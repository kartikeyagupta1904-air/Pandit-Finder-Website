'use strict';
// Notifications, favourites, complaints/reports and payment verification for logged-in users.
const express = require('express');
const { getDb } = require('../database');
const pandits = require('../services/pandits');
const payments = require('../services/payments');
const bookings = require('../services/bookings');
const { notify } = require('../services/notify');
const { validate, idParam } = require('../validators');
const { badRequest, notFound } = require('../utils/errors');
const { requireAuth, requireRole } = require('../middleware/auth');

module.exports = function accountRoutes() {
  const router = express.Router();

  // ---- Notifications ----
  router.get('/notifications', requireAuth, (req, res) => {
    const db = getDb();
    const items = db.prepare('SELECT id, type, title, body, link, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
    const unread = db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).n;
    res.json({ unread, items });
  });

  router.post('/notifications/read-all', requireAuth, (req, res) => {
    getDb().prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });

  router.post('/notifications/:id/read', requireAuth, (req, res) => {
    getDb().prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?').run(idParam(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  // ---- Favourites (customers) ----
  router.get('/favourites', requireRole('customer'), (req, res) => {
    const ids = getDb().prepare('SELECT pandit_id FROM favourites WHERE customer_id = ? ORDER BY created_at DESC').all(req.user.id).map((r) => r.pandit_id);
    res.json(ids.map((id) => pandits.publicProfile(id)).filter(Boolean).map(({ services, ...card }) => card));
  });

  router.post('/favourites/:panditId', requireRole('customer'), (req, res) => {
    const id = idParam(req.params.panditId);
    if (!pandits.isPublic(id)) throw notFound('Pandit not found.');
    getDb().prepare('INSERT OR IGNORE INTO favourites (customer_id, pandit_id) VALUES (?, ?)').run(req.user.id, id);
    res.status(201).json({ ok: true });
  });

  router.delete('/favourites/:panditId', requireRole('customer'), (req, res) => {
    getDb().prepare('DELETE FROM favourites WHERE customer_id = ? AND pandit_id = ?').run(req.user.id, idParam(req.params.panditId));
    res.json({ ok: true });
  });

  // ---- Complaints & profile reports ----
  router.post('/complaints', requireAuth, (req, res) => {
    const data = validate(req.body, {
      kind: { type: 'enum', required: true, values: ['profile_report', 'complaint'] },
      pandit_id: { type: 'int', min: 1 },
      booking_id: { type: 'int', min: 1 },
      subject: { type: 'string', required: true, min: 3, max: 150, label: 'Subject' },
      details: { type: 'string', required: true, min: 10, max: 3000, label: 'Details' },
    });
    const db = getDb();
    if (data.kind === 'profile_report' && !data.pandit_id) throw badRequest('Choose the profile you are reporting.');
    if (data.pandit_id && !db.prepare('SELECT 1 FROM pandit_profiles WHERE id = ?').get(data.pandit_id)) throw notFound('Pandit not found.');
    if (data.booking_id) {
      const b = bookings.getRaw(data.booking_id);
      bookings.accessRole(b, req.user); // must be a party to the booking
    }
    const info = db.prepare('INSERT INTO complaints (reporter_id, kind, pandit_id, booking_id, subject, details) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, data.kind, data.pandit_id || null, data.booking_id || null, data.subject, data.details);
    for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all()) {
      notify(a.id, 'complaint', data.kind === 'profile_report' ? 'Profile reported' : 'New complaint', data.subject, '/admin.html#complaints');
    }
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  router.get('/complaints/my', requireAuth, (req, res) => {
    res.json(getDb().prepare('SELECT id, kind, subject, status, admin_note, created_at FROM complaints WHERE reporter_id = ? ORDER BY id DESC').all(req.user.id));
  });

  // ---- Online payment verification (server-side HMAC check) ----
  router.post('/payments/razorpay/verify', requireRole('customer'), (req, res) => {
    const data = validate(req.body, {
      order_id: { type: 'string', required: true, max: 100 },
      payment_id: { type: 'string', required: true, max: 100 },
      signature: { type: 'string', required: true, max: 200 },
    });
    res.json(payments.verifyRazorpayPayment(req.user, data));
  });

  return router;
};
