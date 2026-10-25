'use strict';
// Routes for the logged-in pandit's own account (/api/pandit/...). Every query is scoped to req.pandit.id.
const express = require('express');
const { getDb } = require('../database');
const pandits = require('../services/pandits');
const bookings = require('../services/bookings');
const { notify } = require('../services/notify');
const { validate, idParam } = require('../validators');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { requirePandit } = require('../middleware/auth');
const { photoUpload, documentUpload, savePhoto, saveDocument, removePhoto } = require('../middleware/upload');
const { SERVICE_RULES, checkService, generateSlots } = require('./public');
const { isValidDate, parseTime, formatTime, today, addDays } = require('../utils/time');

function completion(db, p, user) {
  const checks = [
    ['Profile photo', !!p.photo_path],
    ['Biography (100+ characters)', (p.bio || '').length >= 100],
    ['At least one service', !!db.prepare('SELECT 1 FROM pandit_services WHERE pandit_id = ? AND is_active = 1').get(p.id)],
    ['Service areas', !!db.prepare('SELECT 1 FROM pandit_service_areas WHERE pandit_id = ?').get(p.id)],
    ['Languages', !!db.prepare('SELECT 1 FROM pandit_languages WHERE pandit_id = ?').get(p.id)],
    ['Specializations', !!db.prepare('SELECT 1 FROM pandit_specializations WHERE pandit_id = ?').get(p.id)],
    ['Upcoming availability', !!db.prepare('SELECT 1 FROM availability_slots WHERE pandit_id = ? AND date >= ?').get(p.id, today())],
    ['Phone number', !!user.phone],
  ];
  const done = checks.filter((c) => c[1]).length;
  return { percent: Math.round((done / checks.length) * 100), items: checks.map(([label, ok]) => ({ label, ok })) };
}

module.exports = function panditRoutes() {
  const router = express.Router();
  router.use(requirePandit);

  router.get('/me', (req, res) => {
    const db = getDb();
    const p = req.pandit;
    const city = db.prepare('SELECT id, name FROM cities WHERE id = ?').get(p.city_id);
    res.json({
      id: p.id,
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      city,
      bio: p.bio,
      experience_years: p.experience_years,
      photo_url: p.photo_path ? `/uploads/photos/${p.photo_path}` : null,
      preferred_contact: p.preferred_contact,
      offers_online: !!p.offers_online,
      verification_status: p.verification_status,
      rejection_reason: p.rejection_reason,
      identity_verified: !!p.identity_verified,
      experience_verified: !!p.experience_verified,
      languages: db.prepare('SELECT language FROM pandit_languages WHERE pandit_id = ? ORDER BY language').all(p.id).map((r) => r.language),
      specializations: db.prepare('SELECT category_id FROM pandit_specializations WHERE pandit_id = ?').all(p.id).map((r) => r.category_id),
      service_areas: db.prepare('SELECT locality FROM pandit_service_areas WHERE pandit_id = ? ORDER BY locality').all(p.id).map((r) => r.locality),
      documents: db.prepare('SELECT id, doc_type, original_name, uploaded_at, purged_at FROM pandit_verification_documents WHERE pandit_id = ? ORDER BY id').all(p.id),
      completion: completion(db, p, req.user),
    });
  });

  router.put('/profile', (req, res) => {
    const data = validate(req.body, {
      name: { type: 'string', required: true, min: 2, max: 100, label: 'Full name' },
      phone: { type: 'phone', required: true, label: 'Phone number' },
      city_id: { type: 'int', required: true, min: 1, label: 'City' },
      bio: { type: 'string', required: true, min: 30, max: 2000, label: 'Biography' },
      experience_years: { type: 'int', required: true, min: 0, max: 80, label: 'Experience' },
      languages: { type: 'list', required: true, maxItems: 10, label: 'Languages' },
      specializations: { type: 'intList', required: true, maxItems: 20, label: 'Specializations' },
      service_areas: { type: 'list', required: true, maxItems: 20, label: 'Service areas' },
      preferred_contact: { type: 'enum', values: ['platform', 'phone', 'email'], default: 'platform' },
      offers_online: { type: 'bool', default: false },
    });
    const db = getDb();
    const p = req.pandit;
    if (!db.prepare('SELECT 1 FROM cities WHERE id = ?').get(data.city_id)) throw badRequest('Choose a city from the list.');
    const validCats = new Set(db.prepare('SELECT id FROM puja_categories').all().map((r) => r.id));
    if (data.specializations.some((c) => !validCats.has(c))) throw badRequest('Unknown specialization selected.');

    db.transaction(() => {
      db.prepare("UPDATE users SET name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?").run(data.name, data.phone, req.user.id);
      // Changing self-declared experience removes its verified flag until an admin reviews it again.
      const expVerified = data.experience_years === p.experience_years ? p.experience_verified : 0;
      db.prepare(`UPDATE pandit_profiles SET city_id = ?, bio = ?, experience_years = ?, preferred_contact = ?, offers_online = ?,
        experience_verified = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(data.city_id, data.bio, data.experience_years, data.preferred_contact, data.offers_online ? 1 : 0, expVerified, p.id);
      db.prepare('DELETE FROM pandit_languages WHERE pandit_id = ?').run(p.id);
      for (const l of data.languages) db.prepare('INSERT OR IGNORE INTO pandit_languages (pandit_id, language) VALUES (?, ?)').run(p.id, l);
      db.prepare('DELETE FROM pandit_specializations WHERE pandit_id = ?').run(p.id);
      for (const c of data.specializations) db.prepare('INSERT OR IGNORE INTO pandit_specializations (pandit_id, category_id) VALUES (?, ?)').run(p.id, c);
      db.prepare('DELETE FROM pandit_service_areas WHERE pandit_id = ?').run(p.id);
      for (const a of data.service_areas) db.prepare('INSERT OR IGNORE INTO pandit_service_areas (pandit_id, locality) VALUES (?, ?)').run(p.id, a);
    })();
    res.json({ ok: true });
  });

  router.post('/photo', photoUpload, (req, res) => {
    if (!req.file) throw badRequest('Choose a photo to upload.');
    const name = savePhoto(req.file);
    const old = req.pandit.photo_path;
    getDb().prepare("UPDATE pandit_profiles SET photo_path = ?, updated_at = datetime('now') WHERE id = ?").run(name, req.pandit.id);
    removePhoto(old);
    res.json({ photo_url: `/uploads/photos/${name}` });
  });

  router.delete('/photo', (req, res) => {
    getDb().prepare("UPDATE pandit_profiles SET photo_path = NULL, updated_at = datetime('now') WHERE id = ?").run(req.pandit.id);
    removePhoto(req.pandit.photo_path);
    res.json({ ok: true });
  });

  // Additional verification documents (e.g. after a rejection asking for more proof).
  router.post('/documents', documentUpload, (req, res) => {
    if (!req.file) throw badRequest('Choose a document to upload.');
    const { doc_type: docType } = validate(req.body, { doc_type: { type: 'enum', values: ['identity', 'address', 'certificate', 'other'], default: 'other' } });
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) n FROM pandit_verification_documents WHERE pandit_id = ? AND purged_at IS NULL').get(req.pandit.id).n;
    if (count >= 6) throw conflict('You can keep at most 6 documents on file.');
    const d = saveDocument(req.file);
    db.prepare('INSERT INTO pandit_verification_documents (pandit_id, doc_type, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.pandit.id, docType, d.original_name, d.stored_name, d.mime_type, d.size_bytes);
    // A rejected pandit who uploads new documents goes back into the review queue.
    if (req.pandit.verification_status === 'rejected') {
      db.prepare("UPDATE pandit_profiles SET verification_status = 'pending', updated_at = datetime('now') WHERE id = ?").run(req.pandit.id);
      for (const a of db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all()) {
        notify(a.id, 'verification_request', 'Pandit re-submitted documents', `${req.user.name} uploaded new documents for review.`, '/admin.html#verifications');
      }
    }
    res.status(201).json({ ok: true });
  });

  // ---- Services ----
  router.get('/services', (req, res) => {
    res.json(pandits.serviceRows(req.pandit.id, false));
  });

  router.post('/services', (req, res) => {
    const db = getDb();
    const s = validate(req.body, SERVICE_RULES);
    checkService(db, s);
    const n = db.prepare('SELECT COUNT(*) n FROM pandit_services WHERE pandit_id = ? AND is_active = 1').get(req.pandit.id).n;
    if (n >= 30) throw conflict('You can have at most 30 active services.');
    const info = db.prepare(`INSERT INTO pandit_services (pandit_id, category_id, name, description, duration_minutes, price, samagri_included,
      travel_charges_apply, travel_charge, mode, requirements) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.pandit.id, s.category_id, s.name, s.description, s.duration_minutes, s.price, s.samagri_included ? 1 : 0,
        s.travel_charges_apply ? 1 : 0, s.travel_charge, s.mode, s.requirements);
    db.prepare('INSERT OR IGNORE INTO pandit_specializations (pandit_id, category_id) VALUES (?, ?)').run(req.pandit.id, s.category_id);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  function ownService(id, panditId) {
    const s = getDb().prepare('SELECT * FROM pandit_services WHERE id = ? AND pandit_id = ?').get(id, panditId);
    if (!s) throw notFound('Service not found.');
    return s;
  }

  router.put('/services/:id', (req, res) => {
    const db = getDb();
    const existing = ownService(idParam(req.params.id), req.pandit.id);
    const s = validate(req.body, { ...SERVICE_RULES, is_active: { type: 'bool', default: true } });
    checkService(db, s);
    // Existing bookings keep their own snapshot of time and price, so editing a service never alters them.
    db.prepare(`UPDATE pandit_services SET category_id = ?, name = ?, description = ?, duration_minutes = ?, price = ?, samagri_included = ?,
      travel_charges_apply = ?, travel_charge = ?, mode = ?, requirements = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(s.category_id, s.name, s.description, s.duration_minutes, s.price, s.samagri_included ? 1 : 0, s.travel_charges_apply ? 1 : 0,
        s.travel_charge, s.mode, s.requirements, s.is_active ? 1 : 0, existing.id);
    res.json({ ok: true });
  });

  router.delete('/services/:id', (req, res) => {
    const db = getDb();
    const s = ownService(idParam(req.params.id), req.pandit.id);
    const used = db.prepare('SELECT 1 FROM bookings WHERE service_id = ?').get(s.id);
    if (used) {
      // Keep the row for booking history; just hide it.
      db.prepare("UPDATE pandit_services SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(s.id);
      return res.json({ ok: true, archived: true });
    }
    db.prepare('DELETE FROM pandit_services WHERE id = ?').run(s.id);
    res.json({ ok: true, deleted: true });
  });

  // ---- Availability ----
  router.get('/availability', (req, res) => {
    const db = getDb();
    const from = isValidDate(req.query.from) ? req.query.from : today();
    const to = isValidDate(req.query.to) ? req.query.to : addDays(from, 60);
    const slots = db.prepare('SELECT id, date, start_min, end_min FROM availability_slots WHERE pandit_id = ? AND date BETWEEN ? AND ? ORDER BY date, start_min')
      .all(req.pandit.id, from, to)
      .map((s) => ({ id: s.id, date: s.date, start: formatTime(s.start_min), end: formatTime(s.end_min) }));
    const blocked = db.prepare('SELECT id, date, reason FROM blocked_dates WHERE pandit_id = ? AND date BETWEEN ? AND ? ORDER BY date').all(req.pandit.id, from, to);
    const booked = db.prepare(`SELECT id, booking_ref, date, start_min, end_min, status FROM bookings WHERE pandit_id = ? AND date BETWEEN ? AND ?
      AND status IN ('pending','accepted','confirmed') ORDER BY date, start_min`).all(req.pandit.id, from, to)
      .map((b) => ({ id: b.id, booking_ref: b.booking_ref, date: b.date, start: formatTime(b.start_min), end: formatTime(b.end_min), status: b.status }));
    res.json({ from, to, slots, blocked, bookings: booked });
  });

  router.post('/availability', (req, res) => {
    const data = validate(req.body, {
      weekdays: { type: 'intList', label: 'Days', maxItems: 7, itemMin: 0, itemMax: 6 },
      date: { type: 'string', max: 10 },
      start_time: { type: 'string', required: true, max: 5, label: 'Start time' },
      end_time: { type: 'string', required: true, max: 5, label: 'End time' },
      weeks: { type: 'int', min: 1, max: 26, default: 4, label: 'Weeks' },
    });
    const db = getDb();
    let created;
    if (data.date) {
      if (!isValidDate(data.date) || data.date < today()) throw badRequest('Choose today or a future date.');
      const w = new Date(`${data.date}T00:00:00`).getDay();
      created = generateSlots(db, req.pandit.id, { weekdays: [w], start_time: data.start_time, end_time: data.end_time, weeks: 1, from: data.date });
    } else {
      const weekdays = (data.weekdays || []).map(Number).filter((d) => d >= 0 && d <= 6);
      if (!weekdays.length) throw badRequest('Choose at least one day of the week, or a specific date.');
      created = generateSlots(db, req.pandit.id, { weekdays, start_time: data.start_time, end_time: data.end_time, weeks: data.weeks });
    }
    res.status(201).json({ created, message: created ? `${created} availability window(s) added.` : 'No new windows were added (they already exist or overlap existing ones).' });
  });

  router.delete('/availability/:id', (req, res) => {
    const db = getDb();
    const slot = db.prepare('SELECT * FROM availability_slots WHERE id = ? AND pandit_id = ?').get(idParam(req.params.id), req.pandit.id);
    if (!slot) throw notFound('Availability window not found.');
    const held = db.prepare(`SELECT 1 FROM bookings WHERE pandit_id = ? AND date = ? AND status IN ('accepted','confirmed')
      AND start_min < ? AND ? < end_min`).get(req.pandit.id, slot.date, slot.end_min, slot.start_min);
    if (held) throw conflict('You have an accepted booking in this window. Cancel or complete it before removing the window.');
    db.prepare('DELETE FROM availability_slots WHERE id = ?').run(slot.id);
    res.json({ ok: true });
  });

  router.post('/blocked-dates', (req, res) => {
    const data = validate(req.body, {
      date: { type: 'string', required: true, max: 10, label: 'Date' },
      reason: { type: 'string', max: 200, default: '', label: 'Reason' },
    });
    if (!isValidDate(data.date) || data.date < today()) throw badRequest('Choose today or a future date.');
    const db = getDb();
    const held = db.prepare("SELECT booking_ref FROM bookings WHERE pandit_id = ? AND date = ? AND status IN ('accepted','confirmed')").get(req.pandit.id, data.date);
    if (held) throw conflict(`You have an accepted booking (${held.booking_ref}) on this date. Cancel it first if you are unavailable.`);
    try {
      db.prepare('INSERT INTO blocked_dates (pandit_id, date, reason) VALUES (?, ?, ?)').run(req.pandit.id, data.date, data.reason);
    } catch (err) {
      if (String(err.code).includes('CONSTRAINT')) throw conflict('This date is already blocked.');
      throw err;
    }
    res.status(201).json({ ok: true });
  });

  router.delete('/blocked-dates/:id', (req, res) => {
    const info = getDb().prepare('DELETE FROM blocked_dates WHERE id = ? AND pandit_id = ?').run(idParam(req.params.id), req.pandit.id);
    if (!info.changes) throw notFound('Blocked date not found.');
    res.json({ ok: true });
  });

  // ---- Dashboard & reviews ----
  router.get('/dashboard', (req, res) => {
    const db = getDb();
    const id = req.pandit.id;
    const counts = db.prepare(`SELECT COUNT(*) total,
        SUM(status = 'pending') pending, SUM(status = 'accepted') accepted, SUM(status = 'confirmed') confirmed,
        SUM(status = 'completed') completed, SUM(status = 'cancelled') cancelled, SUM(status = 'rejected') rejected,
        SUM(status IN ('accepted','confirmed') AND date >= ?) upcoming,
        SUM(CASE WHEN status = 'completed' THEN estimated_price ELSE 0 END) completed_value
      FROM bookings WHERE pandit_id = ?`).get(today(), id);
    const paid = db.prepare(`SELECT COALESCE(SUM(p.amount), 0) total, COUNT(*) n,
        COALESCE(SUM(CASE WHEN p.provider = 'razorpay' THEN p.amount ELSE 0 END), 0) online,
        COALESCE(SUM(CASE WHEN p.provider = 'offline' THEN p.amount ELSE 0 END), 0) offline
      FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.pandit_id = ? AND p.status = 'successful'`).get(id);
    const rating = db.prepare("SELECT AVG(rating) avg, COUNT(*) n FROM reviews WHERE pandit_id = ? AND status = 'visible'").get(id);
    const upcoming = bookings.listRows("b.pandit_id = ? AND b.status IN ('accepted','confirmed') AND b.date >= ?", [id, today()], 'b.date, b.start_min')
      .slice(0, 5).map((b) => bookings.serialize(b, 'pandit'));
    const pending = bookings.listRows("b.pandit_id = ? AND b.status = 'pending'", [id], 'b.date, b.start_min').map((b) => bookings.serialize(b, 'pandit'));
    res.json({
      verification_status: req.pandit.verification_status,
      rejection_reason: req.pandit.rejection_reason,
      counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v || 0])),
      earnings: {
        // Received = verified online payments + payments the pandit recorded as received offline.
        received_total: paid.total, received_online: paid.online, received_offline_self_reported: paid.offline,
        completed_bookings_estimated_value: counts.completed_value || 0,
      },
      rating: { average: rating.avg ? Math.round(rating.avg * 10) / 10 : null, count: rating.n },
      completion: completion(db, req.pandit, req.user),
      upcoming,
      pending,
    });
  });

  router.get('/reviews', (req, res) => {
    const rows = getDb().prepare(`SELECT r.id, r.rating, r.comment, r.status, r.created_at, b.booking_ref, b.ceremony_type, u.name AS customer_name
      FROM reviews r JOIN bookings b ON b.id = r.booking_id JOIN users u ON u.id = r.customer_id WHERE r.pandit_id = ? ORDER BY r.created_at DESC`).all(req.pandit.id);
    res.json(rows.map((r) => ({ ...r, customer_name: pandits.shortName(r.customer_name) })));
  });

  return router;
};
