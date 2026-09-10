const crypto = require('crypto');
const { query } = require('../config/db');

const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30;

function generateOpaqueToken() {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return { rawToken, tokenHash };
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function create(userId) {
  const { rawToken, tokenHash } = generateOpaqueToken();
  const result = await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + interval '${REFRESH_TOKEN_TTL_DAYS} days')
     RETURNING id, expires_at`,
    [userId, tokenHash]
  );
  return { rawToken, id: result.rows[0].id, expiresAt: result.rows[0].expires_at };
}

async function findValid(rawToken) {
  const tokenHash = hashToken(rawToken);
  const result = await query(
    `SELECT * FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [tokenHash]
  );
  return result.rows[0] || null;
}

async function revoke(id) {
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [id]);
}

/**
 * Rotation: the old token is marked revoked AND linked to its replacement
 * (replaced_by_id), so if the OLD (already-used) token is ever presented
 * again, you can tell it's a reused/stolen token rather than a legitimate
 * retry — that's the signal a more advanced setup would use to revoke the
 * entire token family. This implementation revokes just the one token
 * rather than the whole chain; upgrading to full reuse-detection later
 * only needs to read replaced_by_id backward from a reused token.
 */
async function rotate(oldTokenId, userId) {
  const newToken = await create(userId);
  await query(
    `UPDATE refresh_tokens SET revoked_at = now(), replaced_by_id = $1 WHERE id = $2`,
    [newToken.id, oldTokenId]
  );
  return newToken;
}

async function revokeAllForUser(userId) {
  await query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
}

module.exports = { create, findValid, revoke, rotate, revokeAllForUser };