// Milestone rules (contract 4.10). Pure functions.
const { diffDays } = require('../utils/dates');

const STREAK_MILESTONES = [7, 14, 21, 30, 50, 100];

// Every streak milestone reached by a streak of this length.
const reachedStreakMilestones = (streakDays) => STREAK_MILESTONES.filter((t) => streakDays >= t);

// The next streak milestone above the current streak that the habit has not earned yet.
// Example: current 21, earned {7,14,21} -> { days: 30, daysToGo: 9 }. Past 100: null.
function nextStreakMilestone(currentStreak, earnedDays = new Set()) {
  const days = STREAK_MILESTONES.find((t) => t > currentStreak && !earnedDays.has(t));
  return days === undefined ? null : { days, daysToGo: days - currentStreak };
}

// A challenge milestone's `days` is the challenge length, start and deadline included.
const challengeLength = (startDate, deadline) => diffDays(startDate, deadline) + 1;

module.exports = { STREAK_MILESTONES, reachedStreakMilestones, nextStreakMilestone, challengeLength };
