// All settings come from environment variables (or Secrets Manager, see secrets.js). No secrets in code.
const region = process.env.AWS_REGION || 'us-east-1';
const endpoint = process.env.AWS_ENDPOINT_URL || undefined;
const userPoolId = process.env.COGNITO_USER_POOL_ID || '';

// Cognito's token issuer. On Floci it is "<endpoint>/<poolId>"; on real AWS it is
// "https://cognito-idp.<region>.amazonaws.com/<poolId>". Can be overridden (inside Docker the token still
// says "localhost:4566" while the keys must be fetched from "floci:4566").
const defaultIssuer = endpoint
  ? `${endpoint.replace(/\/$/, '')}/${userPoolId}`
  : `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
const issuer = process.env.COGNITO_ISSUER || defaultIssuer;

const config = {
  serviceName: 'gateway',
  port: Number(process.env.PORT) || 3000,
  internalToken: process.env.INTERNAL_TOKEN || '',
  databaseUrl: process.env.DATABASE_URL || '',

  // Where to forward requests (contract 3.2). Team names: service-a, service-b, service-c.
  services: {
    habits: process.env.HABITS_SERVICE_URL || 'http://service-a:3001',
    streaks: process.env.STREAKS_SERVICE_URL || 'http://service-b:3002',
    time: process.env.TIME_SERVICE_URL || 'http://service-c:3003',
  },
  // A forwarded request waits longer than the services' own 3-second internal calls.
  upstreamTimeoutMs: Number(process.env.UPSTREAM_TIMEOUT_MS) || 10000,

  // Browser origins allowed to call the gateway (comma separated).
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:8080')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // Contract 3.4: 100 requests per minute per IP; 5 failed logins per email in 10 minutes.
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX) || 100,
  rateLimitWindowMs: 60 * 1000,
  loginMaxFailures: 5,
  loginLockMinutes: 10,
  // Behind a load balancer the client IP is in X-Forwarded-For. Only trust it when that is true.
  trustProxy: process.env.TRUST_PROXY === 'true',

  cognito: {
    userPoolId,
    clientId: process.env.COGNITO_CLIENT_ID || '',
    issuer,
    jwksUrl: process.env.COGNITO_JWKS_URL || `${issuer}/.well-known/jwks.json`,
    adminGroup: 'admin',
  },

  aws: { region, endpoint },
  secretsId: process.env.SECRETS_ID || '',
  logGroup: process.env.CLOUDWATCH_LOG_GROUP || '',
};

module.exports = config;
