const rateLimit = require('express-rate-limit');

/**
 * Applies to POST /auth/login specifically. Tight enough to make credential
 * stuffing / brute force slow and expensive, loose enough that a real user
 * mistyping their password a couple of times never gets blocked.
 * Keyed by IP — good enough for a single-region deployment; if you later
 * put this behind a CDN/load balancer, make sure `app.set('trust proxy', ...)`
 * is configured correctly or every request will appear to come from the
 * same IP and this limiter will block everyone together.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many login attempts. Please try again in a few minutes.' },
});

/**
 * Looser limiter for registration and password-reset requests — these are
 * hit far less often by real users, but still worth capping to stop
 * automated account-creation spam or reset-email flooding aimed at a
 * specific victim's inbox.
 */
const sensitiveActionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again later.' },
});

module.exports = { loginLimiter, sensitiveActionLimiter };