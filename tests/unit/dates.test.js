const d = require('../../src/utils/dates');

describe('date helpers', () => {
  test('addDays and diffDays work across months and leap years', () => {
    expect(d.addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(d.addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(d.diffDays('2026-11-01', '2026-11-21')).toBe(20);
  });

  test('weekdayOf and weekStart (Sunday by default, Monday when the user chose it)', () => {
    expect(d.weekdayOf('2026-11-21')).toBe('sat');
    expect(d.weekdayOf('2026-11-23')).toBe('mon');
    // 2026-11-22 is a Sunday
    expect(d.weekStart('2026-11-22')).toBe('2026-11-22');
    expect(d.weekStart('2026-11-21')).toBe('2026-11-15');
    expect(d.weekStart('2026-11-22', 'monday')).toBe('2026-11-16');
    expect(d.weekStart('2026-11-23', 'monday')).toBe('2026-11-23');
  });

  test('isValidDate rejects impossible dates', () => {
    expect(d.isValidDate('2026-02-29')).toBe(false);
    expect(d.isValidDate('2028-02-29')).toBe(true);
    expect(d.isValidDate('2026-1-01')).toBe(false);
  });

  test('isValidMonth and monthBounds', () => {
    expect(d.isValidMonth('2026-13')).toBe(false);
    expect(d.isValidMonth('2026-00')).toBe(false);
    expect(d.isValidMonth('2026-11')).toBe(true);
    expect(d.monthBounds('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
  });

  test('the date depends on the time zone', () => {
    const instant = new Date('2026-11-21T23:30:00Z');
    expect(d.dateInTimeZone(instant, 'UTC')).toBe('2026-11-21');
    expect(d.dateInTimeZone(instant, 'Africa/Cairo')).toBe('2026-11-22');
    expect(d.isValidTimeZone('Africa/Cairo')).toBe(true);
    expect(d.isValidTimeZone('Mars/Base')).toBe(false);
  });
});
