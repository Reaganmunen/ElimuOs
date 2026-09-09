const axios = require('axios');

// NOTE: this talks to Safaricom's Daraja API, which is NOT reachable from
// the sandbox this backend was authored in (network egress here is
// allowlisted to package registries only) — so this client is written to
// the documented Daraja contract but has NOT been exercised against a live
// or sandbox Daraja endpoint. Test it against Safaricom's sandbox
// (https://sandbox.safaricom.co.ke) with real test credentials before
// relying on it — pay particular attention to the password/timestamp
// encoding and the callback URL being publicly reachable (Daraja cannot
// call back to localhost).

const DARAJA_BASE_URL = process.env.DARAJA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

async function getAccessToken() {
  const auth = Buffer.from(`${process.env.DARAJA_CONSUMER_KEY}:${process.env.DARAJA_CONSUMER_SECRET}`).toString('base64');
  const response = await axios.get(
    `${DARAJA_BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${auth}` } }
  );
  return response.data.access_token;
}

function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Initiates an STK Push (the "enter M-Pesa PIN" prompt on the payer's
 * phone). shortcode/passkey are per-school (from school_payment_configs)
 * so each tenant's fee payments land in their own till/paybill.
 */
async function initiateStkPush({ shortcode, passkey, phoneNumber, amount, accountReference, callbackUrl, transactionDesc }) {
  const accessToken = await getAccessToken();
  const timestamp = getTimestamp();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  const response = await axios.post(
    `${DARAJA_BASE_URL}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phoneNumber,       // format: 2547XXXXXXXX
      PartyB: shortcode,
      PhoneNumber: phoneNumber,
      CallBackURL: callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: transactionDesc || 'School fees payment',
    },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  return response.data; // { MerchantRequestID, CheckoutRequestID, ResponseCode, ... }
}

module.exports = { initiateStkPush };
