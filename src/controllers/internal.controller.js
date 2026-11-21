const { validationError } = require('../utils/errors');
const { checkBodyKeys, checkQueryKeys, isUuid } = require('../utils/validate');
const googleService = require('../services/google.service');
const logger = require('../utils/logger');

// POST /internal/reminders { userId, habitId, action: "upsert" | "delete" }  (called by habits-service)
// Answers 202 at once and does the Google work afterwards, so a slow or failing Google Calendar
// never blocks creating or editing a habit. Failures are logged; the next sync repairs them.
exports.reminders = (req, res, next) => {
  try {
    checkQueryKeys(req.query, []);
    checkBodyKeys(req.body, ['userId', 'habitId', 'action']);
    const { userId, habitId, action } = req.body || {};
    const details = [];
    if (!isUuid(userId)) details.push({ field: 'userId', issue: 'Is required and must be a UUID.' });
    if (!isUuid(habitId)) details.push({ field: 'habitId', issue: 'Is required and must be a UUID.' });
    if (action !== 'upsert' && action !== 'delete') details.push({ field: 'action', issue: 'Must be upsert or delete.' });
    if (details.length) throw validationError(details);

    res.status(202).end();

    const job = { userId: userId.toLowerCase(), habitId: habitId.toLowerCase(), action };
    googleService
      .handleReminder(job, req.requestId)
      .then((result) => logger.info('reminder_processed', { requestId: req.requestId, userId: job.userId, action, result }))
      .catch((err) =>
        logger.warn('reminder_failed', { requestId: req.requestId, userId: job.userId, action, reason: err.code || err.name }),
      );
  } catch (err) {
    next(err);
  }
};
