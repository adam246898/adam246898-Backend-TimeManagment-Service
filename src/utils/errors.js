// One error type for the whole service. The error middleware turns it into the contract's format:
// { "error": { "code", "message", "details", "requestId" } }
// Messages never name internal services, SQL, file paths or stack traces.
class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const validationError = (details, message = 'Some fields are invalid.') =>
  new AppError(400, 'VALIDATION_ERROR', message, details);
const unauthenticated = (message = 'Authentication required.') =>
  new AppError(401, 'UNAUTHENTICATED', message);
const forbidden = (message = 'You are not allowed to do this.') =>
  new AppError(403, 'FORBIDDEN', message);
const notFound = (message = 'Not found.') => new AppError(404, 'NOT_FOUND', message);
const conflict = (message) => new AppError(409, 'CONFLICT', message);
const unsupportedMediaType = () =>
  new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The request body must be JSON.');
const payloadTooLarge = () =>
  new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request body is larger than 10 KB.');
const upstreamError = (message = 'Google Calendar did not respond correctly. Please try again later.') =>
  new AppError(502, 'UPSTREAM_ERROR', message);
const serviceUnavailable = (message = 'Some of your data is not available right now. Please try again in a moment.') =>
  new AppError(503, 'SERVICE_UNAVAILABLE', message);

module.exports = {
  AppError,
  validationError,
  unauthenticated,
  forbidden,
  notFound,
  conflict,
  unsupportedMediaType,
  payloadTooLarge,
  upstreamError,
  serviceUnavailable,
};
