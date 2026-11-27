// Backup and restore of service-c's own tables to Amazon S3 (report section 15: recovery approach).
// Only time_* tables: service-c never touches the other services' data.
const zlib = require('zlib');
const db = require('../config/db');
const s3 = require('../clients/s3.client');

// Restore order matters: time_google_events refers to time_google_links.
// time_oauth_states is left out on purpose: its rows only live 10 minutes.
const TABLES = [
  { name: 'time_milestones', key: 'id' },
  { name: 'time_google_links', key: 'user_id' },
  { name: 'time_google_events', key: 'id' },
];

// JSON cannot hold raw bytes, so bytea columns (the KMS-encrypted refresh token) become { $bytes: base64 }.
const encodeValue = (v) => (Buffer.isBuffer(v) ? { $bytes: v.toString('base64') } : v);
const decodeValue = (v) => (v && typeof v === 'object' && typeof v.$bytes === 'string' ? Buffer.from(v.$bytes, 'base64') : v);

async function createBackup(now = new Date()) {
  const tables = {};
  for (const t of TABLES) {
    const { rows } = await db.query(`SELECT * FROM ${t.name} ORDER BY ${t.key}`);
    tables[t.name] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, encodeValue(v)])));
  }
  const body = zlib.gzipSync(JSON.stringify({ service: 'time-service', createdAt: now.toISOString(), tables }));
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const key = `backups/${now.toISOString().slice(0, 10)}/time-tables-${stamp}.json.gz`;
  const stored = await s3.putBackup(key, body);
  const counts = Object.fromEntries(TABLES.map((t) => [t.name, tables[t.name].length]));
  return { key, bytes: body.length, counts, ...stored };
}

// Puts back every row that is missing. Rows that still exist are left as they are (ON CONFLICT DO NOTHING),
// so a restore never overwrites newer data. Runs in one transaction: all or nothing.
async function restoreBackup(key) {
  const chosen = key || (await s3.listBackups())[0]?.key;
  if (!chosen) throw new Error('No backup found in the bucket.');
  const backup = JSON.parse(zlib.gunzipSync(await s3.getBackup(chosen)).toString('utf8'));
  if (backup.service !== 'time-service') throw new Error('This file is not a time-service backup.');

  const restored = {};
  await db.transaction(async (client) => {
    for (const t of TABLES) {
      let count = 0;
      for (const row of backup.tables[t.name] || []) {
        const columns = Object.keys(row);
        if (!columns.every((c) => /^[a-z_]+$/.test(c))) throw new Error('Unexpected column name in backup.');
        const values = columns.map((c) => decodeValue(row[c]));
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const out = await client.query(
          `INSERT INTO ${t.name} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
          values,
        );
        count += out.rowCount;
      }
      restored[t.name] = count;
    }
  });
  return { key: chosen, createdAt: backup.createdAt, restored };
}

module.exports = { createBackup, restoreBackup, TABLES };
