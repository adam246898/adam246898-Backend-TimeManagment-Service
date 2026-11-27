const tokens = require('../clients/tokens');
const users = require('../services/users.service');
const authService = require('../services/auth.service');
const audit = require('../services/audit.service');
const asyncHandler = require('../utils/asyncHandler');
const { unauthenticated, accountDisabled, forbidden } = require('../utils/errors');

// Every protected request: a valid Cognito access token, not logged out, for an active account.
// Sets req.user = { id, role, timezone, weekStartsOn } (role from the Cognito group only).
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.get('Authorization') || '';
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header);
  if (!match) throw unauthenticated();

  const claims = await tokens.verifyAccessToken(match[1]);
  if (await authService.isRevoked(claims)) throw unauthenticated('You have logged out. Please log in again.');

  const row = await users.findBySub(claims.sub);
  if (!row) throw unauthenticated();
  if (!row.is_active) {
    await audit.fromRequest(req, 'account_disabled', 403, row.id);
    throw accountDisabled();
  }

  req.accessToken = match[1];
  req.tokenClaims = claims;
  req.userRow = row;
  req.user = { id: row.id, role: tokens.roleFromClaims(claims), timezone: row.timezone, weekStartsOn: row.week_starts_on };
  next();
});

// Admin-only routes. A normal user gets 403, written to the audit log (contract 8).
const requireRole = (role) =>
  asyncHandler(async (req, res, next) => {
    if (req.user.role !== role) {
      await audit.fromRequest(req, 'forbidden', 403);
      throw forbidden();
    }
    next();
  });

module.exports = { authenticate, requireRole };
