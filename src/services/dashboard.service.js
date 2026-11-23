// GET /dashboard: everything is computed from data owned by the other two services.
const habitsClient = require('../clients/habits.client');
const streaksClient = require('../clients/streaks.client');
const milestonesService = require('./milestones.service');
const { todayIn, addDays } = require('../utils/dates');
const { dailyBreakdown, completionRate, bestDays } = require('./stats');

const RANGE_DAYS = { '30d': 30, '90d': 90 };

async function getDashboard(ctx, range) {
  const tz = ctx.timezone;
  const today = todayIn(tz);
  // The range is the last N full days, ending yesterday (today is not over yet, so it is shown
  // separately under "today").
  const to = addDays(today, -1);
  const from = addDays(today, -RANGE_DAYS[range]);

  // One round of calls, all in parallel. If any service fails or is too slow: 503.
  // Check-ins start 6 days earlier so times_per_week habits know their weekly count on day one.
  const [habits, dueToday, checkins, streaks, challenges] = await Promise.all([
    habitsClient.listHabits(ctx, { includeArchived: true }),
    habitsClient.dueHabits(ctx, today),
    streaksClient.checkins(ctx, addDays(from, -6), today),
    streaksClient.streaks(ctx),
    streaksClient.challenges(ctx),
  ]);
  const visible = habits.filter((h) => h.status !== 'archived');
  const habitsById = new Map(habits.map((h) => [h.id, h]));

  const breakdown = dailyBreakdown({
    habits: await habitsClient.withInactivePeriods(ctx, visible),
    checkins, from, to, today, tz, weekStartsOn: ctx.weekStartsOn,
  });
  const { bestDays: days, bestDay } = bestDays(breakdown);

  const doneToday = new Set(checkins.filter((c) => c.date === today).map((c) => c.habitId));

  let bestCurrentStreak = null;
  for (const s of streaks) {
    const habit = habitsById.get(s.habitId);
    const current = Number(s.currentStreak) || 0;
    if (!habit || habit.status === 'archived' || current <= 0) continue;
    if (!bestCurrentStreak || current > bestCurrentStreak.days) {
      bestCurrentStreak = { habitId: s.habitId, name: habit.name, days: current };
    }
  }

  const activeChallenges = challenges
    .filter((c) => c.state === 'active' && habitsById.has(c.habitId))
    .map((c) => ({
      habitId: c.habitId,
      name: c.name || habitsById.get(c.habitId).name,
      deadline: c.deadline,
      daysLeft: c.daysLeft,
      completionRate: c.completionRate,
    }))
    .sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0));

  const milestones = await milestonesService.evaluate(ctx, { data: { habits, streaks, challenges } });

  return {
    range,
    today: {
      date: today,
      due: dueToday.length,
      done: dueToday.filter((h) => doneToday.has(h.id)).length,
    },
    completionRate: completionRate(breakdown),
    bestDays: days,
    bestDay,
    bestCurrentStreak,
    activeChallenges,
    nextMilestone: milestones.next[0] || null,
  };
}

module.exports = { getDashboard, RANGES: Object.keys(RANGE_DAYS) };
