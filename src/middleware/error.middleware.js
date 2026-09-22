/**
 * Raw PostgreSQL error codes that mean "the request was malformed or
 * violated a constraint" rather than "the server broke" — a caller
 * mistake, not a server fault. Most of these are already caught close to
 * the query that raised them and rethrown as a clean ApiError/Error with
 * a specific message (e.g. every model's `catch (err) { throw new
 * ApiError(400, err.message) }` pattern, or the unique_violation checks
 * in schoolSubscription.model.js and student.controller.js). This map is
 * the safety net for whatever ISN'T caught that way — most notably a
 * row-level-security rejection (42501), which happens whenever a query
 * running through withTenantClient tries to touch a row outside the
 * current tenant and nothing upstream anticipated it. Without this, that
 * case falls through to a generic 500 with no indication to the client
 * that the request itself was the problem.
 *
 * Messages here are intentionally generic — never echo err.message or
 * err.detail from a raw Postgres error back to the client, since those
 * can contain table/column names and shouldn't leak schema internals.
 * The full error is still logged server-side below either way.
 */
const PG_ERROR_STATUS = {
  '42501': [400, 'This request is not permitted for the resource you referenced.'], // RLS policy violation
  '23503': [400, 'This action references something that no longer exists or is not accessible to you.'], // foreign_key_violation
  '23505': [409, 'This already exists.'], // unique_violation (fallback for anywhere not already handled explicitly)
  '23502': [400, 'A required field is missing.'], // not_null_violation
  '22P02': [400, 'One of the values provided is the wrong type or format.'], // invalid_text_representation
};

/**
 * Central error handler — every route uses asyncHandler, so any thrown
 * error (ApiError or otherwise) ends up here instead of crashing the process
 * or leaking a raw stack trace to the client.
 */
// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  const pgMapping = !err.isApiError && err.code ? PG_ERROR_STATUS[err.code] : null;

  const statusCode = err.isApiError ? err.statusCode : (pgMapping ? pgMapping[0] : 500);
  const message = err.isApiError ? err.message : (pgMapping ? pgMapping[1] : 'Internal server error');

  if (!err.isApiError) {
    // Unexpected errors — including ones we just mapped to a clean 4xx
    // above — are logged in full server-side; the client only ever sees
    // the generic message so internals (queries, stack traces, schema
    // details) never leak into an API response.
    console.error('Unhandled error:', err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    details: err.isApiError ? err.details : undefined,
  });
}

module.exports = errorMiddleware;
