// Amazon S3: the private, KMS-encrypted bucket that holds service-c's backups (created by setup-aws.sh).
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const config = require('../config');
const { awsClientConfig } = require('../config/aws');

let client;
// Floci serves buckets on paths (http://localhost:4566/<bucket>), like most local S3 emulators.
const s3 = () => client || (client = new S3Client({ ...awsClientConfig(), forcePathStyle: Boolean(config.aws.endpoint) }));

// Every backup is encrypted with KMS (the bucket's default key is service-c's own key).
async function putBackup(key, body) {
  const out = await s3().send(
    new PutObjectCommand({
      Bucket: config.backupBucket,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
      ServerSideEncryption: 'aws:kms',
    }),
  );
  return { versionId: out.VersionId || null, encryption: out.ServerSideEncryption || null };
}

async function getBackup(key) {
  const out = await s3().send(new GetObjectCommand({ Bucket: config.backupBucket, Key: key }));
  return Buffer.from(await out.Body.transformToByteArray());
}

// All backup keys, newest first.
async function listBackups() {
  const keys = [];
  let token;
  do {
    const out = await s3().send(
      new ListObjectsV2Command({ Bucket: config.backupBucket, Prefix: 'backups/', ContinuationToken: token }),
    );
    for (const o of out.Contents || []) keys.push({ key: o.Key, lastModified: o.LastModified, size: o.Size });
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
}

module.exports = { putBackup, getBackup, listBackups };
