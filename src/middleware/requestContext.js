const crypto = require('crypto');
const logger = require('../utils/logger');

const REQUEST_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

// Gives every request an ID (the gateway's X-Request-Id, or a new one) and writes one JSON log
// line when the response is sent. The query string is NOT logged: on the Google callback it holds
// the one-time OAuth code and state.
function requestContext(req, res, next) {
  const incoming = req.get('X-Request-Id');
  req.requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', req.requestId);
  const started = process.hrtime.bigint();

  res.on('finish', () => {
    const statusCode = res.statusCode;
    const securityEvent = [401, 403, 429].includes(statusCode);
    logger[securityEvent ? 'warn' : 'info']('request', {
      requestId: req.requestId,
      userId: req.ctx?.userId || null,
      method: req.method,
      route: req.baseUrl + req.path,
      statusCode,
      durationMs: Number((process.hrtime.bigint() - started) / 1000000n),
    });
  });
  next();
}

module.exports = requestContext;
