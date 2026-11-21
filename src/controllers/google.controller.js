const asyncHandler = require('../utils/asyncHandler');
const config = require('../config');
const { checkQueryKeys, checkBodyKeys } = require('../utils/validate');
const googleService = require('../services/google.service');

exports.status = asyncHandler(async (req, res) => {
  checkQueryKeys(req.query, []);
  res.json(await googleService.getStatus(req.ctx));
});

exports.connect = asyncHandler(async (req, res) => {
  checkQueryKeys(req.query, []);
  checkBodyKeys(req.body, []);
  res.json(await googleService.startConnect(req.ctx));
});

// Public (Google redirects the browser here). Always answers with a redirect to the frontend.
// The query is not checked for unknown keys: Google adds its own (scope, authuser, prompt, ...).
exports.callback = asyncHandler(async (req, res) => {
  const pick = (key) => (typeof req.query[key] === 'string' ? req.query[key] : undefined);
  const result = await googleService.finishConnect(
    { code: pick('code'), state: pick('state'), error: pick('error') },
    req.requestId,
  );
  res.redirect(302, `${config.frontendUrl}/settings?google=${result === 'connected' ? 'connected' : 'error'}`);
});

exports.sync = asyncHandler(async (req, res) => {
  checkQueryKeys(req.query, []);
  checkBodyKeys(req.body, []);
  res.json(await googleService.sync(req.ctx));
});

exports.disconnect = asyncHandler(async (req, res) => {
  checkQueryKeys(req.query, []);
  await googleService.disconnect(req.ctx);
  res.status(204).end();
});
