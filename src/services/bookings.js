'use strict';
const crypto = require('crypto');
const { getDb } = require('../database');
const availability = require('./availability');
const settings = require('./settings');
const { notify } = require('./notify');
const { formatTime, hoursUntil } = require('../utils/time');
const { badRequest, conflict, forbidden, notFound } = require('../utils/errors');

const STATUS_LABEL = {
  pending: 'Pending', accepted: 'Accepted', rejected: 'Rejected',
  confirmed: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled',
};

function newRef() {
  return `PF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/** Server-side price computation — never trust a price from the browser. */
function priceFor(service, mode) {
  const travel = mode === 'in_person' && service.travel_charges_apply ? service.travel_charge : 0;
  return {
    total: service.price + travel,
    breakdown: { service_price: service.price, travel_charge: travel, samagri_included: !!service.samagri_included },
  };
}

function logEvent(bookingId, actorId, event, from, to, note = '') {
  getDb().prepare('INSERT INTO booking_events (booking_id, actor_id, event, from_status, to_status, note) VALUES (?, ?, ?, ?, ?, ?)')
    .run(bookingId, actorId, event, from, to, note);
}

function getRaw(id) {
  return getDb().prepare(
    `SELECT b.*, pp.user_id AS pandit_user_id FROM bookings b JOIN pandit_profiles pp ON pp.id = b.pandit_id WHERE b.id = ?`
  ).get(id);
}

/** Returns which side of the booking the user is on, or throws if they have no access. */
function accessRole(booking, user) {
  if (!booking) throw notFound('Booking not found.');
  if (user.role === 'admin') return 'admin';
  if (user.role === 'customer' && booking.customer_id === user.id) return 'customer';
  if (user.role === 'pandit' && booking.pandit_user_id === user.id) return 'pandit';
  // 404 rather than 403 so booking IDs cannot be probed.
  throw notFound('Booking not found.');
}

function serialize(b, viewerRole) {
  const out = {
    id: b.id,
    booking_ref: b.booking_ref,
    customer_id: b.customer_id,
    pandit_id: b.pandit_id,
    service_id: b.service_id,
    ceremony_type: b.ceremony_type,
    date: b.date,
    start_time: formatTime(b.start_min),
    end_time: formatTime(b.end_min),
    service_mode: b.service_mode,
    location_text: b.location_text,
    estimated_price: b.estimated_price,
    price_breakdown: JSON.parse(b.price_breakdown || '{}'),
    samagri_requirements: b.samagri_requirements,
    customer_notes: b.customer_notes,
    status: b.status,
    status_label: STATUS_LABEL[b.status],
    status_reason: b.status_reason,
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
  if (b.pandit_name !== undefined) out.pandit_name = b.pandit_name;
  if (b.service_name !== undefined) out.service_name = b.service_name;
  if (b.pandit_photo !== undefined) out.pandit_photo_url = b.pandit_photo ? `/uploads/photos/${b.pandit_photo}` : null;
  if (b.customer_name !== undefined) out.customer_name = b.customer_name;
  if (b.has_review !== undefined) out.has_review = !!b.has_review;
  if (b.payment_status !== undefined) out.payment_status = b.payment_status;
  if (viewerRole) out.permissions = permissions(b, viewerRole);
  return out;
}

/** What the viewer may do next — mirrors the checks enforced in the transitions below. */
function permissions(b, role) {
  const cutoff = settings.getInt('cancellation_hours');
  const hrs = hoursUntil(b.date, b.start_min);
  const p = { accept: false, reject: false, confirm: false, complete: false, cancel: false, reschedule: false, review: false, record_payment: false };
  if (role === 'pandit' || role === 'admin') {
    p.accept = b.status === 'pending' && hrs > 0;
    p.reject = b.status === 'pending';
    p.complete = (b.status === 'confirmed' || b.status === 'accepted') && hrs <= 0;
    p.cancel = ['pending', 'accepted', 'confirmed'].includes(b.status) && (role === 'admin' || hrs > 0);
    p.record_payment = role === 'pandit' && ['confirmed', 'completed'].includes(b.status) && b.payment_status !== 'successful';
  }
  if (role === 'customer') {
    p.confirm = b.status === 'accepted' && hrs > 0;
    p.cancel = b.status === 'pending' || (['accepted', 'confirmed'].includes(b.status) && hrs >= cutoff);
    p.reschedule = ['pending', 'accepted', 'confirmed'].includes(b.status) && hrs >= cutoff;
    p.review = b.status === 'completed' && b.has_review === 0;
  }
  return p;
}

const DETAIL_SQL = `SELECT b.*, pp.user_id AS pandit_user_id, pu.name AS pandit_name, pp.photo_path AS pandit_photo,
    s.name AS service_name, cu.name AS customer_name,
    (SELECT COUNT(*) FROM reviews r WHERE r.booking_id = b.id) AS has_review,
    (SELECT status FROM payments pay WHERE pay.booking_id = b.id ORDER BY pay.id DESC LIMIT 1) AS payment_status
  FROM bookings b
  JOIN pandit_profiles pp ON pp.id = b.pandit_id
  JOIN users pu ON pu.id = pp.user_id
  JOIN users cu ON cu.id = b.customer_id
  JOIN pandit_services s ON s.id = b.service_id`;

function detailRow(id) {
  return getDb().prepare(`${DETAIL_SQL} WHERE b.id = ?`).get(id);
}

function listRows(whereSql, params, order = 'b.date DESC, b.start_min DESC') {
  return getDb().prepare(`${DETAIL_SQL} WHERE ${whereSql} ORDER BY ${order}`).all(...params);
}

/**
 * Creates a booking request. Validation and insert run inside an IMMEDIATE
 * transaction so concurrent requests are serialised by SQLite.
 */
function create(customer, input) {
  const db = getDb();
  const service = db.prepare(
    `SELECT s.*, c.name AS category_name FROM pandit_services s JOIN puja_categories c ON c.id = s.category_id
     JOIN pandit_profiles p ON p.id = s.pandit_id JOIN users u ON u.id = p.user_id
     WHERE s.id = ? AND s.is_active = 1 AND p.verification_status = 'approved' AND u.status = 'active'`
  ).get(input.service_id);
  if (!service) throw badRequest('This service is not available for booking.');
  if (input.pandit_id && input.pandit_id !== service.pandit_id) throw badRequest('Service does not belong to this pandit.');

  let mode = input.service_mode || (service.mode === 'online' ? 'online' : 'in_person');
  if (service.mode !== 'both' && mode !== service.mode) throw badRequest(`This service is offered ${service.mode === 'online' ? 'online only' : 'in person only'}.`);

  const start = input.start_min;
  const end = start + service.duration_minutes;
  if (end > 1440) throw badRequest('The ceremony must finish on the same day.');

  const price = priceFor(service, mode);
  const tx = db.transaction(() => {
    const problem = availability.slotProblem(service.pandit_id, input.date, start, service.duration_minutes);
    if (problem) throw conflict(problem);
    let ref = newRef();
    while (db.prepare('SELECT 1 FROM bookings WHERE booking_ref = ?').get(ref)) ref = newRef();
    const info = db.prepare(
      `INSERT INTO bookings (booking_ref, customer_id, pandit_id, service_id, category_id, ceremony_type, date, start_min, end_min,
        service_mode, location_text, estimated_price, price_breakdown, samagri_requirements, customer_notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(ref, customer.id, service.pandit_id, service.id, service.category_id, service.category_name, input.date, start, end,
      mode, input.location_text, price.total, JSON.stringify(price.breakdown), input.samagri_requirements || '', input.customer_notes || '');
    const id = Number(info.lastInsertRowid);
    logEvent(id, customer.id, 'created', null, 'pending', 'Booking request submitted');
    const panditUser = db.prepare('SELECT user_id FROM pandit_profiles WHERE id = ?').get(service.pandit_id);
    notify(panditUser.user_id, 'booking_request', 'New booking request',
      `${customer.name} requested ${service.name} on ${input.date} at ${formatTime(start)}.`, `/booking.html?id=${id}`);
    return id;
  });
  return tx.immediate();
}

/**
 * Pandit/admin status changes: accept, reject, complete.
 */
function changeStatus(user, bookingId, next, reason = '') {
  const db = getDb();
  const tx = db.transaction(() => {
    const b = getRaw(bookingId);
    const role = accessRole(b, user);
    if (role === 'customer') throw forbidden('Customers cannot change booking status directly.');
    const hrs = hoursUntil(b.date, b.start_min);

    if (next === 'accepted') {
      if (b.status !== 'pending') throw conflict(`Only pending requests can be accepted (current: ${STATUS_LABEL[b.status]}).`);
      if (hrs <= 0) throw conflict('This ceremony time has already passed.');
      const clash = db.prepare(
        `SELECT 1 FROM bookings WHERE pandit_id = ? AND date = ? AND id <> ? AND status IN ('accepted','confirmed')
         AND start_min < ? AND ? < end_min`
      ).get(b.pandit_id, b.date, b.id, b.end_min, b.start_min);
      if (clash) throw conflict('You already have an accepted or confirmed booking at this time.');
      if (availability.isBlocked(b.pandit_id, b.date)) throw conflict('This date is blocked in your calendar. Unblock it first.');
    } else if (next === 'rejected') {
      if (b.status !== 'pending') throw conflict('Only pending requests can be rejected.');
    } else if (next === 'completed') {
      if (!['accepted', 'confirmed'].includes(b.status)) throw conflict('Only accepted or confirmed bookings can be completed.');
      if (hrs > 0) throw conflict('A ceremony can be marked completed only after its start time.');
    } else {
      throw badRequest('Unsupported status change.');
    }

    try {
      db.prepare("UPDATE bookings SET status = ?, status_reason = ?, updated_at = datetime('now') WHERE id = ?")
        .run(next, reason || null, b.id);
    } catch (err) {
      if (String(err.message).includes('BOOKING_OVERLAP')) throw conflict('This time overlaps another accepted booking.');
      throw err;
    }
    logEvent(b.id, user.id, next, b.status, next, reason);

    const messages = {
      accepted: ['booking_accepted', 'Booking accepted', `Your booking ${b.booking_ref} was accepted. Please confirm it from your dashboard.`],
      rejected: ['booking_rejected', 'Booking request declined', `Your booking ${b.booking_ref} was declined.${reason ? ` Reason: ${reason}` : ''}`],
      completed: ['booking_completed', 'Ceremony completed', `Booking ${b.booking_ref} is marked completed. You can now leave a review.`],
    };
    const [type, title, body] = messages[next];
    notify(b.customer_id, type, title, body, `/booking.html?id=${b.id}`);

    // Keep availability consistent: overlapping pending requests can no longer be fulfilled.
    if (next === 'accepted') {
      const overlapping = db.prepare(
        `SELECT id, customer_id, booking_ref FROM bookings WHERE pandit_id = ? AND date = ? AND id <> ? AND status = 'pending'
         AND start_min < ? AND ? < end_min`
      ).all(b.pandit_id, b.date, b.id, b.end_min, b.start_min);
      for (const o of overlapping) {
        db.prepare("UPDATE bookings SET status = 'rejected', status_reason = ?, updated_at = datetime('now') WHERE id = ?")
          .run('The pandit is no longer available at this time.', o.id);
        logEvent(o.id, null, 'auto_rejected', 'pending', 'rejected', 'Slot taken by another accepted booking');
        notify(o.customer_id, 'booking_rejected', 'Time slot no longer available',
          `Booking ${o.booking_ref} could not be accepted because the slot was taken. Please choose another time.`, `/booking.html?id=${o.id}`);
      }
    }
  });
  tx.immediate();
}

/** Customer confirms an accepted booking (pay later). Online payments confirm via the payment service. */
function confirm(user, bookingId, paymentMethod) {
  const db = getDb();
  const tx = db.transaction(() => {
    const b = getRaw(bookingId);
    const role = accessRole(b, user);
    if (role !== 'customer') throw forbidden('Only the customer can confirm this booking.');
    if (b.status !== 'accepted') throw conflict('Only accepted bookings can be confirmed.');
    if (hoursUntil(b.date, b.start_min) <= 0) throw conflict('This ceremony time has already passed.');
    // A booking already paid online (e.g. before a reschedule) needs no new payment.
    const paid = db.prepare("SELECT 1 FROM payments WHERE booking_id = ? AND status = 'successful'").get(b.id);
    if (!paid && paymentMethod !== 'pay_later') throw badRequest('Unsupported payment method.');
    db.prepare("UPDATE bookings SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?").run(b.id);
    if (!paid) {
      db.prepare("INSERT INTO payments (booking_id, provider, amount, status, notes) VALUES (?, 'pay_later', ?, 'pending', 'Pay the pandit directly after the ceremony')")
        .run(b.id, b.estimated_price);
    }
    logEvent(b.id, user.id, 'confirmed', 'accepted', 'confirmed', paid ? 'Confirmed (already paid online)' : 'Confirmed with pay-later');
    notify(b.pandit_user_id, 'booking_confirmed', 'Booking confirmed', `Customer confirmed booking ${b.booking_ref} for ${b.date}.`, `/booking.html?id=${b.id}`);
  });
  tx.immediate();
}

function cancel(user, bookingId, reason) {
  const db = getDb();
  const tx = db.transaction(() => {
    const b = getRaw(bookingId);
    const role = accessRole(b, user);
    if (!['pending', 'accepted', 'confirmed'].includes(b.status)) throw conflict(`A ${STATUS_LABEL[b.status].toLowerCase()} booking cannot be cancelled.`);
    const hrs = hoursUntil(b.date, b.start_min);
    if (role === 'customer' && b.status !== 'pending') {
      const cutoff = settings.getInt('cancellation_hours');
      if (hrs < cutoff) throw conflict(`Accepted bookings can be cancelled up to ${cutoff} hours before the ceremony. Please contact the pandit or support.`);
    }
    if (role === 'pandit' && hrs <= 0) throw conflict('This ceremony time has already passed.');

    db.prepare("UPDATE bookings SET status = 'cancelled', status_reason = ?, cancelled_by = ?, updated_at = datetime('now') WHERE id = ?")
      .run(reason, user.id, b.id);
    db.prepare("UPDATE payments SET status = 'failed', notes = 'Booking cancelled before payment', updated_at = datetime('now') WHERE booking_id = ? AND status = 'pending'").run(b.id);
    logEvent(b.id, user.id, 'cancelled', b.status, 'cancelled', reason);

    const text = `Booking ${b.booking_ref} on ${b.date} was cancelled by the ${role === 'admin' ? 'Pandit Finder team' : role}. Reason: ${reason}`;
    if (role !== 'customer') notify(b.customer_id, 'booking_cancelled', 'Booking cancelled', text, `/booking.html?id=${b.id}`);
    if (role !== 'pandit') notify(b.pandit_user_id, 'booking_cancelled', 'Booking cancelled', text, `/booking.html?id=${b.id}`);
    return { previous: b.status, refundNeeded: !!db.prepare("SELECT 1 FROM payments WHERE booking_id = ? AND status = 'successful' AND provider = 'razorpay'").get(b.id) };
  });
  return tx.immediate();
}

/** Customer reschedule: new slot is validated server-side; booking returns to pending for the pandit to re-accept. */
function reschedule(user, bookingId, date, startMin, note) {
  const db = getDb();
  const tx = db.transaction(() => {
    const b = getRaw(bookingId);
    const role = accessRole(b, user);
    if (role !== 'customer') throw forbidden('Only the customer can request a reschedule.');
    if (!['pending', 'accepted', 'confirmed'].includes(b.status)) throw conflict('This booking cannot be rescheduled.');
    const cutoff = settings.getInt('cancellation_hours');
    if (hoursUntil(b.date, b.start_min) < cutoff) throw conflict(`Bookings can be rescheduled up to ${cutoff} hours before the ceremony.`);
    const duration = b.end_min - b.start_min;
    if (date === b.date && startMin === b.start_min) throw badRequest('Choose a different date or time.');
    const problem = availability.slotProblem(b.pandit_id, date, startMin, duration, { excludeBookingId: b.id });
    if (problem) throw conflict(problem);

    const from = `${b.date} ${formatTime(b.start_min)}`;
    const to = `${date} ${formatTime(startMin)}`;
    db.prepare("UPDATE bookings SET date = ?, start_min = ?, end_min = ?, status = 'pending', status_reason = NULL, reminder_sent = 0, updated_at = datetime('now') WHERE id = ?")
      .run(date, startMin, startMin + duration, b.id);
    db.prepare("UPDATE payments SET status = 'failed', notes = 'Superseded by reschedule', updated_at = datetime('now') WHERE booking_id = ? AND status = 'pending'").run(b.id);
    logEvent(b.id, user.id, 'rescheduled', b.status, 'pending', `${from} → ${to}${note ? `. ${note}` : ''}`);
    notify(b.pandit_user_id, 'booking_rescheduled', 'Reschedule request',
      `Booking ${b.booking_ref} was moved from ${from} to ${to} and needs your acceptance.`, `/booking.html?id=${b.id}`);
  });
  tx.immediate();
}

module.exports = {
  STATUS_LABEL, create, changeStatus, confirm, cancel, reschedule, serialize, permissions,
  getRaw, detailRow, listRows, accessRole, logEvent, priceFor,
};
