const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const mpesaModel = require('../models/mpesa.model');
const invoiceModel = require('../models/invoice.model');
const paymentConfigModel = require('../models/schoolPaymentConfig.model');
const { initiateStkPush } = require('../utils/daraja.client');

/**
 * Starts an STK Push for an outstanding invoice. The actual passkey is
 * intentionally NOT read from the database (school_payment_configs only
 * stores a pointer to it) — in production, fetch it from your secrets
 * manager using config.secrets_manager_key. Here it falls back to a single
 * env var for local/dev testing only; do not ship that fallback as-is.
 */
const initiatePayment = asyncHandler(async (req, res) => {
  const { invoiceId, phoneNumber, amount } = req.body;
  if (!invoiceId || !phoneNumber || !amount) {
    throw new ApiError(400, 'invoiceId, phoneNumber and amount are required');
  }

  const invoice = await invoiceModel.getById(req.user.school_id, invoiceId);
  if (!invoice) throw new ApiError(404, 'Invoice not found');

  const config = await paymentConfigModel.get(req.user.school_id);
  if (!config || !config.mpesa_shortcode) {
    throw new ApiError(400, 'This school has not configured an M-Pesa shortcode yet');
  }

  const passkey = process.env.DARAJA_PASSKEY; // dev-only fallback — see note above
  if (!passkey) {
    throw new ApiError(500, 'DARAJA_PASSKEY is not configured on the server');
  }

  const callbackUrl = `${process.env.API_PUBLIC_URL}/api/v1/mpesa/callback`;
  const accountReference = `${config.mpesa_account_ref_prefix || 'FEE'}-${invoice.id}`;

  let daraja;
  try {
    daraja = await initiateStkPush({
      shortcode: config.mpesa_shortcode,
      passkey,
      phoneNumber,
      amount,
      accountReference,
      callbackUrl,
    });
  } catch (err) {
    // Surface Daraja's own error message where available rather than a
    // generic failure, since these are usually actionable (bad shortcode,
    // invalid phone format, etc.)
    const darajaMessage = err.response?.data?.errorMessage || err.message;
    throw new ApiError(502, `M-Pesa request failed: ${darajaMessage}`);
  }

  if (daraja.ResponseCode !== '0') {
    throw new ApiError(502, daraja.ResponseDescription || 'M-Pesa declined the STK Push request');
  }

  const txn = await mpesaModel.createPending(req.user.school_id, {
    invoiceId,
    checkoutRequestId: daraja.CheckoutRequestID,
    merchantRequestId: daraja.MerchantRequestID,
    phoneNumber,
    amount,
  });

  return sendSuccess(res, 201, txn, 'STK Push sent — awaiting customer PIN entry');
});

/**
 * Daraja's public webhook. NOT behind `authenticate` — Safaricom calls this
 * directly with no JWT. Tenant identity is resolved inside
 * mpesa.model.applyCallback() via the globally-unique checkout_request_id,
 * not from anything the caller asserts, so this stays safe despite being
 * unauthenticated. Always responds 200 to Daraja regardless of outcome
 * (per Daraja's own integration guide) so it doesn't retry indefinitely;
 * failures are logged server-side instead.
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

const updatePaymentConfig = asyncHandler(async (req, res) => {
  const { mpesaShortcode, mpesaAccountRefPrefix, secretsManagerKey } = req.body;
  if (!mpesaShortcode) throw new ApiError(400, 'mpesaShortcode is required');
  const config = await paymentConfigModel.upsert(req.user.school_id, { mpesaShortcode, mpesaAccountRefPrefix, secretsManagerKey });
  return sendSuccess(res, 200, config, 'Payment config updated');
});

module.exports = { initiatePayment, handleCallback, listInvoiceTransactions, updatePaymentConfig };
