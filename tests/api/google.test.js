// Google Calendar connect / callback. Includes security test ST-08 (bad or reused OAuth state).
const crypto = require('crypto');
const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const google = require('../../src/clients/google.client');
const kms = require('../../src/clients/kms.client');
const habitsClient = require('../../src/clients/habits.client');
const { USER_ID, userHeaders, withHeaders } = require('../helpers');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../../src/clients/kms.client');
jest.mock('../../src/clients/habits.client');
jest.mock('../../src/clients/google.client', () => {
  const actual = jest.requireActual('../../src/clients/google.client');
  return {
    ...actual,
    exchangeCode: jest.fn(),
    refreshAccessToken: jest.fn(),
    createCalendar: jest.fn(),
    deleteCalendar: jest.fn(),
    insertEvent: jest.fn(),
    deleteEvent: jest.fn(),
    revokeToken: jest.fn(),
  };
});

// A tiny in-memory stand-in for the three tables, enough to follow the real SQL's intent.
let states;
let links;
function fakeDb(sql, params = []) {
  if (sql.startsWith('DELETE FROM time_oauth_states WHERE created_at')) return { rows: [] };
  if (sql.startsWith('INSERT INTO time_oauth_states')) {
    states.set(params[0], { user_id: params[1], timezone: params[2], createdAt: Date.now() });
    return { rows: [] };
  }
  if (sql.includes('DELETE FROM time_oauth_states') && sql.includes('RETURNING')) {
    const row = states.get(params[0]);
    states.delete(params[0]);
    const fresh = row && Date.now() - row.createdAt < 10 * 60 * 1000;
    return { rows: fresh ? [row] : [] };
  }
  if (sql.includes('FROM time_google_links WHERE user_id')) {
    const link = links.get(params[0]);
    return { rows: link ? [link] : [] };
  }
  if (sql.startsWith('INSERT INTO time_google_links')) {
    links.set(params[0], { user_id: params[0], encrypted_refresh_token: params[1], calendar_id: params[2], timezone: params[3] });
    return { rows: [] };
  }
  return { rows: [] };
}

beforeEach(() => {
  jest.clearAllMocks();
  states = new Map();
  links = new Map();
  db.query.mockImplementation(async (sql, params) => fakeDb(sql.trim(), params));
  google.exchangeCode.mockResolvedValue({ refreshToken: 'refresh-secret', accessToken: 'access', scope: google.SCOPE });
  google.createCalendar.mockResolvedValue('cal-1');
  google.refreshAccessToken.mockResolvedValue('access');
  kms.encrypt.mockResolvedValue(Buffer.from('encrypted'));
  kms.decrypt.mockResolvedValue('refresh-secret');
  habitsClient.listHabits.mockResolvedValue([]);
});

const post = (path) => withHeaders(request(app).post(path), userHeaders());

async function connect() {
  const res = await post('/integrations/google/connect');
  return new URL(res.body.authUrl).searchParams.get('state');
}

const callback = (query) => request(app)
  .get(`/integrations/google/callback?${new URLSearchParams(query)}`)
  .set('X-Internal-Token', 'test-internal-token');

test('connect returns a Google URL with minimal scope and a random one-time state', async () => {
  const res = await post('/integrations/google/connect');
  expect(res.status).toBe(200);
  const url = new URL(res.body.authUrl);
  expect(url.origin).toBe('https://accounts.google.com');
  expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.app.created');
  const state = url.searchParams.get('state');
  expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
  // Only the hash of the state is stored, never the state itself.
  const stored = [...states.keys()][0];
  expect(stored).toBe(crypto.createHash('sha256').update(state).digest('hex'));
  expect(stored).not.toBe(state);
});

test('a good callback stores the KMS-encrypted token and redirects to the frontend', async () => {
  const state = await connect();
  const res = await callback({ code: 'google-code', state });
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe('http://localhost:8080/settings?google=connected');
  expect(kms.encrypt).toHaveBeenCalledWith('refresh-secret', USER_ID);
  expect(links.get(USER_ID).encrypted_refresh_token).toEqual(Buffer.from('encrypted'));
});

describe('ST-08: Google callback with a wrong or reused state', () => {
  test('wrong state -> rejected, Google never called, no token stored', async () => {
    await connect();
    const res = await callback({ code: 'google-code', state: crypto.randomBytes(32).toString('base64url') });
    expect(res.headers.location).toBe('http://localhost:8080/settings?google=error');
    expect(google.exchangeCode).not.toHaveBeenCalled();
    expect(links.size).toBe(0);
  });

  test('missing or malformed state -> rejected', async () => {
    for (const query of [{ code: 'c' }, { code: 'c', state: 'short' }, { code: 'c', state: "' OR 1=1 --" }]) {
      const res = await callback(query);
      expect(res.headers.location).toBe('http://localhost:8080/settings?google=error');
    }
    expect(links.size).toBe(0);
  });

  test('reused state -> the second use is rejected', async () => {
    const state = await connect();
    await callback({ code: 'google-code', state });
    links.clear();
    google.exchangeCode.mockClear();
    const res = await callback({ code: 'google-code', state });
    expect(res.headers.location).toBe('http://localhost:8080/settings?google=error');
    expect(google.exchangeCode).not.toHaveBeenCalled();
    expect(links.size).toBe(0);
  });

  test('state older than 10 minutes -> rejected', async () => {
    const state = await connect();
    for (const row of states.values()) row.createdAt -= 11 * 60 * 1000;
    const res = await callback({ code: 'google-code', state });
    expect(res.headers.location).toBe('http://localhost:8080/settings?google=error');
    expect(links.size).toBe(0);
  });

  test('the error reason is never put in the redirect URL', async () => {
    const state = await connect();
    google.exchangeCode.mockRejectedValue(Object.assign(new Error('x'), { code: 'UPSTREAM_ERROR' }));
    const res = await callback({ code: 'google-code', state });
    expect(res.headers.location).toBe('http://localhost:8080/settings?google=error');
  });
});

test('connect when already connected -> 409; sync or disconnect when not connected -> 409', async () => {
  links.set(USER_ID, { user_id: USER_ID });
  expect((await post('/integrations/google/connect')).status).toBe(409);
  links.clear();
  expect((await post('/integrations/google/sync')).status).toBe(409);
  const del = await withHeaders(request(app).delete('/integrations/google'), userHeaders());
  expect(del.status).toBe(409);
});

test('status when not connected', async () => {
  const res = await withHeaders(request(app).get('/integrations/google'), userHeaders());
  expect(res.body).toEqual({ connected: false, syncedHabits: 0, lastSyncedAt: null });
});
