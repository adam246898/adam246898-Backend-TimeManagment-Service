# shared-service (gateway functions, built by Adam)

The shared part of **Habit Tracker with Streaks** (Group 03), port **3000**: the only public API. It checks the
Amazon Cognito login token, owns sign-up / login / logout, profile and settings, admin account management and
the audit log, and forwards every other `/api/*` request to the owning service: **service-a** (habits, Ahmed),
**service-b** (streaks, Teeba), **service-c** (time, Adam). Follows the team API contract (sections 3, 5.1 and 7).

It lives in this folder of Adam's repo and has its own `package.json`, tests and Dockerfile. The team's gateway
repo holds the Docker Compose file that builds it from here and connects it to the three backends.

## What it does

| Route | Who | Answers |
|---|---|---|
| `POST /api/auth/signup` `{ name, email, password, timezone? }` | Public | 201 User, 400, 409 `EMAIL_TAKEN`, 415, 429 |
| `POST /api/auth/login` `{ email, password }` | Public | 200 `{ accessToken, tokenType, expiresIn, user }`, 401 `INVALID_CREDENTIALS`, 403 `ACCOUNT_DISABLED`, 429 after 5 failures in 10 min |
| `POST /api/auth/logout` | User, Admin | 204 (the token stops working at once) |
| `GET` / `PATCH /api/users/me` `{ name?, timezone?, settings?: { weekStartsOn? } }` | User, Admin | 200 User, 400 |
| `GET /api/admin/users?page&limit&q&isActive&sort` | Admin | 200 list of User (no habit data) |
| `PATCH /api/admin/users/:id/status` `{ isActive }` | Admin | 200, 404, 409 (not yourself) |
| `GET /api/admin/audit-logs?page&limit&action&statusCode&from&to&sort` | Admin | 200 list |
| everything else under `/api` | see contract 3.2 | forwarded to service-a / b / c; `/internal/*` → 404 |

On every forwarded request the gateway removes any identity headers the client sent and adds its own:
`X-User-Id`, `X-User-Role` (from the Cognito `admin` group only), `X-User-Timezone`, `X-User-Week-Starts-On`,
`X-Request-Id` and `X-Internal-Token`. The Cognito token itself is never forwarded.

Security: RS256 signature checked against Cognito's public keys (issuer, app client, expiry, token use),
logged-out tokens refused, deactivated accounts refused on their next request, role checks for admin routes,
100 requests per minute per IP (sliding window), 10 KB body limit, JSON only, CORS for the frontend origin,
Helmet headers, one error format, audit log for failed logins, lockouts, 403s and admin actions, JSON request
logs to CloudWatch without passwords or tokens.

## AWS services

| Service | Resource | Used for |
|---|---|---|
| Cognito | user pool `habit-tracker-users`, client `habit-tracker-web`, group `admin` | Passwords, login, tokens, roles |
| Secrets Manager | `gateway/secrets` | The internal token |
| CloudWatch | log group `/habit-tracker/gateway`, metric filter and alarm | Request logs; alarm at more than 10 rejected requests (401/403/429) in 5 minutes |

## Run it (Git Bash, with Docker, Floci and the services running)

```bash
npm install
npm test                                   # 54 tests
INTERNAL_TOKEN=<the team token> bash scripts/setup-aws.sh   # Cognito, secret, CloudWatch (safe to run twice)
cp .env.example .env                       # paste the lines the script printed, and DATABASE_URL
npm run db:init                            # gw_* tables
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='choose-a-strong-1' npm run seed:admin
npm run dev                                # http://localhost:3000
```

Tables (`db/gateway_tables.sql`): `gw_users`, `gw_login_attempts`, `gw_audit_logs`, and `gw_revoked_tokens`
(logged-out sessions; needed because tokens are checked locally and would otherwise work until they expire).
