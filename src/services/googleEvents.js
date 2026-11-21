// Builds the Google Calendar events for one habit. Pure functions.
const { addDays, weekdayOf } = require('../utils/dates');

const BYDAY = { mon: 'MO', tue: 'TU', wed: 'WE', thu: 'TH', fri: 'FR', sat: 'SA', sun: 'SU' };
const REMINDER_MINUTES = 15;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// A repeating 15-minute event at the habit's reminder time, in the user's time zone.
function reminderEvent(habit, tz, today) {
  if (!habit.reminderTime || !TIME_RE.test(habit.reminderTime)) return null;
  const schedule = habit.schedule || {};
  const deadline = habit.type === 'challenge' && habit.challenge ? habit.challenge.deadline : null;

  let start = today;
  if (habit.type === 'challenge' && habit.challenge && habit.challenge.startDate > start) {
    start = habit.challenge.startDate;
  }

  let rule;
  if (schedule.type === 'weekdays' && Array.isArray(schedule.days) && schedule.days.length > 0) {
    // The first event must fall on one of the chosen weekdays.
    for (let i = 0; i < 7 && !schedule.days.includes(weekdayOf(start)); i += 1) start = addDays(start, 1);
    rule = `RRULE:FREQ=WEEKLY;BYDAY=${schedule.days.map((d) => BYDAY[d]).filter(Boolean).join(',')}`;
  } else {
    // daily, and times_per_week (due every day until the weekly count is reached)
    rule = 'RRULE:FREQ=DAILY';
  }
  if (deadline) {
    if (start > deadline) return null;
    rule += `;UNTIL=${deadline.replace(/-/g, '')}T235959Z`;
  }

  const [h, m] = habit.reminderTime.split(':').map(Number);
  const endMinutes = h * 60 + m + REMINDER_MINUTES;
  const endDate = endMinutes >= 24 * 60 ? addDays(start, 1) : start;
  const endTime = `${String(Math.floor(endMinutes / 60) % 24).padStart(2, '0')}:${String(endMinutes % 60).padStart(2, '0')}`;

  return {
    summary: habit.name,
    description: 'Habit reminder from Habit Tracker.',
    start: { dateTime: `${start}T${habit.reminderTime}:00`, timeZone: tz },
    end: { dateTime: `${endDate}T${endTime}:00`, timeZone: tz },
    recurrence: [rule],
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] },
  };
}

// An all-day event on a challenge's deadline.
function deadlineEvent(habit) {
  const deadline = habit.type === 'challenge' && habit.challenge ? habit.challenge.deadline : null;
  if (!deadline) return null;
  return {
    summary: `Challenge deadline: ${habit.name}`,
    description: 'Challenge deadline from Habit Tracker.',
    start: { date: deadline },
    end: { date: addDays(deadline, 1) },
    transparency: 'transparent',
  };
}

// The events a habit should have right now: [{ kind: 'reminder' | 'deadline', event }].
// Paused, archived and ended habits have none.
function eventsForHabit(habit, tz, today) {
  if (!habit || habit.status !== 'active') return [];
  if (habit.type === 'challenge') {
    const c = habit.challenge || {};
    if (c.state === 'ended' || (c.deadline && c.deadline < today)) return [];
  }
  return [
    { kind: 'reminder', event: reminderEvent(habit, tz, today) },
    { kind: 'deadline', event: deadlineEvent(habit) },
  ].filter((e) => e.event);
}

module.exports = { reminderEvent, deadlineEvent, eventsForHabit };
