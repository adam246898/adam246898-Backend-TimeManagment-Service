# time-service (Adam)

Part of **Habit Tracker with Streaks** (Group 03). Port **3003**, internal only: the browser reaches it
through the gateway (`/api/...`), and the gateway removes the `/api` prefix.

| Route (as the gateway sees it) | Who | What |
|---|---|---|
| `GET /api/dashboard?range=30d\|90d` | User | Today, completion rate, best days, best streak, active challenges, next milestone |
| `GET /api/calendar?month=YYYY-MM[&category=][&habitId=]` | User | One entry per day: `done` / `partial` / `missed` / `none` / `today` / `future` |
| `GET /api/milestones[?habitId=]` | User | Earned and next milestones (7, 14, 21, 30, 50, 100 days; `challenge_passed`) |
| `GET /api/integrations/google` | User | Connection status |
| `POST /api/integrations/google/connect` | User | Google sign-in URL with a one-time `state` |
| `GET /api/integrations/google/callback` | Public | Checks `state`, stores the KMS-encrypted refresh token, redirects to the frontend |
| `POST /api/integrations/google/sync` | User | Re-creates all reminders and deadline events |
| `DELETE /api/integrations/google` | User | Removes the events, revokes and deletes the token |
| `GET /api/admin/analytics?range=` | Admin | Platform totals only |
| `POST /internal/reminders` | habits-service | `{ userId, habitId, action }` → `202` |

## Layout

```
src/
  server.js        loads secrets, starts listening
  app.js           Helmet, request ID + JSON logs, internal token, JSON rules, routes, errors
  config/          settings, database pool, AWS settings, Secrets Manager, CloudWatch logs
  middleware/      internal token, user headers + roles, 415/413 rules, error format
  routes/          URL -> controller
  controllers/     input checks and status codes
  services/        business logic and SQL (stats.js, schedule.js, milestoneRules.js are pure maths)
  clients/         habits-service, streaks-service, Google, KMS
db/time_tables.sql the four time_* tables
scripts/           setup-aws.sh (Floci), db-init.js, mock-services.js (fake teammates)
tests/             unit/ (maths), api/ (HTTP with Supertest), load/ (k6)
```

## 1. Run the tests (needs only Node.js)

```bash
npm install
npm test
```

## 2. Run it on your PC with fake teammate services

You need a Postgres database for milestones and Google (the calendar works without one).
The easiest way is Docker Desktop:

```bash
docker run -d --name time-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=habits -p 5432:5432 postgres:16-alpine
cp .env.example .env          # then set INTERNAL_TOKEN to any long random value
npm run db:init               # creates the time_* tables
npm run mock                  # window 1: fake habits-service (3001) and streaks-service (3002)
npm run dev                   # window 2: time-service on 3003
```

Try it (window 3, Git Bash). Use the same token as in your `.env`:

```bash
T=your-internal-token
curl -s -H "X-Internal-Token: $T" -H "X-User-Id: aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" \
  -H "X-User-Role: user" -H "X-User-Timezone: Africa/Cairo" "http://localhost:3003/dashboard?range=30d"
```

## 3. AWS resources in Floci (KMS, Secrets Manager, CloudWatch)

With Floci running and the `floci` AWS CLI profile set up:

```bash
export INTERNAL_TOKEN=...  GOOGLE_CLIENT_ID=...  GOOGLE_CLIENT_SECRET=...   # optional, stored in Secrets Manager
bash scripts/setup-aws.sh     # safe to run twice; prints the lines to add to .env
```

It creates the KMS key `alias/time-service-google-tokens`, the secret `time-service/secrets`, the log group
`/habit-tracker/time-service`, a metric filter on 401/403/429 and an alarm (more than 10 in 5 minutes).

## Assumptions to agree with the team

- **habits-service** `GET /internal/habits` returns Habit objects with `schedule`, `status`, `pausedUntil`,
  `challenge` and `createdAt`. Past paused days are only known if it also sends
  `pausePeriods: [{ "from", "to" }]` (optional, not in the contract yet); otherwise only the current pause is excluded.
- **streaks-service** should add `GET /internal/missed-notes?userId=&from=&to=` for the calendar's `hasMissedNote`.
  Until then a 404 is treated as "no notes".
- **streaks-service** `GET /internal/stats` returns `activeUsers`, `checkinsPerDay` and `challenges`;
  **habits-service** `GET /internal/stats` returns `habitsByCategory`.
- Weeks start on Monday for `times_per_week`. Dashboard rates use the last 30 or 90 full days, ending yesterday.
- The gateway sends `X-Internal-Token` on every request it forwards, including the public Google callback.
- A fourth table, `time_oauth_states`, stores the one-time OAuth states (hashed).
