'use strict';
const crypto = require('crypto');
const config = require('../config');
const { getDb } = require('../database');
const { notify } = require('./notify');
const bookings = require('./bookings');
const { badRequest, conflict, HttpError } = require('../utils/errors');

/**
 * Razorpay integration (optional). Enabled only when RAZORPAY_KEY_ID and
 * RAZORPAY_KEY_SECRET are configured. The secret never leaves the server and a
 * payment is marked successful only after the HMAC signature is verified here.
 */
function razorpayEnabled() {
  return !!(config.razorpay.keyId && config.razorpay.keySecret);
}

async function createRazorpayOrder(user, bookingId) {
  if (!razorpayEnabled()) throw new HttpError(503, 'Online payments are not configured. Choose "Pay later".');
  const db = getDb();
  const b = bookings.getRaw(bookingId);
  if (bookings.accessRole(b, user) !== 'customer') throw badRequest('Only the customer can pay for this booking.');
  if (b.status !== 'accepted') throw conflict('Payment is available once the pandit has accepted the booking.');

  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64')}`,
    },
    body: JSON.stringify({ amount: b.estimated_price * 100, currency: 'INR', receipt: b.booking_ref, notes: { booking_id: String(b.id) } }),
  });
  if (!res.ok) throw new HttpError(502, 'Could not start the payment. Please try again later.');
  const order = await res.json();
  db.prepare("INSERT INTO payments (booking_id, provider, provider_order_id, amount, status) VALUES (?, 'razorpay', ?, ?, 'pending')")
    .run(b.id, order.id, b.estimated_price);
  return { key_id: config.razorpay.keyId, order_id: order.id, amount: order.amount, currency: order.currency, booking_ref: b.booking_ref };
}

function safeEqualHex(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

/** Verifies the checkout signature, then marks the payment successful and confirms the booking. */
function verifyRazorpayPayment(user, { order_id: orderId, payment_id: paymentId, signature }) {
  if (!razorpayEnabled()) throw new HttpError(503, 'Online payments are not configured.');
  const db = getDb();
  const payment = db.prepare("SELECT * FROM payments WHERE provider = 'razorpay' AND provider_order_id = ?").get(orderId);
  if (!payment) throw badRequest('Unknown payment order.');
  const b = bookings.getRaw(payment.booking_id);
  if (bookings.accessRole(b, user) !== 'customer') throw badRequest('Unknown payment order.');

  const expected = crypto.createHmac('sha256', config.razorpay.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  if (!safeEqualHex(expected, signature)) {
    db.prepare("UPDATE payments SET status = 'failed', notes = 'Signature verification failed', updated_at = datetime('now') WHERE id = ?").run(payment.id);
    throw badRequest('Payment verification failed. You have not been charged by Pandit Finder; contact support if money was deducted.');
  }
  markPaid(payment, paymentId, user.id);
  return { status: 'successful' };
}

function markPaid(payment, paymentId, actorId) {
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE payments SET status = 'successful', provider_payment_id = ?, updated_at = datetime('now') WHERE id = ? AND status <> 'refunded'")
      .run(paymentId, payment.id);
    const b = bookings.getRaw(payment.booking_id);
    if (b.status === 'accepted') {
      db.prepare("UPDATE bookings SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?").run(b.id);
      bookings.logEvent(b.id, actorId, 'confirmed', 'accepted', 'confirmed', 'Online payment verified');
      notify(b.pandit_user_id, 'booking_confirmed', 'Booking confirmed and paid', `Booking ${b.booking_ref} has been paid online.`, `/booking.html?id=${b.id}`);
    }
  }).immediate();
}

/** Razorpay webhook (payment.captured / payment.failed / refund.processed). Raw body required for the signature. */
function handleWebhook(rawBody, signature) {
  if (!config.razorpay.webhookSecret) throw new HttpError(503, 'Webhook not configured.');
  const expected = crypto.createHmac('sha256', config.razorpay.webhookSecret).update(rawBody).digest('hex');
  if (!signature || !safeEqualHex(expected, signature)) throw badRequest('Invalid signature.');
  const event = JSON.parse(rawBody.toString('utf8'));
  const db = getDb();
  const entity = event?.payload?.payment?.entity;
  if (!entity) return;
  const payment = db.prepare("SELECT * FROM payments WHERE provider = 'razorpay' AND provider_order_id = ?").get(entity.order_id);
  if (!payment) return;
  if (event.event === 'payment.captured') markPaid(payment, entity.id, null);
  if (event.event === 'payment.failed' && payment.status === 'pending') {
    db.prepare("UPDATE payments SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(payment.id);
  }
  if (event.event === 'refund.processed') {
    db.prepare("UPDATE payments SET status = 'refunded', updated_at = datetime('now') WHERE id = ?").run(payment.id);
  }
}

/** Pandit records that a pay-later amount was received offline (self-reported, labelled as such). */
function recordOffline(user, bookingId, amount) {
  const db = getDb();
  const b = bookings.getRaw(bookingId);
  if (bookings.accessRole(b, user) !== 'pandit') throw badRequest('Only the pandit can record an offline payment.');
  if (!['confirmed', 'completed'].includes(b.status)) throw conflict('Payments can be recorded for confirmed or completed bookings.');
  if (db.prepare("SELECT 1 FROM payments WHERE booking_id = ? AND status = 'successful'").get(b.id)) throw conflict('A successful payment is already recorded.');
  db.transaction(() => {
    db.prepare("UPDATE payments SET status = 'failed', notes = 'Replaced by offline payment record', updated_at = datetime('now') WHERE booking_id = ? AND status = 'pending'").run(b.id);
    db.prepare("INSERT INTO payments (booking_id, provider, amount, status, recorded_by, notes) VALUES (?, 'offline', ?, 'successful', ?, 'Recorded by pandit as received offline')")
      .run(b.id, amount, user.id);
    bookings.logEvent(b.id, user.id, 'payment_recorded', b.status, b.status, `Offline payment of ₹${amount} recorded`);
  })();
}

module.exports = { razorpayEnabled, createRazorpayOrder, verifyRazorpayPayment, handleWebhook, recordOffline };
