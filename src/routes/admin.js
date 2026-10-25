'use strict';
const fs = require('fs');
const express = require('express');
const { getDb } = require('../database');
const bookings = require('../services/bookings');
const settings = require('../services/settings');
const { notify } = require('../services/notify');
const { audit } = require('../services/audit');
const { validate, idParam } = require('../validators');
const { badRequest, conflict, notFound } = require('../utils/errors');
const { requireRole } = require('../middleware/auth');
const { documentPath } = require('../middleware/upload');
const { today, addDays } = require('../utils/time');

module.exports = function adminRoutes() {
  const router = express.Router();
  router.use(requireRole('admin'));

  router.get('/dashboard', (req, res) => {
    const db = getDb();
    const one = (sql, ...p) => db.prepare(sql).get(...p).n;
    const from = addDays(today(), -29);
    const perDay = db.prepare("SELECT date(created_at, 'localtime') d, COUNT(*) n FROM bookings WHERE date(created_at, 'localtime') >= ? GROUP BY d").all(from);
    const map = Object.fromEntries(perDay.map((r) => [r.d, r.n]));
    const series = [];
    for (let i = 0; i < 30; i++) { const d = addDays(from, i); series.push({ date: d, bookings: map[d] || 0 }); }
    res.json({
      customers: one("SELECT COUNT(*) n FROM users WHERE role = 'customer'"),
      pandits: one('SELECT COUNT(*) n FROM pandit_profiles'),
      pending_verifications: one("SELECT COUNT(*) n FROM pandit_profiles WHERE verification_status = 'pending'"),
      approved_pandits: one("SELECT COUNT(*) n FROM pandit_profiles WHERE verification_status = 'approved'"),
      rejected_applications: one("SELECT COUNT(*) n FROM pandit_profiles WHERE verification_status = 'rejected'"),
      suspended_users: one("SELECT COUNT(*) n FROM users WHERE status = 'suspended'"),
      bookings: Object.fromEntries(
        ['total', 'pending', 'accepted', 'confirmed', 'completed', 'cancelled', 'rejected'].map((s) => [s,
          s === 'total' ? one('SELECT COUNT(*) n FROM bookings') : one('SELECT COUNT(*) n FROM bookings WHERE status = ?', s)])
      ),
      open_complaints: one("SELECT COUNT(*) n FROM complaints WHERE status IN ('open','in_review')"),
      reviews: one('SELECT COUNT(*) n FROM reviews'),
      bookings_last_30_days: series,
      recent_activity: db.prepare(`SELECT a.action, a.entity_type, a.entity_id, a.created_at, u.name AS actor_name
        FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 10`).all(),
    });
  });

  // ---- Verification ----
  router.get('/verifications', (req, res) => {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    res.json(getDb().prepare(`SELECT p.id, u.name, u.email, u.phone, c.name AS city, p.experience_years, p.verification_status,
        p.rejection_reason, p.created_at, p.verified_at, p.is_sample,
        (SELECT COUNT(*) FROM pandit_verification_documents d WHERE d.pandit_id = p.id AND d.purged_at IS NULL) AS document_count
      FROM pandit_profiles p JOIN users u ON u.id = p.user_id JOIN cities c ON c.id = p.city_id
      WHERE p.verification_status = ? ORDER BY p.created_at`).all(status));
  });

  router.get('/verifications/:id', (req, res) => {
    const db = getDb();
    const id = idParam(req.params.id);
    const p = db.prepare(`SELECT p.*, u.name, u.email, u.phone, u.status AS account_status, c.name AS city
      FROM pandit_profiles p JOIN users u ON u.id = p.user_id JOIN cities c ON c.id = p.city_id WHERE p.id = ?`).get(id);
    if (!p) throw notFound('Application not found.');
    audit(req, 'verification.viewed', 'pandit', id);
    res.json({
      ...p,
      photo_url: p.photo_path ? `/uploads/photos/${p.photo_path}` : null,
      languages: db.prepare('SELECT language FROM pandit_languages WHERE pandit_id = ?').all(id).map((r) => r.language),
      specializations: db.prepare('SELECT c.name FROM pandit_specializations s JOIN puja_categories c ON c.id = s.category_id WHERE s.pandit_id = ?').all(id).map((r) => r.name),
      service_areas: db.prepare('SELECT locality FROM pandit_service_areas WHERE pandit_id = ?').all(id).map((r) => r.locality),
      services: db.prepare('SELECT name, price, duration_minutes, mode FROM pandit_services WHERE pandit_id = ?').all(id),
      documents: db.prepare('SELECT id, doc_type, original_name, mime_type, size_bytes, uploaded_at, purged_at FROM pandit_verification_documents WHERE pandit_id = ?').all(id),
    });
  });

  router.patch('/verifications/:id', (req, res) => {
    const data = validate(req.body, {
      decision: { type: 'enum', required: true, values: ['approve', 'reject'], label: 'Decision' },
      reason: { type: 'string', max: 1000, default: '', label: 'Reason' },
      identity_verified: { type: 'bool', default: true },
      experience_verified: { type: 'bool', default: false },
    });
    if (data.decision === 'reject' && data.reason.length < 5) throw badRequest('Please give the applicant a reason for rejection.');
    const db = getDb();
    const id = idParam(req.params.id);
    const p = db.prepare('SELECT * FROM pandit_profiles WHERE id = ?').get(id);
    if (!p) throw notFound('Application not found.');
    if (data.decision === 'approve') {
      db.prepare(`UPDATE pandit_profiles SET verification_status = 'approved', rejection_reason = NULL, identity_verified = ?, experience_verified = ?,
        verified_at = datetime('now'), verified_by = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(data.identity_verified ? 1 : 0, data.experience_verified ? 1 : 0, req.user.id, id);
      notify(p.user_id, 'verification_approved', 'Your profile is verified',
        'Congratulations! Your pandit profile has been approved and is now visible to customers.', '/pandit-dashboard.html');
    } else {
      db.prepare(`UPDATE pandit_profiles SET verification_status = 'rejected', rejection_reason = ?, identity_verified = 0, experience_verified = 0,
        verified_at = datetime('now'), verified_by = ?, updated_at = datetime('now') WHERE id = ?`).run(data.reason, req.user.id, id);
      notify(p.user_id, 'verification_rejected', 'Application not approved',
        `Your application was not approved. Reason: ${data.reason}. You can update your profile and upload new documents.`, '/pandit-dashboard.html');
    }
    audit(req, `verification.${data.decision}`, 'pandit', id, { reason: data.reason, identity_verified: data.identity_verified, experience_verified: data.experience_verified });
    res.json({ ok: true });
  });

  // Private documents are streamed only through this admin-only route.
  router.get('/documents/:id', (req, res) => {
    const doc = getDb().prepare('SELECT * FROM pandit_verification_documents WHERE id = ?').get(idParam(req.params.id));
    if (!doc || doc.purged_at || !doc.stored_name) throw notFound('Document not found or already purged.');
    const file = documentPath(doc.stored_name);
    if (!fs.existsSync(file)) throw notFound('Document file missing.');
    audit(req, 'document.viewed', 'document', doc.id, { pandit_id: doc.pandit_id });
    res.set({
      'Content-Type': doc.mime_type,
      'Content-Disposition': `inline; filename="document-${doc.id}${doc.mime_type === 'application/pdf' ? '.pdf' : ''}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });

  // ---- Users ----
  router.get('/users', (req, res) => {
    const where = ['1 = 1'];
    const params = [];
    if (['customer', 'pandit', 'admin'].includes(req.query.role)) { where.push('u.role = ?'); params.push(req.query.role); }
    if (req.query.q) { where.push('(u.name LIKE ? OR u.email LIKE ?)'); const q = `%${String(req.query.q).replace(/[%_]/g, '')}%`; params.push(q, q); }
    res.json(getDb().prepare(`SELECT u.id, u.role, u.name, u.email, u.phone, u.status, u.created_at, u.last_login_at,
        p.id AS pandit_id, p.verification_status FROM users u LEFT JOIN pandit_profiles p ON p.user_id = u.id
      WHERE ${where.join(' AND ')} ORDER BY u.id DESC LIMIT 200`).all(...params));
  });

  router.patch('/users/:id/status', (req, res) => {
    const { status, reason } = validate(req.body, {
      status: { type: 'enum', required: true, values: ['active', 'suspended'] },
      reason: { type: 'string', max: 500, default: '' },
    });
    const id = idParam(req.params.id);
    if (id === req.user.id) throw badRequest('You cannot change your own account status.');
    const db = getDb();
    const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
    if (!u) throw notFound('User not found.');
    db.prepare("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
    if (status === 'suspended') db.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?").run(id);
    audit(req, `user.${status === 'active' ? 'reactivated' : 'suspended'}`, 'user', id, { reason });
    res.json({ ok: true });
  });

  // ---- Categories ----
  const CAT_RULES = {
    name: { type: 'string', required: true, min: 2, max: 80, label: 'Name' },
    description: { type: 'string', max: 500, default: '' },
    icon: { type: 'string', max: 40, default: 'bi-flower1', pattern: /^bi-[a-z0-9-]+$/, patternMessage: 'Icon must be a Bootstrap icon class like bi-fire.' },
    sort_order: { type: 'int', min: 0, max: 1000, default: 100 },
    is_active: { type: 'bool', default: true },
  };
  const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  router.get('/categories', (req, res) => {
    res.json(getDb().prepare(`SELECT c.*, (SELECT COUNT(*) FROM pandit_services s WHERE s.category_id = c.id) AS service_count
      FROM puja_categories c ORDER BY c.sort_order, c.name`).all());
  });

  router.post('/categories', (req, res) => {
    const d = validate(req.body, CAT_RULES);
    try {
      const info = getDb().prepare('INSERT INTO puja_categories (name, slug, description, icon, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?)')
        .run(d.name, slugify(d.name), d.description, d.icon, d.sort_order, d.is_active ? 1 : 0);
      audit(req, 'category.created', 'category', Number(info.lastInsertRowid), { name: d.name });
      res.status(201).json({ id: Number(info.lastInsertRowid) });
    } catch (err) {
      if (String(err.code).includes('CONSTRAINT')) throw conflict('A category with this name already exists.');
      throw err;
    }
  });

  router.put('/categories/:id', (req, res) => {
    const d = validate(req.body, CAT_RULES);
    const id = idParam(req.params.id);
    try {
      const info = getDb().prepare("UPDATE puja_categories SET name = ?, description = ?, icon = ?, sort_order = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?")
        .run(d.name, d.description, d.icon, d.sort_order, d.is_active ? 1 : 0, id);
      if (!info.changes) throw notFound('Category not found.');
    } catch (err) {
      if (String(err.code).includes('CONSTRAINT')) throw conflict('A category with this name already exists.');
      throw err;
    }
    audit(req, 'category.updated', 'category', id, d);
    res.json({ ok: true });
  });

  router.delete('/categories/:id', (req, res) => {
    const db = getDb();
    const id = idParam(req.params.id);
    const used = db.prepare('SELECT 1 FROM pandit_services WHERE category_id = ? UNION SELECT 1 FROM bookings WHERE category_id = ?').get(id, id);
    if (used) {
      db.prepare("UPDATE puja_categories SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(id);
      audit(req, 'category.deactivated', 'category', id);
      return res.json({ ok: true, deactivated: true });
    }
    const info = db.prepare('DELETE FROM puja_categories WHERE id = ?').run(id);
    if (!info.changes) throw notFound('Category not found.');
    audit(req, 'category.deleted', 'category', id);
    res.json({ ok: true, deleted: true });
  });

  // ---- Complaints & reported profiles ----
  router.get('/complaints', (req, res) => {
    const where = ['1 = 1'];
    const params = [];
    if (['profile_report', 'complaint'].includes(req.query.kind)) { where.push('c.kind = ?'); params.push(req.query.kind); }
    if (['open', 'in_review', 'resolved', 'dismissed'].includes(req.query.status)) { where.push('c.status = ?'); params.push(req.query.status); }
    res.json(getDb().prepare(`SELECT c.*, u.name AS reporter_name, u.email AS reporter_email, pu.name AS pandit_name, b.booking_ref
      FROM complaints c JOIN users u ON u.id = c.reporter_id LEFT JOIN pandit_profiles p ON p.id = c.pandit_id
      LEFT JOIN users pu ON pu.id = p.user_id LEFT JOIN bookings b ON b.id = c.booking_id
      WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT 200`).all(...params));
  });

  router.patch('/complaints/:id', (req, res) => {
    const d = validate(req.body, {
      status: { type: 'enum', required: true, values: ['open', 'in_review', 'resolved', 'dismissed'] },
      admin_note: { type: 'string', max: 2000, default: '' },
    });
    const db = getDb();
    const id = idParam(req.params.id);
    const c = db.prepare('SELECT * FROM complaints WHERE id = ?').get(id);
    if (!c) throw notFound('Complaint not found.');
    db.prepare("UPDATE complaints SET status = ?, admin_note = ?, updated_at = datetime('now') WHERE id = ?").run(d.status, d.admin_note, id);
    notify(c.reporter_id, 'complaint_update', `Update on: ${c.subject}`, `Status: ${d.status.replace('_', ' ')}. ${d.admin_note}`, null);
    audit(req, 'complaint.updated', 'complaint', id, d);
    res.json({ ok: true });
  });

  // ---- Bookings ----
  router.get('/bookings', (req, res) => {
    const where = ['1 = 1'];
    const params = [];
    if (bookings.STATUS_LABEL[req.query.status]) { where.push('b.status = ?'); params.push(req.query.status); }
    if (req.query.q) { where.push('(b.booking_ref LIKE ? OR cu.name LIKE ? OR pu.name LIKE ?)'); const q = `%${String(req.query.q).replace(/[%_]/g, '')}%`; params.push(q, q, q); }
    res.json(bookings.listRows(where.join(' AND '), params, 'b.id DESC').slice(0, 300).map((b) => bookings.serialize(b, 'admin')));
  });

  // ---- Reviews moderation ----
  router.get('/reviews', (req, res) => {
    res.json(getDb().prepare(`SELECT r.*, cu.name AS customer_name, pu.name AS pandit_name, b.booking_ref
      FROM reviews r JOIN users cu ON cu.id = r.customer_id JOIN pandit_profiles p ON p.id = r.pandit_id JOIN users pu ON pu.id = p.user_id
      JOIN bookings b ON b.id = r.booking_id ORDER BY r.id DESC LIMIT 300`).all());
  });

  router.patch('/reviews/:id', (req, res) => {
    const d = validate(req.body, {
      status: { type: 'enum', required: true, values: ['visible', 'hidden'] },
      moderation_note: { type: 'string', max: 500, default: '' },
    });
    const id = idParam(req.params.id);
    const info = getDb().prepare("UPDATE reviews SET status = ?, moderation_note = ?, updated_at = datetime('now') WHERE id = ?").run(d.status, d.moderation_note, id);
    if (!info.changes) throw notFound('Review not found.');
    audit(req, `review.${d.status === 'hidden' ? 'hidden' : 'restored'}`, 'review', id, d);
    res.json({ ok: true });
  });

  // ---- Audit log ----
  router.get('/audit-logs', (req, res) => {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    res.json(getDb().prepare(`SELECT a.*, u.name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.id DESC LIMIT 50 OFFSET ?`).all((page - 1) * 50));
  });

  // ---- Settings ----
  router.get('/settings', (req, res) => res.json(settings.getAll()));

  router.put('/settings', (req, res) => {
    const clean = validate(req.body, settings.SETTING_RULES);
    const db = getDb();
    const stmt = db.prepare("INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at");
    db.transaction(() => {
      for (const [k, v] of Object.entries(clean)) stmt.run(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v), req.user.id);
    })();
    audit(req, 'settings.updated', 'settings', null, clean);
    res.json(settings.getAll());
  });

  return router;
};
