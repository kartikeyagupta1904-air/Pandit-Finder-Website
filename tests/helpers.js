'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const request = require('supertest');

process.env.NODE_ENV = 'test';

/** Fresh app + database + upload dir in a temp folder for each test file. */
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pandit-finder-test-'));
  process.env.UPLOAD_DIR = path.join(dir, 'uploads');
  // Config reads env at require time, so clear cached modules.
  for (const k of Object.keys(require.cache)) if (k.includes(`${path.sep}src${path.sep}`)) delete require.cache[k];
  const { createApp } = require('../src/app');
  const dbPath = path.join(dir, 'test.db');
  const app = createApp({ dbPath, loginRateLimit: 1000 });
  return { app, db: app.locals.db, dir, dbPath };
}

/** A supertest agent that keeps cookies and sends the CSRF token on writes. */
async function agent(app) {
  const a = request.agent(app);
  let token = (await a.get('/api/auth/csrf')).body.csrfToken;
  const wrap = (method) => (url) => {
    const req = a[method](url).set('X-CSRF-Token', token);
    const origThen = req.then.bind(req);
    req.then = (res, rej) => origThen((r) => { if (r.body && r.body.csrfToken) token = r.body.csrfToken; return r; }).then(res, rej);
    return req;
  };
  return { get: (u) => a.get(u), post: wrap('post'), put: wrap('put'), patch: wrap('patch'), delete: wrap('delete'), raw: a };
}

function createAdmin(db, email = 'admin@test.local', password = 'Admin-password-123') {
  db.prepare("INSERT INTO users (role, name, email, password_hash) VALUES ('admin', 'Test Admin', ?, ?)").run(email, bcrypt.hashSync(password, 4));
  return { email, password };
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);

function dateFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function applyAsPandit(app, overrides = {}) {
  const a = await agent(app);
  const db = app.locals.db;
  const city = db.prepare("SELECT id FROM cities WHERE name = 'Pune'").get().id;
  const cat = db.prepare("SELECT id FROM puja_categories WHERE slug = 'griha-pravesh'").get().id;
  const fields = {
    name: 'Pt. Test Pandit', email: `pandit${Date.now()}${Math.random().toString(36).slice(2, 6)}@test.local`, password: 'Pandit-pass-123', phone: '+91 98765 43210',
    city_id: String(city), service_areas: 'Kothrud, Baner', languages: JSON.stringify(['Hindi', 'Marathi']), experience_years: '12',
    specializations: JSON.stringify([cat]), bio: 'Experienced Vedic pandit performing griha pravesh and havan ceremonies in Pune.',
    preferred_contact: 'phone', offers_online: 'false', consent: 'true',
    services: JSON.stringify([{ category_id: cat, name: 'Griha Pravesh Puja', duration_minutes: 120, price: 5000, samagri_included: true, travel_charges_apply: true, travel_charge: 500, mode: 'in_person' }]),
    availability_weekdays: JSON.stringify([0, 1, 2, 3, 4, 5, 6]), availability_start: '06:00', availability_end: '20:00',
    ...overrides,
  };
  let req = a.post('/api/pandits/apply');
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  req = req.attach('identity_document', overrides.idFile || PDF, { filename: 'id.pdf', contentType: 'application/pdf' })
    .attach('photo', PNG, { filename: 'me.png', contentType: 'image/png' });
  const res = await req;
  return { agent: a, res, email: fields.email, password: fields.password };
}

module.exports = { setup, agent, createAdmin, PDF, PNG, dateFromToday, applyAsPandit };
