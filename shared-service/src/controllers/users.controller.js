const asyncHandler = require('../utils/asyncHandler');
const users = require('../services/users.service');
const { validationError } = require('../utils/errors');
const { checkBody, checkQuery, stringField, isValidTimeZone } = require('../utils/validate');

// GET /api/users/me
exports.me = asyncHandler(async (req, res) => {
  checkQuery(req.query, []);
  res.json(users.toUser({ ...req.userRow, role: req.user.role }));
});

// PATCH /api/users/me  { name?, timezone?, settings?: { weekStartsOn? } }
// email, role, isActive and id are rejected as unknown fields (400).
exports.updateMe = asyncHandler(async (req, res) => {
  checkBody(req.body, ['name', 'timezone', 'settings']);
  const details = [];
  const changes = {};
  if (req.body.name !== undefined) changes.name = stringField(details, 'name', req.body.name, { min: 2, max: 50 });
  if (req.body.timezone !== undefined) {
    if (!isValidTimeZone(req.body.timezone)) details.push({ field: 'timezone', issue: 'Must be a valid IANA time zone.' });
    else changes.timezone = req.body.timezone;
  }
  if (req.body.settings !== undefined) {
    const s = req.body.settings;
    if (s === null || typeof s !== 'object' || Array.isArray(s)) {
      details.push({ field: 'settings', issue: 'Must be an object.' });
    } else {
      for (const key of Object.keys(s)) if (key !== 'weekStartsOn') details.push({ field: `settings.${key}`, issue: 'Unknown field.' });
      if (s.weekStartsOn !== undefined) {
        if (!['sunday', 'monday'].includes(s.weekStartsOn)) details.push({ field: 'settings.weekStartsOn', issue: 'Must be sunday or monday.' });
        else changes.weekStartsOn = s.weekStartsOn;
      }
    }
  }
  if (!details.length && Object.keys(changes).length === 0) details.push({ field: 'body', issue: 'Send at least one field to change.' });
  if (details.length) throw validationError(details);

  const row = await users.updateProfile(req.userRow, changes);
  res.json(users.toUser({ ...row, role: req.user.role }));
});
