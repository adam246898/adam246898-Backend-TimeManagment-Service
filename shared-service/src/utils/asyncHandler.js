// Express 4 does not catch errors from async functions. Wrap every async controller with this.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
