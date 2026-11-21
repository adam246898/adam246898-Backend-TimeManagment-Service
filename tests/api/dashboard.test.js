// GET /dashboard against FAKE habits and streaks services running on local ports.
// This tests the real HTTP clients too: headers sent, timeouts and 503 (IT-11).
const http = require('http');
const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config');
const db = require('../../src/config/db');
const { todayIn, addDays } = require('../../src/utils/dates');
const { USER_ID, userHeaders, withHeaders, habit } = require('../helpers');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

const today = todayIn('UTC');
const READ = '11111111-1111-4111-8111-111111111111';
const CHAL = '44444444-4444-4444-8444-444444444444';

const habits = [
  habit({ id: READ, name: 'Read pages' }),
  habit({
    id: CHAL, type: 'challenge', name: '30 days of exercise',
    challenge: { startDate: addDays(today, -10), deadline: addDays(today, 19), state: 'active' },
  }),
];
// Read was done on every one of the last 30 days except one.
const checkins = [];
for (let i = 1; i <= 30; i += 1) if (i !== 3) checkins.push({ habitId: READ, date: addDays(today, -i) });
checkins.push({ habitId: READ, date: today });

let seen = [];
let mode = 'ok';
let server;

function reply(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (mode === 'hang') return; // never answers: the client must time out
    if (mode === 'error') { res.writeHead(500); return res.end(); }
    const path = req.url.split('?')[0];
    if (path === '/internal/habits') return reply(res, { data: habits });
    if (path === '/internal/habits/due') return reply(res, { data: habits });
    if (path === '/internal/checkins') return reply(res, { data: checkins });
    if (path === '/internal/streaks') {
      return reply(res, { data: [{ habitId: READ, currentStreak: 21, longestStreak: 21, atRisk: false }] });
    }
    if (path === '/internal/challenges') {
      return reply(res, { data: [{ habitId: CHAL, name: '30 days of exercise', state: 'active', startDate: addDays(today, -10),
        deadline: addDays(today, 19), daysLeft: 19, completionRate: 0.9, result: null }] });
    }
    res.writeHead(404);
    return res.end();
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  config.habitsServiceUrl = base;
  config.streaksServiceUrl = base;
  config.upstreamTimeoutMs = 300;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

beforeEach(() => {
  seen = [];
  mode = 'ok';
  db.query.mockReset();
  db.query.mockImplementation(async (sql) => {
    if (sql.includes('SELECT habit_id, kind, days, earned_at')) {
      return { rows: [7, 14, 21].map((days) => ({ habit_id: READ, kind: 'streak', days, earned_at: new Date() })) };
    }
    return { rows: [] };
  });
});

const getDashboard = (query = '') => withHeaders(request(app).get(`/dashboard${query}`), userHeaders());

test('returns the dashboard in the contract shape', async () => {
  const res = await getDashboard('?range=30d');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    range: '30d',
    today: { date: today, due: 2, done: 1 },
    bestCurrentStreak: { habitId: READ, name: 'Read pages', days: 21 },
    activeChallenges: [{ habitId: CHAL, name: '30 days of exercise', daysLeft: 19, completionRate: 0.9 }],
    nextMilestone: { habitId: READ, name: 'Read pages', days: 30, daysToGo: 9 },
  });
  expect(res.body.bestDays).toHaveLength(7);
  // Read: 29/30 done. Challenge: 10 due days in range (start .. yesterday), none done. 29/40.
  expect(res.body.completionRate).toBe(0.73);
});

test('every internal call carries the user ID, internal token and request ID', async () => {
  await getDashboard();
  expect(seen.length).toBeGreaterThanOrEqual(5);
  for (const call of seen) {
    expect(call.headers['x-internal-token']).toBe('test-internal-token');
    expect(call.headers['x-user-id']).toBe(USER_ID);
    expect(call.headers['x-request-id']).toBe('req-test-1');
    expect(call.url).toContain(`userId=${USER_ID}`);
  }
});

test('newly reached milestones are saved (IT-07)', async () => {
  await getDashboard();
  const insert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO time_milestones'));
  expect(insert[1][0]).toBe(USER_ID);
  expect(insert[1][3]).toEqual([7, 14, 21]);
});

test('IT-11: another service does not answer within the timeout -> 503, no crash', async () => {
  mode = 'hang';
  const started = Date.now();
  const res = await getDashboard();
  expect(res.status).toBe(503);
  expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  expect(res.body.error.message).not.toMatch(/habits|streaks|127\.0\.0\.1/i); // no internal names
  expect(Date.now() - started).toBeLessThan(2000);
});

test('another service answers with an error -> 503', async () => {
  mode = 'error';
  const res = await getDashboard();
  expect(res.status).toBe(503);
});
