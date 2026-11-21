// habits-service (Ahmed) internal API. We never read habits_* tables ourselves.
const config = require('../config');
const { callService, asList } = require('./http');

const call = (path, options) => callService('habits-service', config.habitsServiceUrl, path, options);

// GET /internal/habits?userId=&ids=&includeArchived=   -> list of Habit (contract 4.3)
async function listHabits(ctx, { ids, includeArchived = false } = {}) {
  const q = new URLSearchParams({ userId: ctx.userId });
  if (ids && ids.length) q.set('ids', ids.join(','));
  if (includeArchived) q.set('includeArchived', 'true');
  return asList(await call(`/internal/habits?${q}`, { ctx }));
}

// GET /internal/habits/due?userId=&date=   -> habits due on that date
async function dueHabits(ctx, date) {
  const q = new URLSearchParams({ userId: ctx.userId, date });
  return asList(await call(`/internal/habits/due?${q}`, { ctx }));
}

// GET /internal/stats?range=   -> platform totals, no user IDs
async function stats(ctx, range) {
  const q = new URLSearchParams({ range });
  return (await call(`/internal/stats?${q}`, { ctx: { requestId: ctx.requestId } })) || {};
}

module.exports = { listHabits, dueHabits, stats };
