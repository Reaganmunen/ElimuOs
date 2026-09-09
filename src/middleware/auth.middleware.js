const { verifyToken } = require('../utils/jwt.util');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Verifies the Bearer token and attaches the decoded payload to req.user.
 * req.user.school_id is what every downstream query MUST use for tenant
 * scoping — never trust a school_id passed in the request body or query.
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new ApiError(401, 'Missing or malformed Authorization header');
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = verifyToken(token);
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired token');
  }

  next();
});

/**
 * Restricts a route to specific role codes, e.g. restrictTo('school_admin').
 * Must run after `authenticate`.
 */
const restrictTo = (...allowedRoles) => (req, res, next) => {
  if (!req.user || !allowedRoles.includes(req.user.role)) {
    return next(new ApiError(403, 'You do not have permission to perform this action'));
  }
  next();
};

module.exports = { authenticate, restrictTo };
