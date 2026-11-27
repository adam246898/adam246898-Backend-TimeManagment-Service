const config = require('../config');
const cloudwatch = require('../config/cloudwatch');

// One JSON object per line, so CloudWatch can filter on fields such as $.statusCode.
// NEVER pass passwords, tokens, secrets or the Authorization header in `fields`.
function write(level, event, fields = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, service: config.serviceName, event, ...fields });
  if (process.env.NODE_ENV !== 'test') console.log(line);
  cloudwatch.push(line);
}

module.exports = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
};
