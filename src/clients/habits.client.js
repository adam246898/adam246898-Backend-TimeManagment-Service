// habits-service (Ahmed) internal API, contract section 6. We never read habits_* tables ourselves.
const config = require('../config');
const { callService, getList } = require('./http');

const NAME = 'habits-service';
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

// GET /internal/stats?range=   -> platform totals, no user IDs (not for one user, so no X-User-Id)
async function stats(ctx, range) {
  const q = new URLSearchParams({ range });
  return (await callService(NAME, base(), `/internal/stats?${q}`, { ctx: { requestId: ctx.requestId } })) || {};
}

module.exports = { listHabits, dueHabits, stats };
