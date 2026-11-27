// Routing to the services (contract 3.2) and forwarding requests.
const config = require('../config');
const logger = require('../utils/logger');
const { serviceUnavailable } = require('../utils/errors');

// "/api/habits*" means "/api/habits" itself or anything under "/api/habits/".
const prefix = (p) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&')}(/|$)`);

// Checked top to bottom; the first match wins. Gateway-owned routes (/api/auth, /api/users,
// /api/admin/users, /api/admin/audit-logs) are handled before this table is used.
const ROUTES = [
  { match: prefix('/api/admin/analytics'), service: 'time', role: 'admin' },
  { match: prefix('/api/admin/habit-templates'), service: 'habits', role: 'admin' },
  { match: prefix('/api/habits'), service: 'habits' },
  { match: prefix('/api/habit-templates'), service: 'habits' },
  { match: prefix('/api/categories'), service: 'habits' },
  { match: prefix('/api/checklists'), service: 'streaks' },
  { match: prefix('/api/checkins'), service: 'streaks' },
  { match: prefix('/api/streaks'), service: 'streaks' },
  { match: prefix('/api/challenges'), service: 'streaks' },
  { match: prefix('/api/missed-notes'), service: 'streaks' },
  { match: /^\/api\/integrations\/google\/callback$/, service: 'time', isPublic: true },
  { match: prefix('/api/dashboard'), service: 'time' },
  { match: prefix('/api/calendar'), service: 'time' },
  { match: prefix('/api/milestones'), service: 'time' },
  { match: prefix('/api/integrations/google'), service: 'time' },
];

const findRoute = (path) => ROUTES.find((r) => r.match.test(path)) || null;

// Forwards the request and returns { status, headers, body }. Only headers we build ourselves are sent,
// so a client can never fake X-User-* or X-Internal-Token: they come from the verified token.
async function forward(req, route) {
  const headers = {
    'X-Internal-Token': config.internalToken,
    'X-Request-Id': req.requestId,
    Accept: req.get('Accept') || 'application/json',
  };
  if (req.user) {
    headers['X-User-Id'] = req.user.id;
    headers['X-User-Role'] = req.user.role;
    headers['X-User-Timezone'] = req.user.timezone;
    headers['X-User-Week-Starts-On'] = req.user.weekStartsOn;
  }
  const hasBody = Buffer.isBuffer(req.body) && req.body.length > 0;
  if (hasBody) headers['Content-Type'] = req.get('Content-Type') || 'application/octet-stream';

  let res;
  try {
    res = await fetch(config.services[route.service] + req.originalUrl, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: 'manual', // the Google callback answers 302: pass it to the browser, do not follow it
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
    });
  } catch (err) {
    logger.warn('upstream_failed', { requestId: req.requestId, upstream: route.service, reason: err.name });
    throw serviceUnavailable();
  }
  const body = Buffer.from(await res.arrayBuffer());
  const out = {};
  for (const name of ['content-type', 'location', 'cache-control']) {
    const value = res.headers.get(name);
    if (value) out[name] = value;
  }
  return { status: res.status, headers: out, body };
}

module.exports = { findRoute, forward, ROUTES };
