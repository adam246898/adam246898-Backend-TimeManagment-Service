// Token checks (report ST-02: expired and tampered tokens are refused).
const crypto = require('crypto');
const { verifyAccessToken, roleFromClaims, resetKeys } = require('../src/clients/tokens');
const { startJwks, signToken } = require('./helpers');

let jwks;
beforeAll(async () => { jwks = await startJwks(); });
afterAll(() => jwks.close());
beforeEach(() => resetKeys());

const rejects = (token) => expect(verifyAccessToken(token)).rejects.toMatchObject({ status: 401 });

test('a valid Cognito-style access token is accepted', async () => {
  const claims = await verifyAccessToken(signToken());
  expect(claims.sub).toBe('sub-user');
});

test('a tampered token is refused (signature no longer matches)', async () => {
  const [h, p, s] = signToken().split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  claims['cognito:groups'] = ['admin']; // try to become an admin
  await rejects(`${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}`);
});

test.each([
  ['expired', { exp: Math.floor(Date.now() / 1000) - 1 }],
  ['wrong issuer', { iss: 'http://evil.test/pool' }],
  ['wrong app client', { client_id: 'other-client' }],
  ['an ID token instead of an access token', { token_use: 'id' }],
])('%s is refused', async (_name, override) => {
  await rejects(signToken(override));
});

test('"alg: none", an unknown key, another signer and rubbish are refused', async () => {
  await rejects(signToken({}, { alg: 'none' }));
  await rejects(signToken({}, { kid: 'unknown-key' }));
  const { privateKey: other } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  await rejects(signToken({}, { key: other }));
  await rejects('not-a-token');
  await rejects(undefined);
});

test('the role comes only from the Cognito "admin" group', () => {
  expect(roleFromClaims({ 'cognito:groups': ['admin'] })).toBe('admin');
  expect(roleFromClaims({ 'cognito:groups': ['users'] })).toBe('user');
  expect(roleFromClaims({ role: 'admin' })).toBe('user');
});
