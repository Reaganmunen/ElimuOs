const jwt = require('jsonwebtoken');

/**
 * Payload deliberately kept minimal: id, school_id, role_code. Anything else
 * (name, email) should be fetched fresh from the DB when needed, not trusted
 * from an old token.
 *
 * Short-lived by design (default 15m) now that a refresh token exists —
 * see refreshToken.model.js. A short access token limits the damage window
 * if one leaks (logs, browser history, a compromised client) since it
 * can't be revoked directly; the refresh token is the thing that's
 * actually revocable, and it's what re-issues a new access token.
 */
function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      school_id: user.school_id,
      role: user.role_code,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRES_IN || '15m' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports = { signToken, verifyToken };