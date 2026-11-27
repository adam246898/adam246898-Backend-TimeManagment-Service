// One error type. The error middleware turns it into the contract's format (3.7):
// { "error": { "code", "message", "details", "requestId" } }. No stack traces or internal names.
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = {
  AppError,
  validationError: (details, message = 'Some fields are invalid.') => new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthenticated: (message = 'Authentication required.') => new AppError(401, 'UNAUTHENTICATED', message),
  invalidCredentials: () => new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.'),
  forbidden: (message = 'You are not allowed to do this.') => new AppError(403, 'FORBIDDEN', message),
  accountDisabled: () => new AppError(403, 'ACCOUNT_DISABLED', 'This account has been deactivated.'),
  notFound: (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message),
  conflict: (message) => new AppError(409, 'CONFLICT', message),
  emailTaken: () => new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.'),
  payloadTooLarge: () => new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is larger than 10 KB.'),
  unsupportedMediaType: () => new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The request body must be JSON.'),
  tooManyRequests: (message = 'Too many requests. Please wait a moment and try again.') =>
    new AppError(429, 'TOO_MANY_REQUESTS', message),
  serviceUnavailable: (message = 'This part of the app is not available right now. Please try again in a moment.') =>
    new AppError(503, 'SERVICE_UNAVAILABLE', message),
};
