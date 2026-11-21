// Dashboard, calendar and milestones: validate the input, call the service, send the status code.
const asyncHandler = require('../utils/asyncHandler');
const { validationError } = require('../utils/errors');
const { checkQueryKeys, isUuid, CATEGORIES } = require('../utils/validate');
const { isValidMonth, monthIndex, todayIn } = require('../utils/dates');
const dashboardService = require('../services/dashboard.service');
const calendarService = require('../services/calendar.service');
const milestonesService = require('../services/milestones.service');

const MONTHS_BACK = 24;
const MONTHS_AHEAD = 12;

function parseRange(query) {
  const range = query.range === undefined ? '30d' : query.range;
  if (!dashboardService.RANGES.includes(range)) {
    throw validationError([{ field: 'range', issue: 'Must be 30d or 90d.' }]);
  }
  return range;
}

exports.dashboard = asyncHandler(async (req, res) => {
  checkQueryKeys(req.query, ['range']);
  const range = parseRange(req.query);
  res.json(await dashboardService.getDashboard(req.ctx, range));
});

exports.calendar = asyncHandler(async (req, res) => {
  checkQueryKeys(req.query, ['month', 'category', 'habitId']);
  const { month, category, habitId } = req.query;
  const details = [];

  if (month === undefined) {
    details.push({ field: 'month', issue: 'Is required, as YYYY-MM.' });
  } else if (!isValidMonth(month)) {
    details.push({ field: 'month', issue: 'Must be a month in the form YYYY-MM.' });
  } else {
    const current = todayIn(req.ctx.timezone).slice(0, 7);
    const offset = monthIndex(month) - monthIndex(current);
    if (offset < -MONTHS_BACK || offset > MONTHS_AHEAD) {
      details.push({ field: 'month', issue: `Must be from ${MONTHS_BACK} months ago to ${MONTHS_AHEAD} months ahead.` });
    }
  }
  if (category !== undefined && !CATEGORIES.includes(category)) {
    details.push({ field: 'category', issue: `Must be one of: ${CATEGORIES.join(', ')}.` });
  }
  if (habitId !== undefined && !isUuid(habitId)) {
    details.push({ field: 'habitId', issue: 'Must be a UUID.' });
  }
  if (details.length) throw validationError(details);

  res.json(
    await calendarService.getCalendar(req.ctx, {
      month,
      category: category || null,
      habitId: habitId ? habitId.toLowerCase() : null,
    }),
  );
});

exports.milestones = asyncHandler(async (req, res) => {
  checkQueryKeys(req.query, ['habitId']);
  const { habitId } = req.query;
  if (habitId !== undefined && !isUuid(habitId)) {
    throw validationError([{ field: 'habitId', issue: 'Must be a UUID.' }]);
  }
  res.json(await milestonesService.evaluate(req.ctx, { habitId: habitId ? habitId.toLowerCase() : null }));
});
