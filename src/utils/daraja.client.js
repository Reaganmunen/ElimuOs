const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Safaricom Daraja client - stateless with respect to schools: every call is
 * given the credentials to use ({ env, consumerKey, consumerSecret }), so each
 * school's payments go through that school's own Daraja app.
 *
 * NOTE: written to Daraja's documented contract but not exercised against a
 * live/sandbox Daraja endpoint from where it was authored - test on the
 * sandbox first.
 */

const BASE_URLS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};
const HTTP_TIMEOUT_MS = 30000;

const baseUrl = (env) => (env === 'production' ? BASE_URLS.production : BASE_URLS.sandbox);

// ---------------------------------------------------------------------
// Access tokens (valid ~1 hour) - cached in memory so we don't ask Safaricom
// for a new one on every STK push.
// ---------------------------------------------------------------------
const tokenCache = new Map(); // `${env}:${consumerKey}` -> { token, expiresAt }

async function getAccessToken({ env, consumerKey, consumerSecret }, { forceFresh = false } = {}) {
  const cacheKey = `${env}:${consumerKey}`;
  const hit = tokenCache.get(cacheKey);
  if (!forceFresh && hit && hit.expiresAt > Date.now() + 60 * 1000) return hit.token;

  const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const response = await axios.get(`${baseUrl(env)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    timeout: HTTP_TIMEOUT_MS,
  });
  const token = response.data && response.data.access_token;
  if (!token) throw new Error('Daraja did not return an access token');
  const ttlSeconds = Number(response.data.expires_in) || 3599;
  tokenCache.set(cacheKey, { token, expiresAt: Date.now() + ttlSeconds * 1000 });
  return token;
}

/** Drops cached tokens for a consumer key (call after credentials are changed/removed). */
function clearTokenCache(consumerKey) {
  if (!consumerKey) return;
  for (const key of tokenCache.keys()) {
    if (key.endsWith(`:${consumerKey}`)) tokenCache.delete(key);
  }
}

/** Confirms a key/secret pair is accepted by Safaricom (always asks for a fresh token). */
async function verifyCredentials(creds) {
  await getAccessToken(creds, { forceFresh: true });
  return true;
}

/** A readable message out of an axios/Daraja failure. */
function describeError(err) {
  const data = err && err.response && err.response.data;
  if (data) {
    if (typeof data === 'string' && data.trim()) return data.trim().slice(0, 200);
    const msg = data.errorMessage || data.ResponseDescription || data.ResultDesc || data.error_description || data.errorCode;
    if (msg) return String(msg).slice(0, 300);
  }
  if (err && err.response) return `Safaricom returned HTTP ${err.response.status}`;
  if (err && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT')) return 'Safaricom did not respond in time';
  return (err && err.message) || 'Unknown error';
}

/** Daraja timestamps are YYYYMMDDHHmmss in East Africa Time (UTC+3). */
function getTimestamp() {
  const eat = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return eat.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

// ---------------------------------------------------------------------
// STK Push (Lipa na M-Pesa Online)
// ---------------------------------------------------------------------
/**
 * Paybill:  transactionType 'CustomerPayBillOnline', partyB = the paybill.
 * Till:     transactionType 'CustomerBuyGoodsOnline', shortcode = the store /
 *           head-office number used for the password, partyB = the till number.
 */
async function initiateStkPush({
  env, consumerKey, consumerSecret,
  shortcode, passkey, transactionType, partyB,
  phoneNumber, amount, accountReference, callbackUrl, transactionDesc,
}) {
  const accessToken = await getAccessToken({ env, consumerKey, consumerSecret });
  const timestamp = getTimestamp();
  const password = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

  const response = await axios.post(
    `${baseUrl(env)}/mpesa/stkpush/v1/processrequest`,
    {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: transactionType || 'CustomerPayBillOnline',
      Amount: Math.round(amount),
      PartyA: phoneNumber,                 // format: 2547XXXXXXXX
      PartyB: partyB || shortcode,
      PhoneNumber: phoneNumber,
      CallBackURL: callbackUrl,
      AccountReference: String(accountReference).slice(0, 12),
      TransactionDesc: String(transactionDesc || 'School fees').slice(0, 13),
    },
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: HTTP_TIMEOUT_MS }
  );
  return response.data; // { MerchantRequestID, CheckoutRequestID, ResponseCode, ... }
}

// ---------------------------------------------------------------------
// C2B: register the validation + confirmation URLs for a paybill / till
// ---------------------------------------------------------------------
async function registerC2BUrls({ env, consumerKey, consumerSecret, shortcode, confirmationUrl, validationUrl, responseType = 'Completed' }) {
  const accessToken = await getAccessToken({ env, consumerKey, consumerSecret });
  // v2 (production) returns a masked/hashed MSISDN; sandbox is on v1. Override with DARAJA_C2B_VERSION=v1|v2.
  const version = process.env.DARAJA_C2B_VERSION || (env === 'production' ? 'v2' : 'v1');
  const response = await axios.post(
    `${baseUrl(env)}/mpesa/c2b/${version}/registerurl`,
    {
      ShortCode: String(shortcode),
      ResponseType: responseType, // what M-Pesa does if our validation URL can't be reached: 'Completed' never blocks a customer's money
      ConfirmationURL: confirmationUrl,
      ValidationURL: validationUrl,
    },
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: HTTP_TIMEOUT_MS }
  );
  return response.data;
}

// ---------------------------------------------------------------------
// B2B: business -> another paybill / till
// ---------------------------------------------------------------------
function certificatePath(env) {
  const fromEnv = env === 'production' ? process.env.DARAJA_CERT_PRODUCTION_PATH : process.env.DARAJA_CERT_SANDBOX_PATH;
  return fromEnv || path.join(__dirname, '..', 'certs', env === 'production' ? 'production.cer' : 'sandbox.cer');
}

/** True if the Safaricom public certificate for this environment is installed on the server. */
function certificateAvailable(env) {
  try { return fs.existsSync(certificatePath(env)); } catch (e) { return false; }
}

/**
 * SecurityCredential = the M-Pesa API operator's password, RSA-encrypted
 * (PKCS#1 v1.5) with Safaricom's public certificate, then base64.
 * Download the certificate for each environment from the Daraja portal and
 * save it as src/certs/sandbox.cer / src/certs/production.cer.
 */
function getSecurityCredential(env, initiatorPassword) {
  const file = certificatePath(env);
  if (!fs.existsSync(file)) {
    const err = new Error(`The Safaricom ${env} certificate is not installed on the server (expected at ${file})`);
    err.code = 'CERT_MISSING';
    throw err;
  }
  const raw = fs.readFileSync(file);
  let publicKey;
  try {
    publicKey = new crypto.X509Certificate(raw).publicKey; // handles PEM or DER certificates
  } catch (e) {
    publicKey = crypto.createPublicKey(raw); // a bare public key in PEM
  }
  const encrypted = crypto.publicEncrypt(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
    Buffer.from(String(initiatorPassword), 'utf8')
  );
  return encrypted.toString('base64');
}

/**
 * commandId: 'BusinessPayBill' (paying a paybill - AccountReference required)
 *            'BusinessBuyGoods' (paying a till).
 * Note: "RecieverIdentifierType" is spelled that way in Daraja's own API.
 */
async function b2bPayment({
  env, consumerKey, consumerSecret,
  initiator, securityCredential, commandId, amount, partyA, partyB,
  accountReference, remarks, resultUrl, timeoutUrl,
}) {
  const accessToken = await getAccessToken({ env, consumerKey, consumerSecret });
  const response = await axios.post(
    `${baseUrl(env)}/mpesa/b2b/v1/paymentrequest`,
    {
      Initiator: initiator,
      SecurityCredential: securityCredential,
      CommandID: commandId,
      SenderIdentifierType: '4',
      RecieverIdentifierType: '4',
      Amount: String(Math.round(amount)),
      PartyA: String(partyA),
      PartyB: String(partyB),
      AccountReference: String(accountReference || 'School').slice(0, 13),
      Remarks: String(remarks || 'School payment').slice(0, 100),
      QueueTimeOutURL: timeoutUrl,
      ResultURL: resultUrl,
    },
    { headers: { Authorization: `Bearer ${accessToken}` }, timeout: HTTP_TIMEOUT_MS }
  );
  return response.data; // { OriginatorConversationID, ConversationID, ResponseCode, ResponseDescription }
}

module.exports = {
  baseUrl, getAccessToken, clearTokenCache, verifyCredentials, describeError,
  initiateStkPush, registerC2BUrls,
  certificateAvailable, getSecurityCredential, b2bPayment,
};
