// NOTE: like the Daraja client, the actual network calls to Africa's
// Talking and the SMTP server are NOT reachable from this sandbox, so
// these providers are written to their documented APIs but not exercised
// live. Test against real credentials before relying on delivery.

const nodemailer = require('nodemailer');
const axios = require('axios');

let transporter = null;
function getMailTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
  }
  return transporter;
}

async function sendEmail({ to, subject, body }) {
  const info = await getMailTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text: body,
  });
  return { providerMessageId: info.messageId };
}

/**
 * Africa's Talking is the de-facto standard SMS gateway for Kenyan SaaS
 * products — sends via their bulk SMS REST endpoint.
 */
async function sendSms({ to, body }) {
  const response = await axios.post(
    'https://api.africastalking.com/version1/messaging',
    new URLSearchParams({
      username: process.env.AT_USERNAME,
      to,       // format: +2547XXXXXXXX
      message: body,
      from: process.env.AT_SENDER_ID || undefined,
    }),
    {
      headers: {
        apiKey: process.env.AT_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
    }
  );
  const recipient = response.data?.SMSMessageData?.Recipients?.[0];
  return { providerMessageId: recipient?.messageId, status: recipient?.status };
}

async function send(channel, { to, subject, body }) {
  if (channel === 'email') return sendEmail({ to, subject, body });
  if (channel === 'sms') return sendSms({ to, body });
  throw new Error(`Unknown notification channel: ${channel}`);
}

module.exports = { send };
