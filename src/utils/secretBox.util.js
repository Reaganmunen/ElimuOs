const crypto = require('crypto');

/**
 * Encrypts small secrets (a school's own SMS API key / SMTP password) before
 * they touch the database. AES-256-GCM: authenticated, so a tampered or
 * wrong-key value fails to decrypt instead of returning garbage.
 * Key: CONFIG_ENCRYPTION_KEY = 64 hex chars (generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
 * Stored format: v1:<iv>:<tag>:<ciphertext>, each base64.
 */
function getKey() {
  const hex = process.env.CONFIG_ENCRYPTION_KEY || '';
  return /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;
}

const isAvailable = () => getKey() !== null;

function encrypt(plain) {
  const key = getKey();
  if (!key) throw new Error('CONFIG_ENCRYPTION_KEY is not set (or is not 64 hex characters)');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

function decrypt(stored) {
  const key = getKey();
  if (!key) throw new Error('CONFIG_ENCRYPTION_KEY is not set (or is not 64 hex characters)');
  const [v, iv, tag, ct] = String(stored).split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognised secret format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { isAvailable, encrypt, decrypt };