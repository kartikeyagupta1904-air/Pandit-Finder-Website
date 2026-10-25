'use strict';
const { getDb } = require('../database');
const settings = require('./settings');
const { isValidDate, today, addDays, hoursUntil, formatTime } = require('../utils/time');

const STEP = 30; // minutes between selectable start times
const BLOCKING = "('accepted','confirmed')";

function windowsFor(panditId, date) {
  return getDb().prepare(
    'SELECT id, start_min, end_min FROM availability_slots WHERE pandit_id = ? AND date = ? ORDER BY start_min'
  ).all(panditId, date);
}

function isBlocked(panditId, date) {
  return !!getDb().prepare('SELECT 1 FROM blocked_dates WHERE pandit_id = ? AND date = ?').get(panditId, date);
}

function busyRanges(panditId, date, excludeBookingId = 0) {
  return getDb().prepare(
    `SELECT start_min, end_min FROM bookings
     WHERE pandit_id = ? AND date = ? AND status IN ${BLOCKING} AND id <> ?`
  ).all(panditId, date, excludeBookingId);
}

function bookingWindow() {
  const first = today();
  return { first, last: addDays(first, settings.getInt('max_advance_days')), leadHours: settings.getInt('min_lead_hours') };
}

/**
 * Returns every start time on `date` at which a ceremony of `duration` minutes
 * fits fully inside a published window and does not overlap an accepted or
 * confirmed booking. This is the single source of truth used by both the
 * public availability endpoint and the booking validation.
 */
function freeStarts(panditId, date, duration, { excludeBookingId = 0 } = {}) {
  if (!isValidDate(date)) return [];
  const { first, last, leadHours } = bookingWindow();
  if (date < first || date > last) return [];
  if (isBlocked(panditId, date)) return [];

  const busy = busyRanges(panditId, date, excludeBookingId);
  const starts = [];
  for (const w of windowsFor(panditId, date)) {
    for (let s = w.start_min; s + duration <= w.end_min; s += STEP) {
      const e = s + duration;
      if (hoursUntil(date, s) < leadHours) continue;
      if (busy.some((b) => b.start_min < e && s < b.end_min)) continue;
      if (!starts.includes(s)) starts.push(s);
    }
  }
  return starts.sort((a, b) => a - b);
}

/** Validates a specific slot; returns null when bookable or a human-readable reason. */
function slotProblem(panditId, date, start, duration, opts = {}) {
  if (!isValidDate(date)) return 'Choose a valid date.';
  const { first, last, leadHours } = bookingWindow();
  if (date < first) return 'Bookings cannot be made for past dates.';
  if (date > last) return `Bookings can be made at most ${settings.getInt('max_advance_days')} days in advance.`;
  if (start % STEP !== 0) return 'Choose one of the offered time slots.';
  if (hoursUntil(date, start) < 0) return 'That time has already passed.';
  if (hoursUntil(date, start) < leadHours) return `Bookings must be made at least ${leadHours} hours in advance.`;
  if (isBlocked(panditId, date)) return 'The pandit is unavailable on this date.';
  if (!freeStarts(panditId, date, duration, opts).includes(start)) {
    return 'This time slot is not available. Please choose another slot.';
  }
  return null;
}

/** Day-by-day summary between two dates for calendar views. */
function calendar(panditId, from, to, duration) {
  const db = getDb();
  const slotDates = new Set(db.prepare(
    'SELECT DISTINCT date FROM availability_slots WHERE pandit_id = ? AND date BETWEEN ? AND ?'
  ).all(panditId, from, to).map((r) => r.date));
  const blocked = new Set(db.prepare(
    'SELECT date FROM blocked_dates WHERE pandit_id = ? AND date BETWEEN ? AND ?'
  ).all(panditId, from, to).map((r) => r.date));

  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    let status = 'unavailable';
    let freeCount = 0;
    if (blocked.has(d)) status = 'blocked';
    else if (slotDates.has(d)) {
      freeCount = freeStarts(panditId, d, duration).length;
      status = freeCount > 0 ? 'available' : 'full';
    }
    days.push({ date: d, status, free_slots: freeCount });
    if (days.length > 62) break;
  }
  return days;
}

/** Earliest date in the next `days` with at least one free start for the shortest active service. */
function nextAvailableDate(panditId, days = 30) {
  const db = getDb();
  const svc = db.prepare('SELECT MIN(duration_minutes) d FROM pandit_services WHERE pandit_id = ? AND is_active = 1').get(panditId);
  if (!svc || !svc.d) return null;
  const from = today();
  const dates = db.prepare(
    `SELECT DISTINCT date FROM availability_slots WHERE pandit_id = ? AND date BETWEEN ? AND ?
     AND date NOT IN (SELECT date FROM blocked_dates WHERE pandit_id = ?) ORDER BY date`
  ).all(panditId, from, addDays(from, days), panditId).map((r) => r.date);
  for (const d of dates) if (freeStarts(panditId, d, svc.d).length) return d;
  return null;
}

module.exports = { STEP, freeStarts, slotProblem, calendar, nextAvailableDate, windowsFor, isBlocked, formatTime };
