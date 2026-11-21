const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const config = require('./index');
const { awsClientConfig } = require('./aws');

// Reads the service's secrets from AWS Secrets Manager at startup, if SECRETS_ID is set.
// The secret is a JSON object, for example:
//   { "INTERNAL_TOKEN": "...", "GOOGLE_CLIENT_ID": "...", "GOOGLE_CLIENT_SECRET": "..." }
// Secret values are never printed.
async function loadSecrets() {
  if (!config.secretsId) return false;
  const client = new SecretsManagerClient(awsClientConfig());
  const out = await client.send(new GetSecretValueCommand({ SecretId: config.secretsId }));
  const values = JSON.parse(out.SecretString || '{}');
  if (values.INTERNAL_TOKEN) config.internalToken = values.INTERNAL_TOKEN;
  if (values.GOOGLE_CLIENT_ID) config.google.clientId = values.GOOGLE_CLIENT_ID;
  if (values.GOOGLE_CLIENT_SECRET) config.google.clientSecret = values.GOOGLE_CLIENT_SECRET;
  return true;
}

module.exports = { loadSecrets };
