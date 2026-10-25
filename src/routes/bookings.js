'use strict';
const express = require('express');
const { getDb } = require('../database');
const bookings = require('../services/bookings');
const payments = require('../services/payments');
const { notify } = require('../services/notify');
const { audit } = require('../services/audit');
const { validate, idParam } = require('../validators');
const { badRequest, conflict, forbidden } = require('../utils/errors');
const { requireAuth, requireRole } = require('../middleware/auth');
const { parseTime, formatTime } = require('../utils/time');
const { asyncHandler } = require('../utils/errors');

module.exports = function bookingRoutes() {
  const router = express.Router();
  router.use(requireAuth);

  router.post('/', requireRole('customer'), (req, res) => {
    const data = validate(req.body, {
      pandit_id: { type: 'int', min: 1, label: 'Pandit' },
      service_id: { type: 'int', required: true, min: 1, label: 'Service' },
      date: { type: 'string', required: true, max: 10, label: 'Date' },
      start_time: { type: 'string', required: true, max: 5, label: 'Time slot' },
      service_mode: { type: 'enum', values: ['in_person', 'online'], label: 'Mode' },
      location_text: { type: 'string', required: true, min: 3, max: 300, label: 'Ceremony location' },
      samagri_requirements: { type: 'string', max: 1000, default: '' },
      customer_notes: { type: 'string', max: 2000, default: '' },
    });
    const start = parseTime(data.start_time);
    if (start === null) throw badRequest('Choose a valid time slot.');
    const id = bookings.create(req.user, { ...data, start_min: start });
    res.status(201).json(bookings.serialize(bookings.detailRow(id), 'customer'));
  });

  // Bookings belonging to the logged-in user (customer: own requests; pandit: requests received).
  router.get('/my', (req, res) => {
    const status = req.query.status;
    const where = [];
    const params = [];
    if (req.user.role === 'customer') { where.push('b.customer_id = ?'); params.push(req.user.id); }
    else if (req.user.role === 'pandit' && req.pandit) { where.push('b.pandit_id = ?'); params.push(req.pandit.id); }
    else throw forbidden();
    if (status && bookings.STATUS_LABEL[status]) { where.push('b.status = ?'); params.push(status); }
    const rows = bookings.listRows(where.join(' AND '), params);
    res.json(rows.map((b) => bookings.serialize(b, req.user.role === 'pandit' ? 'pandit' : 'customer')));
  });

  router.get('/:id', (req, res) => {
    const b = bookings.detailRow(idParam(req.params.id));
    const role = bookings.accessRole(b, req.user);
    const db = getDb();
    const out = bookings.serialize(b, role);
    out.viewer_role = role;
    out.events = db.prepare(`SELECT e.event, e.from_status, e.to_status, e.note, e.created_at, u.name AS actor_name, u.role AS actor_role
      FROM booking_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.booking_id = ? ORDER BY e.id`).all(b.id);
    out.payments = db.prepare('SELECT id, provider, amount, currency, status, notes, created_at FROM payments WHERE booking_id = ? ORDER BY id').all(b.id);
    out.review = db.prepare('SELECT id, rating, comment, status, created_at FROM reviews WHERE booking_id = ?').get(b.id) || null;
    // Contact details are shared only between the two parties of an accepted/confirmed booking.
    if (['accepted', 'confirmed', 'completed'].includes(b.status) && role !== 'admin') {
      if (role === 'customer') {
        const p = db.prepare('SELECT u.phone, u.email, pp.preferred_contact FROM pandit_profiles pp JOIN users u ON u.id = pp.user_id WHERE pp.id = ?').get(b.pandit_id);
        out.contact = { preferred: p.preferred_contact, phone: p.preferred_contact === 'phone' ? p.phone : null, email: p.preferred_contact === 'email' ? p.email : null };
      } else {
        const c = db.prepare('SELECT phone, email FROM users WHERE id = ?').get(b.customer_id);
        out.contact = { phone: c.phone, email: c.email };
      }
    }
    res.json(out);
  });

  router.patch('/:id/status', requireRole('pandit', 'admin'), (req, res) => {
    const data = validate(req.body, {
      status: { type: 'enum', required: true, values: ['accepted', 'rejected', 'completed'], label: 'Status' },
      reason: { type: 'string', max: 500, default: '' },
    });
    if (data.status === 'rejected' && !data.reason) throw badRequest('Please give a reason for declining.');
    const id = idParam(req.params.id);
    bookings.changeStatus(req.user, id, data.status, data.reason);
    if (req.user.role === 'admin') audit(req, `booking.${data.status}`, 'booking', id, { reason: data.reason });
    res.json(bookings.serialize(bookings.detailRow(id), req.user.role));
  });

  router.post('/:id/confirm', requireRole('customer'), (req, res) => {
    const { payment_method: method } = validate(req.body, { payment_method: { type: 'enum', values: ['pay_later'], default: 'pay_later' } });
    const id = idParam(req.params.id);
    bookings.confirm(req.user, id, method);
    res.json(bookings.serialize(bookings.detailRow(id), 'customer'));
  });

  router.post('/:id/cancel', (req, res) => {
    const data = validate(req.body, {
      reason: { type: 'string', required: true, min: 3, max: 500, label: 'Reason' },
      confirm: { type: 'bool', required: true, label: 'Confirmation' },
    });
    if (!data.confirm) throw badRequest('Please confirm that you want to cancel this booking.');
    const id = idParam(req.params.id);
    const result = bookings.cancel(req.user, id, data.reason);
    if (req.user.role === 'admin') audit(req, 'booking.cancelled', 'booking', id, { reason: data.reason });
    res.json({ ...bookings.serialize(bookings.detailRow(id), req.user.role === 'admin' ? 'admin' : req.user.role), refund_required: result.refundNeeded });
  });

  router.post('/:id/reschedule', requireRole('customer'), (req, res) => {
    const data = validate(req.body, {
      date: { type: 'string', required: true, max: 10, label: 'New date' },
      start_time: { type: 'string', required: true, max: 5, label: 'New time' },
      note: { type: 'string', max: 500, default: '' },
    });
    const start = parseTime(data.start_time);
    if (start === null) throw badRequest('Choose a valid time slot.');
    const id = idParam(req.params.id);
    bookings.reschedule(req.user, id, data.date, start, data.note);
    res.json(bookings.serialize(bookings.detailRow(id), 'customer'));
  });

  // ---- Messages between customer and pandit ----
  router.get('/:id/messages', (req, res) => {
    const b = bookings.getRaw(idParam(req.params.id));
    bookings.accessRole(b, req.user);
    res.json(getDb().prepare(`SELECT m.id, m.body, m.created_at, m.sender_id, u.name AS sender_name, u.role AS sender_role
      FROM booking_messages m JOIN users u ON u.id = m.sender_id WHERE m.booking_id = ? ORDER BY m.id`).all(b.id));
  });

  router.post('/:id/messages', (req, res) => {
    const b = bookings.getRaw(idParam(req.params.id));
    const role = bookings.accessRole(b, req.user);
    if (role === 'admin') throw forbidden('Administrators cannot post in booking conversations.');
    if (['rejected', 'cancelled'].includes(b.status)) throw conflict('This booking is closed.');
    const { body } = validate(req.body, { body: { type: 'string', required: true, min: 1, max: 2000, label: 'Message' } });
    getDb().prepare('INSERT INTO booking_messages (booking_id, sender_id, body) VALUES (?, ?, ?)').run(b.id, req.user.id, body);
    const to = role === 'customer' ? b.pandit_user_id : b.customer_id;
    notify(to, 'booking_message', `New message on ${b.booking_ref}`, body.slice(0, 140), `/booking.html?id=${b.id}`);
    res.status(201).json({ ok: true });
  });

  // ---- Reviews ----
  router.post('/:id/review', requireRole('customer'), (req, res) => {
    const data = validate(req.body, {
      rating: { type: 'int', required: true, min: 1, max: 5, label: 'Rating' },
      comment: { type: 'string', max: 2000, default: '', label: 'Feedback' },
    });
    const db = getDb();
    const b = bookings.getRaw(idParam(req.params.id));
    if (bookings.accessRole(b, req.user) !== 'customer') throw forbidden();
    if (b.status !== 'completed') throw conflict('You can review a pandit only after the ceremony is completed.');
    try {
      db.prepare('INSERT INTO reviews (booking_id, customer_id, pandit_id, rating, comment) VALUES (?, ?, ?, ?, ?)')
        .run(b.id, req.user.id, b.pandit_id, data.rating, data.comment);
    } catch (err) {
      if (String(err.code).includes('CONSTRAINT_UNIQUE')) throw conflict('You have already reviewed this booking.');
      throw err;
    }
    notify(b.pandit_user_id, 'review_received', 'New review', `You received a ${data.rating}-star review for ${b.booking_ref}.`, '/pandit-dashboard.html#reviews');
    res.status(201).json({ ok: true });
  });

  // ---- Payments ----
  router.post('/:id/payments/razorpay-order', requireRole('customer'), asyncHandler(async (req, res) => {
    res.json(await payments.createRazorpayOrder(req.user, idParam(req.params.id)));
  }));

  router.post('/:id/payments/offline', requireRole('pandit'), (req, res) => {
    const id = idParam(req.params.id);
    const b = bookings.getRaw(id);
    const { amount } = validate(req.body, { amount: { type: 'int', min: 0, max: 10000000, default: b ? b.estimated_price : 0, label: 'Amount' } });
    payments.recordOffline(req.user, id, amount);
    res.json({ ok: true });
  });

  return router;
};

module.exports.formatTime = formatTime;
