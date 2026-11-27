// Sign-up, login and logout through Amazon Cognito (contract 5.1).
const db = require('../config/db');
const config = require('../config');
const cognito = require('../clients/cognito.client');
const tokens = require('../clients/tokens');
const users = require('./users.service');
const logger = require('../utils/logger');
const { emailTaken, invalidCredentials, accountDisabled, tooManyRequests, validationError } = require('../utils/errors');

// New accounts are always role "user". Admins are only made by scripts/seed-admin.js.
async function signUp({ name, email, password, timezone }, requestId) {
  if (await users.emailExists(email)) throw emailTaken();
  let sub;
  try {
    sub = await cognito.signUp({ email, password, name });
  } catch (err) {
    if (err.name === 'UsernameExistsException') throw emailTaken();
    if (err.name === 'InvalidPasswordException' || err.name === 'InvalidParameterException') {
      throw validationError([{ field: 'password', issue: 'Use 10 to 128 characters with at least one letter and one digit.' }]);
    }
    throw err;
  }
  try {
    return users.toUser(await users.create({ sub, name, email, timezone }));
  } catch (err) {
    // Keep Cognito and gw_users in step: remove the half-created account.
    logger.error('signup_rollback', { requestId, reason: err.code || err.name });
    try {
      await cognito.deleteUser(email);
    } catch {
      logger.error('signup_rollback_failed', { requestId });
    }
    if (err.code === '23505') throw emailTaken();
    throw err;
  }
}

async function recentFailures(email) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM gw_login_attempts
     WHERE email = $1 AND success = false AND created_at > now() - make_interval(mins => $2)`,
    [email, config.loginLockMinutes],
  );
  return rows[0].n;
}

const recordAttempt = (email, ip, success) =>
  db.query('INSERT INTO gw_login_attempts (email, ip, success) VALUES ($1, $2, $3)', [email, ip, success]);

// Returns { result } on success, or throws. `audit(action, status)` writes the audit line.
// Wrong email and wrong password give exactly the same answer (contract 5.1).
async function login({ email, password }, { ip, audit }) {
  if ((await recentFailures(email)) >= config.loginMaxFailures) {
    await audit('login_locked', 429);
    throw tooManyRequests('Too many failed logins for this email. Please try again in 10 minutes.');
  }

  let session;
  try {
    session = await cognito.login(email, password);
  } catch (err) {
    if (err.name === 'NotAuthorizedException' && /disabled/i.test(err.message || '')) {
      await audit('account_disabled', 403);
      throw accountDisabled();
    }
    if (['NotAuthorizedException', 'UserNotFoundException', 'UserNotConfirmedException'].includes(err.name)) {
      await recordAttempt(email, ip, false);
      await audit('login_failed', 401);
      throw invalidCredentials();
    }
    throw err;
  }

  const claims = await tokens.verifyAccessToken(session.accessToken);
  let row = await users.findBySub(claims.sub);
  if (!row) {
    logger.error('login_without_profile', { reason: 'no gw_users row for this Cognito user' });
    await recordAttempt(email, ip, false);
    await audit('login_failed', 401);
    throw invalidCredentials();
  }
  if (!row.is_active) {
    await audit('account_disabled', 403, row.id);
    throw accountDisabled();
  }
  row = await users.syncRole(row, tokens.roleFromClaims(claims));
  await recordAttempt(email, ip, true);
  return {
    accessToken: session.accessToken,
    tokenType: 'Bearer',
    expiresIn: session.expiresIn,
    user: users.toUser(row),
  };
}

// Signs out in Cognito, and remembers the session as revoked, because the gateway checks tokens
// itself and would otherwise accept this token until it expires.
async function logout(accessToken, claims) {
  const sessionId = tokens.sessionIdOf(claims);
  if (sessionId) {
    await db.query(
      `INSERT INTO gw_revoked_tokens (jti, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT (jti) DO NOTHING`,
      [sessionId, claims.exp],
    );
  }
  try {
    await cognito.logout(accessToken);
  } catch (err) {
    // The token is already revoked here, so a Cognito problem does not stop the logout.
    logger.warn('cognito_logout_failed', { reason: err.name });
  }
}

async function isRevoked(claims) {
  const sessionId = tokens.sessionIdOf(claims);
  if (!sessionId) return false;
  const { rows } = await db.query('SELECT 1 FROM gw_revoked_tokens WHERE jti = $1', [sessionId]);
  return rows.length > 0;
}

module.exports = { signUp, login, logout, isRevoked };
