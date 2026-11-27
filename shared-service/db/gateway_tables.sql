-- Gateway tables (prefix gw_). Safe to run more than once.
-- Passwords are NOT stored here: Amazon Cognito holds them. gw_users holds the profile and settings.

CREATE TABLE IF NOT EXISTS gw_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- the X-User-Id every service sees
  cognito_sub     text NOT NULL UNIQUE,                        -- the Cognito user ("sub" in the token)
  name            varchar(50) NOT NULL,
  email           varchar(254) NOT NULL UNIQUE,                -- stored lower-case
  role            text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  is_active       boolean NOT NULL DEFAULT true,
  timezone        text NOT NULL DEFAULT 'UTC',
  week_starts_on  text NOT NULL DEFAULT 'sunday' CHECK (week_starts_on IN ('sunday', 'monday')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Login attempts, to lock an email for 10 minutes after 5 failures.
CREATE TABLE IF NOT EXISTS gw_login_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       varchar(254) NOT NULL,
  ip          text,
  success     boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gw_login_attempts_email_idx ON gw_login_attempts (email, created_at);

-- Security events. Never contains passwords, tokens or secrets.
CREATE TABLE IF NOT EXISTS gw_audit_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid,
  action         text NOT NULL,
  target         text,
  status_code    integer,
  ip             text,
  request_id     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gw_audit_logs_created_idx ON gw_audit_logs (created_at);
CREATE INDEX IF NOT EXISTS gw_audit_logs_action_idx ON gw_audit_logs (action, created_at);

-- Tokens ended by logout. The gateway checks tokens itself (signature), so without this list a
-- logged-out token would still work until it expires (1 hour). Rows can be deleted after expires_at.
CREATE TABLE IF NOT EXISTS gw_revoked_tokens (
  jti         text PRIMARY KEY,
  expires_at  timestamptz NOT NULL
);
