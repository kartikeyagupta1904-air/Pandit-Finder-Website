'use strict';
const { getDb } = require('../database');
const { unauthorized, forbidden } = require('../utils/errors');

/** Loads the logged-in user from the server-side session on every request. */
function loadUser(req, res, next) {
  req.user = null;
  const id = req.session?.userId;
  if (!id) return next();
  const user = getDb().prepare('SELECT id, role, name, email, phone, status, created_at FROM users WHERE id = ?').get(id);
  if (!user || user.status !== 'active') {
    // Suspended or deleted accounts lose their session immediately.
    return req.session.destroy(() => next());
  }
  req.user = user;
  if (user.role === 'pandit') {
    req.pandit = getDb().prepare('SELECT * FROM pandit_profiles WHERE user_id = ?').get(user.id) || null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** Pandit account with a profile row (any verification status). */
function requirePandit(req, res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'pandit' || !req.pandit) return next(forbidden('This page is for registered pandits.'));
  next();
}

module.exports = { loadUser, requireAuth, requireRole, requirePandit };
