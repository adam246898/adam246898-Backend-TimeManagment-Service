// Audit log (gw_audit_logs) for security events. Never stores passwords, tokens or secrets.
const db = require('../config/db');
const logger = require('../utils/logger');

// Writing the audit line must never break the request, so errors are only logged.
async function record({ actorUserId = null, action, target = null, statusCode = null, ip = null, requestId = null }) {
  logger.warn('audit', { action, actorUserId, target, statusCode, requestId });
  try {
    await db.query(
      `INSERT INTO gw_audit_logs (actor_user_id, action, target, status_code, ip, request_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [actorUserId, action, target, statusCode, ip, requestId],
    );
  } catch (err) {
    logger.error('audit_write_failed', { action, requestId, reason: err.message });
  }
}

// Shortcut used by controllers and middleware.
const fromRequest = (req, action, statusCode, actorUserId) =>
  record({
    actorUserId: actorUserId === undefined ? req.user?.id ?? null : actorUserId,
    action,
    target: req.baseUrl + req.path,
    statusCode,
    ip: req.ip,
    requestId: req.requestId,
  });

const toEntry = (r) => ({
  id: r.id,
  actorUserId: r.actor_user_id,
  action: r.action,
  target: r.target,
  statusCode: r.status_code,
  ip: r.ip,
  requestId: r.request_id,
  createdAt: new Date(r.created_at).toISOString(),
});

async function list({ action, statusCode, from, to, sort, limit, offset }) {
  const where = [];
  const params = [];
  if (action) {
    params.push(action);
    where.push(`action = $${params.length}`);
  }
  if (statusCode !== undefined) {
    params.push(statusCode);
    where.push(`status_code = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`created_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`created_at < ($${params.length}::date + 1)`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = sort === 'createdAt' ? 'created_at ASC' : 'created_at DESC';
  const total = (await db.query(`SELECT count(*)::int AS n FROM gw_audit_logs ${w}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT * FROM gw_audit_logs ${w} ORDER BY ${order}, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return { rows: rows.map(toEntry), total };
}

module.exports = { record, fromRequest, list };
