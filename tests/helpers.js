// Shared test helpers.
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Headers the gateway would add for a logged-in user.
const userHeaders = (overrides = {}) => ({
  'X-Internal-Token': 'test-internal-token',
  'X-User-Id': USER_ID,
  'X-User-Role': 'user',
  'X-User-Timezone': 'UTC',
  'X-Request-Id': 'req-test-1',
  ...overrides,
});

const adminHeaders = () => userHeaders({ 'X-User-Role': 'admin', 'X-User-Id': OTHER_ID });

function withHeaders(request, headers) {
  for (const [k, v] of Object.entries(headers)) request.set(k, v);
  return request;
}

const habit = (fields) => ({
  type: 'habit',
  category: 'study',
  status: 'active',
  pausedUntil: null,
  challenge: null,
  reminderTime: null,
  createdAt: '2020-01-01T00:00:00Z',
  schedule: { type: 'daily' },
  ...fields,
});

module.exports = { USER_ID, OTHER_ID, userHeaders, adminHeaders, withHeaders, habit };
