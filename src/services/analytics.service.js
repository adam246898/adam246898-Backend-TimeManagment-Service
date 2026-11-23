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
  // Each total comes from the service that owns the data, with the other as a fallback:
  // active users and passed/failed challenges from streaks-service (check-ins, results),
  // active challenges from habits-service (challenge dates).
  const pick = (first, second) => (first !== undefined ? first : second);
  const streakChallenges = streakStats.challenges || {};
  const habitChallenges = habitStats.challenges || {};
  const activeUsers = pick(streakStats.activeUsers, habitStats.activeUsers);
  const challenges = {
    active: pick(habitChallenges.active, streakChallenges.active),
    passed: pick(streakChallenges.passed, habitChallenges.passed),
    failed: pick(streakChallenges.failed, habitChallenges.failed),
  };
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
