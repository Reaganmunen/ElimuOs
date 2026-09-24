// NOTE: the actual network calls to Africa's Talking and SMTP servers are NOT
// reachable from the sandbox this was written in — these are written to their
// documented APIs but not exercised live. Test with real (sandbox) credentials.
//
// Two entry points:
//   forSchool(schoolId) — what school broadcasts and test messages use. Resolves
//     THAT school's sender config (shared ElimuOs account + the school's own
//     sender ID / From-name, or the school's own accounts) — a school can never
//     end up sending with another school's settings.
//   send(channel, msg)  — PLATFORM mail only (password-reset emails etc.), sent
//     from the shared .env account with no school identity. Never use it for
//     anything a school authors.

const dns = require('dns').promises;
const net = require('net');
const nodemailer = require('nodemailer');
const axios = require('axios');
const ApiError = require('./ApiError');
const secretBox = require('./secretBox.util');
const configModel = require('../models/schoolMessagingConfig.model');
const schoolModel = require('../models/school.model');

const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525];
const CONFIG_HINT = 'Fix it under Communication → Sender settings.';

// ---------- helpers ----------

/** Kenyan-friendly normaliser → +2547XXXXXXXX (Africa's Talking wants international format with "+"). */
function normalizePhone(raw) {
  const p = String(raw || '').replace(/[\s\-().]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return `+${p.slice(2)}`;
  if (/^254\d{9}$/.test(p)) return `+${p}`;
  if (/^0[17]\d{8}$/.test(p)) return `+254${p.slice(1)}`;
  if (/^[17]\d{8}$/.test(p)) return `+254${p}`;
  return p;
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/**
 * A school supplying its own SMTP host is a tenant choosing where the server
 * connects — without this check it could point at localhost / the database /
 * cloud metadata and probe the internal network. Returns the checked public
 * IP so the caller connects to THAT address (not a second DNS lookup an
 * attacker could flip to an internal one).
 */
async function assertPublicHost(host) {
  const h = String(host || '').trim();
  if (!h || /\s/.test(h)) throw new ApiError(400, 'SMTP host is required');
  let addrs;
  if (net.isIP(h)) addrs = [{ address: h }];
  else {
    try { addrs = await dns.lookup(h, { all: true }); } catch (e) { throw new ApiError(400, `Could not resolve the SMTP host "${h}"`); }
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw new ApiError(400, 'That SMTP host points to a private or internal address, which is not allowed');
  }
  return addrs[0].address;
}

// ---------- SMS (Africa's Talking) ----------

async function sendSms({ username, apiKey, senderId }, { to, body }) {
  const phone = normalizePhone(to);
  if (!/^\+\d{8,15}$/.test(phone)) throw new Error(`"${to}" is not a valid phone number`);
  const base = username === 'sandbox' ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
  const params = new URLSearchParams({ username, to: phone, message: body });
  if (senderId) params.set('from', senderId); // only when set — URLSearchParams would send the text "undefined"
  const response = await axios.post(`${base}/version1/messaging`, params, {
    headers: { apiKey, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    timeout: 15000,
  });
  const recipient = response.data?.SMSMessageData?.Recipients?.[0];
  // 100 Processed / 101 Sent / 102 Queued. Anything else (InvalidPhoneNumber, InvalidSenderId,
  // InsufficientBalance…) is a failure even though the HTTP call itself returned 2xx.
  if (!recipient || ![100, 101, 102].includes(Number(recipient.statusCode))) {
    throw new Error(`Africa's Talking: ${recipient?.status || response.data?.SMSMessageData?.Message || 'no recipient status returned'}`);
  }
  return { providerMessageId: recipient.messageId };
}

// ---------- platform (shared) mail — no school identity ----------

let platformTransporter = null;
function getPlatformTransporter() {
  if (!process.env.SMTP_HOST) throw new ApiError(400, 'Shared ElimuOs email is not set up on this server yet. Use your own SMTP server under Communication → Sender settings.');
  if (!platformTransporter) {
    const port = Number(process.env.SMTP_PORT) || 587;
    platformTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
  }
  return platformTransporter;
}

/** Platform-level send (password resets etc). Not for school-authored messages. */
async function send(channel, { to, subject, body }) {
  if (channel === 'email') {
    const info = await getPlatformTransporter().sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text: body });
    return { providerMessageId: info.messageId };
  }
  throw new Error(`Platform send only supports email (got "${channel}") — use forSchool() for school messages`);
}

// ---------- per-school sender ----------

async function forSchool(schoolId) {
  const [cfg, school] = await Promise.all([configModel.get(schoolId), schoolModel.findById(schoolId)]);
  const c = cfg || {};
  const displayName = String(c.from_name || school?.name || 'School').replace(/[\r\n<>"]/g, '').trim() || 'School';
  const replyTo = c.reply_to || school?.email || undefined;
  const decrypt = (value) => {
    try { return secretBox.decrypt(value); } catch (e) { throw new ApiError(400, `Your saved credentials could not be read (the server's encryption key may have changed). Re-enter them. ${CONFIG_HINT}`); }
  };

  let smsCreds = null;
  let mail = null;
  let ownTransport = null;

  async function resolveSms() {
    if (smsCreds) return smsCreds;
    if (c.sms_mode === 'own') {
      if (!c.at_username || !c.at_api_key_enc) throw new ApiError(400, `Your school's own SMS account is selected but its credentials are incomplete. ${CONFIG_HINT}`);
      smsCreds = { username: c.at_username, apiKey: decrypt(c.at_api_key_enc), senderId: c.sms_sender_id || undefined };
    } else {
      if (!process.env.AT_USERNAME || !process.env.AT_API_KEY) {
        throw new ApiError(400, "SMS on the shared ElimuOs account isn't set up on this server yet. Use your own Africa's Talking account under Communication → Sender settings.");
      }
      smsCreds = { username: process.env.AT_USERNAME, apiKey: process.env.AT_API_KEY, senderId: c.sms_sender_id || process.env.AT_SENDER_ID || undefined };
    }
    return smsCreds;
  }

  async function resolveMail() {
    if (mail) return mail;
    if (c.email_mode === 'own') {
      if (!c.smtp_host || !c.smtp_user || !c.smtp_password_enc || !c.smtp_from_email) {
        throw new ApiError(400, `Your school's own SMTP server is selected but its details are incomplete. ${CONFIG_HINT}`);
      }
      const port = Number(c.smtp_port) || 587;
      if (!ALLOWED_SMTP_PORTS.includes(port)) throw new ApiError(400, `SMTP port ${port} is not allowed. ${CONFIG_HINT}`);
      const ip = await assertPublicHost(c.smtp_host);
      ownTransport = nodemailer.createTransport({
        host: ip, port, secure: !!c.smtp_secure, tls: { servername: c.smtp_host },
        auth: { user: c.smtp_user, pass: decrypt(c.smtp_password_enc) },
        connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
      });
      mail = { transporter: ownTransport, address: c.smtp_from_email };
    } else {
      // Shared mail: a school can't send "from" its own domain through our SMTP
      // (SPF/DMARC would reject it), so it gets its own display name + Reply-To.
      mail = { transporter: getPlatformTransporter(), address: process.env.SMTP_FROM || process.env.SMTP_USER };
    }
    return mail;
  }

  return {
    /** Resolves + validates a channel's config up front, so a broadcast fails BEFORE anything is saved. */
    async prepare(channel) {
      if (channel === 'sms') await resolveSms();
      else if (channel === 'email') await resolveMail();
      else throw new ApiError(400, `Unknown channel "${channel}" (use "sms" or "email")`);
    },
    async send(channel, { to, subject, body }) {
      if (channel === 'sms') return sendSms(await resolveSms(), { to, body });
      if (channel === 'email') {
        const m = await resolveMail();
        const info = await m.transporter.sendMail({
          from: { name: displayName, address: m.address }, replyTo, to, subject, text: body,
        });
        return { providerMessageId: info.messageId };
      }
      throw new Error(`Unknown notification channel: ${channel}`);
    },
    close() { if (ownTransport) ownTransport.close(); },
  };
}

module.exports = { send, forSchool, normalizePhone, assertPublicHost, ALLOWED_SMTP_PORTS };