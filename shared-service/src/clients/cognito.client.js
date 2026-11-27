// Amazon Cognito (user pool). Cognito stores the passwords; we never do.
const {
  CognitoIdentityProviderClient,
  SignUpCommand,
  AdminConfirmSignUpCommand,
  AdminDeleteUserCommand,
  InitiateAuthCommand,
  GlobalSignOutCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminUserGlobalSignOutCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const config = require('../config');
const { awsClientConfig } = require('../config/aws');
const logger = require('../utils/logger');
const { serviceUnavailable } = require('../utils/errors');

let client;
const cognito = () => client || (client = new CognitoIdentityProviderClient(awsClientConfig()));

// Cognito errors we expect are passed on by name; anything else means Cognito is not reachable (503).
const EXPECTED = new Set([
  'UsernameExistsException',
  'NotAuthorizedException',
  'UserNotFoundException',
  'InvalidPasswordException',
  'InvalidParameterException',
  'UserNotConfirmedException',
]);

async function send(command, action) {
  try {
    return await cognito().send(command);
  } catch (err) {
    if (EXPECTED.has(err.name)) throw err;
    logger.error('cognito_failed', { action, reason: err.name });
    throw serviceUnavailable('Sign-in is not available right now. Please try again in a moment.');
  }
}

// Creates and confirms the account (no e-mail code in this project). Returns the Cognito user ID (sub).
async function signUp({ email, password, name }) {
  const out = await send(
    new SignUpCommand({
      ClientId: config.cognito.clientId,
      Username: email,
      Password: password,
      UserAttributes: [
        { Name: 'email', Value: email },
        { Name: 'name', Value: name },
      ],
    }),
    'sign_up',
  );
  await send(new AdminConfirmSignUpCommand({ UserPoolId: config.cognito.userPoolId, Username: email }), 'confirm');
  return out.UserSub;
}

// Undo a sign-up when saving the profile failed.
async function deleteUser(email) {
  await send(new AdminDeleteUserCommand({ UserPoolId: config.cognito.userPoolId, Username: email }), 'delete_user');
}

// Returns { accessToken, expiresIn }.
async function login(email, password) {
  const out = await send(
    new InitiateAuthCommand({
      ClientId: config.cognito.clientId,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: email, PASSWORD: password },
    }),
    'login',
  );
  return { accessToken: out.AuthenticationResult.AccessToken, expiresIn: out.AuthenticationResult.ExpiresIn };
}

async function logout(accessToken) {
  await send(new GlobalSignOutCommand({ AccessToken: accessToken }), 'logout');
}

// Deactivating also signs the user out everywhere in Cognito.
async function setEnabled(email, enabled) {
  const params = { UserPoolId: config.cognito.userPoolId, Username: email };
  if (enabled) {
    await send(new AdminEnableUserCommand(params), 'enable_user');
  } else {
    await send(new AdminDisableUserCommand(params), 'disable_user');
    await send(new AdminUserGlobalSignOutCommand(params), 'admin_sign_out');
  }
}

module.exports = { signUp, deleteUser, login, logout, setEnabled };
