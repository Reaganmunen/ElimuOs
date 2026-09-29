const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const mpesaModel = require('../models/mpesa.model');
const invoiceModel = require('../models/invoice.model');
const paymentConfigModel = require('../models/schoolPaymentConfig.model');
const guardianModel = require('../models/guardian.model');
const daraja = require('../utils/daraja.client');
const secretBox = require('../utils/secretBox.util');
const cfg = require('../utils/mpesaConfig.util');
const { normalizeKenyanPhone } = require('../utils/phone.util');

/**
 * The message a caller sees when payments aren't set up. Parents get a plain
 * "contact the school" message; staff get the specific thing that's missing.
 */
function notReady(req, detail) {
  if (req.user.role === 'parent') {
    return new ApiError(400, 'Online M-Pesa payment is not available for this school yet. Please contact the school office.');
  }
  return new ApiError(400, detail);
}

/**
 * Starts an STK Push for an outstanding invoice, using THIS school's own
 * Daraja credentials, paybill/till and passkey (saved encrypted under
 * Fees -> Payment setup).
 */
const initiatePayment = asyncHandler(async (req, res) => {
  const { invoiceId, phoneNumber, amount } = req.body;
  if (!invoiceId || !phoneNumber || !amount) {
    throw new ApiError(400, 'invoiceId, phoneNumber and amount are required');
  }

  const invoice = await invoiceModel.getById(req.user.school_id, invoiceId);
  if (!invoice) throw new ApiError(404, 'Invoice not found');

  // This route is also open to 'parent' - tenant scoping above only proves the
  // invoice belongs to THIS school, not that it belongs to THIS parent's own
  // child. 404 (not 403) so a non-owner can't confirm the invoice exists.
  if (req.user.role === 'parent') {
    const owns = await guardianModel.isGuardianOfStudent(req.user.school_id, req.user.id, invoice.student_id);
    if (!owns) throw new ApiError(404, 'Invoice not found');
  }

  // Validated AFTER the ownership check so a non-owner can't probe balances via error messages.
  const phone = normalizeKenyanPhone(phoneNumber);
  if (!phone) throw new ApiError(400, 'phoneNumber must be a valid Kenyan mobile number, e.g. 0712345678');
  const stkAmount = Math.round(Number(amount));
  const balance = Number(invoice.total_amount) - Number(invoice.amount_paid || 0);
  if (!Number.isFinite(stkAmount) || stkAmount < 1) throw new ApiError(400, 'amount must be at least KES 1');
  if (balance <= 0) throw new ApiError(400, 'This invoice is already fully paid');
  if (stkAmount > Math.ceil(balance)) throw new ApiError(400, `Amount exceeds the outstanding balance of KES ${Math.ceil(balance).toLocaleString('en-KE')}`);

  const config = await paymentConfigModel.get(req.user.school_id);
  if (!config || !config.mpesa_shortcode) throw notReady(req, 'This school has not set up its paybill/till number yet (Fees -> Payment setup).');
  if (config.stk_enabled === false) throw notReady(req, 'M-Pesa payment prompts (STK Push) are turned off in Payment setup.');

  const creds = cfg.loadCredentials(config);
  if (!creds) throw notReady(req, 'This school has not entered its M-Pesa (Daraja) consumer key and secret yet (Fees -> Payment setup).');
  const passkey = cfg.loadPasskey(config);
  if (!passkey) throw notReady(req, 'This school has not entered its M-Pesa passkey yet (Fees -> Payment setup).');

  const base = cfg.publicBase();
  if (!base) throw new ApiError(500, 'API_PUBLIC_URL is not configured on the server');

  // Daraja allows at most 12 characters in AccountReference - trim the prefix, never the invoice number.
  const idPart = String(invoice.id);
  const prefix = String(config.mpesa_account_ref_prefix || 'FEE').replace(/[^A-Za-z0-9]/g, '').slice(0, Math.max(1, 12 - 1 - idPart.length)) || 'FEE';
  const accountReference = `${prefix}-${idPart}`;

  const target = cfg.collection(config);

  let response;
  try {
    response = await daraja.initiateStkPush({
      ...creds,
      shortcode: target.businessShortCode,
      passkey,
      transactionType: target.stkTransactionType,
      partyB: target.partyB,
      phoneNumber: phone,
      amount: stkAmount,
      accountReference,
      callbackUrl: `${base}/api/v1/pay/stk/callback`,
    });
  } catch (err) {
    throw new ApiError(502, `M-Pesa request failed: ${daraja.describeError(err)}`);
  }

  if (response.ResponseCode !== '0') {
    throw new ApiError(502, response.ResponseDescription || 'M-Pesa declined the STK Push request');
  }

  const txn = await mpesaModel.createPending(req.user.school_id, {
    invoiceId,
    checkoutRequestId: response.CheckoutRequestID,
    merchantRequestId: response.MerchantRequestID,
    phoneNumber: phone,
    amount: stkAmount,
  });

  return sendSuccess(res, 201, txn, 'STK Push sent - awaiting customer PIN entry');
});

/**
 * Daraja's public STK webhook. NOT behind `authenticate` - Safaricom calls
 * this directly with no JWT. Tenant identity is resolved inside
 * mpesa.model.applyCallback() via the globally-unique checkout_request_id.
 * Always answers 200 so Daraja doesn't retry forever; failures are logged.
 * Reachable at BOTH /api/v1/pay/stk/callback (new - no "mpesa" in the URL,
 * which Safaricom filters) and the legacy /api/v1/mpesa/callback.
 */
const handleCallback = asyncHandler(async (req, res) => {
  const stkCallback = req.body?.Body?.stkCallback;
  if (!stkCallback) {
    console.error('Malformed Daraja callback payload:', JSON.stringify(req.body));
    return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

  let mpesaReceiptNumber = null;
  let amountPaid = null;
  if (CallbackMetadata?.Item) {
    for (const item of CallbackMetadata.Item) {
      if (item.Name === 'MpesaReceiptNumber') mpesaReceiptNumber = item.Value;
      if (item.Name === 'Amount') amountPaid = item.Value;
    }
  }

  try {
    await mpesaModel.applyCallback({
      checkoutRequestId: CheckoutRequestID,
      resultCode: ResultCode,
      resultDesc: ResultDesc,
      mpesaReceiptNumber,
      amountPaid,
      rawPayload: req.body,
    });
  } catch (err) {
    console.error('Failed to apply M-Pesa callback:', err);
  }

  return res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

const listInvoiceTransactions = asyncHandler(async (req, res) => {
  const txns = await mpesaModel.listByInvoice(req.user.school_id, req.params.invoiceId);
  return sendSuccess(res, 200, txns);
});

// =====================================================================
// Payment setup (school_admin)
// =====================================================================

/** Config for the setup screen. Secrets are never returned - only whether each one is saved. */
const getPaymentConfig = asyncHandler(async (req, res) => {
  const config = await paymentConfigModel.get(req.user.school_id);
  return sendSuccess(res, 200, cfg.buildConfigResponse(config));
});

// undefined = "not sent, keep what's saved"; '' = "cleared" (stored as null)
const text = (incoming, existing) => (incoming === undefined ? existing : (String(incoming).trim() || null));
const flag = (incoming, existing) => (incoming === undefined ? existing : incoming === true);

const SHORTCODE_RE = /^\d{5,7}$/;
const SECRET_CLEARABLE = { consumerKey: 'consumerKey', consumerSecret: 'consumerSecret', passkey: 'passkey', initiatorPassword: 'initiatorPassword' };

/**
 * Partial update: only the fields present in the body change. A secret
 * (consumer key/secret, passkey, initiator password) is replaced when a
 * non-empty value is sent and kept when it is omitted/blank; send
 * `clear: ['passkey', ...]` to remove one.
 */
const updatePaymentConfig = asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  const b = req.body || {};
  const old = (await paymentConfigModel.get(schoolId)) || {};

  const next = {
    mpesa_env: b.env === undefined ? (old.mpesa_env || 'sandbox') : b.env,
    mpesa_shortcode_type: b.shortcodeType === undefined ? (old.mpesa_shortcode_type || 'paybill') : b.shortcodeType,
    mpesa_shortcode: text(b.shortcode, old.mpesa_shortcode),
    mpesa_till_number: text(b.tillNumber, old.mpesa_till_number),
    mpesa_account_ref_prefix: text(b.accountRefPrefix, old.mpesa_account_ref_prefix),
    consumer_key_enc: old.consumer_key_enc || null,
    consumer_key_hint: old.consumer_key_hint || null,
    consumer_secret_enc: old.consumer_secret_enc || null,
    passkey_enc: old.passkey_enc || null,
    stk_enabled: flag(b.stkEnabled, old.stk_enabled !== false),
    c2b_enabled: flag(b.c2bEnabled, !!old.c2b_enabled),
    c2b_reject_unmatched: flag(b.c2bRejectUnmatched, !!old.c2b_reject_unmatched),
    c2b_registered_at: old.c2b_registered_at || null,
    c2b_register_message: old.c2b_register_message || null,
    b2b_enabled: flag(b.b2bEnabled, !!old.b2b_enabled),
    initiator_name: text(b.initiatorName, old.initiator_name),
    initiator_password_enc: old.initiator_password_enc || null,
    last_verified_at: old.last_verified_at || null,
    last_verify_ok: old.last_verify_ok === undefined ? null : old.last_verify_ok,
    last_verify_message: old.last_verify_message || null,
  };

  // ---- Field validation (only what was actually sent) ----
  if (!['sandbox', 'production'].includes(next.mpesa_env)) throw new ApiError(400, 'Environment must be "sandbox" or "production"');
  if (!['paybill', 'till'].includes(next.mpesa_shortcode_type)) throw new ApiError(400, 'Account type must be "paybill" or "till"');
  if (b.shortcode !== undefined && next.mpesa_shortcode && !SHORTCODE_RE.test(next.mpesa_shortcode)) {
    throw new ApiError(400, 'The paybill / business number must be 5-7 digits');
  }
  if (b.tillNumber !== undefined && next.mpesa_till_number && !SHORTCODE_RE.test(next.mpesa_till_number)) {
    throw new ApiError(400, 'The till number must be 5-7 digits');
  }
  if (b.accountRefPrefix !== undefined && next.mpesa_account_ref_prefix && !/^[A-Za-z0-9]{1,8}$/.test(next.mpesa_account_ref_prefix)) {
    throw new ApiError(400, 'The account reference prefix can only contain letters and numbers (up to 8 characters)');
  }
  if (b.initiatorName !== undefined && next.initiator_name && !/^[A-Za-z0-9._-]{2,50}$/.test(next.initiator_name)) {
    throw new ApiError(400, 'The initiator name can only contain letters, numbers, dots, dashes and underscores');
  }

  // ---- Secrets ----
  const newKey = typeof b.consumerKey === 'string' ? b.consumerKey.trim() : '';
  const newSecret = typeof b.consumerSecret === 'string' ? b.consumerSecret.trim() : '';
  const newPasskey = typeof b.passkey === 'string' ? b.passkey.trim() : '';
  const newInitiatorPassword = typeof b.initiatorPassword === 'string' ? b.initiatorPassword : '';
  const toClear = Array.isArray(b.clear) ? b.clear.filter((k) => SECRET_CLEARABLE[k]) : [];

  if (newKey && !/^\S{8,200}$/.test(newKey)) throw new ApiError(400, 'That consumer key does not look right - copy it again from your Daraja app (no spaces)');
  if (newSecret && !/^\S{8,300}$/.test(newSecret)) throw new ApiError(400, 'That consumer secret does not look right - copy it again from your Daraja app (no spaces)');
  if (newPasskey && !/^\S{16,300}$/.test(newPasskey)) throw new ApiError(400, 'That passkey does not look right - copy it again from your Daraja app or M-Pesa portal (no spaces)');
  if (newInitiatorPassword && newInitiatorPassword.length > 100) throw new ApiError(400, 'The initiator password is too long');

  if ((newKey || newSecret || newPasskey || newInitiatorPassword) && !secretBox.isAvailable()) {
    throw new ApiError(400, "This server can't store credentials securely yet (CONFIG_ENCRYPTION_KEY is not set). Ask the platform administrator to set it.");
  }

  const secretsChanged = [];
  const secretsRemoved = [];
  if (newKey) { next.consumer_key_enc = secretBox.encrypt(newKey); next.consumer_key_hint = newKey.slice(-4); secretsChanged.push('consumerKey'); }
  if (newSecret) { next.consumer_secret_enc = secretBox.encrypt(newSecret); secretsChanged.push('consumerSecret'); }
  if (newPasskey) { next.passkey_enc = secretBox.encrypt(newPasskey); secretsChanged.push('passkey'); }
  if (newInitiatorPassword) { next.initiator_password_enc = secretBox.encrypt(newInitiatorPassword); secretsChanged.push('initiatorPassword'); }
  for (const k of toClear) {
    if (k === 'consumerKey') { next.consumer_key_enc = null; next.consumer_key_hint = null; }
    if (k === 'consumerSecret') next.consumer_secret_enc = null;
    if (k === 'passkey') next.passkey_enc = null;
    if (k === 'initiatorPassword') next.initiator_password_enc = null;
    secretsRemoved.push(k);
  }

  // ---- Combination rules ----
  if (next.c2b_enabled && !next.mpesa_shortcode) {
    throw new ApiError(400, 'Enter your paybill / till number before turning on direct payments');
  }
  if (next.b2b_enabled) {
    if (!next.mpesa_shortcode) throw new ApiError(400, 'Enter your paybill / till number before turning on paying out');
    if (!next.initiator_name || !next.initiator_password_enc) {
      throw new ApiError(400, 'Enter the M-Pesa API initiator name and password before turning on paying out');
    }
  }

  // ---- Anything that invalidates earlier results ----
  const credsChanged = newKey || newSecret || toClear.includes('consumerKey') || toClear.includes('consumerSecret')
    || next.mpesa_env !== (old.mpesa_env || 'sandbox');
  if (credsChanged) { next.last_verified_at = null; next.last_verify_ok = null; next.last_verify_message = null; }

  const partyBBefore = cfg.collection(old.mpesa_shortcode ? old : { mpesa_shortcode_type: next.mpesa_shortcode_type }).partyB;
  const partyBAfter = cfg.collection(next).partyB;
  if (next.mpesa_env !== (old.mpesa_env || 'sandbox') || String(partyBBefore || '') !== String(partyBAfter || '')) {
    next.c2b_registered_at = null;
    next.c2b_register_message = null;
  }

  const saved = await paymentConfigModel.upsert(schoolId, next, req.user.id, { secretsChanged, secretsRemoved });

  // A changed/removed key must not keep being served from the token cache.
  if (credsChanged && old.consumer_key_enc) {
    try { daraja.clearTokenCache(secretBox.decrypt(old.consumer_key_enc)); } catch (e) { /* key unreadable - nothing cached for it anyway */ }
  }

  return sendSuccess(res, 200, cfg.buildConfigResponse(saved), 'Payment setup saved');
});

/**
 * "Verify connection": asks Safaricom for an access token with the SAVED
 * credentials. Costs nothing and moves no money. Answers 200 with ok:false
 * (rather than an HTTP error) so the screen can show why.
 */
const verifyCredentials = asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  const config = await paymentConfigModel.get(schoolId);
  const creds = cfg.loadCredentials(config);
  if (!creds) throw new ApiError(400, 'Save your consumer key and consumer secret first');

  let ok = true;
  let message = `Connected to Safaricom (${creds.env}). Your credentials are valid.`;
  try {
    await daraja.verifyCredentials(creds);
  } catch (err) {
    ok = false;
    const status = err.response && err.response.status;
    message = (status === 400 || status === 401)
      ? `Safaricom rejected these credentials (${creds.env}). Check the consumer key and secret, and that the environment matches the Daraja app they came from.`
      : `Could not reach Safaricom: ${daraja.describeError(err)}`;
  }

  // Only worth saving for the school's own credentials (a platform sandbox fallback has no row to update).
  if (config) await paymentConfigModel.recordVerification(schoolId, { ok, message });
  return sendSuccess(res, 200, { ok, message, verifiedAt: new Date().toISOString(), usingPlatformCredentials: creds.source === 'platform' });
});

/** Registers this school's validation + confirmation URLs with Safaricom for its paybill/till (C2B). */
const registerC2b = asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  const config = await paymentConfigModel.get(schoolId);
  if (!config || !config.mpesa_shortcode) throw new ApiError(400, 'Save your paybill / till number first');
  if (!config.c2b_enabled) throw new ApiError(400, 'Turn on direct payments and save before registering your URLs');

  const creds = cfg.loadCredentials(config);
  if (!creds) throw new ApiError(400, 'Save your consumer key and consumer secret first');

  const urls = cfg.callbackUrls(config);
  const problem = cfg.urlProblem(creds.env);
  if (!urls) throw new ApiError(400, problem || 'The server has no public address configured (API_PUBLIC_URL)');
  if (problem && creds.env === 'production') throw new ApiError(400, problem);

  const shortcode = cfg.collection(config).partyB;

  let ok = true;
  let message = 'URLs registered. Payments made to your paybill/till will now appear under "Paybill / Till payments".';
  try {
    const data = await daraja.registerC2BUrls({
      ...creds, shortcode, confirmationUrl: urls.c2bConfirmation, validationUrl: urls.c2bValidation, responseType: 'Completed',
    });
    if (data && data.ResponseCode !== undefined && String(data.ResponseCode) !== '0') {
      ok = false;
      message = data.ResponseDescription || 'Safaricom did not accept the registration';
    }
  } catch (err) {
    ok = false;
    const detail = daraja.describeError(err);
    message = /duplicate|already/i.test(detail)
      ? 'Safaricom says URLs are already registered for this number. On a live shortcode they can only be changed through your Daraja portal (URL management) or by Safaricom - ask them to point it at the URLs shown here.'
      : `Registration failed: ${detail}`;
  }

  await paymentConfigModel.recordC2BRegistration(schoolId, { ok, message }, req.user.id);
  return sendSuccess(res, 200, { ok, message });
});

// =====================================================================
// STK prompt history (unchanged)
// =====================================================================
const TXN_STATUSES = ['pending', 'success', 'failed', 'cancelled', 'timeout'];
const listTransactions = asyncHandler(async (req, res) => {
  const { status, q, from, to, limit, offset } = req.query;
  if (status && !TXN_STATUSES.includes(status)) throw new ApiError(400, 'Invalid status filter');
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  if ((from && !isDate(from)) || (to && !isDate(to))) throw new ApiError(400, 'from and to must be YYYY-MM-DD dates');
  const data = await mpesaModel.listAll(req.user.school_id, {
    status, q, from, to, limit: Math.min(Number(limit) || 100, 300), offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, data);
});

module.exports = {
  initiatePayment, handleCallback, listTransactions, listInvoiceTransactions,
  getPaymentConfig, updatePaymentConfig, verifyCredentials, registerC2b,
};
