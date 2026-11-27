// Test helpers: a real RSA key pair, a local JWKS server (like Cognito's), token signing,
// and an in-memory stand-in for the gw_* tables.
const crypto = require('crypto');
const http = require('http');
const config = require('../src/config');

const KID = 'test-key';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

async function startJwks() {
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  config.cognito.jwksUrl = `http://127.0.0.1:${server.address().port}/.well-known/jwks.json`;
  return server;
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

// A Cognito-like access token. Pass overrides to break one claim at a time.
function signToken(claimOverrides = {}, { kid = KID, alg = 'RS256', key = privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg, typ: 'JWT', kid });
  const claims = b64({
    sub: 'sub-user',
    token_use: 'access',
    iss: config.cognito.issuer,
    client_id: config.cognito.clientId,
    iat: now,
    exp: now + 3600,
    jti: crypto.randomUUID(),
    origin_jti: crypto.randomUUID(),
    ...claimOverrides,
  });
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), key).toString('base64url');
  return `${header}.${claims}.${signature}`;
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';

function userRow(over = {}) {
  return {
    id: USER_ID,
    cognito_sub: 'sub-user',
    name: 'Adam',
    email: 'adam@example.com',
    role: 'user',
    is_active: true,
    timezone: 'Africa/Cairo',
    week_starts_on: 'sunday',
    created_at: '2026-11-21T18:30:00Z',
    ...over,
  };
}

const adminRow = (over = {}) =>
  userRow({ id: ADMIN_ID, cognito_sub: 'sub-admin', name: 'Admin', email: 'admin@example.com', role: 'admin', ...over });

// In-memory gw_* tables, enough to follow the SQL each service runs.
function fakeDb() {
  const state = { users: [], attempts: [], audit: [], revoked: new Set() };
  const query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT') && s.includes('FROM gw_users WHERE cognito_sub')) {
      return { rows: state.users.filter((u) => u.cognito_sub === params[0]) };
    }
    if (s.startsWith('SELECT') && s.includes('FROM gw_users WHERE id')) return { rows: state.users.filter((u) => u.id === params[0]) };
    if (s.startsWith('SELECT 1 FROM gw_users WHERE email')) return { rows: state.users.filter((u) => u.email === params[0]) };
    if (s.startsWith('INSERT INTO gw_users')) {
      const row = userRow({ id: crypto.randomUUID(), cognito_sub: params[0], name: params[1], email: params[2], timezone: params[3] });
      state.users.push(row);
      return { rows: [row] };
    }
    if (s.startsWith('UPDATE gw_users SET role')) {
      const u = state.users.find((x) => x.id === params[0]);
      u.role = params[1];
      return { rows: [u] };
    }
    if (s.startsWith('UPDATE gw_users SET name')) {
      const u = state.users.find((x) => x.id === params[0]);
      if (params[1] !== null) u.name = params[1];
      if (params[2] !== null) u.timezone = params[2];
      if (params[3] !== null) u.week_starts_on = params[3];
      return { rows: [u] };
    }
    if (s.startsWith('UPDATE gw_users SET is_active')) {
      const u = state.users.find((x) => x.id === params[0]);
      u.is_active = params[1];
      return { rows: [u] };
    }
    if (s.startsWith('SELECT count(*)::int AS n FROM gw_users')) return { rows: [{ n: state.users.length }] };
    if (s.startsWith('SELECT') && s.includes('FROM gw_users') && s.includes('ORDER BY')) return { rows: [...state.users] };
    if (s.startsWith('SELECT count(*)::int AS n FROM gw_login_attempts')) {
      return { rows: [{ n: state.attempts.filter((a) => a.email === params[0] && !a.success).length }] };
    }
    if (s.startsWith('INSERT INTO gw_login_attempts')) {
      state.attempts.push({ email: params[0], ip: params[1], success: params[2] });
      return { rows: [] };
    }
    if (s.startsWith('INSERT INTO gw_audit_logs')) {
      state.audit.push({ actor_user_id: params[0], action: params[1], target: params[2], status_code: params[3], ip: params[4], request_id: params[5] });
      return { rows: [] };
    }
    if (s.startsWith('SELECT count(*)::int AS n FROM gw_audit_logs')) return { rows: [{ n: state.audit.length }] };
    if (s.startsWith('SELECT * FROM gw_audit_logs')) {
      return { rows: state.audit.map((a, i) => ({ id: `a${i}`, created_at: '2026-11-21T18:31:00Z', ...a })) };
    }
    if (s.startsWith('INSERT INTO gw_revoked_tokens')) {
      state.revoked.add(params[0]);
      return { rows: [] };
    }
    if (s.startsWith('SELECT 1 FROM gw_revoked_tokens')) return { rows: state.revoked.has(params[0]) ? [{}] : [] };
    throw new Error(`fakeDb: unhandled SQL: ${s}`);
  };
  return { state, query };
}

module.exports = { startJwks, signToken, userRow, adminRow, fakeDb, USER_ID, ADMIN_ID, KID, privateKey };
