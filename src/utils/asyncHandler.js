/**
 * Wrap every async controller with this so a thrown error or rejected
 * promise is passed to next(err) automatically, instead of needing a
 * try/catch in every single controller function.
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
