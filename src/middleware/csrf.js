'use strict';
const crypto = require('crypto');
const { HttpError } = require('../utils/errors');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function ensureToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

/**
 * Synchroniser-token CSRF protection: every state-changing API request must
 * send the session's token in the X-CSRF-Token header.
 */
function csrfProtection(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const sent = req.get('x-csrf-token') || '';
  const expected = req.session?.csrfToken || '';
  const ok = sent.length === expected.length && expected.length > 0
    && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (!ok) return next(new HttpError(403, 'Your session has expired. Please refresh the page and try again.'));
  next();
}

module.exports = { csrfProtection, ensureToken };
