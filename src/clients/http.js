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

module.exports = { callService, asList };
