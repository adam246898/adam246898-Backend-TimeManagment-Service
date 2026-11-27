# service-c (time-service): summary

Owner: Adam. Repo: https://github.com/adam246898/adam246898-Backend-TimeManagment-Service
Node.js 22 + Express, layered **routes → controllers → services** (plus `clients/` for calls to other services,
Google and AWS). Port 3003, reachable only inside the Docker network; the browser reaches it through the gateway.

## 1. Functions

| # | Function | What it does |
|---|---|---|
| 1 | **Dashboard** | Today's due/done count, completion rate over the last 30 or 90 days, **best days** (rate per weekday), best current streak, active challenges sorted by nearest deadline, next milestone. Rates are `null` when there is no data yet. |
| 2 | **Monthly calendar** | One entry per day: `done`, `partial`, `missed`, `none` (nothing due), `today`, `future`, with due/done counts, whether a missed-day note exists, and challenge deadlines. Filters by category or one habit. Paused days count as `none`, not missed. |
| 3 | **Milestones** | Streak milestones at 7, 14, 21, 30, 50, 100 days, and `challenge_passed`. Newly reached ones are saved once with `earnedAt` and kept even if the streak breaks. Weekly streaks (`unit: "weeks"`) do not earn day milestones. |
| 4 | **Google Calendar (shared)** | Connect with Google, a repeating reminder event per habit with a reminder time, an all-day event per challenge deadline, re-sync, disconnect. Kept up to date when habits change (service-a calls `/internal/reminders`). |
| 5 | **Admin analytics** | Platform totals only: active users, habits per category, check-ins per day, challenges active/passed/failed. No user IDs or habit names ever reach the admin. |

How the numbers are worked out: service-c reads habits from service-a and check-ins, streaks, challenges and missed
notes from service-b, then calculates per day (due = from the habit's schedule, start date, deadline and pause dates;
done = a check-in that day). It never reads another service's tables.

## 2. API

Public (through the gateway, with or without the `/api` prefix):

| Route | Who | Answers |
|---|---|---|
| `GET /api/dashboard?range=30d\|90d` | User | 200, 400, 401, 403, 503 |
| `GET /api/calendar?month=YYYY-MM[&category=][&habitId=]` | User | 200, 400 (month outside 24 back / 12 ahead), 404 (not your habit), 503 |
| `GET /api/milestones[?habitId=]` | User | 200, 400, 404, 503 |
| `GET /api/integrations/google` | User | 200 `{ connected, syncedHabits, lastSyncedAt }` |
| `POST /api/integrations/google/connect` | User | 200 `{ authUrl }`, 409 already connected |
| `GET /api/integrations/google/callback` | Public (Google redirect) | 302 to `/settings?google=connected` or `?google=error` |
| `POST /api/integrations/google/sync` | User | 200 `{ syncedHabits }`, 409 not connected, 502 Google failed |
| `DELETE /api/integrations/google` | User | 204, 409, 502 |
| `GET /api/admin/analytics?range=30d\|90d` | Admin | 200, 400, 403 |

Internal: `POST /internal/reminders { userId, habitId, action: "upsert" | "delete" }` → `202` at once (called by service-a).

Calls it makes (all with `X-Internal-Token`, `X-User-Id`, `X-User-Timezone`, `X-User-Week-Starts-On`, `X-Request-Id`, 3 s timeout → 503):
- service-a: `/internal/habits`, `/internal/habits/due`, `/internal/habits/:id/inactive-periods`, `/internal/stats`
- service-b: `/internal/checkins`, `/internal/streaks`, `/internal/challenges`, `/internal/missed-notes`, `/internal/stats`

## 3. Database (shared PostgreSQL, only `time_*` tables)

| Table | Holds |
|---|---|
| `time_milestones` | Earned milestones (user, habit, kind, days, earnedAt); unique per habit, kind and days |
| `time_google_links` | One Google connection per user: **KMS-encrypted** refresh token, the app's own calendar ID, time zone, last sync |
| `time_google_events` | The Google events the app created (reminder / deadline per habit), so they can be updated and removed |
| `time_oauth_states` | One-time OAuth `state` values, stored only as a SHA-256 hash, valid 10 minutes |

## 4. AWS services (run in Floci; created by `scripts/setup-aws.sh`, safe to run twice)

| AWS service | Resource | Used for |
|---|---|---|
| **KMS** | key `alias/time-service-google-tokens` | Encrypts each user's Google refresh token before it is stored, with an encryption context tied to the user (a token copied to another user's row cannot be decrypted). Also encrypts the secret below. |
| **Secrets Manager** | secret `time-service/secrets` | Holds `INTERNAL_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; read once at start-up, never logged. |
| **CloudWatch Logs** | log group `/habit-tracker/time-service` (14-day retention) | One JSON line per request (time, request ID, user ID, route, status, duration); no tokens, secrets, OAuth codes or note text. |
| **CloudWatch metric filter** | `time-service-rejected` → metric `HabitTracker/TimeServiceRejectedRequests` | Counts responses with status 401, 403 or 429. |
| **CloudWatch alarm** | `time-service-rejected-requests` | Fires when there are more than 10 rejected requests in 5 minutes (tested: it went to `ALARM`). |

Code uses the AWS SDK v3 with the endpoint from `AWS_ENDPOINT_URL` (Floci locally; empty on real AWS).
Planned, not done yet: an IAM role for service-c limited to its own KMS key, secret and log group.
Shared by the team (not in this repo): RDS, EC2 / Auto Scaling, load balancer, API Gateway, CloudFront, WAF, Cognito.

External API: **Google Calendar (OAuth 2.0)**, scope `calendar.app.created` only: the app creates its own
"Habit Tracker" calendar and can only manage that calendar, not the user's other calendars.

## 5. Security controls

- Every request needs the shared `X-Internal-Token` (compared in constant time), else 401. Only `/health` is open.
- User identity only from `X-User-Id` (set by the gateway); never from the body or query (`?userId=` → 400).
- Users only on personal routes (admin → 403); admin only on analytics (user → 403).
- Another user's habit → 404, never 403.
- Input checks: `month`, `range`, `category`, UUIDs; unknown query or body fields → 400; non-JSON → 415; body over 10 KB → 413.
- One error format: `{ "error": { code, message, details, requestId } }`, with no stack traces or internal names.
- Helmet security headers; no `X-Powered-By`.
- Google: one-time `state` (hashed, 10 minutes, deleted when used), fixed redirect address, minimal scope,
  refresh token encrypted with KMS, revoked and deleted on disconnect; error reasons are logged, never put in the URL.
- Admin totals use an allow-list of fields, so nothing personal can leak even if another service sends extra data.
- No secrets in Git (`.env` ignored, Gitleaks in CI); the Docker image runs as a non-root user and contains no `.env` or tests.

## 6. Tests and evidence

- **89 automated tests** (Jest + Supertest): best days, calendar statuses, schedules (weekdays, times per week,
  pauses, Sunday/Monday week start), milestone thresholds, Google events, all security rules, timeouts.
- Report tests covered: **ST-08** (bad, reused or expired OAuth state → rejected, nothing stored), **ST-13** (invalid
  input), **IT-03 / IT-07** (calendar, streaks, 7-day milestone saved), **IT-11** (another service down → 503 in under
  0.01 s, no crash, recovers), **IT-12** (Google failure never blocks a habit: 202).
- **Integration test with service-a and service-b passed** on 2026-11-23 (details in `docs/INTEGRATION.md`).
- `npm run check:upstreams`: checks that service-a and service-b answer what service-c needs (12/12 PASS).
- CI (GitHub Actions): tests, `npm audit` (0 vulnerabilities), Docker build, Gitleaks.
- k6 load test script for the dashboard: `tests/load/dashboard.k6.js` (to be run for the report).

## 7. The shared service (`shared-service/`, port 3000)

Also built by Adam, in this repo: the shared gateway functions, as a separate app with its own tests (54).

| Function | Routes |
|---|---|
| Sign-up, login, logout through **Amazon Cognito** | `POST /api/auth/signup`, `/login`, `/logout` |
| Profile and settings (name, time zone, week start) | `GET` / `PATCH /api/users/me` |
| Admin account management (list, deactivate, reactivate) | `GET /api/admin/users`, `PATCH /api/admin/users/:id/status` |
| Audit log | `GET /api/admin/audit-logs` |
| Routing to service-a / b / c, `/internal/*` blocked | every other `/api/*` route |

It checks every Cognito token itself (RS256 signature, issuer, app client, expiry), takes the role only from the
Cognito `admin` group, replaces any `X-User-*` headers the client sent, refuses logged-out tokens and
deactivated accounts at once, locks an email for 10 minutes after 5 failed logins, limits each IP to 100
requests per minute, and writes security events to the audit log. Tested live with Floci and the three real
services (sign-up → login → habits → checklist → check-in → dashboard), plus ST-01 to ST-04, ST-06, ST-07.

Its AWS services: **Cognito** (user pool, app client, `admin` group), **Secrets Manager** (`gateway/secrets`),
**CloudWatch** (`/habit-tracker/gateway` log group, metric filter on 401/403/429, alarm).
Tables: `gw_users`, `gw_login_attempts`, `gw_audit_logs`, `gw_revoked_tokens`.

## 8. Not done yet

- Real Google sign-in (needs a Google Cloud OAuth client ID and secret).
- IAM role for service-c, and running the k6 load test.
- Frontend pages: dashboard, calendar, milestones, Google settings.
