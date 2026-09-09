/**
 * Thrown deliberately from controllers/models for expected failure cases
 * (validation, not found, unauthorized). Caught by the central error
 * middleware and turned into a consistent JSON error response.
 */
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isApiError = true;
  }
}

module.exports = ApiError;
