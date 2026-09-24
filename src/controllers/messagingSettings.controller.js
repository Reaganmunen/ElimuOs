const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const configModel = require('../models/schoolMessagingConfig.model');
const secretBox = require('../utils/secretBox.util');
const notificationProvider = require('../utils/notification.provider');

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const MODES = ['platform', 'own'];

/** Never returns a secret — only whether one is saved. */
function toClient(c = {}) {
  return {
    smsMode: c.sms_mode || 'platform', smsSenderId: c.sms_sender_id || '',
    atUsername: c.at_username || '', atApiKeySet: !!c.at_api_key_enc,
    emailMode: c.email_mode || 'platform', fromName: c.from_name || '', replyTo: c.reply_to || '',
    smtpHost: c.smtp_host || '', smtpPort: c.smtp_port || 587, smtpSecure: !!c.smtp_secure,
    smtpUser: c.smtp_user || '', smtpPasswordSet: !!c.smtp_password_enc, smtpFromEmail: c.smtp_from_email || '',
  };
}

const getSettings = asyncHandler(async (req, res) => {
  const cfg = await configModel.get(req.user.school_id);
  return sendSuccess(res, 200, {
    settings: toClient(cfg || {}),
    // what the shared account can actually do on this server — the UI disables options that can't work
    platform: { sms: !!(process.env.AT_USERNAME && process.env.AT_API_KEY), email: !!process.env.SMTP_HOST },
    encryptionAvailable: secretBox.isAvailable(),
  });
});

// undefined = "not sent, keep what's saved"; '' = "cleared" (stored as null)
const text = (incoming, existing) => (incoming === undefined ? existing : (String(incoming).trim() || null));

const updateSettings = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const old = (await configModel.get(req.user.school_id)) || {};

  const next = {
    sms_mode: b.smsMode ?? old.sms_mode ?? 'platform',
    sms_sender_id: text(b.smsSenderId, old.sms_sender_id),
    at_username: text(b.atUsername, old.at_username),
    at_api_key_enc: old.at_api_key_enc,
    email_mode: b.emailMode ?? old.email_mode ?? 'platform',
    from_name: text(b.fromName, old.from_name),
    reply_to: text(b.replyTo, old.reply_to),
    smtp_host: text(b.smtpHost, old.smtp_host),
    smtp_port: b.smtpPort === undefined ? old.smtp_port : (b.smtpPort === '' || b.smtpPort === null ? null : Number(b.smtpPort)),
    smtp_secure: b.smtpSecure === undefined ? !!old.smtp_secure : !!b.smtpSecure,
    smtp_user: text(b.smtpUser, old.smtp_user),
    smtp_password_enc: old.smtp_password_enc,
    smtp_from_email: text(b.smtpFromEmail, old.smtp_from_email),
  };

  // Secrets: a non-empty value replaces the saved one; blank/absent keeps it.
  const newAtKey = typeof b.atApiKey === 'string' && b.atApiKey.trim() ? b.atApiKey.trim() : null;
  const newSmtpPass = typeof b.smtpPassword === 'string' && b.smtpPassword ? b.smtpPassword : null;
  if ((newAtKey || newSmtpPass) && !secretBox.isAvailable()) {
    throw new ApiError(400, "This server can't store credentials securely yet (CONFIG_ENCRYPTION_KEY is not set). Ask the platform administrator to set it.");
  }
  if (newAtKey) next.at_api_key_enc = secretBox.encrypt(newAtKey);
  if (newSmtpPass) next.smtp_password_enc = secretBox.encrypt(newSmtpPass);

  if (!MODES.includes(next.sms_mode) || !MODES.includes(next.email_mode)) throw new ApiError(400, 'Mode must be "platform" or "own"');
  if (next.sms_sender_id && !/^[A-Za-z0-9]{1,11}$/.test(next.sms_sender_id)) {
    throw new ApiError(400, 'SMS sender ID must be 1–11 letters/numbers, with no spaces or symbols');
  }
  if (next.from_name && (next.from_name.length > 60 || /[\r\n<>"]/.test(next.from_name))) throw new ApiError(400, 'From name must be under 60 characters and cannot contain < > or quotes');
  if (next.reply_to && !EMAIL_RE.test(next.reply_to)) throw new ApiError(400, 'Reply-to must be a valid email address');
  if (next.smtp_from_email && !EMAIL_RE.test(next.smtp_from_email)) throw new ApiError(400, 'SMTP "from" address must be a valid email address');
  if (next.smtp_port != null && !notificationProvider.ALLOWED_SMTP_PORTS.includes(next.smtp_port)) {
    throw new ApiError(400, `SMTP port must be one of ${notificationProvider.ALLOWED_SMTP_PORTS.join(', ')}`);
  }
  if (next.sms_mode === 'own' && (!next.at_username || !next.at_api_key_enc)) throw new ApiError(400, "Enter your Africa's Talking username and API key to use your own SMS account");
  if (next.email_mode === 'own') {
    if (!next.smtp_host || !next.smtp_user || !next.smtp_password_enc || !next.smtp_from_email) {
      throw new ApiError(400, 'Enter the SMTP host, username, password and from-address to use your own email server');
    }
    await notificationProvider.assertPublicHost(next.smtp_host); // rejects private/internal hosts
  }

  const saved = await configModel.upsert(req.user.school_id, next, req.user.id, {
    atKeyChanged: !!newAtKey, smtpPasswordChanged: !!newSmtpPass,
  });
  return sendSuccess(res, 200, toClient(saved), 'Sender settings saved');
});

/** Sends one test message using the school's SAVED settings, so credentials can be checked before a real broadcast. */
const sendTest = asyncHandler(async (req, res) => {
  const { channel, to } = req.body || {};
  if (!['sms', 'email'].includes(channel) || !to) throw new ApiError(400, 'channel ("sms" or "email") and to are required');
  if (channel === 'email' && !EMAIL_RE.test(to)) throw new ApiError(400, 'Enter a valid email address');

  const sender = await notificationProvider.forSchool(req.user.school_id);
  try {
    await sender.prepare(channel);
    const result = await sender.send(channel, {
      to, subject: 'ElimuOs test message',
      body: 'This is a test message from your ElimuOs sender settings. If you received it, sending works.',
    });
    return sendSuccess(res, 200, { providerMessageId: result.providerMessageId || null }, 'Test message sent');
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(502, `The provider did not accept the test message: ${err.message}`);
  } finally {
    sender.close();
  }
});

module.exports = { getSettings, updateSettings, sendTest };