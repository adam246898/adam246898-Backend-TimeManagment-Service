// Backup to S3 and restore (report section 15). S3 and the database are faked.
const zlib = require('zlib');
const db = require('../../src/config/db');
const s3 = require('../../src/clients/s3.client');
const { createBackup, restoreBackup } = require('../../src/services/backup.service');

jest.mock('../../src/config/db', () => ({ query: jest.fn(), transaction: jest.fn() }));
jest.mock('../../src/clients/s3.client');

const TOKEN = Buffer.from([1, 2, 3, 250, 255]); // a KMS-encrypted refresh token is raw bytes
const rows = {
  time_milestones: [{ id: 'm1', user_id: 'u1', habit_id: 'h1', kind: 'streak', days: 7, earned_at: '2026-11-20T10:00:00.000Z' }],
  time_google_links: [{ user_id: 'u1', encrypted_refresh_token: TOKEN, calendar_id: 'cal', timezone: 'UTC', scope: 's' }],
  time_google_events: [{ id: 'e1', user_id: 'u1', habit_id: 'h1', google_event_id: 'g1', kind: 'reminder' }],
};

beforeEach(() => {
  jest.resetAllMocks();
  db.query.mockImplementation(async (sql) => ({ rows: rows[/FROM (\w+)/.exec(sql)[1]] }));
  s3.putBackup.mockResolvedValue({ versionId: 'v1', encryption: 'aws:kms' });
});

test('a backup holds only time_* tables, is gzipped, and is stored KMS-encrypted under backups/', async () => {
  const r = await createBackup(new Date('2026-11-27T02:00:00Z'));
  expect(r).toMatchObject({ key: 'backups/2026-11-27/time-tables-2026-11-27T02-00-00-000Z.json.gz', encryption: 'aws:kms' });
  expect(r.counts).toEqual({ time_milestones: 1, time_google_links: 1, time_google_events: 1 });
  const sql = db.query.mock.calls.map(([q]) => q).join(' ');
  expect(sql).not.toMatch(/habits_|streaks_|gw_|time_oauth_states/);
  const stored = JSON.parse(zlib.gunzipSync(s3.putBackup.mock.calls[0][1]));
  expect(stored.service).toBe('time-service');
  expect(stored.tables.time_google_links[0].encrypted_refresh_token).toEqual({ $bytes: TOKEN.toString('base64') });
});

test('restore puts missing rows back in a safe order, bytes intact, never overwriting (ON CONFLICT DO NOTHING)', async () => {
  const backupBody = zlib.gzipSync(JSON.stringify({
    service: 'time-service',
    createdAt: '2026-11-27T02:00:00.000Z',
    tables: {
      time_milestones: rows.time_milestones,
      time_google_links: [{ ...rows.time_google_links[0], encrypted_refresh_token: { $bytes: TOKEN.toString('base64') } }],
      time_google_events: rows.time_google_events,
    },
  }));
  s3.listBackups.mockResolvedValue([{ key: 'backups/latest.json.gz' }]);
  s3.getBackup.mockResolvedValue(backupBody);
  const client = { query: jest.fn().mockResolvedValue({ rowCount: 1 }) };
  db.transaction.mockImplementation((fn) => fn(client));

  const r = await restoreBackup();
  expect(r).toEqual({
    key: 'backups/latest.json.gz',
    createdAt: '2026-11-27T02:00:00.000Z',
    restored: { time_milestones: 1, time_google_links: 1, time_google_events: 1 },
  });
  const tables = client.query.mock.calls.map(([q]) => /INSERT INTO (\w+)/.exec(q)[1]);
  expect(tables.indexOf('time_google_links')).toBeLessThan(tables.indexOf('time_google_events'));
  expect(client.query.mock.calls.every(([q]) => q.endsWith('ON CONFLICT DO NOTHING'))).toBe(true);
  const linkValues = client.query.mock.calls.find(([q]) => q.includes('time_google_links'))[1];
  expect(linkValues).toContainEqual(TOKEN);
});

test('restore refuses a file that is not a time-service backup', async () => {
  s3.getBackup.mockResolvedValue(zlib.gzipSync(JSON.stringify({ service: 'other', tables: {} })));
  await expect(restoreBackup('backups/x.json.gz')).rejects.toThrow('not a time-service backup');
});
