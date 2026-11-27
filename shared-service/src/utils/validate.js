// Small validation helpers. Every function returns a list of { field, issue } problems (empty = valid).
const { validationError } = require('./errors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Body must be a JSON object with only the allowed keys (contract 3.4: unknown fields are rejected).
function checkBody(body, allowed) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError([{ field: 'body', issue: 'Must be a JSON object.' }]);
  }
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) throw validationError(unknown.map((field) => ({ field, issue: 'Unknown field.' })));
}

function checkQuery(query, allowed) {
  const details = [];
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key)) details.push({ field: key, issue: 'Unknown query parameter.' });
    else if (typeof value !== 'string') details.push({ field: key, issue: 'Must be given once.' });
  }
  if (details.length) throw validationError(details);
}

// Strings are trimmed before checking their length (contract 3.4).
function stringField(details, field, value, { min, max }) {
  if (typeof value !== 'string') {
    details.push({ field, issue: 'Must be a string.' });
    return undefined;
  }
  const v = value.trim();
  if (v.length < min || v.length > max) details.push({ field, issue: `Must be between ${min} and ${max} characters.` });
  return v;
}

// ?page=&limit= (contract 3.6)
function paging(query, details) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) details.push({ field: 'page', issue: 'Must be a whole number from 1.' });
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) details.push({ field: 'limit', issue: 'Must be from 1 to 100.' });
  return { page, limit, offset: (page - 1) * limit };
}

module.exports = { isUuid, isValidTimeZone, isValidDate, EMAIL_RE, checkBody, checkQuery, stringField, paging };
