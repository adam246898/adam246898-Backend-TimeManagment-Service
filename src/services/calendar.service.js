// GET /calendar?month=YYYY-MM: one entry per day of the month.
const habitsClient = require('../clients/habits.client');
const streaksClient = require('../clients/streaks.client');
const { notFound } = require('../utils/errors');
const { todayIn, addDays, monthBounds, minDate } = require('../utils/dates');
const { dailyBreakdown, dayStatus } = require('./stats');

async function getCalendar(ctx, { month, category, habitId }) {
  const tz = ctx.timezone;
  const today = todayIn(tz);
  const { first, last } = monthBounds(month);

  const allHabits = await habitsClient.listHabits(ctx, { includeArchived: true });
  // Ownership: a habitId that is not in THIS user's list is "not found", never "forbidden".
  if (habitId && !allHabits.some((h) => h.id === habitId)) throw notFound('Habit not found.');

  const habits = allHabits.filter(
    (h) => h.status !== 'archived' && (!category || h.category === category) && (!habitId || h.id === habitId),
  );
  const habitIds = new Set(habits.map((h) => h.id));

  // Check-ins and notes only exist up to today. A month fully in the future needs no calls.
  const fetchFrom = addDays(first, -6); // earlier days of the first week, for times_per_week
  const fetchTo = minDate(last, today);
  let checkins = [];
  let notes = [];
  if (habits.length > 0 && fetchFrom <= fetchTo) {
    [checkins, notes] = await Promise.all([
      streaksClient.checkins(ctx, fetchFrom, fetchTo),
      fetchTo >= first ? streaksClient.missedNotes(ctx, first, fetchTo) : [],
    ]);
  }
  checkins = checkins.filter((c) => habitIds.has(c.habitId));
  const noteDates = new Set(notes.filter((n) => habitIds.has(n.habitId)).map((n) => n.date));

  const deadlines = new Map();
  for (const h of habits) {
    const deadline = h.type === 'challenge' && h.challenge ? h.challenge.deadline : null;
    if (!deadline || deadline < first || deadline > last) continue;
    if (!deadlines.has(deadline)) deadlines.set(deadline, []);
    deadlines.get(deadline).push({ habitId: h.id, name: h.name });
  }

  const breakdown = dailyBreakdown({ habits, checkins, from: first, to: last, today, tz });
  const days = [];
  for (const [date, entry] of breakdown) {
    days.push({
      date,
      status: dayStatus(date, entry, today),
      due: entry.due,
      done: entry.done,
      hasMissedNote: noteDates.has(date),
      challengeDeadlines: deadlines.get(date) || [],
    });
  }
  return { month, days };
}

module.exports = { getCalendar };
