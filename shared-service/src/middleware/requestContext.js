const crypto = require('crypto');
const logger = require('../utils/logger');

// The gateway always creates the request ID itself (a client cannot choose it), sends it to the services
// and back to the browser, and writes one JSON log line per request. The query string is not logged
// (it can hold the Google OAuth code and state), and neither are headers such as Authorization.
function requestContext(req, res, next) {
  req.requestId = crypto.randomUUID();
  res.set('X-Request-Id', req.requestId);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const statusCode = res.statusCode;
    logger[[401, 403, 429].includes(statusCode) ? 'warn' : 'info']('request', {
      requestId: req.requestId,
      userId: req.user?.id || null,
      method: req.method,
      route: req.path,
      statusCode,
      ip: req.ip,
      durationMs: Number((process.hrtime.bigint() - started) / 1000000n),
    });
  });
  next();
}

module.exports = requestContext;
