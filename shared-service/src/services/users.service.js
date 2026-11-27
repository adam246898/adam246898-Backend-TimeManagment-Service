// Profiles and settings in gw_users.
const db = require('../config/db');

const COLUMNS = 'id, cognito_sub, name, email, role, is_active, timezone, week_starts_on, created_at';

// The User object of contract 4.1. Never contains the password, tokens or the Cognito ID.
const toUser = (r) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  role: r.role,
  isActive: r.is_active,
  timezone: r.timezone,
  settings: { weekStartsOn: r.week_starts_on },
  createdAt: new Date(r.created_at).toISOString(),
});

// Every logged-in request needs the user's row (active flag, time zone, week start). A short cache keeps
// that from hitting the database each time; an admin deactivation clears it at once on this instance.
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map(); // cognito_sub -> { row, at }

async function findBySub(sub) {
  const hit = cache.get(sub);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.row;
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM gw_users WHERE cognito_sub = $1`, [sub]);
  const row = rows[0] || null;
  if (row) cache.set(sub, { row, at: Date.now() });
  return row;
}

const forget = (sub) => cache.delete(sub);
const clearCache = () => cache.clear();

async function findById(id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM gw_users WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function create({ sub, name, email, timezone }) {
  const { rows } = await db.query(
    `INSERT INTO gw_users (cognito_sub, name, email, timezone) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`,
    [sub, name, email, timezone],
  );
  return rows[0];
}

async function emailExists(email) {
  const { rows } = await db.query('SELECT 1 FROM gw_users WHERE email = $1', [email]);
  return rows.length > 0;
}

// Keeps gw_users.role in line with the Cognito group (the group is the source of truth).
async function syncRole(row, role) {
  if (row.role === role) return row;
  const { rows } = await db.query(
    `UPDATE gw_users SET role = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [row.id, role],
  );
  forget(row.cognito_sub);
  return rows[0];
}

async function updateProfile(row, { name, timezone, weekStartsOn }) {
  const { rows } = await db.query(
    `UPDATE gw_users SET name = COALESCE($2, name), timezone = COALESCE($3, timezone),
       week_starts_on = COALESCE($4, week_starts_on), updated_at = now()
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [row.id, name ?? null, timezone ?? null, weekStartsOn ?? null],
  );
  forget(row.cognito_sub);
  return rows[0];
}

async function setActive(row, isActive) {
  const { rows } = await db.query(
    `UPDATE gw_users SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING ${COLUMNS}`,
    [row.id, isActive],
  );
  forget(row.cognito_sub);
  return rows[0];
}

const SORTS = { createdAt: 'created_at ASC', '-createdAt': 'created_at DESC', email: 'email ASC' };

async function list({ q, isActive, sort, limit, offset }) {
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length})`);
  }
  if (isActive !== undefined) {
    params.push(isActive);
    where.push(`is_active = $${params.length}`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await db.query(`SELECT count(*)::int AS n FROM gw_users ${w}`, params)).rows[0].n;
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM gw_users ${w} ORDER BY ${SORTS[sort]}, id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset],
  );
  return { rows, total };
}

module.exports = {
  toUser, findBySub, findById, create, emailExists, syncRole, updateProfile, setActive, list, forget, clearCache, SORTS,
};
