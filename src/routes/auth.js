'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { validate, PASSWORD_RULE, checkPasswordStrength } = require('../validators');
const { asyncHandler, badRequest, conflict, unauthorized, HttpError } = require('../utils/errors');
const { requireAuth } = require('../middleware/auth');
const { ensureToken } = require('../middleware/csrf');
const { audit } = require('../services/audit');

const BCRYPT_ROUNDS = 12;
// Used to keep login timing similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', BCRYPT_ROUNDS);

function publicUser(u) {
  return { id: u.id, role: u.role, name: u.name, email: u.email, phone: u.phone, created_at: u.created_at };
}

/** Regenerates the session on login to prevent session fixation. */
function startSession(req, userId) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      ensureToken(req);
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}

module.exports = function authRoutes({ authLimiter }) {
  const router = express.Router();

  router.get('/csrf', (req, res) => {
    res.json({ csrfToken: ensureToken(req) });
  });

  router.get('/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    const db = getDb();
    const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).n;
    const out = { user: publicUser(req.user), unread_notifications: unread };
    if (req.user.role === 'customer') {
      out.profile = db.prepare('SELECT city, preferred_language FROM customer_profiles WHERE user_id = ?').get(req.user.id) || {};
    }
    if (req.pandit) {
      out.pandit = { id: req.pandit.id, verification_status: req.pandit.verification_status };
    }
    res.json(out);
  });

  // Public registration creates CUSTOMER accounts only. Role is never taken from the request body.
  router.post('/register', authLimiter, asyncHandler(async (req, res) => {
    const data = validate(req.body, {
      name: { type: 'string', required: true, min: 2, max: 100, label: 'Name' },
      email: { type: 'email', required: true, max: 254, label: 'Email' },
      password: PASSWORD_RULE,
      phone: { type: 'phone', label: 'Phone' },
      city: { type: 'string', max: 80, label: 'City' },
    });
    checkPasswordStrength(data.password);
    const db = getDb();
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(data.email)) {
      throw conflict('An account with this email already exists. Try logging in.');
    }
    const hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const id = db.transaction(() => {
      const info = db.prepare("INSERT INTO users (role, name, email, password_hash, phone) VALUES ('customer', ?, ?, ?, ?)")
        .run(data.name, data.email, hash, data.phone || null);
      db.prepare('INSERT INTO customer_profiles (user_id, city) VALUES (?, ?)').run(info.lastInsertRowid, data.city || null);
      return Number(info.lastInsertRowid);
    })();
    await startSession(req, id);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    res.status(201).json({ user: publicUser(user), csrfToken: req.session.csrfToken });
  }));

  router.post('/login', authLimiter, asyncHandler(async (req, res) => {
    const data = validate(req.body, {
      email: { type: 'email', required: true, label: 'Email' },
      password: { type: 'string', required: true, max: 128, label: 'Password' },
    });
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(data.email);
    const ok = await bcrypt.compare(data.password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Incorrect email or password.');
    if (user.status !== 'active') throw new HttpError(403, 'This account has been suspended. Please contact support.');
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
    await startSession(req, user.id);
    if (user.role === 'admin') audit({ user, ip: req.ip }, 'admin.login', 'user', user.id);
    res.json({ user: publicUser(user), csrfToken: req.session.csrfToken });
  }));

  router.post('/logout', (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie('pf.sid');
      res.json({ ok: true });
    });
  });

  router.put('/profile', requireAuth, (req, res) => {
    const data = validate(req.body, {
      name: { type: 'string', required: true, min: 2, max: 100, label: 'Name' },
      phone: { type: 'phone', label: 'Phone' },
      city: { type: 'string', max: 80, label: 'City' },
      preferred_language: { type: 'string', max: 40, label: 'Preferred language' },
    });
    const db = getDb();
    db.prepare("UPDATE users SET name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?").run(data.name, data.phone || null, req.user.id);
    if (req.user.role === 'customer') {
      db.prepare(`INSERT INTO customer_profiles (user_id, city, preferred_language) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET city = excluded.city, preferred_language = excluded.preferred_language, updated_at = datetime('now')`)
        .run(req.user.id, data.city || null, data.preferred_language || null);
    }
    res.json({ ok: true });
  });

  router.post('/change-password', requireAuth, authLimiter, asyncHandler(async (req, res) => {
    const data = validate(req.body, {
      current_password: { type: 'string', required: true, max: 128, label: 'Current password' },
      new_password: { ...PASSWORD_RULE, label: 'New password' },
    });
    checkPasswordStrength(data.new_password);
    const db = getDb();
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await bcrypt.compare(data.current_password, row.password_hash))) throw badRequest('Current password is incorrect.', { current_password: 'Incorrect password.' });
    if (data.current_password === data.new_password) throw badRequest('Choose a password different from the current one.');
    const hash = await bcrypt.hash(data.new_password, BCRYPT_ROUNDS);
    db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(hash, req.user.id);
    // Sign out other devices.
    db.prepare("DELETE FROM sessions WHERE sid <> ? AND json_extract(sess, '$.userId') = ?").run(req.sessionID, req.user.id);
    audit(req, 'user.password_changed', 'user', req.user.id);
    res.json({ ok: true });
  }));

  return router;
};

module.exports.startSession = startSession;
module.exports.publicUser = publicUser;
module.exports.BCRYPT_ROUNDS = BCRYPT_ROUNDS;
