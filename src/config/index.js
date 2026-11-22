// All settings come from environment variables (or Secrets Manager, see secrets.js).
// Nothing secret is written in the code.
const config = {
  serviceName: 'time-service', // service-c in the team's Docker Compose
  port: Number(process.env.PORT) || 3003,

  // Shared secret that proves a request came from the gateway or another service.
  internalToken: process.env.INTERNAL_TOKEN || '',

  databaseUrl: process.env.DATABASE_URL || '',

  // Team naming: service-a = habits (Ahmed), service-b = streaks (Teeba), service-c = time (Adam, this one).
  habitsServiceUrl: process.env.HABITS_SERVICE_URL || 'http://service-a:3001',
  streaksServiceUrl: process.env.STREAKS_SERVICE_URL || 'http://service-b:3002',
  // An internal call that does not answer in time is treated as failed (contract section 6).
  upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS) || 3000,

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:8080',

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    // Must match the redirect address registered in the Google Cloud console exactly.
    redirectUri:
      process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/integrations/google/callback',
  },

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    // Floci locally (http://localhost:4566). Leave empty on real AWS.
    endpoint: process.env.AWS_ENDPOINT_URL || undefined,
  },
  kmsKeyId: process.env.KMS_KEY_ID || 'alias/time-service-google-tokens',
  // Optional: name of a Secrets Manager secret (JSON) that holds INTERNAL_TOKEN,
  // GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET. Values found there win over .env.
  secretsId: process.env.SECRETS_ID || '',
  // Optional: send JSON logs straight to this CloudWatch log group.
  logGroup: process.env.CLOUDWATCH_LOG_GROUP || '',
};

module.exports = config;
