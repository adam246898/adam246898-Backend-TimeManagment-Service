const { isUuid } = require('../utils/validate');
const { isValidTimeZone } = require('../utils/dates');
const { unauthenticated, forbidden } = require('../utils/errors');

// The gateway checks the Cognito token and then sets these headers. The user ID is taken ONLY from
// here, never from the body or the query string.
function userContext(req, res, next) {
  const userId = req.get('X-User-Id');
  const role = req.get('X-User-Role');
  const timezone = req.get('X-User-Timezone');
  const weekStartsOn = req.get('X-User-Week-Starts-On');
  req.ctx = {
    userId: isUuid(userId) ? userId.toLowerCase() : null,
    role: role === 'user' || role === 'admin' ? role : null,
    timezone: isValidTimeZone(timezone) ? timezone : 'UTC',
    // Same default as habits-service: Sunday when the gateway does not send the user's setting.
    weekStartsOn: weekStartsOn === 'monday' ? 'monday' : 'sunday',
    requestId: req.requestId,
  };
  next();
}

// Personal routes (dashboard, calendar, milestones, Google). Admins are blocked on purpose:
// they manage the platform, not people's private data (contract section 7).
function requireUser(req, res, next) {
  if (!req.ctx.userId || !req.ctx.role) return next(unauthenticated());
  if (req.ctx.role !== 'user') return next(forbidden());
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.ctx.userId || !req.ctx.role) return next(unauthenticated());
  if (req.ctx.role !== 'admin') return next(forbidden());
  return next();
}

module.exports = { userContext, requireUser, requireAdmin };
