// Creates (or updates) the admin account. Nobody can sign up as an admin through the API (contract 3.3);
// this script is the only way. Run once after setup-aws.sh and db:init:
//   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='choose-a-strong-1' ADMIN_NAME='Admin' npm run seed:admin
// The password is never printed or stored by us (Cognito keeps it).
const {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { Client } = require('pg');

async function main() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'Admin', COGNITO_USER_POOL_ID, DATABASE_URL } = process.env;
  const email = (ADMIN_EMAIL || '').trim().toLowerCase();
  if (!email || !ADMIN_PASSWORD || !COGNITO_USER_POOL_ID || !DATABASE_URL) {
    console.error('Set ADMIN_EMAIL, ADMIN_PASSWORD, COGNITO_USER_POOL_ID and DATABASE_URL.');
    process.exit(1);
  }
  if (!/^(?=.*[A-Za-z])(?=.*\d).{10,128}$/.test(ADMIN_PASSWORD)) {
    console.error('ADMIN_PASSWORD needs 10 to 128 characters with at least one letter and one digit.');
    process.exit(1);
  }
  const aws = { region: process.env.AWS_REGION || 'us-east-1' };
  if (process.env.AWS_ENDPOINT_URL) aws.endpoint = process.env.AWS_ENDPOINT_URL;
  const cognito = new CognitoIdentityProviderClient(aws);
  const pool = { UserPoolId: COGNITO_USER_POOL_ID, Username: email };

  try {
    await cognito.send(new AdminCreateUserCommand({
      ...pool,
      MessageAction: 'SUPPRESS',
      UserAttributes: [{ Name: 'email', Value: email }, { Name: 'name', Value: ADMIN_NAME }, { Name: 'email_verified', Value: 'true' }],
    }));
    console.log(`Cognito user created: ${email}`);
  } catch (err) {
    if (err.name !== 'UsernameExistsException') throw err;
    console.log(`Cognito user already exists: ${email}`);
  }
  await cognito.send(new AdminSetUserPasswordCommand({ ...pool, Password: ADMIN_PASSWORD, Permanent: true }));
  await cognito.send(new AdminAddUserToGroupCommand({ ...pool, GroupName: 'admin' }));
  const user = await cognito.send(new AdminGetUserCommand(pool));
  const sub = (user.UserAttributes || []).find((a) => a.Name === 'sub')?.Value;
  if (!sub) throw new Error('Cognito did not return the user ID (sub).');

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      `INSERT INTO gw_users (cognito_sub, name, email, role) VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO UPDATE SET cognito_sub = EXCLUDED.cognito_sub, role = 'admin', is_active = true, updated_at = now()`,
      [sub, ADMIN_NAME, email],
    );
  } finally {
    await db.end();
  }
  console.log(`Admin ready: ${email} (in the Cognito "admin" group)`);
}

main().catch((err) => {
  console.error(`seed:admin failed: ${err.name}: ${err.message}`);
  process.exit(1);
});
