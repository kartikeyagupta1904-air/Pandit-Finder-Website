'use strict';
const fs = require('fs');
const { getDb } = require('../database');
const settings = require('./settings');
const { notify } = require('./notify');
const { documentPath } = require('../middleware/upload');
const { formatTime, hoursUntil, today } = require('../utils/time');

/**
 * Periodic housekeeping:
 *  - upcoming ceremony reminders (24h before) for confirmed bookings
 *  - expire pending requests whose ceremony time has passed
 *  - purge verification documents after the retention period
 *  - remove expired sessions
 */
function runMaintenance() {
  const db = getDb();
  const out = { reminders: 0, expired: 0, purged: 0 };

  const upcoming = db.prepare(`SELECT b.*, pp.user_id AS pandit_user_id FROM bookings b JOIN pandit_profiles pp ON pp.id = b.pandit_id
    WHERE b.status = 'confirmed' AND b.reminder_sent = 0 AND b.date >= ?`).all(today());
  for (const b of upcoming) {
    const h = hoursUntil(b.date, b.start_min);
    if (h > 0 && h <= 24) {
      const text = `${b.ceremony_type} (${b.booking_ref}) is scheduled for ${b.date} at ${formatTime(b.start_min)}.`;
      notify(b.customer_id, 'reminder', 'Upcoming ceremony reminder', text, `/booking.html?id=${b.id}`);
      notify(b.pandit_user_id, 'reminder', 'Upcoming ceremony reminder', text, `/booking.html?id=${b.id}`);
      db.prepare('UPDATE bookings SET reminder_sent = 1 WHERE id = ?').run(b.id);
      out.reminders++;
    }
  }

  const stale = db.prepare("SELECT id, customer_id, booking_ref, date, start_min FROM bookings WHERE status = 'pending' AND date <= ?").all(today());
  for (const b of stale) {
    if (hoursUntil(b.date, b.start_min) > 0) continue;
    db.prepare("UPDATE bookings SET status = 'cancelled', status_reason = 'Expired: the pandit did not respond before the ceremony time.', updated_at = datetime('now') WHERE id = ?").run(b.id);
    db.prepare("INSERT INTO booking_events (booking_id, event, from_status, to_status, note) VALUES (?, 'expired', 'pending', 'cancelled', 'No response before ceremony time')").run(b.id);
    notify(b.customer_id, 'booking_cancelled', 'Booking request expired', `Booking ${b.booking_ref} expired without a response from the pandit.`, `/booking.html?id=${b.id}`);
    out.expired++;
  }

  const days = settings.getInt('document_retention_days');
  const docs = db.prepare(`SELECT d.id, d.stored_name FROM pandit_verification_documents d JOIN pandit_profiles p ON p.id = d.pandit_id
    WHERE d.purged_at IS NULL AND p.verification_status IN ('approved','rejected') AND p.verified_at IS NOT NULL
      AND p.verified_at <= datetime('now', ?)`).all(`-${days} days`);
  for (const d of docs) {
    if (d.stored_name) fs.rmSync(documentPath(d.stored_name), { force: true });
    db.prepare("UPDATE pandit_verification_documents SET purged_at = datetime('now'), stored_name = NULL WHERE id = ?").run(d.id);
    out.purged++;
  }

  db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
  return out;
}

module.exports = { runMaintenance };
