const { eventsForHabit, reminderEvent } = require('../../src/services/googleEvents');
const { habit } = require('../helpers');

const today = '2026-11-21'; // a Saturday

describe('Google Calendar events', () => {
  test('weekday reminder starts on the next chosen day and repeats weekly', () => {
    const e = reminderEvent(
      habit({ name: 'Gym', reminderTime: '07:00', schedule: { type: 'weekdays', days: ['mon', 'wed'] } }),
      'Africa/Cairo',
      today,
    );
    expect(e.start).toEqual({ dateTime: '2026-11-23T07:00:00', timeZone: 'Africa/Cairo' });
    expect(e.end.dateTime).toBe('2026-11-23T07:15:00');
    expect(e.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE']);
  });

  test('a reminder late at night ends the next day', () => {
    const e = reminderEvent(habit({ name: 'Read', reminderTime: '23:50' }), 'UTC', today);
    expect(e.end.dateTime).toBe('2026-11-22T00:05:00');
  });

  test('a challenge gets a reminder until the deadline and an all-day deadline event', () => {
    const c = habit({
      name: '30 days', type: 'challenge', reminderTime: '18:00',
      challenge: { startDate: '2026-11-22', deadline: '2026-12-21', state: 'upcoming' },
    });
    const events = eventsForHabit(c, 'UTC', today);
    expect(events.map((e) => e.kind)).toEqual(['reminder', 'deadline']);
    expect(events[0].event.start.dateTime).toBe('2026-11-22T18:00:00');
    expect(events[0].event.recurrence[0]).toBe('RRULE:FREQ=DAILY;UNTIL=20261221T235959Z');
    expect(events[1].event.start).toEqual({ date: '2026-12-21' });
    expect(events[1].event.end).toEqual({ date: '2026-12-22' });
  });

  test('paused, archived and ended habits have no events; no reminder time means no reminder', () => {
    expect(eventsForHabit(habit({ status: 'paused', reminderTime: '07:00' }), 'UTC', today)).toEqual([]);
    expect(eventsForHabit(habit({ status: 'archived', reminderTime: '07:00' }), 'UTC', today)).toEqual([]);
    const ended = habit({ type: 'challenge', challenge: { startDate: '2026-10-01', deadline: '2026-10-30', state: 'ended' } });
    expect(eventsForHabit(ended, 'UTC', today)).toEqual([]);
    expect(eventsForHabit(habit({ reminderTime: null }), 'UTC', today)).toEqual([]);
  });
});
