const request = require('supertest');
const app = require('../../src/app');
const db = require('../../src/config/db');
const habitsClient = require('../../src/clients/habits.client');
const streaksClient = require('../../src/clients/streaks.client');
const { todayIn, addDays } = require('../../src/utils/dates');
const { USER_ID, userHeaders, withHeaders, habit } = require('../helpers');

jest.mock('../../src/config/db', () => ({ query: jest.fn() }));
jest.mock('../../src/clients/habits.client');
jest.mock('../../src/clients/streaks.client');

const today = todayIn('UTC');
const month = today.slice(0, 7);
const H1 = '11111111-1111-4111-8111-111111111111';
const H2 = '22222222-2222-4222-8222-222222222222';
const CH = '44444444-4444-4444-8444-444444444444';
const SOMEONE_ELSES = '99999999-9999-4999-8999-999999999999';
const lastOfMonth = (() => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
})();

beforeEach(() => {
  jest.resetAllMocks();
  habitsClient.listHabits.mockResolvedValue([
    habit({ id: H1, name: 'Read', category: 'study' }),
    habit({ id: H2, name: 'Run', category: 'health' }),
    habit({
      id: CH, name: 'Read 2 books', type: 'challenge', category: 'study',
      challenge: { startDate: `${month}-01`, deadline: lastOfMonth, state: 'active' },
    }),
  ]);
  streaksClient.checkins.mockResolvedValue([{ habitId: H1, date: today }]);
  streaksClient.missedNotes.mockResolvedValue([{ habitId: H2, date: today }]);
  streaksClient.streaks.mockResolvedValue([
    { habitId: H1, currentStreak: 15, longestStreak: 15 },
    { habitId: H2, currentStreak: 0, longestStreak: 3 },
  ]);
  streaksClient.challenges.mockResolvedValue([
    { habitId: CH, startDate: '2026-10-01', deadline: '2026-10-30', state: 'ended', result: 'passed' },
  ]);
  habitsClient.withInactivePeriods.mockImplementation(async (ctx, list) => list);
  db.query.mockResolvedValue({ rows: [] });
});

const get = (path) => withHeaders(request(app).get(path), userHeaders());

describe('GET /calendar', () => {
  test('one entry per day with status, counts, notes and deadlines', async () => {
    const res = await get(`/calendar?month=${month}`);
    expect(res.status).toBe(200);
    expect(res.body.month).toBe(month);
    expect(res.body.days).toHaveLength(Number(lastOfMonth.slice(8)));
    const todayEntry = res.body.days.find((d) => d.date === today);
    expect(todayEntry).toEqual({
      date: today, status: 'today', due: 3, done: 1, hasMissedNote: true,
      challengeDeadlines: today === lastOfMonth ? [{ habitId: CH, name: 'Read 2 books' }] : [],
    });
    const lastEntry = res.body.days[res.body.days.length - 1];
    expect(lastEntry.challengeDeadlines).toEqual([{ habitId: CH, name: 'Read 2 books' }]);
    if (today > `${month}-01`) {
      expect(res.body.days[0]).toMatchObject({ status: 'missed', due: 3, done: 0 });
    }
  });

  test('category filter only counts habits in that category', async () => {
    const res = await get(`/calendar?month=${month}&category=health`);
    expect(res.body.days.find((d) => d.date === today)).toMatchObject({ due: 1, done: 0, hasMissedNote: true });
  });

  test("another user's habitId -> 404, not 403", async () => {
    const res = await get(`/calendar?month=${month}&habitId=${SOMEONE_ELSES}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  test('a month fully in the future needs no check-in calls', async () => {
    const future = addDays(lastOfMonth, 40).slice(0, 7);
    const res = await get(`/calendar?month=${future}`);
    expect(res.status).toBe(200);
    expect(res.body.days.every((d) => d.status === 'future')).toBe(true);
    expect(streaksClient.checkins).not.toHaveBeenCalled();
  });
});

describe('GET /milestones', () => {
  test('saves newly reached milestones and returns earned and next', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT habit_id, kind, days, earned_at')) {
        return { rows: [
          { habit_id: H1, kind: 'streak', days: 14, earned_at: '2026-11-21T19:02:11Z' },
          { habit_id: H1, kind: 'streak', days: 7, earned_at: '2026-11-14T19:02:11Z' },
          { habit_id: CH, kind: 'challenge_passed', days: 30, earned_at: '2026-10-31T00:00:00Z' },
        ] };
      }
      return { rows: [] };
    });

    const res = await get('/milestones');
    expect(res.status).toBe(200);

    const insert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO time_milestones'));
    expect(insert[1]).toEqual([USER_ID, [H1, H1, CH], ['streak', 'streak', 'challenge_passed'], [7, 14, 30]]);
    expect(insert[0]).toContain('ON CONFLICT (habit_id, kind, days) DO NOTHING');

    expect(res.body.earned[0]).toEqual({ habitId: H1, kind: 'streak', days: 14, earnedAt: '2026-11-21T19:02:11.000Z' });
    expect(res.body.next).toEqual([
      { habitId: H1, name: 'Read', days: 21, daysToGo: 6 },
      { habitId: H2, name: 'Run', days: 7, daysToGo: 7 },
    ]);
  });

  test('weekly streaks (unit "weeks") never earn or aim for day milestones', async () => {
    streaksClient.streaks.mockResolvedValue([
      { habitId: H1, currentStreak: 3, longestStreak: 3, unit: 'days' },
      { habitId: H2, currentStreak: 8, longestStreak: 8, unit: 'weeks' },
    ]);
    streaksClient.challenges.mockResolvedValue([]);
    const res = await get('/milestones');
    expect(res.status).toBe(200);
    const insert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO time_milestones'));
    expect(insert).toBeUndefined(); // H1 has no 7-day streak yet, H2's 8 WEEKS must not count as 7 days
    expect(res.body.next).toEqual([{ habitId: H1, name: 'Read', days: 7, daysToGo: 4 }]);
  });

  test("another user's habitId -> 404 and nothing is saved", async () => {
    const res = await get(`/milestones?habitId=${SOMEONE_ELSES}`);
    expect(res.status).toBe(404);
    expect(db.query).not.toHaveBeenCalled();
  });
});
