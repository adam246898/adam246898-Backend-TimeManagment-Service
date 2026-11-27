// URL + method -> controller (contract 3.2: checked top to bottom, the first match wins).
const express = require('express');
const auth = require('../controllers/auth.controller');
const usersCtrl = require('../controllers/users.controller');
const admin = require('../controllers/admin.controller');
const proxyCtrl = require('../controllers/proxy.controller');
const { authenticate, requireRole } = require('../middleware/auth');
const { requireJson, json, raw } = require('../middleware/body');
const { notFound } = require('../utils/errors');

const router = express.Router();

// The gateway's own routes: JSON bodies only.
const own = express.Router();
own.use(requireJson, json);
own.post('/auth/signup', auth.signup); // public
own.post('/auth/login', auth.login); // public
own.post('/auth/logout', authenticate, auth.logout);
own.get('/users/me', authenticate, usersCtrl.me);
own.patch('/users/me', authenticate, usersCtrl.updateMe);
own.get('/admin/users', authenticate, requireRole('admin'), admin.listUsers);
own.patch('/admin/users/:id/status', authenticate, requireRole('admin'), admin.setStatus);
own.get('/admin/audit-logs', authenticate, requireRole('admin'), admin.auditLogs);

const ownPaths = /^\/api\/(auth|users)(\/|$)|^\/api\/admin\/(users|audit-logs)(\/|$)/;
router.use('/api', (req, res, next) => (ownPaths.test(req.originalUrl.split('?')[0]) ? own(req, res, next) : next()));

// Internal routes are never public.
router.use('/internal', (req, res, next) => next(notFound('Route not found.')));

// Everything else under /api goes to the owning service (the body is forwarded unchanged).
router.use('/api', raw, proxyCtrl.forward);

module.exports = router;
