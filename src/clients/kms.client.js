const { KMSClient, EncryptCommand, DecryptCommand } = require('@aws-sdk/client-kms');
const config = require('../config');
const { awsClientConfig } = require('../config/aws');

// Google refresh tokens are encrypted with AWS KMS before they are stored in time_google_links.
// The encryption context ties each ciphertext to one user: a token copied to another user's row
// cannot be decrypted.
let client;
const kms = () => client || (client = new KMSClient(awsClientConfig()));

const context = (userId) => ({ purpose: 'google-refresh-token', userId });

async function encrypt(plaintext, userId) {
  const out = await kms().send(
    new EncryptCommand({
      KeyId: config.kmsKeyId,
      Plaintext: Buffer.from(plaintext, 'utf8'),
      EncryptionContext: context(userId),
    }),
  );
  return Buffer.from(out.CiphertextBlob);
}

async function decrypt(ciphertext, userId) {
  const out = await kms().send(
    new DecryptCommand({ CiphertextBlob: ciphertext, EncryptionContext: context(userId) }),
  );
  return Buffer.from(out.Plaintext).toString('utf8');
}

module.exports = { encrypt, decrypt };
