const { AppError, notFound, validationError, payloadTooLarge } = require('../utils/errors');
const logger = require('../utils/logger');

function notFoundHandler(req, res, next) {
  next(notFound('Route not found.'));
}

// Keep all 4 arguments: that is how Express recognises an error handler.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let appError = err;
  if (err.type === 'entity.parse.failed') {
    appError = validationError([{ field: 'body', issue: 'Must be valid JSON.' }]);
  } else if (err.type === 'entity.too.large') {
    appError = payloadTooLarge();
  } else if (!(err instanceof AppError)) {
    // Unexpected bug: log the details for us, show nothing internal to the client.
    logger.error('unhandled_error', { requestId: req.requestId, message: err.message, stack: err.stack });
    appError = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again later.');
  }

  const body = { code: appError.code, message: appError.message };
  if (appError.details) body.details = appError.details;
  body.requestId = req.requestId;
  res.status(appError.status).json({ error: body });
}

module.exports = { notFoundHandler, errorHandler };
