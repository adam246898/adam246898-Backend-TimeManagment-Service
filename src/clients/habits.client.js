// service-a: habits-service (Ahmed) internal API, contract section 6. We never read habits_* tables ourselves.
const config = require('../config');
const logger = require('../utils/logger');
const { callService, getList } = require('./http');

const NAME = 'service-a (habits)';
const base = () => config.habitsServiceUrl;

// GET /internal/habits?userId=&ids=&includeArchived=   -> list of Habit (contract 4.3)
async function listHabits(ctx, { ids, includeArchived = false } = {}) {
  const q = new URLSearchParams({ userId: ctx.userId });
  if (ids && ids.length) q.set('ids', ids.join(','));
  if (includeArchived) q.set('includeArchived', 'true');
  return getList(NAME, base(), `/internal/habits?${q}`, { ctx });
}

// GET /internal/habits/due?userId=&date=   -> habits due on that date
async function dueHabits(ctx, date) {
  const q = new URLSearchParams({ userId: ctx.userId, date });
  return getList(NAME, base(), `/internal/habits/due?${q}`, { ctx });
}

// GET /internal/habits/:id/inactive-periods?userId=   -> { data: [{ from, until }] } (until exclusive or null)
// The dates a habit was paused or archived, so past paused days are not counted as missed.
// Optional: if the route is missing or fails, the habit is used without them (logged).
async function inactivePeriods(ctx, habitId) {
  const q = new URLSearchParams({ userId: ctx.userId });
  try {
    const list = await getList(NAME, base(), `/internal/habits/${encodeURIComponent(habitId)}/inactive-periods?${q}`, {
      ctx,
      allow404: true,
    });
    return list
      .filter((p) => p && typeof p.from === 'string')
      .map((p) => ({ from: p.from, to: typeof p.until === 'string' ? p.until : null }));
  } catch (err) {
    logger.warn('inactive_periods_unavailable', { requestId: ctx.requestId, reason: err.code || err.name });
    return [];
  }
}

// Adds pausePeriods to each habit, fetching all habits' periods in parallel.
async function withInactivePeriods(ctx, habits) {
  const periods = await Promise.all(habits.map((h) => inactivePeriods(ctx, h.id)));
  return habits.map((h, i) => ({ ...h, pausePeriods: periods[i] }));
}

// GET /internal/stats?range=   -> platform totals, no user IDs (not for one user, so no X-User-Id)
async function stats(ctx, range) {
  const q = new URLSearchParams({ range });
  return (await callService(NAME, base(), `/internal/stats?${q}`, { ctx: { requestId: ctx.requestId } })) || {};
}

module.exports = { listHabits, dueHabits, inactivePeriods, withInactivePeriods, stats };
