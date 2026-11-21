// Best-day and calendar calculations (Adam's unit tests in the report, section 18.2).
const { dailyBreakdown, completionRate, bestDays, dayStatus } = require('../../src/services/stats');
const { isDueOn } = require('../../src/services/schedule');
const { habit } = require('../helpers');

const tz = 'UTC';
// 2026-11-16 is a Monday; the range below is Mon 16 .. Sun 22 (one full week).
const from = '2026-11-16';
const to = '2026-11-22';
const today = '2026-11-23';

describe('isDueOn', () => {
  test('weekday schedule is due only on the chosen days', () => {
    const h = habit({ id: 'h1', schedule: { type: 'weekdays', days: ['mon', 'wed'] } });
    expect(isDueOn(h, '2026-11-16', { tz, today })).toBe(true); // mon
    expect(isDueOn(h, '2026-11-17', { tz, today })).toBe(false); // tue
  });

  test('not due before the habit was created, nor after a challenge deadline', () => {
    const h = habit({ id: 'h1', createdAt: '2026-11-18T10:00:00Z' });
    expect(isDueOn(h, '2026-11-17', { tz, today })).toBe(false);
    expect(isDueOn(h, '2026-11-18', { tz, today })).toBe(true);
    const c = habit({ id: 'c1', type: 'challenge', challenge: { startDate: '2026-11-17', deadline: '2026-11-19' } });
    expect(isDueOn(c, '2026-11-16', { tz, today })).toBe(false);
    expect(isDueOn(c, '2026-11-19', { tz, today })).toBe(true);
    expect(isDueOn(c, '2026-11-20', { tz, today })).toBe(false);
  });

  test('paused days are not due (pause periods, and the current pause)', () => {
    const h = habit({ id: 'h1', pausePeriods: [{ from: '2026-11-17', to: '2026-11-19' }] });
    expect(isDueOn(h, '2026-11-17', { tz, today })).toBe(false);
    expect(isDueOn(h, '2026-11-19', { tz, today })).toBe(true);
    const paused = habit({ id: 'h2', status: 'paused', pausedUntil: '2026-11-25' });
    expect(isDueOn(paused, '2026-11-24', { tz, today })).toBe(false);
    expect(isDueOn(paused, '2026-11-25', { tz, today })).toBe(true);
  });

  test('times_per_week is due until the weekly count is reached', () => {
    const h = habit({ id: 'h1', schedule: { type: 'times_per_week', count: 2 } });
    const doneDates = new Set(['2026-11-16', '2026-11-17']);
    expect(isDueOn(h, '2026-11-17', { tz, today, doneDates })).toBe(true); // 1 done before
    expect(isDueOn(h, '2026-11-18', { tz, today, doneDates })).toBe(false); // 2 done: target reached
    expect(isDueOn(h, '2026-11-23', { tz, today, doneDates })).toBe(true); // new week
  });
});

describe('best days and completion rate', () => {
  test('rate per weekday = completed due days / all due days', () => {
    const h1 = habit({ id: 'h1' }); // daily
    const h2 = habit({ id: 'h2', schedule: { type: 'weekdays', days: ['mon', 'fri'] } });
    const checkins = [
      { habitId: 'h1', date: '2026-11-16' },
      { habitId: 'h2', date: '2026-11-16' }, // mon: 2/2
      { habitId: 'h1', date: '2026-11-18' }, // wed: 1/1
      { habitId: 'h2', date: '2026-11-20' }, // fri: 1/2
    ];
    const breakdown = dailyBreakdown({ habits: [h1, h2], checkins, from, to, today, tz });
    const { bestDays: days, bestDay } = bestDays(breakdown);
    const rate = (day) => days.find((x) => x.day === day).rate;
    expect(rate('mon')).toBe(1);
    expect(rate('tue')).toBe(0);
    expect(rate('wed')).toBe(1);
    expect(rate('fri')).toBe(0.5);
    expect(bestDay).toBe('mon'); // tie with wed: the first weekday wins
    // 9 due days in total (7 daily + 2), 4 done
    expect(completionRate(breakdown)).toBe(0.44);
  });

  test('check-ins on days that were not due are ignored', () => {
    const h = habit({ id: 'h1', schedule: { type: 'weekdays', days: ['mon'] } });
    const breakdown = dailyBreakdown({
      habits: [h], checkins: [{ habitId: 'h1', date: '2026-11-17' }], from, to, today, tz,
    });
    expect(breakdown.get('2026-11-17')).toEqual({ due: 0, done: 0 });
  });

  test('no data gives null rates, never an error', () => {
    const breakdown = dailyBreakdown({ habits: [], checkins: [], from, to, today, tz });
    expect(completionRate(breakdown)).toBeNull();
    const { bestDays: days, bestDay } = bestDays(breakdown);
    expect(days).toHaveLength(7);
    expect(days.every((x) => x.rate === null)).toBe(true);
    expect(bestDay).toBeNull();
  });
});

describe('calendar day status', () => {
  test.each([
    ['2026-11-20', { due: 3, done: 3 }, 'done'],
    ['2026-11-20', { due: 3, done: 1 }, 'partial'],
    ['2026-11-20', { due: 3, done: 0 }, 'missed'],
    ['2026-11-20', { due: 0, done: 0 }, 'none'],
    ['2026-11-23', { due: 3, done: 1 }, 'today'],
    ['2026-11-24', { due: 3, done: 0 }, 'future'],
  ])('%s with %o is %s', (date, entry, expected) => {
    expect(dayStatus(date, entry, today)).toBe(expected);
  });
});
