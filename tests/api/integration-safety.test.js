// Things that matter when the three backends are connected for real.
const http = require('http');
const request = require('supertest');
const app = require('../../src/app');
const config = require('../../src/config');
const { getList } = require('../../src/clients/http');
const streaksClient = require('../../src/clients/streaks.client');
const { userHeaders, withHeaders } = require('../helpers');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));

let server;
let base;
let handler;

beforeAll(async () => {
  server = http.createServer((req, res) => handler(req, res));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  config.streaksServiceUrl = base;
  config.habitsServiceUrl = base;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

describe('gateway path prefix', () => {
  test('public routes answer with and without /api', async () => {
    for (const path of ['/calendar?month=2026-13', '/api/calendar?month=2026-13']) {
      const res = await withHeaders(request(app).get(path), userHeaders());
      expect(res.status).toBe(400); // reached the route (validation), not 404
    }
  });

  test('internal routes are NOT available under /api', async () => {
    const res = await withHeaders(request(app).post('/api/internal/reminders'), userHeaders()).send({});
    expect(res.status).toBe(404);
  });
});

describe('paged answers from another service (contract 3.6)', () => {
  test('all pages are fetched, not just the first 20 items', async () => {
    const all = Array.from({ length: 45 }, (_, i) => ({ habitId: 'h', date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, n: i }));
    const urls = [];
    handler = (req, res) => {
      urls.push(req.url);
      const page = Number(new URL(req.url, base).searchParams.get('page') || 1);
      json(res, 200, { data: all.slice((page - 1) * 20, page * 20), page, limit: 20, total: all.length });
    };
    const items = await getList('streaks-service', base, '/internal/checkins?userId=u', {});
    expect(items).toHaveLength(45);
    expect(urls).toEqual([
      '/internal/checkins?userId=u',
      '/internal/checkins?userId=u&page=2&limit=20',
      '/internal/checkins?userId=u&page=3&limit=20',
    ]);
  });

  test('a plain list or { data } without total is used as it is', async () => {
    handler = (req, res) => json(res, 200, { data: [{ a: 1 }] });
    expect(await getList('x', base, '/internal/streaks?userId=u', {})).toEqual([{ a: 1 }]);
    handler = (req, res) => json(res, 200, [{ a: 1 }, { a: 2 }]);
    expect(await getList('x', base, '/internal/streaks?userId=u', {})).toHaveLength(2);
  });
});

describe('optional missed-notes route', () => {
  test.each([404, 400, 500])('a %i answer means "no notes", never a failed calendar', async (status) => {
    handler = (req, res) => json(res, status, { error: { code: 'X', message: 'x' } });
    await expect(streaksClient.missedNotes({ userId: 'u' }, '2026-11-01', '2026-11-21')).resolves.toEqual([]);
  });
});
