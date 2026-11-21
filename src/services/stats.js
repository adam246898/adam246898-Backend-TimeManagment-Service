// The calculations behind the dashboard and the calendar. Pure functions: easy to unit-test.
const { eachDay, weekdayOf, WEEKDAYS } = require('../utils/dates');
const { isDueOn } = require('./schedule');

const round2 = (x) => Math.round(x * 100) / 100;

// Groups check-ins as habitId -> Set of dates.
function doneDatesByHabit(checkins) {
  const map = new Map();
  for (const c of checkins) {
    if (!c || !c.habitId || !c.date) continue;
    if (!map.has(c.habitId)) map.set(c.habitId, new Set());
    map.get(c.habitId).add(c.date);
  }
  return map;
}

// For every day from `from` to `to`: how many habits were due and how many of those were done.
// Returns a Map: date -> { due, done }.
function dailyBreakdown({ habits, checkins, from, to, today, tz }) {
  const days = new Map(eachDay(from, to).map((d) => [d, { due: 0, done: 0 }]));
  const doneMap = doneDatesByHabit(checkins);
  for (const habit of habits) {
    const doneDates = doneMap.get(habit.id) || new Set();
    for (const [date, entry] of days) {
      if (!isDueOn(habit, date, { tz, today, doneDates })) continue;
      entry.due += 1;
      if (doneDates.has(date)) entry.done += 1;
    }
  }
  return days;
}

// Completion rate = completed due days / all due days. null when nothing was due.
function completionRate(breakdown) {
  let due = 0;
  let done = 0;
  for (const entry of breakdown.values()) {
    due += entry.due;
    done += entry.done;
  }
  return due === 0 ? null : round2(done / due);
}

// Best days: for each weekday, completed due days / all due days on that weekday.
// bestDay is the weekday with the highest rate (first one wins a tie), or null.
function bestDays(breakdown) {
  const totals = Object.fromEntries(WEEKDAYS.map((d) => [d, { due: 0, done: 0 }]));
  for (const [date, entry] of breakdown) {
    const t = totals[weekdayOf(date)];
    t.due += entry.due;
    t.done += entry.done;
  }
  const days = WEEKDAYS.map((day) => ({
    day,
    rate: totals[day].due === 0 ? null : round2(totals[day].done / totals[day].due),
  }));
  let best = null;
  for (const d of days) {
    if (d.rate !== null && (best === null || d.rate > best.rate)) best = d;
  }
  return { bestDays: days, bestDay: best ? best.day : null };
}

// Calendar status of one day (contract 5.4, function 2).
function dayStatus(date, { due, done }, today) {
  if (date > today) return 'future';
  if (date === today) return 'today';
  if (due === 0) return 'none';
  if (done >= due) return 'done';
  if (done > 0) return 'partial';
  return 'missed';
}

module.exports = { round2, doneDatesByHabit, dailyBreakdown, completionRate, bestDays, dayStatus };
