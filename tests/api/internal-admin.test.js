const request = require('supertest');
const app = require('../../src/app');
const googleService = require('../../src/services/google.service');
const habitsClient = require('../../src/clients/habits.client');
const streaksClient = require('../../src/clients/streaks.client');
const { USER_ID, userHeaders, adminHeaders, withHeaders } = require('../helpers');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../../src/services/google.service');
jest.mock('../../src/clients/habits.client');
jest.mock('../../src/clients/streaks.client');

const HABIT = '11111111-1111-4111-8111-111111111111';
const internalHeaders = { 'X-Internal-Token': 'test-internal-token', 'X-Request-Id': 'req-int-1' };

beforeEach(() => jest.resetAllMocks());

describe('POST /internal/reminders (called by habits-service)', () => {
  const post = (body, headers = internalHeaders) => withHeaders(request(app).post('/internal/reminders'), headers).send(body);

  test('valid request -> 202 and the reminder is processed', async () => {
    googleService.handleReminder.mockResolvedValue('not_connected');
    const res = await post({ userId: USER_ID, habitId: HABIT, action: 'upsert' });
    expect(res.status).toBe(202);
    expect(googleService.handleReminder).toHaveBeenCalledWith(
      { userId: USER_ID, habitId: HABIT, action: 'upsert' }, 'req-int-1',
    );
  });

  test('a Google failure never turns into an error for habits-service (IT-12)', async () => {
    googleService.handleReminder.mockRejectedValue(new Error('Google is down'));
    const res = await post({ userId: USER_ID, habitId: HABIT, action: 'delete' });
    expect(res.status).toBe(202);
  });

  test('invalid or unknown fields -> 400', async () => {
    expect((await post({ userId: 'x', habitId: HABIT, action: 'upsert' })).status).toBe(400);
    expect((await post({ userId: USER_ID, habitId: HABIT, action: 'drop' })).status).toBe(400);
    expect((await post({ userId: USER_ID, habitId: HABIT, action: 'upsert', role: 'admin' })).status).toBe(400);
    expect(googleService.handleReminder).not.toHaveBeenCalled();
  });

  test('without the internal token -> 401', async () => {
    const res = await post({ userId: USER_ID, habitId: HABIT, action: 'upsert' }, {});
    expect(res.status).toBe(401);
  });
});

describe('GET /admin/analytics', () => {
  test('returns totals only: extra fields from other services never reach the admin', async () => {
    habitsClient.stats.mockResolvedValue({
      habitsByCategory: [{ category: 'health', count: 31, userIds: [USER_ID] }],
      secret: 'x',
    });
    streaksClient.stats.mockResolvedValue({
      activeUsers: 42,
      checkinsPerDay: [{ date: '2026-11-21', count: 118, userId: USER_ID }],
      challenges: { active: 12, passed: 5, failed: 3, names: ['30 days of exercise'] },
      users: [{ id: USER_ID }],
    });
    const res = await withHeaders(request(app).get('/admin/analytics?range=90d'), adminHeaders());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      range: '90d',
      activeUsers: 42,
      habitsByCategory: [{ category: 'health', count: 31 }],
      checkinsPerDay: [{ date: '2026-11-21', count: 118 }],
      challenges: { active: 12, passed: 5, failed: 3 },
    });
    expect(JSON.stringify(res.body)).not.toContain(USER_ID);
  });

  test('bad range -> 400; normal user -> 403', async () => {
    expect((await withHeaders(request(app).get('/admin/analytics?range=1y'), adminHeaders())).status).toBe(400);
    expect((await withHeaders(request(app).get('/admin/analytics'), userHeaders())).status).toBe(403);
  });
});
