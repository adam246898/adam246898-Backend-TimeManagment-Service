const express = require('express');
const helmet = require('helmet');
const config = require('./config');
const requestContext = require('./middleware/requestContext');
const cors = require('./middleware/cors');
const { rateLimit } = require('./middleware/rateLimit');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const routes = require('./routes');

const app = express();
app.disable('x-powered-by');
app.set('query parser', 'simple');
// Behind a load balancer, read the client IP from X-Forwarded-For; otherwise ignore that header,
// so nobody can dodge the rate limit by sending a fake one.
app.set('trust proxy', config.trustProxy ? 1 : false);

app.use(requestContext);
app.use(helmet());
app.use(cors);

// Health check for Docker and the load balancer: no data, no rate limit.
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'gateway' }));

app.use(rateLimit);
app.use(routes);
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
