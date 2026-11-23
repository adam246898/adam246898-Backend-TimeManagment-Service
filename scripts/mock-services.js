// FAKE service-a = habits-service (Ahmed, port 3001) and service-b = streaks-service (Teeba, port 3002) for local testing, until
// Ahmed's and Teeba's real services are ready. They answer the /internal routes from the contract
// with sample data built around today's date.
//   npm run mock                      both fake services
//   MOCK_ONLY=streaks npm run mock    only fake service-b (when Ahmed's real service-a runs on 3001)
//   MOCK_ONLY=habits npm run mock     only fake service-a (when Teeba's real service-b runs on 3002)
const express = require('express');

const ONLY = process.env.MOCK_ONLY;

const TOKEN = process.env.INTERNAL_TOKEN;
if (!TOKEN) {
  console.error('INTERNAL_TOKEN is not set in .env');
  process.exit(1);
}

const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const daysAgoIso = (n) => new Date(Date.now() - n * 86400000).toISOString();

const habits = [
  { id: '11111111-1111-4111-8111-111111111111', type: 'habit', name: 'Read before bed', category: 'study',
    tags: ['reading'], schedule: { type: 'daily' }, reminderTime: '21:30', status: 'active', pausedUntil: null,
    challenge: null, templateId: null, createdAt: daysAgoIso(120), updatedAt: daysAgoIso(120) },
  { id: '22222222-2222-4222-8222-222222222222', type: 'habit', name: 'Gym', category: 'fitness',
    tags: [], schedule: { type: 'weekdays', days: ['mon', 'wed', 'fri'] }, reminderTime: '07:00',
    status: 'active', pausedUntil: null, challenge: null, templateId: null, createdAt: daysAgoIso(100), updatedAt: daysAgoIso(100) },
  { id: '33333333-3333-4333-8333-333333333333', type: 'habit', name: 'Run', category: 'health',
    tags: [], schedule: { type: 'times_per_week', count: 3 }, reminderTime: null, status: 'active',
    pausedUntil: null, challenge: null, templateId: null, createdAt: daysAgoIso(60), updatedAt: daysAgoIso(60) },
  { id: '44444444-4444-4444-8444-444444444444', type: 'challenge', name: '30 days of exercise', category: 'fitness',
    tags: [], schedule: { type: 'daily' }, reminderTime: '18:00', status: 'active', pausedUntil: null,
    challenge: { startDate: day(-10), deadline: day(19), state: 'active' }, templateId: null,
    createdAt: daysAgoIso(11), updatedAt: daysAgoIso(11) },
];

// Deterministic sample check-ins: "Read" done on most days, "Gym" most Mondays/Wednesdays, etc.
const checkins = [];
for (let i = 0; i <= 100; i += 1) {
  const date = day(-i);
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (i % 4 !== 1) checkins.push({ habitId: habits[0].id, date });
  if ([1, 3].includes(wd) || (wd === 5 && i % 3 === 0)) checkins.push({ habitId: habits[1].id, date });
  if (i < 60 && [2, 4, 6].includes(wd)) checkins.push({ habitId: habits[2].id, date });
  if (i <= 10 && i % 5 !== 2) checkins.push({ habitId: habits[3].id, date });
}
checkins.forEach((c, i) => Object.assign(c, { id: `c-${i}`, createdAt: `${c.date}T19:00:00Z` }));

function guard(req, res, next) {
  if (req.get('X-Internal-Token') !== TOKEN) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } });
  }
  return next();
}

const habitsApp = express();
habitsApp.use(guard);
habitsApp.get('/internal/habits', (req, res) => {
  const ids = req.query.ids ? String(req.query.ids).split(',') : null;
  res.json({ data: habits.filter((h) => !ids || ids.includes(h.id)) });
});
habitsApp.get('/internal/habits/due', (req, res) => res.json({ data: habits.slice(0, 2).concat(habits[3]) }));
habitsApp.get('/internal/stats', (req, res) =>
  res.json({ habitsByCategory: [{ category: 'health', count: 31 }, { category: 'fitness', count: 22 }] }));
if (ONLY !== 'streaks') habitsApp.listen(3001, () => console.log('mock service-a (habits, Ahmed) on http://localhost:3001'));

const streaksApp = express();
streaksApp.use(guard);
streaksApp.get('/internal/checkins', (req, res) =>
  res.json({ data: checkins.filter((c) => c.date >= req.query.from && c.date <= req.query.to) }));
streaksApp.get('/internal/streaks', (req, res) =>
  res.json({ data: [
    { habitId: habits[0].id, currentStreak: 2, longestStreak: 3, lastCompletedDate: day(0), atRisk: false },
    { habitId: habits[1].id, currentStreak: 9, longestStreak: 23, lastCompletedDate: day(-1), atRisk: false },
    { habitId: habits[2].id, currentStreak: 8, longestStreak: 8, lastCompletedDate: day(-1), atRisk: true },
  ] }));
streaksApp.get('/internal/challenges', (req, res) =>
  res.json({ data: [{ habitId: habits[3].id, name: habits[3].name, startDate: day(-10), deadline: day(19),
    state: 'active', dueDaysTotal: 30, dueDaysSoFar: 10, completedDays: 9, completionRate: 0.9, daysLeft: 19, result: null }] }));
streaksApp.get('/internal/missed-notes', (req, res) =>
  res.json({ data: [{ habitId: habits[0].id, date: day(-5), note: 'Worked late.' }] }));
streaksApp.get('/internal/stats', (req, res) =>
  res.json({ activeUsers: 42, checkinsPerDay: [{ date: day(-1), count: 118 }], challenges: { active: 12, passed: 5, failed: 3 } }));
if (ONLY !== 'habits') streaksApp.listen(3002, () => console.log('mock service-b (streaks, Teeba) on http://localhost:3002'));
