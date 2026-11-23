// Milestones: checked every time GET /milestones or GET /dashboard is loaded.
// Any newly reached milestone is saved with earnedAt, and is kept even if the streak breaks later.
const db = require('../config/db');
const habitsClient = require('../clients/habits.client');
const streaksClient = require('../clients/streaks.client');
const { notFound } = require('../utils/errors');
const { reachedStreakMilestones, nextStreakMilestone, challengeLength, isDayStreak } = require('./milestoneRules');

// Fetches what milestones need from the other two services, in parallel.
async function fetchData(ctx) {
  const [habits, streaks, challenges] = await Promise.all([
    habitsClient.listHabits(ctx, { includeArchived: true }),
    streaksClient.streaks(ctx),
    streaksClient.challenges(ctx),
  ]);
  return { habits, streaks, challenges };
}

// Saves milestones in one statement. ON CONFLICT DO NOTHING keeps the first earnedAt.
async function saveMilestones(userId, milestones) {
  if (milestones.length === 0) return;
  await db.query(
    `INSERT INTO time_milestones (user_id, habit_id, kind, days)
     SELECT $1::uuid, t.habit_id, t.kind, t.days
     FROM unnest($2::uuid[], $3::text[], $4::int[]) AS t(habit_id, kind, days)
     ON CONFLICT (habit_id, kind, days) DO NOTHING`,
    [userId, milestones.map((m) => m.habitId), milestones.map((m) => m.kind), milestones.map((m) => m.days)],
  );
}

async function listEarned(userId, habitId) {
  const { rows } = await db.query(
    `SELECT habit_id, kind, days, earned_at
     FROM time_milestones
     WHERE user_id = $1 AND ($2::uuid IS NULL OR habit_id = $2::uuid)
     ORDER BY earned_at DESC, days DESC`,
    [userId, habitId || null],
  );
  return rows.map((r) => ({
    habitId: r.habit_id,
    kind: r.kind,
    days: r.days,
    earnedAt: new Date(r.earned_at).toISOString(),
  }));
}

// `data` can be passed in by the dashboard, which already fetched it, to avoid calling twice.
async function evaluate(ctx, { habitId = null, data = null } = {}) {
  const { habits, streaks, challenges } = data || (await fetchData(ctx));
  const habitsById = new Map(habits.map((h) => [h.id, h]));
  if (habitId && !habitsById.has(habitId)) throw notFound('Habit not found.');
  const wanted = (id) => habitsById.has(id) && (!habitId || id === habitId);

  // 1. Work out every milestone reached so far and save the new ones.
  const reached = [];
  for (const s of streaks) {
    if (!wanted(s.habitId) || !isDayStreak(s)) continue;
    const best = Math.max(Number(s.longestStreak) || 0, Number(s.currentStreak) || 0);
    for (const days of reachedStreakMilestones(best)) reached.push({ habitId: s.habitId, kind: 'streak', days });
  }
  for (const c of challenges) {
    if (!wanted(c.habitId) || c.result !== 'passed' || !c.startDate || !c.deadline) continue;
    reached.push({ habitId: c.habitId, kind: 'challenge_passed', days: challengeLength(c.startDate, c.deadline) });
  }
  await saveMilestones(ctx.userId, reached);

  // 2. Read back what is earned (only for habits that still exist).
  const earned = (await listEarned(ctx.userId, habitId)).filter((m) => habitsById.has(m.habitId));

  // 3. The next streak milestone for each normal habit that is not archived, closest first.
  const earnedByHabit = new Map();
  for (const m of earned) {
    if (m.kind !== 'streak') continue;
    if (!earnedByHabit.has(m.habitId)) earnedByHabit.set(m.habitId, new Set());
    earnedByHabit.get(m.habitId).add(m.days);
  }
  const next = [];
  for (const s of streaks) {
    const habit = habitsById.get(s.habitId);
    if (!wanted(s.habitId) || !isDayStreak(s) || habit.type === 'challenge' || habit.status === 'archived') continue;
    const n = nextStreakMilestone(Number(s.currentStreak) || 0, earnedByHabit.get(s.habitId));
    if (n) next.push({ habitId: s.habitId, name: habit.name, days: n.days, daysToGo: n.daysToGo });
  }
  next.sort((a, b) => a.daysToGo - b.daysToGo || a.name.localeCompare(b.name));

  return { earned, next };
}

module.exports = { evaluate, fetchData };
