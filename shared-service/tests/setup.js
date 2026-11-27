// Runs before every test file. Fake values only.
process.env.NODE_ENV = 'test';
process.env.INTERNAL_TOKEN = 'test-internal-token';
process.env.COGNITO_USER_POOL_ID = 'us-east-1_test';
process.env.COGNITO_CLIENT_ID = 'test-client';
process.env.COGNITO_ISSUER = 'http://cognito.test/us-east-1_test';
process.env.COGNITO_JWKS_URL = 'http://127.0.0.1:1/unused'; // replaced by the test JWKS server
process.env.RATE_LIMIT_MAX = '100';
delete process.env.AWS_ENDPOINT_URL;
