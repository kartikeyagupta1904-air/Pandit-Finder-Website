'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const pandits = require('../services/pandits');
const availability = require('../services/availability');
const settings = require('../services/settings');
const payments = require('../services/payments');
const { emailStatus } = require('../services/notify');
const { validate, idParam, PASSWORD_RULE, checkPasswordStrength } = require('../validators');
const { asyncHandler, badRequest, conflict, notFound, HttpError } = require('../utils/errors');
const { applicationUpload, savePhoto, saveDocument, removePhoto } = require('../middleware/upload');
const { notify } = require('../services/notify');
const { startSession, BCRYPT_ROUNDS } = require('./auth');
const { LANGUAGES } = require('../database/reference-data');
const { isValidDate, parseTime, formatTime, today, addDays, weekday } = require('../utils/time');

const SERVICE_RULES = {
  category_id: { type: 'int', required: true, min: 1, label: 'Ceremony type' },
  name: { type: 'string', required: true, min: 2, max: 120, label: 'Service name' },
  description: { type: 'string', max: 1000, default: '', label: 'Description' },
  duration_minutes: { type: 'int', required: true, min: 30, max: 720, label: 'Duration' },
  price: { type: 'int', required: true, min: 0, max: 10000000, label: 'Price' },
  samagri_included: { type: 'bool', default: false },
  travel_charges_apply: { type: 'bool', default: false },
  travel_charge: { type: 'int', min: 0, max: 100000, default: 0, label: 'Travel charge' },
  mode: { type: 'enum', values: ['in_person', 'online', 'both'], default: 'in_person', label: 'Mode' },
  requirements: { type: 'string', max: 1000, default: '', label: 'Requirements' },
};

function checkService(db, s) {
  if (s.duration_minutes % 30 !== 0) throw badRequest('Duration must be in steps of 30 minutes.');
  if (!db.prepare('SELECT 1 FROM puja_categories WHERE id = ? AND is_active = 1').get(s.category_id)) throw badRequest('Unknown ceremony type.');
  if (!s.travel_charges_apply) s.travel_charge = 0;
}

/** Generates availability windows for the given weekdays over the next N weeks. */
function generateSlots(db, panditId, { weekdays, start_time: startTime, end_time: endTime, weeks, from }) {
  const s = parseTime(startTime);
  const e = endTime === '24:00' ? 1440 : parseTime(endTime);
  if (s === null || e === null || e - s < 30) throw badRequest('End time must be at least 30 minutes after start time.');
  if (s % 30 || e % 30) throw badRequest('Times must be on the hour or half hour.');
  const first = from && isValidDate(from) && from >= today() ? from : today();
  const days = Math.min(weeks, 26) * 7;
  const insert = db.prepare('INSERT OR IGNORE INTO availability_slots (pandit_id, date, start_min, end_min) VALUES (?, ?, ?, ?)');
  const overlaps = db.prepare('SELECT 1 FROM availability_slots WHERE pandit_id = ? AND date = ? AND start_min < ? AND ? < end_min');
  let created = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(first, i);
    if (!weekdays.includes(weekday(d))) continue;
    if (overlaps.get(panditId, d, e, s)) continue;
    created += insert.run(panditId, d, s, e).changes;
  }
  return created;
}

module.exports = function publicRoutes({ authLimiter }) {
  const router = express.Router();

  router.get('/categories', (req, res) => {
    res.json(getDb().prepare('SELECT id, name, slug, description, icon FROM puja_categories WHERE is_active = 1 ORDER BY sort_order, name').all());
  });

  router.get('/cities', (req, res) => {
    const rows = getDb().prepare(`SELECT c.id, c.name, c.state, c.lat, c.lng,
        (SELECT COUNT(*) FROM pandit_profiles p JOIN users u ON u.id = p.user_id WHERE p.city_id = c.id AND ${pandits.publicWhere()}) AS pandit_count
      FROM cities c ORDER BY c.name`).all();
    res.json(rows);
  });

  router.get('/languages', (req, res) => res.json(LANGUAGES));

  // Puja services offered on the platform, with real counts and price ranges from active services.
  router.get('/services', (req, res) => {
    const rows = getDb().prepare(`SELECT c.id, c.name, c.slug, c.description, c.icon,
        COUNT(DISTINCT p.id) AS pandit_count, MIN(s.price) AS min_price, MAX(s.price) AS max_price
      FROM puja_categories c
      LEFT JOIN pandit_services s ON s.category_id = c.id AND s.is_active = 1
      LEFT JOIN pandit_profiles p ON p.id = s.pandit_id
      LEFT JOIN users u ON u.id = p.user_id
      WHERE c.is_active = 1 AND (p.id IS NULL OR (${pandits.publicWhere()}))
      GROUP BY c.id ORDER BY c.sort_order`).all();
    res.json(rows);
  });

  router.get('/stats', (req, res) => {
    const db = getDb();
    const w = pandits.publicWhere();
    res.json({
      pandits: db.prepare(`SELECT COUNT(*) n FROM pandit_profiles p JOIN users u ON u.id = p.user_id WHERE ${w}`).get().n,
      cities: db.prepare(`SELECT COUNT(DISTINCT p.city_id) n FROM pandit_profiles p JOIN users u ON u.id = p.user_id WHERE ${w}`).get().n,
      completed_ceremonies: db.prepare("SELECT COUNT(*) n FROM bookings WHERE status = 'completed'").get().n,
      reviews: db.prepare("SELECT COUNT(*) n FROM reviews WHERE status = 'visible'").get().n,
    });
  });

  router.get('/settings/public', (req, res) => {
    const s = settings.getAll();
    res.json({
      cancellation_hours: Number(s.cancellation_hours),
      min_lead_hours: Number(s.min_lead_hours),
      max_advance_days: Number(s.max_advance_days),
      support_email: s.support_email,
      support_phone: s.support_phone,
      allow_new_pandit_applications: s.allow_new_pandit_applications === '1',
      online_payments: payments.razorpayEnabled(),
      email_notifications: emailStatus() === 'ready',
    });
  });

  router.get('/reviews/recent', (req, res) => {
    const rows = getDb().prepare(`SELECT r.id, r.rating, r.comment, r.created_at, cu.name AS customer_name, u.name AS pandit_name,
        p.id AS pandit_id, b.ceremony_type, c.name AS city, p.is_sample
      FROM reviews r JOIN bookings b ON b.id = r.booking_id JOIN users cu ON cu.id = r.customer_id
      JOIN pandit_profiles p ON p.id = r.pandit_id JOIN users u ON u.id = p.user_id JOIN cities c ON c.id = p.city_id
      WHERE r.status = 'visible' AND length(r.comment) > 20 AND ${pandits.publicWhere()}
      ORDER BY r.rating DESC, r.created_at DESC LIMIT 6`).all();
    res.json(rows.map((r) => ({ ...r, customer_name: pandits.shortName(r.customer_name), is_sample: !!r.is_sample })));
  });

  // ---- Pandit discovery ----
  router.get('/pandits', (req, res) => {
    res.json(pandits.search(req.query));
  });

  router.get('/pandits/:id', (req, res) => {
    const profile = pandits.publicProfile(idParam(req.params.id));
    if (!profile) throw notFound('Pandit not found.');
    if (req.user?.role === 'customer') {
      profile.is_favourite = !!getDb().prepare('SELECT 1 FROM favourites WHERE customer_id = ? AND pandit_id = ?').get(req.user.id, profile.id);
    }
    res.json(profile);
  });

  router.get('/pandits/:id/reviews', (req, res) => {
    const id = idParam(req.params.id);
    if (!pandits.isPublic(id)) throw notFound('Pandit not found.');
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    res.json(pandits.reviewsFor(id, limit, offset));
  });

  /**
   * ?date=YYYY-MM-DD&service_id=  -> free start times for that date
   * ?from=&to=&service_id=        -> per-day calendar summary
   */
  router.get('/pandits/:id/availability', (req, res) => {
    const id = idParam(req.params.id);
    if (!pandits.isPublic(id)) throw notFound('Pandit not found.');
    const db = getDb();
    let duration;
    if (req.query.service_id) {
      const s = db.prepare('SELECT duration_minutes FROM pandit_services WHERE id = ? AND pandit_id = ? AND is_active = 1').get(Number(req.query.service_id) || 0, id);
      if (!s) throw badRequest('Unknown service for this pandit.');
      duration = s.duration_minutes;
    } else {
      duration = db.prepare('SELECT MIN(duration_minutes) d FROM pandit_services WHERE pandit_id = ? AND is_active = 1').get(id).d || 60;
    }
    if (req.query.date) {
      if (!isValidDate(req.query.date)) throw badRequest('Invalid date.');
      const starts = availability.freeStarts(id, req.query.date, duration);
      return res.json({
        date: req.query.date,
        duration_minutes: duration,
        blocked: availability.isBlocked(id, req.query.date),
        slots: starts.map((s) => ({ start: formatTime(s), end: formatTime(s + duration) })),
      });
    }
    const from = isValidDate(req.query.from) ? req.query.from : today();
    let to = isValidDate(req.query.to) ? req.query.to : addDays(from, 30);
    if (to < from) throw badRequest('`to` must be after `from`.');
    if (to > addDays(from, 62)) to = addDays(from, 62);
    res.json({ duration_minutes: duration, days: availability.calendar(id, from, to, duration) });
  });

  // ---- Pandit application (Become a Pandit) ----
  router.post('/pandits/apply', authLimiter, applicationUpload, asyncHandler(async (req, res) => {
    if (settings.get('allow_new_pandit_applications') !== '1') throw new HttpError(403, 'New pandit applications are paused at the moment.');
    if (req.user) throw conflict('You are already logged in. Please log out to create a separate pandit account.');

    const data = validate(req.body, {
      name: { type: 'string', required: true, min: 2, max: 100, label: 'Full name' },
      email: { type: 'email', required: true, max: 254, label: 'Email' },
      password: PASSWORD_RULE,
      phone: { type: 'phone', required: true, label: 'Phone number' },
      city_id: { type: 'int', required: true, min: 1, label: 'City' },
      service_areas: { type: 'list', required: true, maxItems: 20, label: 'Service areas' },
      languages: { type: 'list', required: true, maxItems: 10, label: 'Languages' },
      experience_years: { type: 'int', required: true, min: 0, max: 80, label: 'Experience' },
      specializations: { type: 'intList', required: true, maxItems: 20, label: 'Specializations' },
      bio: { type: 'string', required: true, min: 30, max: 2000, label: 'Biography' },
      preferred_contact: { type: 'enum', values: ['platform', 'phone', 'email'], default: 'platform', label: 'Preferred contact' },
      offers_online: { type: 'bool', default: false },
      services: { type: 'string', required: true, max: 20000, label: 'Services' },
      availability_weekdays: { type: 'intList', maxItems: 7, itemMin: 0, itemMax: 6, label: 'Available days' },
      availability_start: { type: 'string', max: 5, label: 'Start time' },
      availability_end: { type: 'string', max: 5, label: 'End time' },
      consent: { type: 'bool', required: true, label: 'Consent' },
    });
    checkPasswordStrength(data.password);
    if (!data.consent) throw badRequest('Please confirm the declaration and consent to verification.');

    const files = req.files || {};
    if (!files.identity_document?.[0]) throw badRequest('An identity document is required for verification.');

    let services;
    try { services = JSON.parse(data.services); } catch { throw badRequest('Services are invalid.'); }
    if (!Array.isArray(services) || services.length === 0 || services.length > 20) throw badRequest('Add between 1 and 20 services.');
    const db = getDb();
    services = services.map((s) => { const v = validate(s, SERVICE_RULES); checkService(db, v); return v; });

    if (!db.prepare('SELECT 1 FROM cities WHERE id = ?').get(data.city_id)) throw badRequest('Choose a city from the list.');
    const validCats = new Set(db.prepare('SELECT id FROM puja_categories WHERE is_active = 1').all().map((r) => r.id));
    if (data.specializations.some((c) => !validCats.has(c))) throw badRequest('Unknown specialization selected.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(data.email)) throw conflict('An account with this email already exists.');

    // Validate & store files only after all fields pass.
    const photoName = files.photo?.[0] ? savePhoto(files.photo[0]) : null;
    const docs = [{ type: 'identity', file: files.identity_document[0] }];
    if (files.certificate_document?.[0]) docs.push({ type: 'certificate', file: files.certificate_document[0] });
    let saved;
    try {
      saved = docs.map((d) => ({ type: d.type, ...saveDocument(d.file) }));
    } catch (err) {
      removePhoto(photoName);
      throw err;
    }

    const hash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const ids = db.transaction(() => {
      const u = db.prepare("INSERT INTO users (role, name, email, password_hash, phone) VALUES ('pandit', ?, ?, ?, ?)")
        .run(data.name, data.email, hash, data.phone);
      const userId = Number(u.lastInsertRowid);
      const p = db.prepare(`INSERT INTO pandit_profiles (user_id, city_id, bio, experience_years, photo_path, preferred_contact, offers_online)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, data.city_id, data.bio, data.experience_years, photoName, data.preferred_contact, data.offers_online ? 1 : 0);
      const pid = Number(p.lastInsertRowid);
      for (const l of data.languages) db.prepare('INSERT OR IGNORE INTO pandit_languages (pandit_id, language) VALUES (?, ?)').run(pid, l);
      for (const c of data.specializations) db.prepare('INSERT OR IGNORE INTO pandit_specializations (pandit_id, category_id) VALUES (?, ?)').run(pid, c);
      for (const a of data.service_areas) db.prepare('INSERT OR IGNORE INTO pandit_service_areas (pandit_id, locality) VALUES (?, ?)').run(pid, a);
      for (const s of services) {
        db.prepare(`INSERT INTO pandit_services (pandit_id, category_id, name, description, duration_minutes, price, samagri_included,
          travel_charges_apply, travel_charge, mode, requirements) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(pid, s.category_id, s.name, s.description, s.duration_minutes, s.price, s.samagri_included ? 1 : 0,
            s.travel_charges_apply ? 1 : 0, s.travel_charge, s.mode, s.requirements);
      }
      for (const d of saved) {
        db.prepare('INSERT INTO pandit_verification_documents (pandit_id, doc_type, original_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, ?)')
          .run(pid, d.type, d.original_name, d.stored_name, d.mime_type, d.size_bytes);
      }
      if (data.availability_weekdays?.length && data.availability_start && data.availability_end) {
        generateSlots(db, pid, { weekdays: data.availability_weekdays, start_time: data.availability_start, end_time: data.availability_end, weeks: 8 });
      }
      return { userId, pid };
    })();

    for (const admin of db.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all()) {
      notify(admin.id, 'verification_request', 'New pandit application', `${data.name} applied to join as a pandit.`, `/admin.html#verifications`);
    }
    notify(ids.userId, 'verification_pending', 'Application received',
      'Your application is pending review. You will be notified once an administrator has verified your details.', '/pandit-dashboard.html');
    await startSession(req, ids.userId);
    res.status(201).json({ pandit_id: ids.pid, verification_status: 'pending', csrfToken: req.session.csrfToken });
  }));

  return router;
};

module.exports.SERVICE_RULES = SERVICE_RULES;
module.exports.checkService = checkService;
module.exports.generateSlots = generateSlots;
