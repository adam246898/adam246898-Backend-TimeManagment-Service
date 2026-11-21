const { validationError } = require('./errors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

// The fixed category list (contract 4.5).
const CATEGORIES = ['health', 'fitness', 'study', 'mindfulness', 'productivity', 'finance', 'social', 'other'];

// Rejects query parameters we do not know, and parameters given twice (?range=a&range=b).
// Returns nothing; throws 400 VALIDATION_ERROR with every problem listed.
function checkQueryKeys(query, allowed) {
  const details = [];
  for (const [key, value] of Object.entries(query)) {
    if (!allowed.includes(key)) details.push({ field: key, issue: 'Unknown query parameter.' });
    else if (typeof value !== 'string') details.push({ field: key, issue: 'Must be given once.' });
  }
  if (details.length) throw validationError(details);
}

// Rejects body fields we do not know (contract 3.4: unknown fields are an error, not ignored).
function checkBodyKeys(body, allowed) {
  if (body === undefined) return;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw validationError([{ field: 'body', issue: 'Must be a JSON object.' }]);
  }
  const details = Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({ field: key, issue: 'Unknown field.' }));
  if (details.length) throw validationError(details);
}

module.exports = { isUuid, CATEGORIES, checkQueryKeys, checkBodyKeys };
