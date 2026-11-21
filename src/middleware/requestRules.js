const express = require('express');
const { unsupportedMediaType } = require('../utils/errors');

const hasBody = (req) =>
  Number(req.get('Content-Length') || 0) > 0 || req.get('Transfer-Encoding') !== undefined;

// A body that is not JSON gets 415 (contract 3.4).
function requireJsonBody(req, res, next) {
  if (hasBody(req) && !req.is('application/json')) return next(unsupportedMediaType());
  return next();
}

// Bodies larger than 10 KB are refused (413) by the JSON parser; see the error handler.
const jsonParser = express.json({ limit: '10kb', strict: true });

module.exports = { requireJsonBody, jsonParser };
