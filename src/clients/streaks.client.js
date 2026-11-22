// service-b: streaks-service (Teeba) internal API, contract section 6. We never read streaks_* tables ourselves.
const config = require('../config');
const logger = require('../utils/logger');
const { callService, getList } = require('./http');

const NAME = 'service-b (streaks)';
const base = () => config.streaksServiceUrl;

// GET /internal/checkins?userId=&from=&to=   -> list of Check-in (contract 4.6)
async function checkins(ctx, from, to) {
  const q = new URLSearchParams({ userId: ctx.userId, from, to });
  return getList(NAME, base(), `/internal/checkins?${q}`, { ctx });
}

// GET /internal/streaks?userId=   -> list of Streak (contract 4.7)
async function streaks(ctx) {
  const q = new URLSearchParams({ userId: ctx.userId });
  return getList(NAME, base(), `/internal/streaks?${q}`, { ctx });
}

// GET /internal/challenges?userId=   -> list of ChallengeProgress (contract 4.8)
async function challenges(ctx) {
  const q = new URLSearchParams({ userId: ctx.userId });
  return getList(NAME, base(), `/internal/challenges?${q}`, { ctx });
}

// GET /internal/missed-notes?userId=&from=&to=   -> list of { habitId, date, ... }
// PROPOSED, NOT YET IN THE CONTRACT: only used for the calendar's "hasMissedNote".
// It is optional: if the route is missing or fails, the calendar still works and shows no notes.
async function missedNotes(ctx, from, to) {
  const q = new URLSearchParams({ userId: ctx.userId, from, to });
  try {
    return await getList(NAME, base(), `/internal/missed-notes?${q}`, { ctx, allow404: true });
  } catch (err) {
    logger.warn('missed_notes_unavailable', { requestId: ctx.requestId, reason: err.code || err.name });
    return [];
  }
}

// GET /internal/stats?range=   -> platform totals, no user IDs (not for one user, so no X-User-Id)
async function stats(ctx, range) {
  const q = new URLSearchParams({ range });
  return (await callService(NAME, base(), `/internal/stats?${q}`, { ctx: { requestId: ctx.requestId } })) || {};
}

module.exports = { checkins, streaks, challenges, missedNotes, stats };
