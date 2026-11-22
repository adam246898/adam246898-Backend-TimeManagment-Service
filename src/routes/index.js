// URL + method -> controller. Nothing else happens here.
// The contract does not say whether the gateway removes the "/api" prefix, so the public routes
// answer on both paths: GET /api/dashboard and GET /dashboard. Internal routes only exist under
// /internal (never under /api).
const express = require('express');
const time = require('../controllers/time.controller');
const googleCtrl = require('../controllers/google.controller');
const admin = require('../controllers/admin.controller');
const internal = require('../controllers/internal.controller');
const { requireUser, requireAdmin } = require('../middleware/userContext');

const publicRouter = express.Router();

// Function 1-3: dashboard, monthly calendar, milestones (users only; admins get 403)
publicRouter.get('/dashboard', requireUser, time.dashboard);
publicRouter.get('/calendar', requireUser, time.calendar);
publicRouter.get('/milestones', requireUser, time.milestones);

// Shared: Google Calendar
publicRouter.get('/integrations/google/callback', googleCtrl.callback); // public: needs a valid one-time state
publicRouter.get('/integrations/google', requireUser, googleCtrl.status);
publicRouter.post('/integrations/google/connect', requireUser, googleCtrl.connect);
publicRouter.post('/integrations/google/sync', requireUser, googleCtrl.sync);
publicRouter.delete('/integrations/google', requireUser, googleCtrl.disconnect);

// Admin: platform totals only
publicRouter.get('/admin/analytics', requireAdmin, admin.analytics);

// Service to service only (the gateway answers 404 for /internal/* from outside)
const internalRouter = express.Router();
internalRouter.post('/reminders', internal.reminders);

module.exports = { publicRouter, internalRouter };
