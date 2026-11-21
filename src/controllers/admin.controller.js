const asyncHandler = require('../utils/asyncHandler');
const { validationError } = require('../utils/errors');
const { checkQueryKeys } = require('../utils/validate');
const analyticsService = require('../services/analytics.service');

exports.analytics = asyncHandler(async (req, res) => {
  checkQueryKeys(req.query, ['range']);
  const range = req.query.range === undefined ? '30d' : req.query.range;
  if (!['30d', '90d'].includes(range)) throw validationError([{ field: 'range', issue: 'Must be 30d or 90d.' }]);
  res.json(await analyticsService.getAnalytics(req.ctx, range));
});
