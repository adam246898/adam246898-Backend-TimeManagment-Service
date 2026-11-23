// Works out on which past and future days a habit was due, from the Habit object that
// habits-service returns (contract 4.2 and 4.3). Pure functions: no network, no database.
const { dateInTimeZone, weekdayOf, weekStart, addDays } = require('../utils/dates');

// First day the habit can be due: the challenge start date, or the day it was created.
function habitStartDate(habit, tz) {
  if (habit.type === 'challenge' && habit.challenge && habit.challenge.startDate) {
    return habit.challenge.startDate;
  }
  if (habit.createdAt) return dateInTimeZone(new Date(habit.createdAt), tz);
  return null;
}

// Paused days are not due (the streak is frozen, not broken).
// - habit.pausePeriods ([{ from, to }], `to` exclusive or null): paused and archived dates, from
//   habits-service's GET /internal/habits/:id/inactive-periods (see habits.client.js).
// - status "paused": not due from today until pausedUntil (or forever if pausedUntil is null).
function isPausedOn(habit, date, today) {
  for (const p of habit.pausePeriods || []) {
    if (p && p.from && date >= p.from && (!p.to || date < p.to)) return true;
  }
  if (habit.status === 'paused' && date >= today && (!habit.pausedUntil || date < habit.pausedUntil)) {
    return true;
  }
  return false;
}

// Is the habit due on `date`?
// `doneDates` is the Set of dates this habit was checked in; it is needed for times_per_week,
// which is due every day of the week until that week's count is reached.
function isDueOn(habit, date, { tz, today, doneDates = new Set(), weekStartsOn = 'sunday' }) {
  if (habit.status === 'archived') return false;
  const start = habitStartDate(habit, tz);
  if (start && date < start) return false;
  if (habit.type === 'challenge' && habit.challenge && habit.challenge.deadline && date > habit.challenge.deadline) {
    return false;
  }
  if (isPausedOn(habit, date, today)) return false;

  const schedule = habit.schedule || {};
  switch (schedule.type) {
    case 'daily':
      return true;
    case 'weekdays':
      return Array.isArray(schedule.days) && schedule.days.includes(weekdayOf(date));
    case 'times_per_week': {
      let doneBefore = 0;
      for (let d = weekStart(date, weekStartsOn); d < date; d = addDays(d, 1)) {
        if (doneDates.has(d)) doneBefore += 1;
      }
      return doneBefore < (Number(schedule.count) || 0);
    }
    default:
      return false;
  }
}

module.exports = { habitStartDate, isPausedOn, isDueOn };
