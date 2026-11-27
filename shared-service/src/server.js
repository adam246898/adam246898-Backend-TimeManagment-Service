const config = require('./config');
const { loadSecrets } = require('./config/secrets');
const cloudwatch = require('./config/cloudwatch');

async function start() {
  try {
    if (await loadSecrets()) console.log(`Secrets loaded from Secrets Manager (${config.secretsId})`);
  } catch (err) {
    console.error(`Could not read secrets from Secrets Manager: ${err.name}`);
    process.exit(1);
  }
  const missing = [];
  if (!config.internalToken) missing.push('INTERNAL_TOKEN');
  if (!config.cognito.userPoolId) missing.push('COGNITO_USER_POOL_ID');
  if (!config.cognito.clientId) missing.push('COGNITO_CLIENT_ID');
  if (missing.length) {
    console.error(`Missing settings: ${missing.join(', ')}. Copy .env.example to .env and run scripts/setup-aws.sh.`);
    process.exit(1);
  }
  cloudwatch.start();
  const app = require('./app');
  app.listen(config.port, () => console.log(`gateway listening on port ${config.port}`));
}

start();
