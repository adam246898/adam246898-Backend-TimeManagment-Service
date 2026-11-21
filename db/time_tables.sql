-- time-service tables. Safe to run more than once.
-- This service owns ONLY tables starting with time_. It never reads habits_*, streaks_* or gw_* tables.
-- user_id and habit_id point to other services' data, so they are plain UUIDs (no foreign key):
-- ownership is checked through those services' APIs.
-- Copy this file into gateway/db/ when the team's shared database scripts are ready.

-- Milestones earned by a user's habits (contract 4.10). Once earned, kept forever.
CREATE TABLE IF NOT EXISTS time_milestones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  habit_id   uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('streak', 'challenge_passed')),
  days       integer NOT NULL CHECK (days > 0),
  earned_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (habit_id, kind, days)
);
CREATE INDEX IF NOT EXISTS time_milestones_user_idx ON time_milestones (user_id);

-- One Google Calendar connection per user. The refresh token is encrypted with AWS KMS.
CREATE TABLE IF NOT EXISTS time_google_links (
  user_id                  uuid PRIMARY KEY,
  encrypted_refresh_token  bytea NOT NULL,
  calendar_id              text NOT NULL,   -- the app's own "Habit Tracker" calendar
  timezone                 text NOT NULL DEFAULT 'UTC',
  scope                    text NOT NULL,
  connected_at             timestamptz NOT NULL DEFAULT now(),
  last_synced_at           timestamptz
);

-- The events this app created in Google Calendar, so they can be updated and removed.
CREATE TABLE IF NOT EXISTS time_google_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES time_google_links (user_id) ON DELETE CASCADE,
  habit_id         uuid NOT NULL,
  google_event_id  text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('reminder', 'deadline')),
  synced_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, habit_id, kind)
);

-- One-time OAuth "state" values (only their SHA-256 hash), valid for 10 minutes.
CREATE TABLE IF NOT EXISTS time_oauth_states (
  state_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL,
  timezone    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
