'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setup, agent, createAdmin, dateFromToday, applyAsPandit } = require('./helpers');

describe('Pandit Finder end-to-end workflows', () => {
  let app; let db; let ctx;
  let admin; let customer; let customer2; let pandit; let panditId; let serviceId;
  const day = dateFromToday(3);

  before(async () => {
    ctx = setup();
    app = ctx.app; db = ctx.db;
    const creds = createAdmin(db);
    admin = await agent(app);
    await admin.post('/api/auth/login').send(creds).expect(200);
  });

  // 1. Customer registration and login
  test('customer registration, login, logout and /me', async () => {
    customer = await agent(app);
    const r = await customer.post('/api/auth/register').send({ name: 'Asha Verma', email: 'asha@test.local', password: 'Customer-123', city: 'Pune' });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.role, 'customer');
    assert.equal((await customer.get('/api/auth/me')).body.user.email, 'asha@test.local');

    // Role cannot be escalated via the registration body.
    const sneaky = await agent(app);
    const s = await sneaky.post('/api/auth/register').send({ name: 'Evil', email: 'evil@test.local', password: 'Evil-12345', role: 'admin' });
    assert.equal(s.body.user.role, 'customer');

    // Duplicate email, bad password, wrong login.
    assert.equal((await sneaky.post('/api/auth/register').send({ name: 'Dup', email: 'ASHA@test.local', password: 'Customer-123' })).status, 409);
    assert.equal((await sneaky.post('/api/auth/register').send({ name: 'Weak', email: 'weak@test.local', password: 'short' })).status, 400);
    assert.equal((await sneaky.post('/api/auth/login').send({ email: 'asha@test.local', password: 'wrong-pass1' })).status, 401);

    await customer.post('/api/auth/logout').expect(200);
    assert.equal((await customer.get('/api/auth/me')).body.user, null);
    customer = await agent(app);
    await customer.post('/api/auth/login').send({ email: 'asha@test.local', password: 'Customer-123' }).expect(200);

    customer2 = await agent(app);
    await customer2.post('/api/auth/register').send({ name: 'Ravi Kumar', email: 'ravi@test.local', password: 'Customer-456' }).expect(201);

    // Passwords are hashed.
    const row = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('asha@test.local');
    assert.match(row.password_hash, /^\$2[aby]\$/);
  });

  test('CSRF token is required for state-changing requests', async () => {
    const request = require('supertest');
    const r = await request(app).post('/api/auth/login').send({ email: 'asha@test.local', password: 'Customer-123' });
    assert.equal(r.status, 403);
  });

  // 2. Pandit application submission
  test('pandit application creates a pending, non-public profile with private documents', async () => {
    const out = await applyAsPandit(app);
    assert.equal(out.res.status, 201, JSON.stringify(out.res.body));
    pandit = out.agent;
    panditId = out.res.body.pandit_id;
    assert.equal(out.res.body.verification_status, 'pending');
    serviceId = db.prepare('SELECT id FROM pandit_services WHERE pandit_id = ?').get(panditId).id;

    // Not visible publicly before approval.
    assert.equal((await customer.get(`/api/pandits/${panditId}`)).status, 404);
    assert.equal((await customer.get('/api/pandits?city=Pune')).body.total, 0);

    // Document stored privately, never under /public, never served statically.
    const doc = db.prepare('SELECT stored_name FROM pandit_verification_documents WHERE pandit_id = ?').get(panditId);
    assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR, 'private', doc.stored_name)));
    assert.equal((await customer.get(`/uploads/private/${doc.stored_name}`)).status, 404);

    // Invalid file type is rejected.
    const bad = await applyAsPandit(app, { idFile: Buffer.from('just text, not a document at all') });
    assert.equal(bad.res.status, 400);
    assert.match(bad.res.body.error, /PDF, JPG, PNG/);
  });

  // 3. Administrator verification
  test('only admins can review applications and view documents; approval publishes the profile', async () => {
    assert.equal((await customer.get('/api/admin/verifications')).status, 403);
    assert.equal((await pandit.get('/api/admin/dashboard')).status, 403);
    const docId = db.prepare('SELECT id FROM pandit_verification_documents WHERE pandit_id = ?').get(panditId).id;
    assert.equal((await customer.get(`/api/admin/documents/${docId}`)).status, 403);

    const list = await admin.get('/api/admin/verifications?status=pending');
    assert.ok(list.body.some((p) => p.id === panditId));
    const docRes = await admin.get(`/api/admin/documents/${docId}`);
    assert.equal(docRes.status, 200);
    assert.equal(docRes.headers['content-type'], 'application/pdf');

    assert.equal((await admin.patch(`/api/admin/verifications/${panditId}`).send({ decision: 'reject' })).status, 400, 'reason required');
    await admin.patch(`/api/admin/verifications/${panditId}`).send({ decision: 'approve', identity_verified: true }).expect(200);
    const p = await customer.get(`/api/pandits/${panditId}`);
    assert.equal(p.status, 200);
    assert.equal(p.body.identity_verified, true);
    assert.equal(p.body.experience_verified, false);
    // Private data never exposed publicly.
    const text = JSON.stringify(p.body);
    assert.ok(!text.includes('98765'), 'phone must not be public');
    assert.ok(!text.includes('@test.local'), 'email must not be public');
    assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action = 'verification.approve'").get());
    assert.ok(db.prepare("SELECT 1 FROM notifications n JOIN pandit_profiles p ON p.user_id = n.user_id WHERE p.id = ? AND n.type = 'verification_approved'").get(panditId));
  });

  // 4 & 5. Searching, filtering and viewing profiles
  test('search filters and sorting come from the database', async () => {
    const q = async (s) => (await customer.get(`/api/pandits?${s}`)).body;
    assert.equal((await q('city=Pune')).total, 1);
    assert.equal((await q('city=Delhi')).total, 0);
    assert.equal((await q('locality=baner')).total, 1);
    assert.equal((await q('category=griha-pravesh')).total, 1);
    assert.equal((await q('category=havan')).total, 0);
    assert.equal((await q('language=marathi')).total, 1);
    assert.equal((await q('language=Tamil')).total, 0);
    assert.equal((await q('min_experience=10')).total, 1);
    assert.equal((await q('min_experience=20')).total, 0);
    assert.equal((await q('max_price=4000')).total, 0);
    assert.equal((await q('min_price=4000&max_price=6000')).total, 1);
    assert.equal((await q('mode=online')).total, 0);
    assert.equal((await q('min_rating=4')).total, 0, 'no reviews yet');
    assert.equal((await q(`date=${day}`)).total, 1);
    assert.equal((await q('sort=price_desc&limit=1&page=1')).results.length, 1);
    const card = (await q('city=Pune')).results[0];
    assert.equal(card.starting_price, 5000);
    assert.deepEqual(card.languages.sort(), ['Hindi', 'Marathi']);
  });

  test('date filter only returns pandits with confirmed free time', async () => {
    db.prepare('INSERT INTO blocked_dates (pandit_id, date) VALUES (?, ?)').run(panditId, dateFromToday(5));
    assert.equal((await customer.get(`/api/pandits?date=${dateFromToday(5)}`)).body.total, 0);
    const avail = await customer.get(`/api/pandits/${panditId}/availability?date=${dateFromToday(5)}`);
    assert.equal(avail.body.slots.length, 0);
    assert.equal(avail.body.blocked, true);
  });

  // 6. Creating a booking request
  let bookingA; let bookingB;
  test('customer creates a booking request; server computes price and validates slot', async () => {
    const slots = (await customer.get(`/api/pandits/${panditId}/availability?date=${day}&service_id=${serviceId}`)).body.slots;
    assert.ok(slots.find((s) => s.start === '10:00'));
    const r = await customer.post('/api/bookings').send({
      pandit_id: panditId, service_id: serviceId, date: day, start_time: '10:00', location_text: 'Kothrud, Pune',
      estimated_price: 1, status: 'confirmed', customer_id: 999, // must be ignored
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    bookingA = r.body;
    assert.equal(bookingA.status, 'pending');
    assert.equal(bookingA.estimated_price, 5500, 'service price + travel, computed on the server');
    assert.equal(bookingA.end_time, '12:00');
    assert.equal(db.prepare('SELECT customer_id FROM bookings WHERE id = ?').get(bookingA.id).customer_id,
      db.prepare("SELECT id FROM users WHERE email = 'asha@test.local'").get().id);

    // Second, overlapping pending request from another customer is allowed (not yet confirmed).
    const r2 = await customer2.post('/api/bookings').send({ service_id: serviceId, date: day, start_time: '11:00', location_text: 'Baner, Pune' });
    assert.equal(r2.status, 201);
    bookingB = r2.body;
  });

  // 13. Handling invalid inputs
  test('invalid booking inputs are rejected', async () => {
    const base = { service_id: serviceId, location_text: 'Kothrud, Pune' };
    const cases = [
      [{ ...base, date: dateFromToday(-1), start_time: '10:00' }, 409], // past
      [{ ...base, date: '2026-02-30', start_time: '10:00' }, 409],     // invalid date
      [{ ...base, date: day, start_time: '25:00' }, 400],              // invalid time
      [{ ...base, date: day, start_time: '10:15' }, 409],              // not on slot grid
      [{ ...base, date: day, start_time: '19:00' }, 409],              // runs past window end
      [{ ...base, date: day, start_time: '03:00' }, 409],              // outside published availability
      [{ ...base, date: dateFromToday(5), start_time: '10:00' }, 409], // blocked date
      [{ service_id: serviceId, date: day, start_time: '10:00' }, 400], // missing location
      [{ ...base, service_id: 99999, date: day, start_time: '10:00' }, 400],
    ];
    for (const [body, status] of cases) {
      const r = await customer.post('/api/bookings').send(body);
      assert.equal(r.status, status, `${JSON.stringify(body)} -> ${r.status} ${r.body.error}`);
    }
    // Pandits and anonymous users cannot create bookings.
    assert.equal((await pandit.post('/api/bookings').send({ ...base, date: day, start_time: '10:00' })).status, 403);
    const anon = await agent(app);
    assert.equal((await anon.post('/api/bookings').send({ ...base, date: day, start_time: '10:00' })).status, 401);
    // Malformed JSON
    const bad = await customer.post('/api/bookings').set('Content-Type', 'application/json').send('{"bad json');
    assert.equal(bad.status, 400);
  });

  // 11. Preventing unauthorized data access
  test('users can only access their own bookings', async () => {
    assert.equal((await customer.get(`/api/bookings/${bookingA.id}`)).status, 200);
    assert.equal((await customer2.get(`/api/bookings/${bookingA.id}`)).status, 404);
    assert.equal((await customer2.post(`/api/bookings/${bookingA.id}/cancel`).send({ reason: 'not mine', confirm: true })).status, 404);
    assert.equal((await customer.patch(`/api/bookings/${bookingA.id}/status`).send({ status: 'accepted' })).status, 403);
    assert.equal((await customer2.get(`/api/bookings/${bookingA.id}/messages`)).status, 404);

    // Another pandit cannot see or change this pandit's bookings.
    const other = await applyAsPandit(app);
    const otherAgent = other.agent;
    assert.equal((await otherAgent.get(`/api/bookings/${bookingA.id}`)).status, 404);
    assert.equal((await otherAgent.patch(`/api/bookings/${bookingA.id}/status`).send({ status: 'accepted' })).status, 404);
    assert.equal((await otherAgent.put(`/api/pandit/services/${serviceId}`).send({ category_id: 1, name: 'Hijack', duration_minutes: 60, price: 1 })).status, 404);
    const mine = (await otherAgent.get('/api/bookings/my')).body;
    assert.equal(mine.length, 0);
    // Customers cannot use pandit routes.
    assert.equal((await customer.get('/api/pandit/dashboard')).status, 403);
  });

  // 7 & 8. Accepting/rejecting and conflict prevention
  test('pandit accepts a request; overlapping requests cannot both be accepted', async () => {
    await pandit.patch(`/api/bookings/${bookingA.id}/status`).send({ status: 'accepted' }).expect(200);
    // B overlapped A and was automatically declined.
    const b = await customer2.get(`/api/bookings/${bookingB.id}`);
    assert.equal(b.body.status, 'rejected');
    // Accepted time is no longer offered.
    const slots = (await customer.get(`/api/pandits/${panditId}/availability?date=${day}&service_id=${serviceId}`)).body.slots.map((s) => s.start);
    assert.ok(!slots.includes('10:00') && !slots.includes('11:00') && !slots.includes('09:00'));
    assert.ok(slots.includes('12:00'));
    // New request for the taken time is refused by the server.
    assert.equal((await customer2.post('/api/bookings').send({ service_id: serviceId, date: day, start_time: '11:00', location_text: 'Baner' })).status, 409);

    // Database trigger blocks overlapping accepted bookings even if app checks are bypassed.
    const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingA.id);
    assert.throws(() => db.prepare(`INSERT INTO bookings (booking_ref, customer_id, pandit_id, service_id, ceremony_type, date, start_min, end_min, location_text, estimated_price, status)
      VALUES ('PF-RACE', ?, ?, ?, 'x', ?, ?, ?, 'x', 1, 'confirmed')`).run(row.customer_id, row.pandit_id, row.service_id, row.date, row.start_min + 30, row.end_min + 30), /BOOKING_OVERLAP/);
  });

  test('concurrent booking requests followed by concurrent accepts yield one accepted booking', async () => {
    const d = dateFromToday(4);
    const [r1, r2] = await Promise.all([
      customer.post('/api/bookings').send({ service_id: serviceId, date: d, start_time: '08:00', location_text: 'Kothrud' }),
      customer2.post('/api/bookings').send({ service_id: serviceId, date: d, start_time: '08:30', location_text: 'Baner' }),
    ]);
    assert.equal(r1.status, 201); assert.equal(r2.status, 201);
    const [a1, a2] = await Promise.all([
      pandit.patch(`/api/bookings/${r1.body.id}/status`).send({ status: 'accepted' }),
      pandit.patch(`/api/bookings/${r2.body.id}/status`).send({ status: 'accepted' }),
    ]);
    const statuses = [a1.status, a2.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const accepted = db.prepare("SELECT COUNT(*) n FROM bookings WHERE pandit_id = ? AND date = ? AND status IN ('accepted','confirmed')").get(panditId, d).n;
    assert.equal(accepted, 1);
  });

  test('rejecting requires a reason and notifies the customer', async () => {
    const r = await customer.post('/api/bookings').send({ service_id: serviceId, date: dateFromToday(6), start_time: '14:00', location_text: 'Kothrud' });
    assert.equal((await pandit.patch(`/api/bookings/${r.body.id}/status`).send({ status: 'rejected' })).status, 400);
    await pandit.patch(`/api/bookings/${r.body.id}/status`).send({ status: 'rejected', reason: 'Travelling that day' }).expect(200);
    const n = (await customer.get('/api/notifications')).body;
    assert.ok(n.items.some((x) => x.type === 'booking_rejected'));
    assert.ok(n.unread > 0);
    // Rejected booking cannot be accepted afterwards.
    assert.equal((await pandit.patch(`/api/bookings/${r.body.id}/status`).send({ status: 'accepted' })).status, 409);
  });

  test('customer confirms with pay-later; payment recorded as pending (no fake success)', async () => {
    await customer.post(`/api/bookings/${bookingA.id}/confirm`).send({ payment_method: 'pay_later' }).expect(200);
    const b = (await customer.get(`/api/bookings/${bookingA.id}`)).body;
    assert.equal(b.status, 'confirmed');
    assert.equal(b.payments[0].provider, 'pay_later');
    assert.equal(b.payments[0].status, 'pending');
    assert.ok(b.contact, 'contact shared after acceptance');
    assert.equal((await customer.post(`/api/bookings/${bookingA.id}/payments/razorpay-order`).send({})).status, 503);
    // Pandit cannot block a date with a confirmed booking.
    assert.equal((await pandit.post('/api/pandit/blocked-dates').send({ date: day })).status, 409);
  });

  // 9. Cancelling and rescheduling
  test('reschedule moves booking back to pending and validates the new slot on the server', async () => {
    const newDay = dateFromToday(7);
    assert.equal((await customer.post(`/api/bookings/${bookingA.id}/reschedule`).send({ date: dateFromToday(5), start_time: '10:00' })).status, 409, 'blocked date');
    assert.equal((await customer.post(`/api/bookings/${bookingA.id}/reschedule`).send({ date: newDay, start_time: '10:00', note: 'Family travel' })).status, 200);
    const b = (await customer.get(`/api/bookings/${bookingA.id}`)).body;
    assert.equal(b.status, 'pending');
    assert.equal(b.date, newDay);
    assert.ok(b.events.some((e) => e.event === 'rescheduled'));
    // Old slot is free again.
    const slots = (await customer.get(`/api/pandits/${panditId}/availability?date=${day}&service_id=${serviceId}`)).body.slots.map((s) => s.start);
    assert.ok(slots.includes('10:00'));
  });

  test('cancellation requires explicit confirmation and respects the policy window', async () => {
    assert.equal((await customer.post(`/api/bookings/${bookingA.id}/cancel`).send({ reason: 'Plans changed' })).status, 400);
    assert.equal((await customer.post(`/api/bookings/${bookingA.id}/cancel`).send({ reason: 'Plans changed', confirm: false })).status, 400);

    // Accepted booking inside the 24h window cannot be cancelled by the customer.
    const soon = dateFromToday(1);
    const r = await customer.post('/api/bookings').send({ service_id: serviceId, date: soon, start_time: '17:00', location_text: 'Kothrud' });
    assert.equal(r.status, 201, r.body.error);
    await pandit.patch(`/api/bookings/${r.body.id}/status`).send({ status: 'accepted' }).expect(200);
    db.prepare("UPDATE platform_settings SET value = '72' WHERE key = 'cancellation_hours'").run();
    assert.equal((await customer.post(`/api/bookings/${r.body.id}/cancel`).send({ reason: 'Plans changed', confirm: true })).status, 409);
    db.prepare("UPDATE platform_settings SET value = '24' WHERE key = 'cancellation_hours'").run();

    const ok = await customer.post(`/api/bookings/${bookingA.id}/cancel`).send({ reason: 'Plans changed', confirm: true });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'cancelled');
    assert.equal((await customer.post(`/api/bookings/${bookingA.id}/cancel`).send({ reason: 'again', confirm: true })).status, 409);
  });

  // 10. Submitting eligible reviews
  test('reviews only for completed bookings, once per booking; ratings computed from records', async () => {
    const r = await customer.post('/api/bookings').send({ service_id: serviceId, date: dateFromToday(8), start_time: '09:00', location_text: 'Kothrud' });
    const id = r.body.id;
    await pandit.patch(`/api/bookings/${id}/status`).send({ status: 'accepted' }).expect(200);
    assert.equal((await customer.post(`/api/bookings/${id}/review`).send({ rating: 5 })).status, 409, 'not completed yet');
    assert.equal((await pandit.patch(`/api/bookings/${id}/status`).send({ status: 'completed' })).status, 409, 'cannot complete before start');

    // Move the ceremony into the past (simulating time passing) and complete it.
    db.prepare('UPDATE bookings SET date = ? WHERE id = ?').run(dateFromToday(-1), id);
    await pandit.patch(`/api/bookings/${id}/status`).send({ status: 'completed' }).expect(200);

    assert.equal((await customer2.post(`/api/bookings/${id}/review`).send({ rating: 1 })).status, 404, 'not their booking');
    assert.equal((await customer.post(`/api/bookings/${id}/review`).send({ rating: 6 })).status, 400);
    await customer.post(`/api/bookings/${id}/review`).send({ rating: 4, comment: 'Very well conducted ceremony.' }).expect(201);
    assert.equal((await customer.post(`/api/bookings/${id}/review`).send({ rating: 5 })).status, 409, 'duplicate');

    const rv = (await customer.get(`/api/pandits/${panditId}/reviews`)).body;
    assert.equal(rv.summary.count, 1);
    assert.equal(rv.summary.average, 4);
    assert.equal(rv.reviews[0].customer_name, 'Asha V.');
    const card = (await customer.get('/api/pandits?city=Pune')).body.results[0];
    assert.equal(card.rating, 4);
    assert.equal(card.review_count, 1);

    // Moderation hides the review and the average updates.
    const reviewId = db.prepare('SELECT id FROM reviews WHERE booking_id = ?').get(id).id;
    assert.equal((await pandit.patch(`/api/admin/reviews/${reviewId}`).send({ status: 'hidden' })).status, 403);
    await admin.patch(`/api/admin/reviews/${reviewId}`).send({ status: 'hidden', moderation_note: 'test' }).expect(200);
    assert.equal((await customer.get(`/api/pandits/${panditId}/reviews`)).body.summary.count, 0);

    // Earnings: completed value is an estimate; received stays 0 until a payment is recorded.
    let dash = (await pandit.get('/api/pandit/dashboard')).body;
    assert.equal(dash.earnings.received_total, 0);
    assert.equal(dash.earnings.completed_bookings_estimated_value, 5500);
    await pandit.post(`/api/bookings/${id}/payments/offline`).send({ amount: 5500 }).expect(200);
    dash = (await pandit.get('/api/pandit/dashboard')).body;
    assert.equal(dash.earnings.received_offline_self_reported, 5500);
  });

  // 12. Managing services and availability
  test('pandit manages services and availability', async () => {
    const cat = db.prepare("SELECT id FROM puja_categories WHERE slug = 'havan'").get().id;
    const s = await pandit.post('/api/pandit/services').send({ category_id: cat, name: 'Shanti Havan', duration_minutes: 90, price: 3100, mode: 'both' });
    assert.equal(s.status, 201);
    assert.equal((await pandit.post('/api/pandit/services').send({ category_id: cat, name: 'Bad', duration_minutes: 45, price: 100 })).status, 400, 'duration step');
    assert.equal((await pandit.post('/api/pandit/services').send({ category_id: cat, name: 'Bad', duration_minutes: 60, price: -5 })).status, 400);
    await pandit.put(`/api/pandit/services/${s.body.id}`).send({ category_id: cat, name: 'Shanti Havan (updated)', duration_minutes: 90, price: 3500, mode: 'online' }).expect(200);
    assert.equal((await customer.get('/api/pandits?category=havan&mode=online')).body.total, 1);
    const del = await pandit.delete(`/api/pandit/services/${s.body.id}`);
    assert.equal(del.body.deleted, true);
    const del2 = await pandit.delete(`/api/pandit/services/${serviceId}`);
    assert.equal(del2.body.archived, true, 'services with bookings are archived, not deleted');
    await pandit.put(`/api/pandit/services/${serviceId}`).send({ category_id: db.prepare("SELECT id FROM puja_categories WHERE slug = 'griha-pravesh'").get().id, name: 'Griha Pravesh Puja', duration_minutes: 120, price: 5000, travel_charges_apply: true, travel_charge: 500, is_active: true }).expect(200);

    const target = dateFromToday(20);
    db.prepare('DELETE FROM availability_slots WHERE pandit_id = ? AND date = ?').run(panditId, target);
    const add = await pandit.post('/api/pandit/availability').send({ date: target, start_time: '08:00', end_time: '10:00' });
    assert.equal(add.body.created, 1);
    assert.equal((await pandit.post('/api/pandit/availability').send({ date: target, start_time: '09:00', end_time: '11:00' })).body.created, 0, 'overlap skipped');
    assert.equal((await pandit.post('/api/pandit/availability').send({ date: target, start_time: '10:00', end_time: '09:00' })).status, 400);
    const slots = (await customer.get(`/api/pandits/${panditId}/availability?date=${target}&service_id=${serviceId}`)).body.slots;
    assert.deepEqual(slots.map((x) => x.start), ['08:00']);
    const block = await pandit.post('/api/pandit/blocked-dates').send({ date: target, reason: 'Festival travel' });
    assert.equal(block.status, 201);
    assert.equal((await customer.get(`/api/pandits/${panditId}/availability?date=${target}&service_id=${serviceId}`)).body.slots.length, 0);

    // Profile update; changing experience resets its verified flag.
    db.prepare('UPDATE pandit_profiles SET experience_verified = 1 WHERE id = ?').run(panditId);
    const city = db.prepare("SELECT id FROM cities WHERE name = 'Mumbai'").get().id;
    await pandit.put('/api/pandits/profile').send({ name: 'Pt. Test Pandit', phone: '+91 98765 43210', city_id: city, bio: 'Updated biography for the test pandit with enough characters.',
      experience_years: 15, languages: ['Hindi'], specializations: [cat], service_areas: ['Andheri'] }).expect(200);
    const me = (await pandit.get('/api/pandit/me')).body;
    assert.equal(me.city.name, 'Mumbai');
    assert.equal(me.experience_verified, false);
  });

  test('admin functions: suspend, categories, complaints, settings, audit', async () => {
    const custId = db.prepare("SELECT id FROM users WHERE email = 'ravi@test.local'").get().id;
    await customer2.post('/api/complaints').send({ kind: 'profile_report', pandit_id: panditId, subject: 'Wrong info', details: 'The listed experience seems incorrect.' }).expect(201);
    const comps = (await admin.get('/api/admin/complaints')).body;
    assert.equal(comps.length, 1);
    await admin.patch(`/api/admin/complaints/${comps[0].id}`).send({ status: 'resolved', admin_note: 'Checked' }).expect(200);

    await admin.patch(`/api/admin/users/${custId}/status`).send({ status: 'suspended', reason: 'test' }).expect(200);
    assert.equal((await customer2.get('/api/auth/me')).body.user, null, 'suspended user is logged out');
    const relog = await agent(app);
    assert.equal((await relog.post('/api/auth/login').send({ email: 'ravi@test.local', password: 'Customer-456' })).status, 403);
    await admin.patch(`/api/admin/users/${custId}/status`).send({ status: 'active' }).expect(200);

    const c = await admin.post('/api/admin/categories').send({ name: 'Annaprashan', icon: 'bi-egg' });
    assert.equal(c.status, 201);
    assert.equal((await admin.post('/api/admin/categories').send({ name: 'Annaprashan' })).status, 409);
    assert.equal((await admin.post('/api/admin/categories').send({ name: 'X1', icon: '"><script>' })).status, 400);
    assert.ok((await customer.get('/api/categories')).body.some((x) => x.name === 'Annaprashan'));

    assert.equal((await admin.put('/api/admin/settings').send({ cancellation_hours: -1 })).status, 400);
    const s = await admin.put('/api/admin/settings').send({ cancellation_hours: 48, allow_new_pandit_applications: false });
    assert.equal(s.body.cancellation_hours, '48');
    assert.equal((await applyAsPandit(app)).res.status, 403, 'applications paused');
    await admin.put('/api/admin/settings').send({ cancellation_hours: 24, allow_new_pandit_applications: true }).expect(200);

    const dash = (await admin.get('/api/admin/dashboard')).body;
    assert.ok(dash.customers >= 2 && dash.bookings.total >= 1);
    const logs = (await admin.get('/api/admin/audit-logs')).body.map((l) => l.action);
    for (const a of ['user.suspended', 'category.created', 'settings.updated', 'document.viewed']) assert.ok(logs.includes(a), a);
  });

  test('password change works and old password stops working', async () => {
    assert.equal((await customer.post('/api/auth/change-password').send({ current_password: 'wrong', new_password: 'Newpass-123' })).status, 400);
    await customer.post('/api/auth/change-password').send({ current_password: 'Customer-123', new_password: 'Newpass-123' }).expect(200);
    const a = await agent(app);
    assert.equal((await a.post('/api/auth/login').send({ email: 'asha@test.local', password: 'Customer-123' })).status, 401);
    assert.equal((await a.post('/api/auth/login').send({ email: 'asha@test.local', password: 'Newpass-123' })).status, 200);
  });

  // 14. Preserving data after restarting the server
  test('data and sessions persist across a server restart', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM bookings').get().n;
    const cookie = (await customer.get('/api/auth/me')).request.cookies || null;
    void cookie;
    db.close();
    const { createApp } = require('../src/app');
    const app2 = createApp({ dbPath: ctx.dbPath });
    const db2 = app2.locals.db;
    assert.equal(db2.prepare('SELECT COUNT(*) n FROM bookings').get().n, before);
    const login = await agent(app2);
    await login.post('/api/auth/login').send({ email: 'asha@test.local', password: 'Newpass-123' }).expect(200);
    assert.ok((await login.get('/api/bookings/my')).body.length >= 1);
    assert.equal((await login.get(`/api/pandits/${panditId}`)).status, 200);
    db2.close();
  });
});
