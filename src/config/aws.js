const config = require('./index');

// Same settings for every AWS SDK client. With Floci the endpoint is http://localhost:4566
// (or http://floci:4566 inside Docker). On real AWS the endpoint is left empty.
function awsClientConfig() {
  const options = { region: config.aws.region };
  if (config.aws.endpoint) options.endpoint = config.aws.endpoint;
  return options;
}

module.exports = { awsClientConfig };
