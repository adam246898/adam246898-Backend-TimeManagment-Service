// URL + method -> controller. Nothing else happens here.
// The gateway removes the "/api" prefix, so GET /api/dashboard arrives here as GET /dashboard.
const router = require('express').Router();
const time = require('../controllers/time.controller');
const googleCtrl = require('../controllers/google.controller');
const admin = require('../controllers/admin.controller');
const internal = require('../controllers/internal.controller');
const { requireUser, requireAdmin } = require('../middleware/userContext');

// Function 1-3: dashboard, monthly calendar, milestones (users only; admins get 403)
router.get('/dashboard', requireUser, time.dashboard);
router.get('/calendar', requireUser, time.calendar);
router.get('/milestones', requireUser, time.milestones);

// Shared: Google Calendar
router.get('/integrations/google/callback', googleCtrl.callback); // public: needs a valid one-time state
router.get('/integrations/google', requireUser, googleCtrl.status);
router.post('/integrations/google/connect', requireUser, googleCtrl.connect);
router.post('/integrations/google/sync', requireUser, googleCtrl.sync);
router.delete('/integrations/google', requireUser, googleCtrl.disconnect);

// Admin: platform totals only
router.get('/admin/analytics', requireAdmin, admin.analytics);

// Service to service only (the gateway answers 404 for /internal/* from outside)
router.post('/internal/reminders', internal.reminders);

module.exports = router;
