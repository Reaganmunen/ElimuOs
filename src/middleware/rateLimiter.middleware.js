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

/**
 * Caps "send a test message" per SCHOOL (not per IP) — each one costs real SMS
 * credit or mail quota and goes to an arbitrary address the admin types in.
 * Must run after `authenticate` so req.user is set.
 */
const testSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `school:${req.user?.school_id || 'unknown'}`,
  message: { success: false, message: 'Too many test messages. Please try again in an hour.' },
});

/**
 * POST /auth/refresh-token — deliberately NOT sensitiveActionLimiter.
 *
 * The frontend keeps access tokens in memory only (see public/js/api.js), so
 * EVERY protected page load mints a fresh one through this route: one refresh
 * per page navigation, per user. Under sensitiveActionLimiter (10/hour/IP,
 * shared with register/forgot/reset) an admin was locked out after ~10 page
 * clicks — for up to an hour — and could no longer request a password reset either.
 *
 * Brute-forcing isn't the risk here (a refresh token is 40 random bytes, checked
 * by hash); the risk is load, since each call is a DB lookup + rotation write. So
 * this is a generous per-IP ceiling with its OWN counter. Keyed by IP, so a
 * school's staff behind one NAT share it — hence the headroom, and the env override.
 * Behind a reverse proxy/PaaS, set TRUST_PROXY (see app.js) or every user shares
 * the proxy's IP and therefore one counter.
 */
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.REFRESH_RATE_LIMIT_MAX) || 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many session refreshes from this network. Please wait a few minutes and try again.' },
});

module.exports = { loginLimiter, sensitiveActionLimiter, refreshLimiter, testSendLimiter };