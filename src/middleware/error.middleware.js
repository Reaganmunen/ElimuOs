/**
 * Central error handler — every route uses asyncHandler, so any thrown
 * error (ApiError or otherwise) ends up here instead of crashing the process
 * or leaking a raw stack trace to the client.
 */
// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  const statusCode = err.isApiError ? err.statusCode : 500;
  const message = err.isApiError ? err.message : 'Internal server error';

  if (!err.isApiError) {
    // Unexpected errors are logged in full server-side; the client only
    // ever sees a generic message so internals (queries, stack traces)
    // never leak into an API response.
    console.error('Unhandled error:', err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    details: err.isApiError ? err.details : undefined,
  });
}

module.exports = errorMiddleware;
