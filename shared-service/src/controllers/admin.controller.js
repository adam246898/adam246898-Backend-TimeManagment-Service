const asyncHandler = require('../utils/asyncHandler');
const users = require('../services/users.service');
const audit = require('../services/audit.service');
const cognito = require('../clients/cognito.client');
const { validationError, notFound, conflict } = require('../utils/errors');
const { checkBody, checkQuery, paging, isUuid, isValidDate } = require('../utils/validate');

// GET /api/admin/users?page&limit&q&isActive&sort   (no habit data is ever included)
exports.listUsers = asyncHandler(async (req, res) => {
  checkQuery(req.query, ['page', 'limit', 'q', 'isActive', 'sort']);
  const details = [];
  const { page, limit, offset } = paging(req.query, details);
  const q = req.query.q === undefined ? undefined : req.query.q.trim();
  if (q !== undefined && (q.length < 1 || q.length > 100)) details.push({ field: 'q', issue: 'Must be 1 to 100 characters.' });
  let isActive;
  if (req.query.isActive !== undefined) {
    if (!['true', 'false'].includes(req.query.isActive)) details.push({ field: 'isActive', issue: 'Must be true or false.' });
    else isActive = req.query.isActive === 'true';
  }
  const sort = req.query.sort === undefined ? '-createdAt' : req.query.sort;
  if (!users.SORTS[sort]) details.push({ field: 'sort', issue: 'Must be createdAt, -createdAt or email.' });
  if (details.length) throw validationError(details);

  const { rows, total } = await users.list({ q, isActive, sort, limit, offset });
  res.json({ data: rows.map(users.toUser), page, limit, total });
});

// PATCH /api/admin/users/:id/status  { isActive: boolean }
// Deactivating also disables the user in Cognito and signs them out; their next request gets 403.
exports.setStatus = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.id)) throw validationError([{ field: 'id', issue: 'Must be a UUID.' }]);
  checkBody(req.body, ['isActive']);
  if (typeof req.body.isActive !== 'boolean') throw validationError([{ field: 'isActive', issue: 'Is required and must be true or false.' }]);

  const target = await users.findById(req.params.id.toLowerCase());
  if (!target) throw notFound('User not found.');
  if (target.id === req.user.id && req.body.isActive === false) throw conflict('You cannot deactivate your own account.');

  await cognito.setEnabled(target.email, req.body.isActive);
  const row = await users.setActive(target, req.body.isActive);
  await audit.fromRequest(req, req.body.isActive ? 'user_activated' : 'user_deactivated', 200);
  res.json(users.toUser(row));
});

// GET /api/admin/audit-logs?page&limit&action&statusCode&from&to&sort
exports.auditLogs = asyncHandler(async (req, res) => {
  checkQuery(req.query, ['page', 'limit', 'action', 'statusCode', 'from', 'to', 'sort']);
  const details = [];
  const { page, limit, offset } = paging(req.query, details);
  const { action, from, to } = req.query;
  if (action !== undefined && !/^[a-z_]{1,40}$/.test(action)) details.push({ field: 'action', issue: 'Must be an action name, e.g. login_failed.' });
  let statusCode;
  if (req.query.statusCode !== undefined) {
    statusCode = Number(req.query.statusCode);
    if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) details.push({ field: 'statusCode', issue: 'Must be an HTTP status code.' });
  }
  if (from !== undefined && !isValidDate(from)) details.push({ field: 'from', issue: 'Must be a date YYYY-MM-DD.' });
  if (to !== undefined && !isValidDate(to)) details.push({ field: 'to', issue: 'Must be a date YYYY-MM-DD.' });
  const sort = req.query.sort === undefined ? '-createdAt' : req.query.sort;
  if (!['createdAt', '-createdAt'].includes(sort)) details.push({ field: 'sort', issue: 'Must be createdAt or -createdAt.' });
  if (details.length) throw validationError(details);

  const { rows, total } = await audit.list({ action, statusCode, from, to, sort, limit, offset });
  res.json({ data: rows, page, limit, total });
});
