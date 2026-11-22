// GET /admin/analytics: platform totals for admins.
// Privacy: we copy ONLY the expected total fields from the other services' answers (an allow-list),
// so even if they sent extra fields, no user ID or habit name could reach the admin.
const habitsClient = require('../clients/habits.client');
const streaksClient = require('../clients/streaks.client');

const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
const list = (v) => (Array.isArray(v) ? v : []);

async function getAnalytics(ctx, range) {
  const [habitStats, streakStats] = await Promise.all([
    habitsClient.stats(ctx, range),
    streaksClient.stats(ctx, range),
  ]);
  const challenges = streakStats.challenges || {};
  // The contract does not say which service counts active users: take it from whichever sends it.
  const activeUsers = streakStats.activeUsers !== undefined ? streakStats.activeUsers : habitStats.activeUsers;
  return {
    range,
    activeUsers: count(activeUsers),
    habitsByCategory: list(habitStats.habitsByCategory || habitStats.data)
      .filter((r) => r && typeof r.category === 'string')
      .map((r) => ({ category: r.category, count: count(r.count) })),
    checkinsPerDay: list(streakStats.checkinsPerDay || streakStats.data)
      .filter((r) => r && typeof r.date === 'string')
      .map((r) => ({ date: r.date, count: count(r.count) })),
    challenges: {
      active: count(challenges.active),
      passed: count(challenges.passed),
      failed: count(challenges.failed),
    },
  };
}

module.exports = { getAnalytics };
