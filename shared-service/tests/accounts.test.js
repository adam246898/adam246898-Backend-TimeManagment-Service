// Accounts: sign-up, login (+ lockout), logout, profile, admin. Cognito and the database are faked.
const request = require('supertest');
const app = require('../src/app');
const db = require('../src/config/db');
const cognito = require('../src/clients/cognito.client');
const users = require('../src/services/users.service');
const { resetKeys } = require('../src/clients/tokens');
const { resetRateLimit } = require('../src/middleware/rateLimit');
const { startJwks, signToken, userRow, adminRow, fakeDb, USER_ID, ADMIN_ID } = require('./helpers');

jest.mock('../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../src/clients/cognito.client');

let jwks;
let fake;
beforeAll(async () => { jwks = await startJwks(); });
afterAll(() => jwks.close());
beforeEach(() => {
  jest.resetAllMocks();
  resetKeys();
  resetRateLimit();
  users.clearCache();
  fake = fakeDb();
  fake.state.users.push(userRow(), adminRow());
  db.query.mockImplementation(fake.query);
});

const userToken = () => signToken({ sub: 'sub-user' });
const adminToken = () => signToken({ sub: 'sub-admin', 'cognito:groups': ['admin'] });
const json = (req) => req.set('Content-Type', 'application/json');

describe('POST /api/auth/signup', () => {
  const good = { name: 'Teeba', email: 'Teeba@Example.com', password: 'habits2026x', timezone: 'Africa/Cairo' };

  test('creates a normal user (201), email stored lower-case, no password in the answer', async () => {
    cognito.signUp.mockResolvedValue('sub-new');
    const res = await json(request(app).post('/api/auth/signup')).send(good);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Teeba', email: 'teeba@example.com', role: 'user', isActive: true, timezone: 'Africa/Cairo', settings: { weekStartsOn: 'sunday' } });
    expect(JSON.stringify(res.body)).not.toMatch(/habits2026x|sub-new/);
    expect(cognito.signUp).toHaveBeenCalledWith({ email: 'teeba@example.com', password: 'habits2026x', name: 'Teeba' });
  });

  test('ST-04: "role": "admin" in the body is rejected (400), no account is made', async () => {
    const res = await json(request(app).post('/api/auth/signup')).send({ ...good, role: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'role', issue: 'Unknown field.' }]);
    expect(cognito.signUp).not.toHaveBeenCalled();
  });

  test.each([
    [{ name: 'A' }, 'name'],
    [{ email: 'not-an-email' }, 'email'],
    [{ password: 'short1' }, 'password'],
    [{ password: 'onlyletterspassword' }, 'password'],
    [{ timezone: 'Mars/Base' }, 'timezone'],
  ])('invalid %o -> 400 on %s', async (change, field) => {
    const res = await json(request(app).post('/api/auth/signup')).send({ ...good, ...change });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
  });

  test('an email that already exists -> 409 EMAIL_TAKEN', async () => {
    const res = await json(request(app).post('/api/auth/signup')).send({ ...good, email: 'adam@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  test('not JSON -> 415, over 10 KB -> 413', async () => {
    expect((await request(app).post('/api/auth/signup').set('Content-Type', 'text/plain').send('hi')).status).toBe(415);
    expect((await json(request(app).post('/api/auth/signup')).send({ name: 'x'.repeat(20000) })).status).toBe(413);
  });
});

describe('POST /api/auth/login', () => {
  const nameError = Object.assign(new Error('Incorrect username or password'), { name: 'NotAuthorizedException' });
  const notFoundError = Object.assign(new Error('User not found'), { name: 'UserNotFoundException' });

  test('right password -> 200 with a Bearer token and the user', async () => {
    cognito.login.mockResolvedValue({ accessToken: userToken(), expiresIn: 3600 });
    const res = await json(request(app).post('/api/auth/login')).send({ email: 'adam@example.com', password: 'habits2026x' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 3600, user: { id: USER_ID, email: 'adam@example.com', role: 'user' } });
  });

  test('wrong password and unknown email give the SAME 401 answer, and are audited', async () => {
    cognito.login.mockRejectedValueOnce(nameError).mockRejectedValueOnce(notFoundError);
    const a = await json(request(app).post('/api/auth/login')).send({ email: 'adam@example.com', password: 'wrong-pass-1' });
    const b = await json(request(app).post('/api/auth/login')).send({ email: 'nobody@example.com', password: 'wrong-pass-1' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(a.body.error.message).toBe(b.body.error.message);
    expect(fake.state.audit.filter((x) => x.action === 'login_failed')).toHaveLength(2);
  });

  test('ST-07: five failures for one email, then the sixth try is locked (429) even with the right password', async () => {
    cognito.login.mockRejectedValue(nameError);
    const codes = [];
    for (let i = 0; i < 5; i += 1) {
      codes.push((await json(request(app).post('/api/auth/login')).send({ email: 'adam@example.com', password: 'wrong-pass-1' })).status);
    }
    cognito.login.mockResolvedValue({ accessToken: userToken(), expiresIn: 3600 });
    const sixth = await json(request(app).post('/api/auth/login')).send({ email: 'adam@example.com', password: 'habits2026x' });
    expect(codes).toEqual([401, 401, 401, 401, 401]);
    expect(sixth.status).toBe(429);
    expect(fake.state.audit.some((x) => x.action === 'login_locked')).toBe(true);
  });

  test('a deactivated account -> 403 ACCOUNT_DISABLED', async () => {
    cognito.login.mockRejectedValue(Object.assign(new Error('User is disabled.'), { name: 'NotAuthorizedException' }));
    const res = await json(request(app).post('/api/auth/login')).send({ email: 'adam@example.com', password: 'habits2026x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('token, logout and profile', () => {
  const me = (token) => request(app).get('/api/users/me').set('Authorization', `Bearer ${token}`);

  test('ST-01: no token -> 401; a tampered or expired token -> 401', async () => {
    expect((await request(app).get('/api/users/me')).status).toBe(401);
    expect((await me(`${userToken()}x`)).status).toBe(401);
    expect((await me(signToken({ sub: 'sub-user', exp: 1 }))).status).toBe(401);
  });

  test('GET /api/users/me returns the profile', async () => {
    const res = await me(userToken());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: USER_ID, name: 'Adam', email: 'adam@example.com', role: 'user', isActive: true,
      timezone: 'Africa/Cairo', settings: { weekStartsOn: 'sunday' }, createdAt: '2026-11-21T18:30:00.000Z',
    });
  });

  test('after logout the same token no longer works', async () => {
    const token = userToken();
    const out = await request(app).post('/api/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(out.status).toBe(204);
    expect(cognito.logout).toHaveBeenCalledWith(token);
    expect((await me(token)).status).toBe(401);
  });

  test('PATCH /api/users/me changes name, time zone and week start; role/email/isActive are rejected', async () => {
    const patch = (body) => json(request(app).patch('/api/users/me').set('Authorization', `Bearer ${userToken()}`)).send(body);
    const ok = await patch({ name: 'Adam M', timezone: 'Europe/London', settings: { weekStartsOn: 'monday' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ name: 'Adam M', timezone: 'Europe/London', settings: { weekStartsOn: 'monday' } });
    for (const body of [{ role: 'admin' }, { email: 'x@y.com' }, { isActive: false }, {}, { settings: { weekStartsOn: 'friday' } }]) {
      expect((await patch(body)).status).toBe(400);
    }
  });

  test('a deactivated account is blocked on its next request (403 ACCOUNT_DISABLED)', async () => {
    fake.state.users[0].is_active = false;
    const res = await me(userToken());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('admin', () => {
  const asAdmin = (req) => req.set('Authorization', `Bearer ${adminToken()}`);

  test('ST-03: a normal user calling an admin route -> 403, written to the audit log', async () => {
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${userToken()}`);
    expect(res.status).toBe(403);
    expect(fake.state.audit).toContainEqual(expect.objectContaining({ action: 'forbidden', status_code: 403, actor_user_id: USER_ID }));
  });

  test('admin lists users (no habit data) and reads the audit log', async () => {
    const list = await asAdmin(request(app).get('/api/admin/users?sort=email&limit=10'));
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ page: 1, limit: 10, total: 2 });
    expect(Object.keys(list.body.data[0]).sort()).toEqual(['createdAt', 'email', 'id', 'isActive', 'name', 'role', 'settings', 'timezone']);
    const logs = await asAdmin(request(app).get('/api/admin/audit-logs?action=forbidden'));
    expect(logs.status).toBe(200);
    expect(await asAdmin(request(app).get('/api/admin/users?sort=password')).then((r) => r.status)).toBe(400);
  });

  test('admin deactivates a user (Cognito disabled too), and cannot deactivate themselves (409)', async () => {
    const off = await json(asAdmin(request(app).patch(`/api/admin/users/${USER_ID}/status`))).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    expect(cognito.setEnabled).toHaveBeenCalledWith('adam@example.com', false);
    const self = await json(asAdmin(request(app).patch(`/api/admin/users/${ADMIN_ID}/status`))).send({ isActive: false });
    expect(self.status).toBe(409);
    const missing = await json(asAdmin(request(app).patch('/api/admin/users/33333333-3333-4333-8333-333333333333/status'))).send({ isActive: true });
    expect(missing.status).toBe(404);
  });
});
