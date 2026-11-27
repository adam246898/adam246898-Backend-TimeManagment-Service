// Checks a Cognito access token without calling Cognito on every request (contract 3.3):
// RS256 signature against Cognito's public keys (JWKS), issuer, client, token use and expiry.
// Uses only Node's built-in crypto module.
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const { unauthenticated, serviceUnavailable } = require('../utils/errors');

const KEYS_TTL_MS = 10 * 60 * 1000;
let keys = new Map(); // kid -> KeyObject
let keysLoadedAt = 0;

async function loadKeys() {
  let body;
  try {
    const res = await fetch(config.cognito.jwksUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    body = await res.json();
  } catch (err) {
    logger.error('jwks_failed', { reason: err.message });
    throw serviceUnavailable('Sign-in is not available right now. Please try again in a moment.');
  }
  const next = new Map();
  for (const jwk of body.keys || []) {
    if (jwk.kty === 'RSA' && jwk.kid) next.set(jwk.kid, crypto.createPublicKey({ key: jwk, format: 'jwk' }));
  }
  keys = next;
  keysLoadedAt = Date.now();
}

async function keyFor(kid) {
  if (!keys.has(kid) || Date.now() - keysLoadedAt > KEYS_TTL_MS) await loadKeys();
  return keys.get(kid);
}

function decodePart(part) {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// Returns the token's claims, or throws 401. Only "RS256" is accepted, so a token signed with
// "none" or a shared secret is refused.
async function verifyAccessToken(token, now = Date.now()) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) throw unauthenticated();
  const [h, p, s] = parts;
  const header = decodePart(h);
  const claims = decodePart(p);
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') throw unauthenticated();

  const key = await keyFor(header.kid);
  if (!key) throw unauthenticated();
  const signatureOk = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'));
  if (!signatureOk) throw unauthenticated();

  const nowSeconds = Math.floor(now / 1000);
  if (claims.iss !== config.cognito.issuer) throw unauthenticated();
  if (claims.token_use !== 'access') throw unauthenticated();
  if (claims.client_id !== config.cognito.clientId) throw unauthenticated(); // access tokens carry client_id, not aud
  if (typeof claims.exp !== 'number' || claims.exp <= nowSeconds) throw unauthenticated('Your session has expired. Please log in again.');
  if (typeof claims.sub !== 'string') throw unauthenticated();
  return claims;
}

// Role comes ONLY from the Cognito group, never from the request.
const roleFromClaims = (claims) =>
  Array.isArray(claims['cognito:groups']) && claims['cognito:groups'].includes(config.cognito.adminGroup) ? 'admin' : 'user';

// Logout revokes the whole sign-in session (origin_jti), falling back to the token's own jti.
const sessionIdOf = (claims) => claims.origin_jti || claims.jti || null;

// For tests.
const resetKeys = () => {
  keys = new Map();
  keysLoadedAt = 0;
};

module.exports = { verifyAccessToken, roleFromClaims, sessionIdOf, resetKeys };
