// streaks-service (Teeba) internal API. We never read streaks_* tables ourselves.
const config = require('../config');
const { callService, asList } = require('./http');

const call = (path, options) => callService('streaks-service', config.streaksServiceUrl, path, options);

// GET /internal/checkins?userId=&from=&to=   -> list of Check-in (contract 4.6)
async function checkins(ctx, from, to) {
  const q = new URLSearchParams({ userId: ctx.userId, from, to });
  return asList(await call(`/internal/checkins?${q}`, { ctx }));
}

// GET /internal/streaks?userId=   -> list of Streak (contract 4.7)
async function streaks(ctx) {
  const q = new URLSearchParams({ userId: ctx.userId });
  return asList(await call(`/internal/streaks?${q}`, { ctx }));
}

// GET /internal/challenges?userId=   -> list of ChallengeProgress (contract 4.8)
async function challenges(ctx) {
  const q = new URLSearchParams({ userId: ctx.userId });
  return asList(await call(`/internal/challenges?${q}`, { ctx }));
}

// GET /internal/missed-notes?userId=&from=&to=   -> list of { habitId, date, ... }
// NOT YET IN THE CONTRACT: needed for the calendar's "hasMissedNote". Until streaks-service adds it,
// a 404 simply means "no notes".
async function missedNotes(ctx, from, to) {
  const q = new URLSearchParams({ userId: ctx.userId, from, to });
  return asList(await call(`/internal/missed-notes?${q}`, { ctx, allow404: true }));
}

// GET /internal/stats?range=   -> platform totals, no user IDs
async function stats(ctx, range) {
  const q = new URLSearchParams({ range });
  return (await call(`/internal/stats?${q}`, { ctx: { requestId: ctx.requestId } })) || {};
}

module.exports = { checkins, streaks, challenges, missedNotes, stats };
