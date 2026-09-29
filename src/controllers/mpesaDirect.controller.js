const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const configModel = require('../models/schoolPaymentConfig.model');
const directModel = require('../models/mpesaDirect.model');
const userModel = require('../models/user.model');
const { comparePassword } = require('../utils/password.util');
const daraja = require('../utils/daraja.client');
const cfg = require('../utils/mpesaConfig.util');

// =====================================================================
// PUBLIC callbacks - Safaricom calls these; there is no JWT.
//
// Safaricom does not sign its callbacks, so the URL carries a long random
// token unique to each school (school_payment_configs.callback_token). An
// unknown token gets a plain 404; a valid one tells us which school the
// callback belongs to - nothing in the request body is trusted for that.
// Confirmation/result handlers always answer 200 "Accepted" once the token is
// valid, so Safaricom doesn't retry endlessly; problems are logged instead.
// =====================================================================

async function schoolFromToken(req) {
  const schoolId = await configModel.resolveSchoolIdByToken(req.params.token);
  if (!schoolId) throw new ApiError(404, 'Not found');
  return schoolId;
}

const ACCEPTED = { ResultCode: '0', ResultDesc: 'Accepted' };

/**
 * C2B validation. Only called by Safaricom if external validation has been
 * switched on for the shortcode (they enable that on request). By default we
 * accept everything - money is never blocked. If the school ticked "reject
 * unknown account numbers" (paybill only) we refuse payments whose account
 * number matches no student.
 */
const c2bValidation = asyncHandler(async (req, res) => {
  const schoolId = await schoolFromToken(req);
  const config = await configModel.get(schoolId);

  if (config && config.c2b_reject_unmatched && config.mpesa_shortcode_type !== 'till') {
    let matched = true; // if we can't tell, accept - never block money because of our own error
    try {
      matched = await directModel.accountMatches(schoolId, req.body && req.body.BillRefNumber);
    } catch (err) {
      console.error('C2B validation lookup failed:', err);
    }
    if (!matched) return res.status(200).json({ ResultCode: 'C2B00012', ResultDesc: 'Rejected' });
  }
  return res.status(200).json(ACCEPTED);
});

/** C2B confirmation: the payment has happened - record it and apply it to the student's invoices. */
const c2bConfirmation = asyncHandler(async (req, res) => {
  const schoolId = await schoolFromToken(req);
  try {
    await directModel.recordC2BPayment(schoolId, req.body || {});
  } catch (err) {
    // The full payload is logged so a payment can be recovered by hand if the database was unavailable.
    console.error('Failed to record C2B payment:', err, JSON.stringify(req.body));
  }
  return res.status(200).json(ACCEPTED);
});

const b2bResult = asyncHandler(async (req, res) => {
  const schoolId = await schoolFromToken(req);
  try {
    await directModel.applyB2BResult(schoolId, req.body || {});
  } catch (err) {
    console.error('Failed to apply B2B result:', err, JSON.stringify(req.body));
  }
  return res.status(200).json(ACCEPTED);
});

const b2bTimeout = asyncHandler(async (req, res) => {
  const schoolId = await schoolFromToken(req);
  try {
    await directModel.applyB2BTimeout(schoolId, req.body || {});
  } catch (err) {
    console.error('Failed to apply B2B timeout:', err, JSON.stringify(req.body));
  }
  return res.status(200).json(ACCEPTED);
});

// =====================================================================
// C2B admin endpoints (school_admin, accountant)
// =====================================================================
const C2B_STATUSES = ['allocated', 'unallocated', 'ignored'];
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

const listC2B = asyncHandler(async (req, res) => {
  const { status, q, from, to, limit, offset } = req.query;
  if (status && !C2B_STATUSES.includes(status)) throw new ApiError(400, 'Invalid status filter');
  if ((from && !isDate(from)) || (to && !isDate(to))) throw new ApiError(400, 'from and to must be YYYY-MM-DD dates');
  const data = await directModel.listC2B(req.user.school_id, {
    status, q, from, to, limit: Math.min(Number(limit) || 100, 300), offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, data);
});

const allocateC2B = asyncHandler(async (req, res) => {
  const { invoiceId } = req.body || {};
  if (!invoiceId || !/^\d+$/.test(String(invoiceId))) throw new ApiError(400, 'invoiceId is required');
  const result = await directModel.allocateManually(req.user.school_id, req.params.id, invoiceId, req.user.id);
  if (!result) throw new ApiError(404, 'Payment not found');
  return sendSuccess(res, 200, result, 'Payment applied to the invoice');
});

const ignoreC2B = asyncHandler(async (req, res) => {
  const reason = typeof (req.body || {}).reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
  if (reason.length < 3) throw new ApiError(400, 'Please give a short reason');
  const result = await directModel.ignoreC2B(req.user.school_id, req.params.id, reason, req.user.id);
  if (!result) throw new ApiError(404, 'Payment not found');
  return sendSuccess(res, 200, result, 'Payment set aside');
});

// =====================================================================
// B2B admin endpoints (school_admin only)
// =====================================================================
const listB2B = asyncHandler(async (req, res) => {
  const { limit, offset } = req.query;
  const rows = await directModel.listB2B(req.user.school_id, {
    limit: Math.min(Number(limit) || 100, 300), offset: Number(offset) || 0,
  });
  return sendSuccess(res, 200, rows);
});

const TARGET_COMMANDS = { paybill: 'BusinessPayBill', till: 'BusinessBuyGoods' };

/**
 * Sends money from the school's M-Pesa business account to another paybill or
 * till. Because this moves money OUT, it needs the admin's own login password
 * every time, and is rate-limited (see mpesa.routes.js).
 */
const sendB2B = asyncHandler(async (req, res) => {
  const schoolId = req.user.school_id;
  const b = req.body || {};

  const config = await configModel.get(schoolId);
  if (!config || !config.b2b_enabled) throw new ApiError(400, 'Paying other paybills/tills is not turned on (Fees -> Payment setup -> Paying out)');
  if (!config.mpesa_shortcode) throw new ApiError(400, 'Save your paybill / till number first');
  const creds = cfg.loadCredentials(config);
  if (!creds) throw new ApiError(400, 'Save your Daraja consumer key and secret first');
  const initiator = cfg.loadInitiator(config);
  if (!initiator) throw new ApiError(400, 'Save the M-Pesa API initiator name and password first');

  // ---- Input ----
  const commandId = TARGET_COMMANDS[b.targetType];
  if (!commandId) throw new ApiError(400, 'Choose whether you are paying a paybill or a till');
  const partyB = String(b.targetNumber || '').trim();
  if (!/^\d{5,7}$/.test(partyB)) throw new ApiError(400, 'The paybill / till number must be 5-7 digits');
  const amount = Number(b.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 10000000) throw new ApiError(400, 'Amount must be a whole number of shillings, at least 1');
  let accountReference = typeof b.accountReference === 'string' ? b.accountReference.trim() : '';
  if (commandId === 'BusinessPayBill') {
    if (!/^[A-Za-z0-9 ._-]{1,13}$/.test(accountReference)) throw new ApiError(400, 'Enter the account number for this paybill (up to 13 letters/numbers)');
  } else {
    accountReference = '';
  }
  const remarks = (typeof b.remarks === 'string' && b.remarks.trim() ? b.remarks.trim() : 'School payment').slice(0, 100);

  // ---- Re-confirm the admin's identity before releasing money ----
  const me = await userModel.findById(req.user.id, schoolId);
  const full = me ? await userModel.findByEmailInSchool(me.email, schoolId) : null;
  if (!full || typeof b.password !== 'string' || !b.password || !(await comparePassword(b.password, full.password_hash))) {
    throw new ApiError(403, 'Your password is incorrect - enter the password you use to log in to ElimuOs');
  }

  if (await directModel.hasRecentDuplicateB2B(schoolId, { partyB, amount, accountReference })) {
    throw new ApiError(409, 'An identical payment was just sent. Check the history below before sending it again.');
  }

  // ---- Security credential ----
  let securityCredential;
  try {
    securityCredential = daraja.getSecurityCredential(creds.env, initiator.password);
  } catch (err) {
    if (err.code === 'CERT_MISSING') throw new ApiError(400, `The Safaricom ${creds.env} certificate is not installed on the server yet. Ask the platform administrator to add it.`);
    throw new ApiError(500, 'Could not prepare the payment credentials');
  }

  const base = cfg.publicBase();
  const urls = cfg.callbackUrls(config);
  if (!base || !urls) throw new ApiError(500, 'API_PUBLIC_URL is not configured on the server');
  const problem = cfg.urlProblem(creds.env);
  if (problem && creds.env === 'production') throw new ApiError(400, problem);

  const partyA = cfg.collection(config).partyB;
  const record = { commandId, partyA, partyB, accountReference: accountReference || null, amount, remarks };

  let response;
  try {
    response = await daraja.b2bPayment({
      ...creds,
      initiator: initiator.name, securityCredential, commandId, amount, partyA, partyB,
      accountReference, remarks, resultUrl: urls.b2bResult, timeoutUrl: urls.b2bTimeout,
    });
  } catch (err) {
    const detail = daraja.describeError(err);
    await directModel.createB2B(schoolId, { ...record, status: 'failed', resultDesc: detail.slice(0, 300) }, req.user.id);
    throw new ApiError(502, `M-Pesa did not accept the payment: ${detail}`);
  }

  if (String(response.ResponseCode) !== '0') {
    const detail = response.ResponseDescription || 'M-Pesa declined the request';
    await directModel.createB2B(schoolId, { ...record, status: 'failed', resultDesc: String(detail).slice(0, 300) }, req.user.id);
    throw new ApiError(502, `M-Pesa did not accept the payment: ${detail}`);
  }

  const txn = await directModel.createB2B(schoolId, {
    ...record, status: 'pending',
    originatorConversationId: response.OriginatorConversationID, conversationId: response.ConversationID,
  }, req.user.id);

  return sendSuccess(res, 201, txn, 'Payment request sent - M-Pesa will confirm shortly');
});

module.exports = {
  c2bValidation, c2bConfirmation, b2bResult, b2bTimeout,
  listC2B, allocateC2B, ignoreC2B, listB2B, sendB2B,
};
