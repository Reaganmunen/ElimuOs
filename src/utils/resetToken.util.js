const crypto = require('crypto');

/**
 * Generates a random reset token and its SHA-256 hash. The RAW token is
 * what goes in the emailed link — it is NEVER stored. Only the hash is
 * saved to the database, so a database leak alone can't be used to forge
 * valid reset links (same principle as never storing plaintext passwords).
 */
function generateResetToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

module.exports = { generateResetToken, hashToken };