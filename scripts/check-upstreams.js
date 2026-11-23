// Checks that habits-service and streaks-service answer the /internal routes that time-service
// needs, in the shape time-service expects (contract sections 4 and 6). Use it when the team
// connects the three backends:
//
//   npm run check:upstreams                         (reads INTERNAL_TOKEN and the URLs from .env)
//   CHECK_USER_ID=<a real user's UUID> npm run check:upstreams
//
// Tip: create one habit, one challenge and one check-in for CHECK_USER_ID first, so the field
// checks have data to look at. Exit code 1 if any check FAILS.

const TOKEN = process.env.INTERNAL_TOKEN;
const HABITS = process.env.HABITS_SERVICE_URL || 'http://localhost:3001';
const STREAKS = process.env.STREAKS_SERVICE_URL || 'http://localhost:3002';
const USER = process.env.CHECK_USER_ID || 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TIMEOUT_MS = 3000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

let failures = 0;
const out = (tag, msg) => console.log(`${tag}  ${msg}`);
const pass = (msg) => out('PASS', msg);
const warn = (msg) => out('WARN', msg);
const fail = (msg) => { failures += 1; out('FAIL', msg); };

async function call(base, path, { token = TOKEN } = {}) {
  const headers = { Accept: 'application/json', 'X-User-Id': USER, 'X-Request-Id': 'check-upstreams',
    'X-User-Timezone': process.env.CHECK_TIMEZONE || 'Africa/Cairo', 'X-User-Week-Starts-On': 'sunday' };
  if (token) headers['X-Internal-Token'] = token;
  const started = Date.now();
  try {
    const res = await fetch(base + path, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body, ms: Date.now() - started };
  } catch (err) {
    return { status: 0, body: null, ms: Date.now() - started, error: err.name === 'TimeoutError' ? 'no answer within 3 s' : 'not reachable' };
  }
}

const listOf = (body) => (Array.isArray(body) ? body : body && Array.isArray(body.data) ? body.data : null);

// Calls a route, checks it answers 200 in time with a list, then checks every item with `checkItem`
// (which returns a list of problems).
async function checkList(label, base, path, checkItem, { optional = false, emptyOk = false } = {}) {
  const r = await call(base, path);
  if (r.status === 0) return fail(`${label}: ${r.error} (${base})`);
  if (optional && r.status === 404) return warn(`${label}: route not there yet (404). Optional for time-service.`);
  if (r.status !== 200) return fail(`${label}: expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
  const items = listOf(r.body);
  if (!items) return fail(`${label}: answer must be a list or { "data": [...] }, got ${JSON.stringify(r.body).slice(0, 120)}`);
  if (r.body.total !== undefined && items.length < r.body.total) {
    warn(`${label}: paged answer (${items.length} of ${r.body.total}); time-service fetches the other pages itself`);
  }
  if (items.length === 0 && emptyOk) return pass(`${label}: 200, empty list (${r.ms} ms)`);
  if (items.length === 0) return warn(`${label}: 200 but the list is empty, so fields could not be checked. Add data for user ${USER}.`);
  const problems = [...new Set(items.flatMap(checkItem))];
  if (problems.length) return fail(`${label}: ${problems.join('; ')}`);
  return pass(`${label}: ${items.length} item(s), all fields OK (${r.ms} ms)`);
}

const habitProblems = (h) => {
  const p = [];
  if (!UUID.test(h.id || '')) p.push('id must be a UUID');
  if (typeof h.name !== 'string') p.push('name must be a string');
  if (!['habit', 'challenge'].includes(h.type)) p.push('type must be habit or challenge');
  if (!['daily', 'weekdays', 'times_per_week'].includes(h.schedule && h.schedule.type)) p.push('schedule.type is missing or wrong');
  if (h.schedule && h.schedule.type === 'weekdays' && !Array.isArray(h.schedule.days)) p.push('schedule.days must be a list like ["mon","wed"]');
  if (h.schedule && h.schedule.type === 'times_per_week' && !Number.isInteger(h.schedule.count)) p.push('schedule.count must be an integer');
  if (!['active', 'paused', 'archived'].includes(h.status)) p.push('status must be active, paused or archived');
  if (Number.isNaN(Date.parse(h.createdAt))) p.push('createdAt must be an ISO timestamp');
  if (!('category' in h)) p.push('category is missing');
  if (h.type === 'challenge' && !(h.challenge && DATE.test(h.challenge.startDate) && DATE.test(h.challenge.deadline))) {
    p.push('challenge.startDate and challenge.deadline must be YYYY-MM-DD');
  }
  return p;
};

async function checkNeedsToken(label, base, path) {
  const r = await call(base, path, { token: null });
  if (r.status === 0) return fail(`${label}: ${r.error}`);
  if (r.status === 401) return pass(`${label}: without X-Internal-Token -> 401`);
  return fail(`${label}: without X-Internal-Token expected 401, got ${r.status}`);
}

async function main() {
  if (!TOKEN) {
    console.error('INTERNAL_TOKEN is not set (put it in .env).');
    process.exit(1);
  }
  console.log(`service-a (habits, Ahmed):  ${HABITS}\nservice-b (streaks, Teeba): ${STREAKS}\ntest user:                  ${USER}\n`);
  const u = `userId=${USER}`;

  console.log('--- service-a: habits-service (Ahmed)');
  await checkNeedsToken('GET /internal/habits', HABITS, `/internal/habits?${u}`);
  await checkList('GET /internal/habits', HABITS, `/internal/habits?${u}`, habitProblems);
  await checkList('GET /internal/habits?includeArchived=true', HABITS, `/internal/habits?${u}&includeArchived=true`, habitProblems);
  await checkList(`GET /internal/habits/due?date=${today}`, HABITS, `/internal/habits/due?${u}&date=${today}`, habitProblems);
  {
    const first = listOf((await call(HABITS, `/internal/habits?${u}`)).body) || [];
    if (first[0] && first[0].id) {
      await checkList('GET /internal/habits/:id/inactive-periods', HABITS, `/internal/habits/${first[0].id}/inactive-periods?${u}`,
        (p) => [DATE.test(p.from || '') ? null : 'from must be YYYY-MM-DD',
          p.until === null || DATE.test(p.until || '') ? null : 'until must be YYYY-MM-DD or null'].filter(Boolean),
        { optional: true, emptyOk: true });
    }
  }
  {
    const r = await call(HABITS, '/internal/stats?range=30d');
    if (r.status !== 200) fail(`GET /internal/stats: expected 200, got ${r.status || r.error}`);
    else if (!Array.isArray(r.body && (r.body.habitsByCategory || r.body.data))) fail('GET /internal/stats: needs habitsByCategory: [{ category, count }]');
    else if (JSON.stringify(r.body).includes(USER)) fail('GET /internal/stats: contains a user ID (must be totals only)');
    else pass('GET /internal/stats: habitsByCategory present, no user IDs');
  }

  console.log('\n--- service-b: streaks-service (Teeba)');
  const range = `${u}&from=${daysAgo(96)}&to=${today}`;
  await checkNeedsToken('GET /internal/checkins', STREAKS, `/internal/checkins?${range}`);
  await checkList('GET /internal/checkins (97 days)', STREAKS, `/internal/checkins?${range}`, (c) =>
    [UUID.test(c.habitId || '') ? null : 'habitId must be a UUID', DATE.test(c.date || '') ? null : 'date must be YYYY-MM-DD'].filter(Boolean));
  await checkList('GET /internal/streaks', STREAKS, `/internal/streaks?${u}`, (s) =>
    [UUID.test(s.habitId || '') ? null : 'habitId must be a UUID',
      Number.isInteger(s.currentStreak) ? null : 'currentStreak must be an integer',
      Number.isInteger(s.longestStreak) ? null : 'longestStreak must be an integer'].filter(Boolean));
  await checkList('GET /internal/challenges', STREAKS, `/internal/challenges?${u}`, (c) =>
    [UUID.test(c.habitId || '') ? null : 'habitId must be a UUID',
      ['upcoming', 'active', 'ended'].includes(c.state) ? null : 'state must be upcoming, active or ended',
      DATE.test(c.startDate || '') && DATE.test(c.deadline || '') ? null : 'startDate and deadline must be YYYY-MM-DD',
      typeof c.completionRate === 'number' ? null : 'completionRate must be a number',
      Number.isInteger(c.daysLeft) ? null : 'daysLeft must be an integer',
      [null, 'passed', 'failed'].includes(c.result) ? null : 'result must be null, passed or failed'].filter(Boolean));
  await checkList('GET /internal/missed-notes', STREAKS, `/internal/missed-notes?${range}`, (n) =>
    [UUID.test(n.habitId || '') ? null : 'habitId must be a UUID', DATE.test(n.date || '') ? null : 'date must be YYYY-MM-DD'].filter(Boolean),
  { optional: true });
  {
    const r = await call(STREAKS, '/internal/stats?range=30d');
    const b = r.body || {};
    if (r.status !== 200) fail(`GET /internal/stats: expected 200, got ${r.status || r.error}`);
    else if (!Array.isArray(b.checkinsPerDay) || !b.challenges) fail('GET /internal/stats: needs checkinsPerDay: [{ date, count }] and challenges: { active, passed, failed }');
    else if (JSON.stringify(b).includes(USER)) fail('GET /internal/stats: contains a user ID (must be totals only)');
    else pass(`GET /internal/stats: checkinsPerDay and challenges present${b.activeUsers === undefined ? ' (no activeUsers: agree who sends it)' : ''}`);
  }

  console.log(`\n${failures === 0 ? 'All required checks passed.' : `${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
