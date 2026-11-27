const express = require('express');
const { unsupportedMediaType } = require('../utils/errors');

const hasBody = (req) => Number(req.get('Content-Length') || 0) > 0 || req.get('Transfer-Encoding') !== undefined;

// Contract 3.4: a body that is not JSON gets 415, a body over 10 KB gets 413.
function requireJson(req, res, next) {
  if (hasBody(req) && !req.is('application/json')) return next(unsupportedMediaType());
  return next();
}

// For the gateway's own routes: parsed JSON.
const json = express.json({ limit: '10kb', strict: true });

// For forwarded routes: the raw bytes, passed on unchanged (the service validates them).
const raw = express.raw({ type: () => true, limit: '10kb' });

module.exports = { requireJson, json, raw };
