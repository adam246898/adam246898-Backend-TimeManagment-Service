// k6 load test for GET /api/dashboard (report section 14).
// Through the gateway (final test):
//   k6 run -e BASE_URL=http://localhost:3000/api -e TOKEN=<Cognito access token> tests/load/dashboard.k6.js
// Straight to time-service with the mock services (early test, no gateway yet):
//   k6 run -e BASE_URL=http://localhost:3003 -e INTERNAL_TOKEN=<from .env> tests/load/dashboard.k6.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3003';
const headers = __ENV.TOKEN
  ? { Authorization: `Bearer ${__ENV.TOKEN}` }
  : {
      'X-Internal-Token': __ENV.INTERNAL_TOKEN,
      'X-User-Id': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'X-User-Role': 'user',
      'X-User-Timezone': 'Africa/Cairo',
    };

export default function () {
  const res = http.get(`${BASE_URL}/dashboard?range=30d`, { headers });
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
