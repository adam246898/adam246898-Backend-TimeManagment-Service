// Shared Google Calendar integration. Tables: time_google_links, time_google_events, time_oauth_states.
const crypto = require('crypto');
const config = require('../config');
const db = require('../config/db');
const google = require('../clients/google.client');
const kms = require('../clients/kms.client');
const habitsClient = require('../clients/habits.client');
const logger = require('../utils/logger');
const { conflict, serviceUnavailable } = require('../utils/errors');
const { todayIn, isValidTimeZone } = require('../utils/dates');
const { eventsForHabit } = require('./googleEvents');

const STATE_TTL_MINUTES = 10;
const STATE_RE = /^[A-Za-z0-9_-]{43}$/; // 32 random bytes, base64url

// Only a hash of the state is stored, so a database leak does not reveal usable states.
const hashState = (state) => crypto.createHash('sha256').update(state).digest('hex');

async function getLink(userId) {
  const { rows } = await db.query(
    `SELECT user_id, encrypted_refresh_token, calendar_id, timezone, last_synced_at
     FROM time_google_links WHERE user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

async function accessTokenFor(link) {
  const refreshToken = await kms.decrypt(link.encrypted_refresh_token, link.user_id);
  return google.refreshAccessToken(refreshToken);
}

// ---------- status ----------
async function getStatus(ctx) {
  const link = await getLink(ctx.userId);
  if (!link) return { connected: false, syncedHabits: 0, lastSyncedAt: null };
  const { rows } = await db.query(
    'SELECT COUNT(DISTINCT habit_id)::int AS n FROM time_google_events WHERE user_id = $1',
    [ctx.userId],
  );
  return {
    connected: true,
    syncedHabits: rows[0].n,
    lastSyncedAt: link.last_synced_at ? new Date(link.last_synced_at).toISOString() : null,
  };
}

// ---------- connect: issue a one-time state and the Google sign-in URL ----------
async function startConnect(ctx) {
  if (!config.google.clientId || !config.google.clientSecret) {
    throw serviceUnavailable('Google Calendar is not set up on this server yet.');
  }
  if (await getLink(ctx.userId)) throw conflict('Google Calendar is already connected.');

  await db.query(`DELETE FROM time_oauth_states WHERE created_at < now() - interval '${STATE_TTL_MINUTES} minutes'`);
  const state = crypto.randomBytes(32).toString('base64url');
  await db.query('INSERT INTO time_oauth_states (state_hash, user_id, timezone) VALUES ($1, $2, $3)', [
    hashState(state),
    ctx.userId,
    ctx.timezone,
  ]);
  return { authUrl: google.buildAuthUrl(state) };
}

// Uses up a state: it works once, and only within 10 minutes. Returns { userId, timezone } or null.
async function consumeState(state) {
  if (typeof state !== 'string' || !STATE_RE.test(state)) return null;
  const { rows } = await db.query(
    `DELETE FROM time_oauth_states
     WHERE state_hash = $1 AND created_at > now() - interval '${STATE_TTL_MINUTES} minutes'
     RETURNING user_id, timezone`,
    [hashState(state)],
  );
  return rows[0] ? { userId: rows[0].user_id, timezone: rows[0].timezone } : null;
}

// ---------- callback: Google redirects the browser here ----------
// Returns 'connected' or 'error'. The reason for an error is logged, never put in the URL.
async function finishConnect({ code, state, error }, requestId) {
  const fail = (reason, userId = null) => {
    logger.warn('google_oauth_failed', { requestId, userId, reason });
    return 'error';
  };

  const owner = await consumeState(state); // checked first, so a bad state never reaches Google
  if (!owner) return fail('invalid_or_expired_state');
  if (error) return fail('denied_by_user', owner.userId);
  if (typeof code !== 'string' || code.length === 0 || code.length > 1024) return fail('missing_code', owner.userId);

  try {
    const tokens = await google.exchangeCode(code);
    if (!tokens.refreshToken) return fail('no_refresh_token', owner.userId);
    const calendarId = await google.createCalendar(tokens.accessToken, owner.timezone);
    const encrypted = await kms.encrypt(tokens.refreshToken, owner.userId);
    await db.query(
      `INSERT INTO time_google_links (user_id, encrypted_refresh_token, calendar_id, timezone, scope)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
         calendar_id = EXCLUDED.calendar_id, timezone = EXCLUDED.timezone, scope = EXCLUDED.scope,
         connected_at = now(), last_synced_at = NULL`,
      [owner.userId, encrypted, calendarId, owner.timezone, tokens.scope],
    );
  } catch (err) {
    return fail(err.code === 'UPSTREAM_ERROR' ? 'google_error' : `internal_${err.name}`, owner.userId);
  }

  logger.info('google_connected', { requestId, userId: owner.userId });
  // Create the first reminders. If this fails the user can press "sync" later.
  try {
    await sync({ userId: owner.userId, timezone: owner.timezone, requestId });
  } catch (err) {
    logger.warn('google_first_sync_failed', { requestId, userId: owner.userId, reason: err.code || err.name });
  }
  return 'connected';
}

// ---------- events of one habit ----------
async function removeHabitEvents(accessToken, link, habitId) {
  const { rows } = await db.query(
    'SELECT google_event_id FROM time_google_events WHERE user_id = $1 AND habit_id = $2',
    [link.user_id, habitId],
  );
  for (const r of rows) await google.deleteEvent(accessToken, link.calendar_id, r.google_event_id);
  await db.query('DELETE FROM time_google_events WHERE user_id = $1 AND habit_id = $2', [link.user_id, habitId]);
}

async function createHabitEvents(accessToken, link, habit, tz) {
  const events = eventsForHabit(habit, tz, todayIn(tz));
  for (const { kind, event } of events) {
    const eventId = await google.insertEvent(accessToken, link.calendar_id, event);
    await db.query(
      `INSERT INTO time_google_events (user_id, habit_id, google_event_id, kind) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, habit_id, kind) DO UPDATE SET google_event_id = EXCLUDED.google_event_id, synced_at = now()`,
      [link.user_id, habit.id, eventId, kind],
    );
  }
  return events.length > 0;
}

// ---------- sync: re-create every reminder and deadline event ----------
async function sync(ctx) {
  const link = await getLink(ctx.userId);
  if (!link) throw conflict('Google Calendar is not connected.');
  const tz = isValidTimeZone(ctx.timezone) ? ctx.timezone : link.timezone;
  const accessToken = await accessTokenFor(link);
  const habits = await habitsClient.listHabits(ctx);

  const { rows } = await db.query('SELECT DISTINCT habit_id FROM time_google_events WHERE user_id = $1', [ctx.userId]);
  for (const r of rows) await removeHabitEvents(accessToken, link, r.habit_id);

  let syncedHabits = 0;
  for (const habit of habits) {
    if (await createHabitEvents(accessToken, link, habit, tz)) syncedHabits += 1;
  }
  await db.query('UPDATE time_google_links SET last_synced_at = now(), timezone = $2 WHERE user_id = $1', [
    ctx.userId,
    tz,
  ]);
  return { syncedHabits };
}

// ---------- disconnect: remove events, revoke and delete the token ----------
async function disconnect(ctx) {
  const link = await getLink(ctx.userId);
  if (!link) throw conflict('Google Calendar is not connected.');
  try {
    const refreshToken = await kms.decrypt(link.encrypted_refresh_token, link.user_id);
    const accessToken = await google.refreshAccessToken(refreshToken);
    // Deleting the app's own calendar removes all of its events in one call.
    await google.deleteCalendar(accessToken, link.calendar_id);
    await google.revokeToken(refreshToken);
  } catch (err) {
    // If the user already revoked access in Google, there is nothing left to remove there.
    if (!(err instanceof google.GoogleTokenInvalidError)) throw err;
  }
  await db.query('DELETE FROM time_google_links WHERE user_id = $1', [ctx.userId]); // events cascade
  logger.info('google_disconnected', { requestId: ctx.requestId, userId: ctx.userId });
}

// ---------- internal: habits-service tells us a habit changed ----------
// Does nothing if the user has not connected Google.
async function handleReminder({ userId, habitId, action }, requestId) {
  const link = await getLink(userId);
  if (!link) return 'not_connected';
  const ctx = { userId, requestId };
  const accessToken = await accessTokenFor(link);
  await removeHabitEvents(accessToken, link, habitId);
  if (action === 'upsert') {
    const [habit] = await habitsClient.listHabits(ctx, { ids: [habitId], includeArchived: true });
    if (habit && habit.id === habitId) await createHabitEvents(accessToken, link, habit, link.timezone);
  }
  return 'done';
}

module.exports = { getStatus, startConnect, consumeState, finishConnect, sync, disconnect, handleReminder };
