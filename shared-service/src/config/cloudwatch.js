const os = require('os');
const config = require('./index');

// Sends log lines to the CloudWatch log group named in CLOUDWATCH_LOG_GROUP (created by
// scripts/setup-aws.sh). If the variable is empty, this does nothing and logs only go to the console.
// Lines are buffered and sent every 2 seconds. A CloudWatch failure never breaks a request.

let buffer = [];
let client;
let commands;
let streamName;
let streamReady = false;

function start() {
  if (!config.logGroup || client) return;
  const logs = require('@aws-sdk/client-cloudwatch-logs');
  const { awsClientConfig } = require('./aws');
  commands = logs;
  client = new logs.CloudWatchLogsClient(awsClientConfig());
  streamName = `${os.hostname()}-${Date.now()}`;
  setInterval(flush, 2000).unref();
}

async function ensureStream() {
  if (streamReady) return;
  try {
    await client.send(
      new commands.CreateLogStreamCommand({ logGroupName: config.logGroup, logStreamName: streamName }),
    );
  } catch (err) {
    if (err.name !== 'ResourceAlreadyExistsException') throw err;
  }
  streamReady = true;
}

async function flush() {
  if (!client || buffer.length === 0) return;
  const batch = buffer.splice(0, 500);
  try {
    await ensureStream();
    await client.send(
      new commands.PutLogEventsCommand({
        logGroupName: config.logGroup,
        logStreamName: streamName,
        logEvents: batch,
      }),
    );
  } catch (err) {
    console.error(`CloudWatch logging failed: ${err.name}`);
  }
}

function push(message) {
  if (!client) return;
  if (buffer.length < 10000) buffer.push({ timestamp: Date.now(), message });
}

module.exports = { start, push, flush };
