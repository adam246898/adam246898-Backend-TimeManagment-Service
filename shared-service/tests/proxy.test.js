// Routing to service-a / b / c through fake upstream services on local ports.
const http = require('http');
const request = require('supertest');
const app = require('../src/app');
const config = require('../src/config');
const db = require('../src/config/db');
const users = require('../src/services/users.service');
const { resetKeys } = require('../src/clients/tokens');
const { resetRateLimit } = require('../src/middleware/rateLimit');
const { startJwks, signToken, userRow, adminRow, fakeDb, USER_ID } = require('./helpers');

jest.mock('../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../src/clients/cognito.client');

let jwks;
let upstream;
let seen;
let fake;

beforeAll(async () => {
  jwks = await startJwks();
  upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body, host: req.headers.host });
      if (req.url.startsWith('/api/integrations/google/callback')) {
        res.writeHead(302, { Location: 'http://localhost:8080/settings?google=connected' });
        return res.end();
      }
      if (req.url.startsWith('/api/habits/forbidden')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        return res.end('{"error":{"code":"FORBIDDEN","message":"no"}}');
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => upstream.listen(0, resolve));
  const base = `http://127.0.0.1:${upstream.address().port}`;
  // Three different "services" on the same port, told apart by a path marker in the URL we check.
  config.services = { habits: `${base}`, streaks: `${base}`, time: `${base}` };
});
afterAll(() => { jwks.close(); upstream.close(); });
beforeEach(() => {
  jest.clearAllMocks();
  resetKeys();
  resetRateLimit();
  users.clearCache();
  seen = [];
  fake = fakeDb();
  fake.state.users.push(userRow(), adminRow());
  db.query.mockImplementation(fake.query);
});

const auth = (req, token = signToken({ sub: 'sub-user' })) => req.set('Authorization', `Bearer ${token}`);

test('requests are forwarded with the full /api path, the query and the body', async () => {
  const res = await auth(request(app).post('/api/checkins?x=1')).set('Content-Type', 'application/json').send({ habitId: 'h' });
  expect(res.status).toBe(200);
  expect(seen[0]).toMatchObject({ method: 'POST', url: '/api/checkins?x=1', body: '{"habitId":"h"}' });
});

test('ST-06: client identity headers are replaced by the verified ones', async () => {
  await auth(request(app).get('/api/dashboard'))
    .set('X-User-Id', '99999999-9999-4999-8999-999999999999')
    .set('X-User-Role', 'admin')
    .set('X-Internal-Token', 'guess')
    .set('X-Request-Id', 'chosen-by-client');
  const h = seen[0].headers;
  expect(h['x-user-id']).toBe(USER_ID);
  expect(h['x-user-role']).toBe('user');
  expect(h['x-user-timezone']).toBe('Africa/Cairo');
  expect(h['x-user-week-starts-on']).toBe('sunday');
  expect(h['x-internal-token']).toBe('test-internal-token');
  expect(h['x-request-id']).not.toBe('chosen-by-client');
  expect(h.authorization).toBeUndefined(); // the Cognito token never reaches the services
});

test.each([
  '/api/habits', '/api/habits/123/pause', '/api/habit-templates', '/api/categories',
  '/api/checklists', '/api/checkins', '/api/streaks', '/api/challenges/1', '/api/missed-notes',
  '/api/dashboard', '/api/calendar?month=2026-11', '/api/milestones', '/api/integrations/google',
])('%s is forwarded', async (path) => {
  const res = await auth(request(app).get(path));
  expect(res.status).toBe(200);
  expect(seen[0].url).toBe(path);
});

test('the routing table sends each path to the right service', () => {
  const { findRoute } = require('../src/services/proxy.service');
  expect(findRoute('/api/habits/1').service).toBe('habits');
  expect(findRoute('/api/habit-templates/1/adopt').service).toBe('habits');
  expect(findRoute('/api/checkins').service).toBe('streaks');
  expect(findRoute('/api/admin/analytics').service).toBe('time');
  expect(findRoute('/api/admin/habit-templates').service).toBe('habits');
  expect(findRoute('/api/integrations/google/callback').isPublic).toBe(true);
  expect(findRoute('/api/habitsXYZ')).toBeNull();
  expect(findRoute('/api/nothing')).toBeNull();
});

test('/internal/* is never public (404), unknown routes are 404', async () => {
  expect((await auth(request(app).get('/internal/habits?userId=x'))).status).toBe(404);
  expect((await auth(request(app).post('/internal/reminders'))).status).toBe(404);
  expect((await auth(request(app).get('/api/nothing'))).status).toBe(404);
  expect(seen).toHaveLength(0);
});

test('without a token nothing is forwarded (401)', async () => {
  expect((await request(app).get('/api/habits')).status).toBe(401);
  expect(seen).toHaveLength(0);
});

test('admin-only forwarded routes: a user gets 403 at the gateway, an admin is forwarded', async () => {
  expect((await auth(request(app).get('/api/admin/analytics'))).status).toBe(403);
  expect(seen).toHaveLength(0);
  const admin = signToken({ sub: 'sub-admin', 'cognito:groups': ['admin'] });
  expect((await auth(request(app).get('/api/admin/analytics?range=30d'), admin)).status).toBe(200);
  expect(seen[0].headers['x-user-role']).toBe('admin');
});

test('the Google callback is public and its 302 is passed to the browser unchanged', async () => {
  const res = await request(app).get('/api/integrations/google/callback?code=c&state=s');
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('http://localhost:8080/settings?google=connected');
  expect(seen[0].headers['x-internal-token']).toBe('test-internal-token');
  expect(seen[0].headers['x-user-id']).toBeUndefined();
});

test('a 403 from a service is written to the audit log', async () => {
  const res = await auth(request(app).get('/api/habits/forbidden'));
  expect(res.status).toBe(403);
  expect(fake.state.audit).toContainEqual(expect.objectContaining({ action: 'forbidden', target: '/api/habits/forbidden' }));
});

test('IT-11: a service that does not answer -> 503, the gateway keeps running', async () => {
  const saved = config.services.habits;
  config.services.habits = 'http://127.0.0.1:1';
  const res = await auth(request(app).get('/api/habits'));
  config.services.habits = saved;
  expect(res.status).toBe(503);
  expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  expect((await request(app).get('/health')).status).toBe(200);
});

test('a forwarded body over 10 KB -> 413 at the gateway', async () => {
  const res = await auth(request(app).post('/api/habits')).set('Content-Type', 'application/json').send({ name: 'x'.repeat(20000) });
  expect(res.status).toBe(413);
  expect(seen).toHaveLength(0);
});

test('rate limit: request 101 within a minute from one IP -> 429', async () => {
  const codes = [];
  for (let i = 0; i < 101; i += 1) codes.push((await request(app).get('/api/nothing')).status);
  expect(codes.slice(0, 100).every((c) => c === 404)).toBe(true);
  expect(codes[100]).toBe(429);
});

test('CORS: only the frontend origin is allowed; security headers are set', async () => {
  const ok = await request(app).options('/api/habits').set('Origin', 'http://localhost:8080');
  expect(ok.status).toBe(204);
  expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:8080');
  const bad = await request(app).options('/api/habits').set('Origin', 'http://evil.test');
  expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  const health = await request(app).get('/health');
  expect(health.headers['x-content-type-options']).toBe('nosniff');
  expect(health.headers['x-powered-by']).toBeUndefined();
});
