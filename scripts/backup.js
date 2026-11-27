// Backs up service-c's tables to the encrypted S3 bucket.   npm run backup
// On the EC2 server, run it every night with cron, for example:
//   0 2 * * *  cd /opt/time-service && npm run backup >> /var/log/time-service-backup.log 2>&1
const backup = require('../src/services/backup.service');
const db = require('../src/config/db');

backup
  .createBackup()
  .then((r) => {
    console.log(`Backup stored: s3://${require('../src/config').backupBucket}/${r.key}`);
    console.log(`  ${r.bytes} bytes, encryption: ${r.encryption}, version: ${r.versionId}`);
    console.log(`  rows: ${JSON.stringify(r.counts)}`);
  })
  .catch((err) => {
    console.error(`Backup failed: ${err.name}: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.end());
