const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/auth.service');
const audit = require('../services/audit.service');
const { validationError } = require('../utils/errors');
const { checkBody, stringField, isValidTimeZone, EMAIL_RE } = require('../utils/validate');

const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{10,128}$/;

function email(details, value) {
  const v = stringField(details, 'email', value, { min: 3, max: 254 });
  if (v !== undefined && !EMAIL_RE.test(v)) details.push({ field: 'email', issue: 'Must be a valid email address.' });
  return v ? v.toLowerCase() : v;
}

// POST /api/auth/signup  { name, email, password, timezone? }   (role can NOT be sent: unknown field -> 400)
exports.signup = asyncHandler(async (req, res) => {
  checkBody(req.body, ['name', 'email', 'password', 'timezone']);
  const details = [];
  const name = stringField(details, 'name', req.body.name, { min: 2, max: 50 });
  const mail = email(details, req.body.email);
  const { password } = req.body;
  if (typeof password !== 'string' || !PASSWORD_RE.test(password)) {
    details.push({ field: 'password', issue: 'Use 10 to 128 characters with at least one letter and one digit.' });
  }
  const timezone = req.body.timezone === undefined ? 'UTC' : req.body.timezone;
  if (!isValidTimeZone(timezone)) details.push({ field: 'timezone', issue: 'Must be a valid IANA time zone, e.g. Africa/Cairo.' });
  if (details.length) throw validationError(details);

  res.status(201).json(await authService.signUp({ name, email: mail, password, timezone }, req.requestId));
});

// POST /api/auth/login  { email, password }
exports.login = asyncHandler(async (req, res) => {
  checkBody(req.body, ['email', 'password']);
  const details = [];
  const mail = email(details, req.body.email);
  if (typeof req.body.password !== 'string' || req.body.password.length === 0) {
    details.push({ field: 'password', issue: 'Is required.' });
  }
  if (details.length) throw validationError(details);

  const result = await authService.login(
    { email: mail, password: req.body.password },
    { ip: req.ip, audit: (action, status, actorId = null) => audit.fromRequest(req, action, status, actorId) },
  );
  res.json(result);
});

// POST /api/auth/logout  (no body)
exports.logout = asyncHandler(async (req, res) => {
  await authService.logout(req.accessToken, req.tokenClaims);
  res.status(204).end();
});
