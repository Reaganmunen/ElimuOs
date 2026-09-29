const ApiError = require('./ApiError');
const secretBox = require('./secretBox.util');
const daraja = require('./daraja.client');

/**
 * Helpers shared by the M-Pesa controllers: reading a school's saved payment
 * config, decrypting the secrets ONLY at the moment they're needed, building
 * the callback URLs, and working out what is/isn't set up yet.
 */

const envOf = (config) => (config && config.mpesa_env === 'production' ? 'production' : 'sandbox');

const platformSandboxFallback = () =>
  !!(process.env.DARAJA_CONSUMER_KEY && process.env.DARAJA_CONSUMER_SECRET);

function decryptOrFail(stored) {
  try {
    return secretBox.decrypt(stored);
  } catch (e) {
    throw new ApiError(
      500,
      'Saved M-Pesa credentials could not be read (the server encryption key may have changed). Please re-enter them under Payment setup.'
    );
  }
}

/**
 * The Daraja app credentials to use for this school:
 *  - the school's own (saved, encrypted), else
 *  - SANDBOX ONLY: the shared DARAJA_CONSUMER_KEY/SECRET env vars (dev convenience).
 * Production never falls back to shared credentials.
 */
function loadCredentials(config) {
  if (!config) return null;
  const env = envOf(config);
  if (config.consumer_key_enc && config.consumer_secret_enc) {
    return {
      env,
      consumerKey: decryptOrFail(config.consumer_key_enc),
      consumerSecret: decryptOrFail(config.consumer_secret_enc),
      source: 'school',
    };
  }
  if (env === 'sandbox' && platformSandboxFallback()) {
    return { env, consumerKey: process.env.DARAJA_CONSUMER_KEY, consumerSecret: process.env.DARAJA_CONSUMER_SECRET, source: 'platform' };
  }
  return null;
}

function loadPasskey(config) {
  if (!config) return null;
  if (config.passkey_enc) return decryptOrFail(config.passkey_enc);
  if (envOf(config) === 'sandbox' && process.env.DARAJA_PASSKEY) return process.env.DARAJA_PASSKEY;
  return null;
}

function loadInitiator(config) {
  if (!config || !config.initiator_name || !config.initiator_password_enc) return null;
  return { name: config.initiator_name, password: decryptOrFail(config.initiator_password_enc) };
}

/**
 * Where money lands and how each API addresses it.
 *  paybill: BusinessShortCode = PartyB = the paybill.
 *  till:    BusinessShortCode = the store/head-office number (used for the STK
 *           password), PartyB = the till number (falls back to the same number).
 */
function collection(config) {
  const type = config && config.mpesa_shortcode_type === 'till' ? 'till' : 'paybill';
  const businessShortCode = config ? config.mpesa_shortcode : null;
  const partyB = type === 'till' ? (config.mpesa_till_number || businessShortCode) : businessShortCode;
  return {
    type,
    businessShortCode,
    partyB,
    stkTransactionType: type === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
  };
}

// ---------------------------------------------------------------------
// Public callback URLs
// ---------------------------------------------------------------------
const publicBase = () => String(process.env.API_PUBLIC_URL || '').trim().replace(/\/+$/, '');

/**
 * Safaricom silently blocks callback URLs that are not public or that contain
 * "mpesa"/"safaricom" - so all callbacks live under /api/v1/pay/... and this
 * warns about a server address that would still be rejected.
 */
function urlProblem(env) {
  const base = publicBase();
  if (!base) return 'API_PUBLIC_URL is not set on the server, so Safaricom has nowhere to send payment notifications.';
  if (/localhost|127\.0\.0\.1|\[::1\]/i.test(base)) return 'API_PUBLIC_URL points to localhost - Safaricom cannot reach it. Use a public address (e.g. an ngrok URL while testing).';
  if (/m-?pesa|safaricom/i.test(base)) return 'API_PUBLIC_URL contains "mpesa" or "safaricom", which Safaricom rejects in callback URLs. Use a different domain.';
  if (env === 'production' && !/^https:\/\//i.test(base)) return 'API_PUBLIC_URL must start with https:// for live (production) payments.';
  return null;
}

function callbackUrls(config) {
  const base = publicBase();
  if (!base || !config || !config.callback_token) return null;
  const t = config.callback_token;
  return {
    stkCallback: `${base}/api/v1/pay/stk/callback`,
    c2bValidation: `${base}/api/v1/pay/c2b/${t}/validation`,
    c2bConfirmation: `${base}/api/v1/pay/c2b/${t}/confirmation`,
    b2bResult: `${base}/api/v1/pay/b2b/${t}/result`,
    b2bTimeout: `${base}/api/v1/pay/b2b/${t}/timeout`,
  };
}

// ---------------------------------------------------------------------
// What the frontend gets - never a secret, only whether one is saved
// ---------------------------------------------------------------------
function toClient(c = {}) {
  const hasOwnCreds = !!(c.consumer_key_enc && c.consumer_secret_enc);
  return {
    env: c.mpesa_env || 'sandbox',
    shortcodeType: c.mpesa_shortcode_type || 'paybill',
    shortcode: c.mpesa_shortcode || '',
    tillNumber: c.mpesa_till_number || '',
    accountRefPrefix: c.mpesa_account_ref_prefix || '',
    consumerKeySet: !!c.consumer_key_enc,
    consumerKeyHint: c.consumer_key_hint || '',
    consumerSecretSet: !!c.consumer_secret_enc,
    usingPlatformCredentials: !hasOwnCreds && envOf(c) === 'sandbox' && platformSandboxFallback(),
    passkeySet: !!c.passkey_enc,
    stkEnabled: c.stk_enabled !== false,
    c2bEnabled: !!c.c2b_enabled,
    c2bRejectUnmatched: !!c.c2b_reject_unmatched,
    c2bRegisteredAt: c.c2b_registered_at || null,
    c2bRegisterMessage: c.c2b_register_message || '',
    b2bEnabled: !!c.b2b_enabled,
    initiatorName: c.initiator_name || '',
    initiatorPasswordSet: !!c.initiator_password_enc,
    verifiedAt: c.last_verified_at || null,
    verifyOk: c.last_verify_ok === null || c.last_verify_ok === undefined ? null : !!c.last_verify_ok,
    verifyMessage: c.last_verify_message || '',
    updatedAt: c.updated_at || null,
  };
}

/** Human-readable "what's still missing" for each payment method. */
function readiness(c = {}) {
  const env = envOf(c);
  const hasCreds = !!((c.consumer_key_enc && c.consumer_secret_enc) || (env === 'sandbox' && platformSandboxFallback()));
  const hasShortcode = !!c.mpesa_shortcode;
  const hasPasskey = !!(c.passkey_enc || (env === 'sandbox' && process.env.DARAJA_PASSKEY));

  const credentials = hasCreds
    ? { ok: true, detail: c.last_verify_ok === true ? 'Saved and verified with Safaricom.' : 'Saved. Use "Verify connection" to confirm Safaricom accepts them.' }
    : { ok: false, detail: 'Enter your Daraja consumer key and secret.' };

  const stkMissing = [];
  if (!hasCreds) stkMissing.push('Daraja credentials');
  if (!hasShortcode) stkMissing.push('paybill/till number');
  if (!hasPasskey) stkMissing.push('passkey');
  const stk = c.stk_enabled === false
    ? { ok: false, detail: 'Turned off.' }
    : stkMissing.length
      ? { ok: false, detail: `Still needed: ${stkMissing.join(', ')}.` }
      : { ok: true, detail: 'Ready - accountants and parents can send M-Pesa prompts.' };

  let c2b;
  if (!c.c2b_enabled) c2b = { ok: false, detail: 'Turned off.' };
  else if (!hasCreds || !hasShortcode) c2b = { ok: false, detail: 'Needs Daraja credentials and a paybill/till number.' };
  else if (!c.c2b_registered_at) c2b = { ok: false, detail: 'Turned on - now register your URLs with Safaricom.' };
  else c2b = { ok: true, detail: 'Live - payments to your paybill/till are recorded automatically.' };

  let b2b;
  if (!c.b2b_enabled) b2b = { ok: false, detail: 'Turned off.' };
  else if (!hasCreds || !hasShortcode) b2b = { ok: false, detail: 'Needs Daraja credentials and a paybill/till number.' };
  else if (!c.initiator_name || !c.initiator_password_enc) b2b = { ok: false, detail: 'Needs the M-Pesa API initiator name and password.' };
  else if (!daraja.certificateAvailable(env)) b2b = { ok: false, detail: `The Safaricom ${env} certificate is not installed on the server.` };
  else b2b = { ok: true, detail: 'Ready to send payments to other paybills/tills.' };

  return { credentials, stk, c2b, b2b };
}

function platformInfo(config) {
  const env = envOf(config);
  return {
    encryptionAvailable: secretBox.isAvailable(),
    certificates: { sandbox: daraja.certificateAvailable('sandbox'), production: daraja.certificateAvailable('production') },
    urlProblem: urlProblem(env),
  };
}

/** The full payload for GET/PATCH /mpesa/config. */
function buildConfigResponse(config) {
  return {
    config: toClient(config || {}),
    urls: callbackUrls(config),
    readiness: readiness(config || {}),
    platform: platformInfo(config),
  };
}

module.exports = {
  envOf, loadCredentials, loadPasskey, loadInitiator, collection,
  urlProblem, callbackUrls, publicBase, toClient, readiness, platformInfo, buildConfigResponse,
};
