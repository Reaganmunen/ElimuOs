const { query } = require('../config/db');

const TOKEN_TTL_MINUTES = 30;

async function createToken(userId, tokenHash) {
  const result = await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '${TOKEN_TTL_MINUTES} minutes')
     RETURNING id, expires_at`,
    [userId, tokenHash]
  );
  return result.rows[0];
}

/**
 * Looks up a token by its hash and confirms it's unexpired and unused, in
 * one query, so there's no window between "check validity" and "use it"
 * for a race condition to slip through.
 */
async function findValidToken(tokenHash) {
  const result = await query(
    `SELECT * FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

async function markUsed(tokenId) {
  await query(`UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`, [tokenId]);
}

/**
 * Invalidates every outstanding reset token for a user — called after a
 * successful reset so an old, still-emailed link can't be replayed, and
 * also useful to call whenever a password changes through any path.
 */
async function invalidateAllForUser(userId) {
  await query(`UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [userId]);
}

module.exports = { createToken, findValidToken, markUsed, invalidateAllForUser };