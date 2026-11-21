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
  if (!config.internalToken) {
    console.error('INTERNAL_TOKEN is not set. Copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  cloudwatch.start();

  const app = require('./app');
  app.listen(config.port, () => console.log(`time-service listening on port ${config.port}`));
}

start();
