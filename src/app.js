const express = require('express');
const helmet = require('helmet');
const requestContext = require('./middleware/requestContext');
const requireInternalToken = require('./middleware/internalToken');
const { userContext } = require('./middleware/userContext');
const { requireJsonBody, jsonParser } = require('./middleware/requestRules');
const { notFoundHandler, errorHandler } = require('./middleware/error');
const { publicRouter, internalRouter } = require('./routes');

const app = express();
app.disable('x-powered-by');
app.set('query parser', 'simple'); // ?a[b]=1 stays a plain string, never a nested object
app.use(helmet());
app.use(requestContext);

// Health check for Docker and the load balancer. It returns no data, so it needs no token.
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'time-service' }));

app.use(requireInternalToken); // every other request must come from the gateway or a service
app.use(requireJsonBody); // 415 for non-JSON bodies
app.use(jsonParser); // 413 above 10 KB
app.use(userContext); // X-User-Id, X-User-Role, X-User-Timezone from the gateway
app.use('/internal', internalRouter);
app.use('/api', publicRouter); // if the gateway forwards the full path
app.use(publicRouter); // if the gateway removes "/api"

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
