// Milestone thresholds (report section 18.2).
const {
  STREAK_MILESTONES,
  reachedStreakMilestones,
  nextStreakMilestone,
  challengeLength,
} = require('../../src/services/milestoneRules');

describe('milestone rules', () => {
  test('thresholds are 7, 14, 21, 30, 50, 100', () => {
    expect(STREAK_MILESTONES).toEqual([7, 14, 21, 30, 50, 100]);
  });

  test.each([
    [6, []],
    [7, [7]],
    [13, [7]],
    [21, [7, 14, 21]],
    [100, [7, 14, 21, 30, 50, 100]],
    [250, [7, 14, 21, 30, 50, 100]],
  ])('a %i-day streak reaches %o', (days, expected) => {
    expect(reachedStreakMilestones(days)).toEqual(expected);
  });

  test('next milestone and days to go', () => {
    expect(nextStreakMilestone(0)).toEqual({ days: 7, daysToGo: 7 });
    expect(nextStreakMilestone(21, new Set([7, 14, 21]))).toEqual({ days: 30, daysToGo: 9 });
    // 30 was already earned in an earlier, longer streak: skip to 50
    expect(nextStreakMilestone(21, new Set([7, 14, 21, 30]))).toEqual({ days: 50, daysToGo: 29 });
    expect(nextStreakMilestone(100)).toBeNull();
  });

  test('challenge length counts the start and deadline days', () => {
    expect(challengeLength('2026-11-22', '2026-12-21')).toBe(30);
  });
});
