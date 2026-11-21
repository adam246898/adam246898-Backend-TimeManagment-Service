const crypto = require('crypto');
const config = require('../config');
const { unauthenticated } = require('../utils/errors');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

// Every request must carry the shared X-Internal-Token, which only the gateway and the other
// services know. Without it: 401. This stops anyone who reaches the container directly from
// faking X-User-Id. timingSafeEqual avoids leaking the token through response timing.
function requireInternalToken(req, res, next) {
  const sent = req.get('X-Internal-Token');
  const expected = config.internalToken;
  if (!sent || !expected || !crypto.timingSafeEqual(sha256(sent), sha256(expected))) {
    return next(unauthenticated());
  }
  return next();
}

module.exports = requireInternalToken;
