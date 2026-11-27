// Restores service-c's tables from S3. Rows that still exist are kept; only missing rows come back.
//   npm run restore                                   the newest backup
//   npm run restore -- backups/2026-11-27/<file>.json.gz   one chosen backup
//   npm run restore -- --list                         show the backups
const backup = require('../src/services/backup.service');
const s3 = require('../src/clients/s3.client');
const db = require('../src/config/db');

async function main() {
  const arg = process.argv[2];
  if (arg === '--list') {
    for (const b of await s3.listBackups()) console.log(`${new Date(b.lastModified).toISOString()}  ${b.size} bytes  ${b.key}`);
    return;
  }
  const r = await backup.restoreBackup(arg);
  console.log(`Restored from ${r.key} (made ${r.createdAt})`);
  console.log(`  rows put back: ${JSON.stringify(r.restored)}`);
}

main()
  .catch((err) => {
    console.error(`Restore failed: ${err.name}: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
