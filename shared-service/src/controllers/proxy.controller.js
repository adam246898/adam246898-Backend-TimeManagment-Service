const asyncHandler = require('../utils/asyncHandler');
const proxy = require('../services/proxy.service');
const audit = require('../services/audit.service');
const { authenticate, requireRole } = require('../middleware/auth');
const { notFound } = require('../utils/errors');

// Runs Express middleware inside a handler (used for the token and role checks per route).
const run = (mw, req, res) => new Promise((resolve, reject) => mw(req, res, (err) => (err ? reject(err) : resolve())));

// Every /api/* route that belongs to service-a, service-b or service-c (contract 3.2).
exports.forward = asyncHandler(async (req, res) => {
  // The full path ("/api/habits/..."): inside the /api router req.path no longer starts with /api.
  const route = proxy.findRoute(req.originalUrl.split('?')[0]);
  if (!route) throw notFound('Route not found.');

  if (!route.isPublic) {
    await run(authenticate, req, res);
    if (route.role) await run(requireRole(route.role), req, res);
  }

  const upstream = await proxy.forward(req, route);
  // A service refused an action for this role (contract 8: "written to the audit log").
  if (upstream.status === 403) await audit.fromRequest(req, 'forbidden', 403);

  res.status(upstream.status);
  for (const [name, value] of Object.entries(upstream.headers)) res.set(name, value);
  res.send(upstream.body);
});
