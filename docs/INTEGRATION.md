# time-service: how to connect to it

For Ahmed (service-a), Teeba (service-b) and whoever sets up the gateway and Docker Compose.
Everything here follows `gateway/docs/api-contract.md` v0.1. Items marked **PROPOSED** are not in the
contract yet and need a contract pull request.

| Docker Compose name | Service | Owner | Port | Internal address |
|---|---|---|---|---|
| `service-a` | habits-service | Ahmed | 3001 | `http://service-a:3001` |
| `service-b` | streaks-service | Teeba | 3002 | `http://service-b:3002` |
| `service-c` | time-service (this repo) | Adam | 3003 | `http://service-c:3003` |

If a service listens on a different port inside its container, change the URL in the environment
variables below; nothing in the code needs to change.

## 1. Quick check when the backends are connected

From the `time-service` folder, with `INTERNAL_TOKEN`, `HABITS_SERVICE_URL` and `STREAKS_SERVICE_URL` in `.env`:

```bash
CHECK_USER_ID=<a real user's UUID> npm run check:upstreams
```

It calls every `/internal` route time-service uses, exactly as time-service calls it, and prints
PASS / WARN / FAIL with the reason (wrong status, missing field, slower than 3 s, user IDs in stats).
Create one habit, one challenge and one check-in for that user first, so the field checks have data.

## 2. What service-c calls (please answer in this shape)

Every call (from service-c) sends `X-Internal-Token`, `X-Request-Id` and, for one user's data, `X-User-Id` **and**
`userId` in the query. No answer within **3 seconds**, a network error or a 5xx makes time-service
return `503 SERVICE_UNAVAILABLE`. A list may be a plain array or `{ "data": [...] }`; if it is paged
(`{ data, page, limit, total }`), time-service fetches the remaining pages with `&page=N&limit=N`.

### service-a: habits-service (Ahmed)

| Call | Fields time-service reads |
|---|---|
| `GET /internal/habits?userId=` (active + paused) | Habit (contract 4.3): `id`, `type`, `name`, `category`, `schedule`, `reminderTime`, `status`, `pausedUntil`, `challenge.startDate`, `challenge.deadline`, `challenge.state`, `createdAt` |
| `GET /internal/habits?userId=&includeArchived=true` | same, archived habits included |
| `GET /internal/habits?userId=&ids=<id>&includeArchived=true` | same, one habit (for reminders) |
| `GET /internal/habits/due?userId=&date=YYYY-MM-DD` | `id` of each habit due that day |
| `GET /internal/stats?range=30d\|90d` | `{ "habitsByCategory": [{ "category": "health", "count": 31 }] }` |

**PROPOSED (optional):** add `pausePeriods: [{ "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" or null }]` to the
internal Habit. Without it, time-service only knows about the *current* pause, so days of a pause that
has already ended are counted as due in "best days" (contract 5.4 says paused days are left out).

### service-b: streaks-service (Teeba)

| Call | Fields time-service reads |
|---|---|
| `GET /internal/checkins?userId=&from=&to=` (up to 97 days) | `habitId`, `date` |
| `GET /internal/streaks?userId=` | `habitId`, `currentStreak`, `longestStreak` |
| `GET /internal/challenges?userId=` | ChallengeProgress (4.8): `habitId`, `name`, `startDate`, `deadline`, `state`, `daysLeft`, `completionRate`, `result` |
| `GET /internal/stats?range=30d\|90d` | `{ "activeUsers": 42, "checkinsPerDay": [{ "date", "count" }], "challenges": { "active", "passed", "failed" } }` |
| **PROPOSED** `GET /internal/missed-notes?userId=&from=&to=` | `habitId`, `date` (no note text needed) |

The missed-notes route is needed for the calendar's `hasMissedNote`. Until it exists, the calendar
works and shows `hasMissedNote: false`. **`activeUsers` is not in the contract:** time-service takes it
from streaks-service, or from habits-service if only that one sends it.

## 3. What service-c serves to other services

`POST http://service-c:3003/internal/reminders` (Ahmed, service-a, calls this when a habit is created, edited,
paused, resumed, archived, unarchived or deleted):

```bash
curl -i -X POST http://service-c:3003/internal/reminders \
  -H "X-Internal-Token: $INTERNAL_TOKEN" -H "Content-Type: application/json" \
  -d '{"userId":"<user uuid>","habitId":"<habit uuid>","action":"upsert"}'
```

- `action`: `upsert` (create or update the habit's events) or `delete` (remove them).
- Always `202` with an empty body, at once. The Google work happens afterwards, so it never slows down
  or blocks the habit request. If the user has not connected Google, nothing happens.
- `400` if a field is missing, not a UUID, or unknown. `401` without the internal token.
- For `delete`, it is fine to call after the habit is already deleted.

## 4. What the gateway must do for service-c

| Public path | Forward to | Bearer token needed |
|---|---|---|
| `GET /api/dashboard`, `GET /api/calendar`, `GET /api/milestones` | `http://service-c:3003` | yes (role `user`) |
| `GET /api/integrations/google`, `POST .../connect`, `POST .../sync`, `DELETE /api/integrations/google` | same | yes (role `user`) |
| `GET /api/integrations/google/callback` | same | **no** (public: Google redirects the browser here) |
| `GET /api/admin/analytics` | same | yes (role `admin`) |

- Forwarding with or without the `/api` prefix both work.
- Send `X-Internal-Token` and `X-Request-Id` on **every** forwarded request, including the public
  callback (it has no user, so no `X-User-*` headers). Without the token time-service answers 401.
- Send `X-User-Id` (UUID), `X-User-Role` (`user`/`admin`) and `X-User-Timezone` (IANA, e.g. `Africa/Cairo`)
  for logged-in requests, after removing any `X-User-*` headers the client sent.
- Pass the query string through unchanged (the callback's `code` and `state` are in it), and pass the
  `302` redirect back to the browser as it is (do not follow it).
- Block `/internal/*` from outside (404).

## 5. Docker Compose block

```yaml
  service-c:                       # time-service (Adam)
    build: ../time-service          # the folder where this repo is cloned
    expose: ["3003"]               # internal only; no public port needed
    environment:
      PORT: "3003"
      INTERNAL_TOKEN: ${INTERNAL_TOKEN}
      DATABASE_URL: ${DATABASE_URL}
      HABITS_SERVICE_URL: http://service-a:3001
      STREAKS_SERVICE_URL: http://service-b:3002
      FRONTEND_URL: http://localhost:8080
      GOOGLE_REDIRECT_URI: http://localhost:3000/api/integrations/google/callback
      AWS_ENDPOINT_URL: http://floci:4566
      AWS_REGION: us-east-1
      AWS_ACCESS_KEY_ID: test
      AWS_SECRET_ACCESS_KEY: test
      KMS_KEY_ID: alias/time-service-google-tokens
      SECRETS_ID: time-service/secrets          # holds GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
      CLOUDWATCH_LOG_GROUP: /habit-tracker/time-service
```

Database: run `db/time_tables.sql` once (or `npm run db:init`). It creates only `time_*` tables:
`time_milestones`, `time_google_links`, `time_google_events` and **`time_oauth_states`** (one-time OAuth
states, hashed; not yet listed in contract section 2).

## 6. Small rules to agree on

| Question | What time-service does now |
|---|---|
| Week start for `times_per_week` (users have a `weekStartsOn` setting, default `sunday`) | Monday (ISO week). habits, streaks and time must use the same rule. |
| Dashboard range "last 30 days" | the 30 full days ending yesterday; today is shown separately under `today` |
| Calendar `habitId` that is not the user's | `404 NOT_FOUND` (ownership rule; not listed in 5.4's calendar errors) |
| `POST /api/integrations/google/connect` when Google is not configured on the server | `503 SERVICE_UNAVAILABLE` |
| `GET /health` | answers without the internal token (no data), for Docker and the load balancer |
