'use strict';
/**
 * DEVELOPMENT SAMPLE DATA: npm run seed
 * Every pandit created here has is_sample = 1 and is shown with a "Sample profile"
 * label. Set SHOW_SAMPLE_DATA=0 in production to hide them, or don't run the seed.
 * Passwords are random (or SEED_PASSWORD) and are written to data/sample-credentials.txt.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { openDatabase } = require('./db');
const { today, addDays, weekday } = require('../utils/time');

const db = openDatabase(config.dbPath);
if (db.prepare('SELECT 1 FROM pandit_profiles WHERE is_sample = 1').get()) {
  console.log('Sample data already present. Delete the database file to re-seed.');
  process.exit(0);
}

const password = process.env.SEED_PASSWORD || `Sample-${crypto.randomBytes(5).toString('hex')}1`;
const hash = bcrypt.hashSync(password, 10);
const cat = Object.fromEntries(db.prepare('SELECT slug, id FROM puja_categories').all().map((r) => [r.slug, r.id]));
const city = Object.fromEntries(db.prepare('SELECT name, id FROM cities').all().map((r) => [r.name, r.id]));

const PANDITS = [
  { name: 'Pt. Ramesh Sharma', city: 'Delhi', exp: 22, langs: ['Hindi', 'Sanskrit', 'English'], areas: ['Dwarka', 'Janakpuri', 'Rajouri Garden'],
    bio: 'Vedic scholar trained at a gurukul in Varanasi. Performs griha pravesh, Satyanarayan katha and havan with clear explanations of each ritual in Hindi or English.',
    services: [['griha-pravesh', 'Griha Pravesh Puja', 180, 5100, 1, 1, 500, 'in_person'], ['satyanarayan-puja', 'Satyanarayan Katha', 120, 2100, 0, 1, 300, 'both'], ['havan', 'Shanti Havan', 90, 3100, 1, 1, 300, 'in_person']] },
  { name: 'Acharya Vinod Joshi', city: 'Mumbai', exp: 15, langs: ['Hindi', 'Marathi', 'Sanskrit'], areas: ['Andheri', 'Borivali', 'Thane'],
    bio: 'Specialist in Rudrabhishek and Navgraha Shanti. Conducts ceremonies according to Shukla Yajurveda tradition, with samagri arranged on request.',
    services: [['rudrabhishek', 'Rudrabhishek', 150, 4100, 1, 1, 600, 'in_person'], ['navgraha-shanti', 'Navgraha Shanti Puja', 180, 5500, 1, 1, 600, 'in_person'], ['ganesh-puja', 'Ganesh Puja', 60, 1500, 0, 0, 0, 'both']] },
  { name: 'Pt. Suresh Tiwari', city: 'Pune', exp: 30, langs: ['Hindi', 'Marathi', 'Sanskrit'], areas: ['Kothrud', 'Hinjewadi', 'Viman Nagar'],
    bio: 'Three decades of experience in wedding ceremonies (vivah sanskar) and vastu shanti. Known for punctuality and well-organised rituals for large families.',
    services: [['wedding-ceremony', 'Vivah Sanskar (complete wedding rituals)', 300, 21000, 0, 1, 1000, 'in_person'], ['vastu-shanti', 'Vastu Shanti Puja', 180, 6100, 1, 1, 500, 'in_person']] },
  { name: 'Pt. Krishnan Iyer', city: 'Bengaluru', exp: 12, langs: ['Tamil', 'Kannada', 'Sanskrit', 'English'], areas: ['Jayanagar', 'Whitefield', 'Koramangala'],
    bio: 'South Indian Vedic tradition. Performs Ganapathi homam, Satyanarayan puja and festival pujas, both in person and online for families abroad.',
    services: [['ganesh-puja', 'Ganapathi Homam', 120, 3500, 1, 1, 400, 'in_person'], ['satyanarayan-puja', 'Satyanarayan Puja', 120, 2500, 0, 0, 0, 'both'], ['festival-puja', 'Online Festival Puja', 60, 1100, 0, 0, 0, 'online']] },
  { name: 'Pt. Anil Mishra', city: 'Varanasi', exp: 25, langs: ['Hindi', 'Sanskrit', 'Bhojpuri'], areas: ['Assi Ghat', 'Lanka', 'Sigra'],
    bio: 'Kashi-based pandit performing Rudrabhishek, mundan sanskar and pitru-related rituals at ghats and homes. Can guide visiting families.',
    services: [['rudrabhishek', 'Rudrabhishek at home', 120, 3100, 1, 0, 0, 'in_person'], ['mundan-sanskar', 'Mundan Sanskar', 90, 2100, 0, 0, 0, 'in_person']] },
  { name: 'Pt. Hemant Dave', city: 'Ahmedabad', exp: 9, langs: ['Gujarati', 'Hindi', 'Sanskrit'], areas: ['Satellite', 'Navrangpura', 'Bopal'],
    bio: 'Young, well-trained pandit for griha pravesh, Lakshmi puja and Satyanarayan katha. Explains rituals for first-time hosts.',
    services: [['griha-pravesh', 'Griha Pravesh', 150, 4100, 0, 1, 300, 'in_person'], ['festival-puja', 'Diwali Lakshmi Puja', 90, 2500, 1, 1, 300, 'in_person']] },
  { name: 'Pt. Subhash Chakraborty', city: 'Kolkata', exp: 18, langs: ['Bengali', 'Hindi', 'Sanskrit'], areas: ['Salt Lake', 'Behala', 'New Town'],
    bio: 'Performs Bengali-tradition pujas including Satyanarayan (Shinni), griha pravesh and annaprashan, with all mantras explained.',
    services: [['satyanarayan-puja', 'Satyanarayan Puja (Shinni)', 120, 2000, 1, 1, 200, 'in_person'], ['havan', 'Havan', 90, 2500, 1, 1, 200, 'in_person']] },
  { name: 'Pt. Gopal Shastri', city: 'Jaipur', exp: 20, langs: ['Hindi', 'Sanskrit', 'English'], areas: ['Malviya Nagar', 'Vaishali Nagar', 'Mansarovar'],
    bio: 'Jyotish and karmakand expert offering Navgraha Shanti, Vastu Shanti and wedding ceremonies across Jaipur.',
    services: [['navgraha-shanti', 'Navgraha Shanti', 150, 4500, 1, 1, 400, 'in_person'], ['wedding-ceremony', 'Vivah Ceremony', 300, 15000, 0, 1, 800, 'in_person'], ['vastu-shanti', 'Vastu Shanti', 150, 5100, 1, 1, 400, 'both']] },
];

const CUSTOMERS = ['Sample Customer Anjali', 'Sample Customer Rahul', 'Sample Customer Meera'];
const REVIEWS = [
  [5, 'Panditji explained every step of the griha pravesh to our family. Very punctual and the samagri was complete.'],
  [4, 'Good experience. The katha was well paced and the kids enjoyed it. Arrived ten minutes late but informed us in advance.'],
  [5, 'Very knowledgeable and calm. Our Rudrabhishek felt meaningful and well organised.'],
  [5, 'Excellent coordination before the ceremony through the platform. Highly recommended for first-time hosts.'],
];

const credentials = [];
db.transaction(() => {
  const customerIds = CUSTOMERS.map((name, i) => {
    const email = `sample.customer${i + 1}@example.com`;
    const id = Number(db.prepare("INSERT INTO users (role, name, email, password_hash, phone) VALUES ('customer', ?, ?, ?, ?)")
      .run(name, email, hash, `+91 90000 0000${i}`).lastInsertRowid);
    db.prepare('INSERT INTO customer_profiles (user_id, city) VALUES (?, ?)').run(id, 'Delhi');
    credentials.push(`customer  ${email}`);
    return id;
  });

  PANDITS.forEach((p, i) => {
    const email = `sample.pandit${i + 1}@example.com`;
    const userId = Number(db.prepare("INSERT INTO users (role, name, email, password_hash, phone) VALUES ('pandit', ?, ?, ?, ?)")
      .run(p.name, email, hash, `+91 98000 000${String(i).padStart(2, '0')}`).lastInsertRowid);
    credentials.push(`pandit    ${email}`);
    const pid = Number(db.prepare(`INSERT INTO pandit_profiles (user_id, city_id, bio, experience_years, offers_online, verification_status,
      identity_verified, experience_verified, verified_at, is_sample) VALUES (?, ?, ?, ?, ?, 'approved', 1, ?, datetime('now'), 1)`)
      .run(userId, city[p.city], p.bio, p.exp, p.services.some((s) => s[7] !== 'in_person') ? 1 : 0, i % 2 === 0 ? 1 : 0).lastInsertRowid);
    p.langs.forEach((l) => db.prepare('INSERT INTO pandit_languages VALUES (?, ?)').run(pid, l));
    p.areas.forEach((a) => db.prepare('INSERT INTO pandit_service_areas (pandit_id, locality) VALUES (?, ?)').run(pid, a));
    const serviceIds = p.services.map(([slug, name, dur, price, samagri, travel, charge, mode]) => {
      db.prepare('INSERT OR IGNORE INTO pandit_specializations VALUES (?, ?)').run(pid, cat[slug]);
      return Number(db.prepare(`INSERT INTO pandit_services (pandit_id, category_id, name, description, duration_minutes, price, samagri_included,
        travel_charges_apply, travel_charge, mode, requirements) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(pid, cat[slug], name, `${name} performed with traditional vidhi. Includes sankalp and aarti.`, dur, price, samagri, travel, charge, mode,
          samagri ? '' : 'Samagri list will be shared after the booking is accepted.').lastInsertRowid);
    });
    // Availability: mornings and evenings for the next 45 days, one weekly day off.
    for (let d = 0; d < 45; d++) {
      const date = addDays(today(), d);
      if (weekday(date) === (i % 7)) continue;
      db.prepare('INSERT INTO availability_slots (pandit_id, date, start_min, end_min) VALUES (?, ?, ?, ?)').run(pid, date, 7 * 60, 12 * 60);
      db.prepare('INSERT INTO availability_slots (pandit_id, date, start_min, end_min) VALUES (?, ?, ?, ?)').run(pid, date, 16 * 60, 20 * 60);
    }
    // Past completed sample bookings with reviews (labelled sample via the pandit).
    const reviewCount = (i % 3) + 1;
    for (let r = 0; r < reviewCount; r++) {
      const svc = db.prepare('SELECT * FROM pandit_services WHERE id = ?').get(serviceIds[r % serviceIds.length]);
      const date = addDays(today(), -10 - r * 7 - i);
      const bid = Number(db.prepare(`INSERT INTO bookings (booking_ref, customer_id, pandit_id, service_id, category_id, ceremony_type, date, start_min, end_min,
        location_text, estimated_price, price_breakdown, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed')`)
        .run(`PF-S${i}${r}${crypto.randomBytes(2).toString('hex').toUpperCase()}`, customerIds[r % customerIds.length], pid, svc.id, svc.category_id,
          db.prepare('SELECT name FROM puja_categories WHERE id = ?').get(svc.category_id).name, date, 9 * 60, 9 * 60 + svc.duration_minutes,
          `${p.areas[0]}, ${p.city}`, svc.price, JSON.stringify({ service_price: svc.price, travel_charge: 0 })).lastInsertRowid);
      db.prepare("INSERT INTO booking_events (booking_id, event, to_status, note) VALUES (?, 'seeded', 'completed', 'Sample data')").run(bid);
      const [rating, comment] = REVIEWS[(i + r) % REVIEWS.length];
      db.prepare('INSERT INTO reviews (booking_id, customer_id, pandit_id, rating, comment) VALUES (?, ?, ?, ?, ?)').run(bid, customerIds[r % customerIds.length], pid, rating, comment);
    }
  });
})();

const file = path.join(path.dirname(config.dbPath), 'sample-credentials.txt');
fs.writeFileSync(file, `Pandit Finder SAMPLE accounts (development only)\nPassword for all: ${password}\n\n${credentials.join('\n')}\n`);
console.log(`Seeded ${PANDITS.length} sample pandits and ${CUSTOMERS.length} sample customers.`);
console.log(`Sample login details written to ${file}`);
console.log('Create an administrator with: npm run create-admin');
db.close();
