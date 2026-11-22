const config = require('../config');
const logger = require('../utils/logger');
const { serviceUnavailable } = require('../utils/errors');

// Calls another service's /internal API. Every call carries the internal token, the request ID,
// and (when acting for a user) the user ID, so the other service checks ownership too.
// No answer within 3 seconds, a network error or a 5xx => 503 SERVICE_UNAVAILABLE (contract 6).
async function callService(name, baseUrl, path, { ctx = {}, method = 'GET', body, allow404 = false } = {}) {
  const headers = { 'X-Internal-Token': config.internalToken, Accept: 'application/json' };
  if (ctx.userId) headers['X-User-Id'] = ctx.userId;
  if (ctx.requestId) headers['X-Request-Id'] = ctx.requestId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const fail = (reason) => {
    logger.warn('upstream_failed', { requestId: ctx.requestId, upstream: name, path: path.split('?')[0], reason });
    return serviceUnavailable();
  };

  let res;
  try {
    res = await fetch(baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
    });
  } catch (err) {
    throw fail(err.name === 'TimeoutError' ? 'timeout' : 'unreachable');
  }

  if (allow404 && res.status === 404) return null;
  if (!res.ok) throw fail(`status ${res.status}`);
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    throw fail('invalid JSON');
  }
}

// The contract returns lists either as a bare array or as { "data": [...] }. Accept both.
function asList(body) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.data)) return body.data;
  return [];
}

// Gets a whole list. If the other service pages its answer ({ data, page, limit, total }, contract 3.6)
// and there are more items than in the first page, the next pages are fetched too, so the
// dashboard never silently works on only the first 20 check-ins.
const MAX_PAGES = 50;
async function getList(name, baseUrl, path, options) {
  const first = await callService(name, baseUrl, path, options);
  const items = asList(first);
  if (!first || Array.isArray(first) || typeof first.total !== 'number' || items.length >= first.total) {
    return items;
  }
  const limit = Number(first.limit) || items.length || 100;
  const sep = path.includes('?') ? '&' : '?';
  for (let page = (Number(first.page) || 1) + 1; items.length < first.total && page <= MAX_PAGES; page += 1) {
    const next = asList(await callService(name, baseUrl, `${path}${sep}page=${page}&limit=${limit}`, options));
    if (next.length === 0) break;
    items.push(...next);
  }
  return items;
}

module.exports = { callService, asList, getList };
