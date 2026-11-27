const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const config = require('./index');
const { awsClientConfig } = require('./aws');

// Reads the gateway's secret JSON from AWS Secrets Manager at startup when SECRETS_ID is set, e.g.
//   { "INTERNAL_TOKEN": "..." }
// Secret values are never printed.
async function loadSecrets() {
  if (!config.secretsId) return false;
  const client = new SecretsManagerClient(awsClientConfig());
  const out = await client.send(new GetSecretValueCommand({ SecretId: config.secretsId }));
  const values = JSON.parse(out.SecretString || '{}');
  if (values.INTERNAL_TOKEN) config.internalToken = values.INTERNAL_TOKEN;
  return true;
}

module.exports = { loadSecrets };
