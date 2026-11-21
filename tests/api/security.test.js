// Request rules that apply to every route: internal token, identity headers, roles,
// input validation and the error format.
const request = require('supertest');
const app = require('../../src/app');
const { userHeaders, adminHeaders, withHeaders } = require('../helpers');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

const get = (path, headers = userHeaders()) => withHeaders(request(app).get(path), headers);

describe('internal token and identity', () => {
  test('health needs no token and returns no data', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'time-service' });
  });

  test('no internal token -> 401 in the contract error format', async () => {
    const { 'X-Internal-Token': _omit, ...headers } = userHeaders();
    const res = await get('/dashboard', headers);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: expect.any(String), requestId: 'req-test-1' },
    });
  });

  test('wrong internal token -> 401 (a faked X-User-Id is useless without it)', async () => {
    const res = await get('/dashboard', userHeaders({ 'X-Internal-Token': 'guess' }));
    expect(res.status).toBe(401);
  });

  test('missing or malformed X-User-Id -> 401', async () => {
    expect((await get('/dashboard', userHeaders({ 'X-User-Id': '' }))).status).toBe(401);
    expect((await get('/dashboard', userHeaders({ 'X-User-Id': '42' }))).status).toBe(401);
  });

  test('an admin cannot open personal routes -> 403', async () => {
    for (const path of ['/dashboard', '/calendar?month=2026-11', '/milestones', '/integrations/google']) {
      const res = await get(path, adminHeaders());
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });

  test('a normal user cannot open admin analytics -> 403', async () => {
    const res = await get('/admin/analytics');
    expect(res.status).toBe(403);
  });

  test('unknown route -> 404 NOT_FOUND', async () => {
    const res = await get('/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('input validation (ST-13)', () => {
  test.each([
    ['/dashboard?range=7d', 'range'],
    ['/dashboard?range=30d&range=90d', 'range'],
    ['/dashboard?userId=someone-else', 'userId'],
    ['/calendar', 'month'],
    ['/calendar?month=2026-13', 'month'],
    ['/calendar?month=1999-01', 'month'],
    ['/calendar?month=2026-11&category=gaming', 'category'],
    ['/calendar?month=2026-11&habitId=1', 'habitId'],
    ['/milestones?habitId=%27%3B%20DROP%20TABLE%20x', 'habitId'],
  ])('%s -> 400 on %s', async (path, field) => {
    const res = await get(path);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });

  test('a non-JSON body -> 415', async () => {
    const res = await withHeaders(request(app).post('/integrations/google/sync'), userHeaders())
      .set('Content-Type', 'text/plain')
      .send('hello');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  test('a body over 10 KB -> 413', async () => {
    const res = await withHeaders(request(app).post('/internal/reminders'), userHeaders())
      .send({ userId: 'x'.repeat(50 * 1024) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('broken JSON -> 400', async () => {
    const res = await withHeaders(request(app).post('/integrations/google/sync'), userHeaders())
      .set('Content-Type', 'application/json')
      .send('{"a":');
    expect(res.status).toBe(400);
  });

  test('unknown body fields are rejected, not ignored', async () => {
    const res = await withHeaders(request(app).post('/integrations/google/connect'), userHeaders())
      .send({ userId: 'someone-else' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'userId', issue: 'Unknown field.' }]);
  });

  test('security headers are set by Helmet', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
