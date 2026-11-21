// Google OAuth 2.0 and Google Calendar API, called with plain fetch (no extra library).
const config = require('../config');
const logger = require('../utils/logger');
const { upstreamError } = require('../utils/errors');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TIMEOUT_MS = 5000;

// Minimal permission: the app may only create its own secondary calendar and manage the events
// on calendars it created. It cannot read or change the user's other calendars.
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';

// Thrown when Google says the refresh token is no longer valid (the user revoked access).
class GoogleTokenInvalidError extends Error {}

async function googleFetch(url, options, action) {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    logger.warn('google_failed', { action, reason: err.name });
    throw upstreamError();
  }
  return res;
}

// Logs only the status and Google's short error code, never tokens or the response body.
async function failFrom(res, action) {
  let code;
  try {
    code = (await res.json()).error;
  } catch {
    code = undefined;
  }
  logger.warn('google_failed', { action, status: res.status, googleError: typeof code === 'string' ? code : undefined });
  return upstreamError();
}

function buildAuthUrl(state) {
  const q = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline', // we need a refresh token for later syncs
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
  });
  return `${AUTH_URL}?${q}`;
}

const form = (fields) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

// Swaps the one-time code from the callback for tokens.
async function exchangeCode(code) {
  const res = await googleFetch(
    TOKEN_URL,
    form({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: 'authorization_code',
    }),
    'exchange_code',
  );
  if (!res.ok) throw await failFrom(res, 'exchange_code');
  const body = await res.json();
  return { refreshToken: body.refresh_token || null, accessToken: body.access_token, scope: body.scope || SCOPE };
}

async function refreshAccessToken(refreshToken) {
  const res = await googleFetch(
    TOKEN_URL,
    form({
      refresh_token: refreshToken,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      grant_type: 'refresh_token',
    }),
    'refresh_token',
  );
  if (res.status === 400 || res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.error === 'invalid_grant') throw new GoogleTokenInvalidError('Google access was revoked.');
    logger.warn('google_failed', { action: 'refresh_token', status: res.status, googleError: body.error });
    throw upstreamError();
  }
  if (!res.ok) throw await failFrom(res, 'refresh_token');
  return (await res.json()).access_token;
}

const bearer = (accessToken, extra = {}) => ({ Authorization: `Bearer ${accessToken}`, ...extra });

async function createCalendar(accessToken, timeZone) {
  const res = await googleFetch(
    `${CALENDAR_API}/calendars`,
    {
      method: 'POST',
      headers: bearer(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ summary: 'Habit Tracker', timeZone }),
    },
    'create_calendar',
  );
  if (!res.ok) throw await failFrom(res, 'create_calendar');
  return (await res.json()).id;
}

// 404 / 410 mean "already gone", which is fine when deleting.
async function deleteCalendar(accessToken, calendarId) {
  const res = await googleFetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}`,
    { method: 'DELETE', headers: bearer(accessToken) },
    'delete_calendar',
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) throw await failFrom(res, 'delete_calendar');
}

async function insertEvent(accessToken, calendarId, event) {
  const res = await googleFetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: bearer(accessToken, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(event),
    },
    'insert_event',
  );
  if (!res.ok) throw await failFrom(res, 'insert_event');
  return (await res.json()).id;
}

async function deleteEvent(accessToken, calendarId, eventId) {
  const res = await googleFetch(
    `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: bearer(accessToken) },
    'delete_event',
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) throw await failFrom(res, 'delete_event');
}

// Revokes the refresh token at Google. 400 means it was already invalid, which is fine.
async function revokeToken(token) {
  const res = await googleFetch(REVOKE_URL, form({ token }), 'revoke');
  if (!res.ok && res.status !== 400) throw await failFrom(res, 'revoke');
}

module.exports = {
  SCOPE,
  GoogleTokenInvalidError,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  createCalendar,
  deleteCalendar,
  insertEvent,
  deleteEvent,
  revokeToken,
};
