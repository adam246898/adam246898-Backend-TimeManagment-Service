const config = require('../config');
const audit = require('../services/audit.service');
const { tooManyRequests } = require('../utils/errors');

// Contract 3.4: at most 100 requests per minute per IP, counted with a SLIDING window (the last 60 s),
// so a client cannot send 100 at 11:59:59 and 100 more at 12:00:00.
// Kept in memory: with several gateway copies each one counts separately (WAF and API Gateway add
// their own limits in front, see the report).
const hits = new Map(); // ip -> array of timestamps
const alerted = new Map(); // ip -> time of the last audit line, so a flood writes one line per minute

function rateLimit(req, res, next) {
  const now = Date.now();
  const windowStart = now - config.rateLimitWindowMs;
  const list = (hits.get(req.ip) || []).filter((t) => t > windowStart);
  if (list.length >= config.rateLimitMax) {
    hits.set(req.ip, list);
    res.set('Retry-After', String(Math.ceil((list[0] + config.rateLimitWindowMs - now) / 1000)));
    if (!alerted.has(req.ip) || now - alerted.get(req.ip) > config.rateLimitWindowMs) {
      alerted.set(req.ip, now);
      audit.fromRequest(req, 'rate_limited', 429, null);
    }
    return next(tooManyRequests());
  }
  list.push(now);
  hits.set(req.ip, list);
  return next();
}

// Old entries are removed every minute so memory does not grow.
setInterval(() => {
  const windowStart = Date.now() - config.rateLimitWindowMs;
  for (const [ip, list] of hits) if (!list.some((t) => t > windowStart)) hits.delete(ip);
}, 60 * 1000).unref();

const resetRateLimit = () => {
  hits.clear();
  alerted.clear();
};

module.exports = { rateLimit, resetRateLimit };
