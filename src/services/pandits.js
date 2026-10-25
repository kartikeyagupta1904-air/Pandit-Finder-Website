'use strict';
const config = require('../config');
const { getDb } = require('../database');
const availability = require('./availability');
const { isValidDate, today, addDays } = require('../utils/time');

const RATING_SQL = "(SELECT AVG(rating) FROM reviews r WHERE r.pandit_id = p.id AND r.status = 'visible')";
const REVIEWS_SQL = "(SELECT COUNT(*) FROM reviews r WHERE r.pandit_id = p.id AND r.status = 'visible')";

function publicWhere() {
  let w = "p.verification_status = 'approved' AND u.status = 'active'";
  if (!config.showSampleData) w += ' AND p.is_sample = 0';
  return w;
}

function photoUrl(p) {
  return p.photo_path ? `/uploads/photos/${p.photo_path}` : null;
}

function listFor(panditIds, sql) {
  const map = new Map(panditIds.map((id) => [id, []]));
  if (!panditIds.length) return map;
  const rows = getDb().prepare(sql.replace('$IDS', panditIds.map(() => '?').join(','))).all(...panditIds);
  for (const r of rows) map.get(r.pandit_id)?.push(r);
  return map;
}

/** Shapes rows into public pandit cards (no private contact data). */
function toCards(rows) {
  const ids = rows.map((r) => r.id);
  const langs = listFor(ids, 'SELECT pandit_id, language FROM pandit_languages WHERE pandit_id IN ($IDS) ORDER BY language');
  const specs = listFor(ids, `SELECT ps.pandit_id, c.id, c.name, c.slug FROM pandit_specializations ps
    JOIN puja_categories c ON c.id = ps.category_id WHERE ps.pandit_id IN ($IDS) AND c.is_active = 1 ORDER BY c.sort_order`);
  const areas = listFor(ids, 'SELECT pandit_id, locality FROM pandit_service_areas WHERE pandit_id IN ($IDS) ORDER BY locality');
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    photo_url: photoUrl(r),
    verified: r.verification_status === 'approved',
    identity_verified: !!r.identity_verified,
    experience_verified: !!r.experience_verified,
    experience_years: r.experience_years,
    city: r.city,
    languages: langs.get(r.id).map((l) => l.language),
    specializations: specs.get(r.id).map((s) => ({ id: s.id, name: s.name, slug: s.slug })),
    service_areas: areas.get(r.id).map((a) => a.locality),
    rating: r.rating ? Math.round(r.rating * 10) / 10 : null,
    review_count: r.review_count,
    starting_price: r.min_price,
    offers_online: !!r.offers_online,
    is_sample: !!r.is_sample,
  }));
}

/**
 * Search approved pandits. All filters are applied server-side against the
 * database; date availability is confirmed with the same slot logic used for booking.
 */
function search(q) {
  const db = getDb();
  const params = [];
  const where = [publicWhere()];
  let catFilter = '';
  const catParams = [];

  if (q.category) {
    const cat = db.prepare('SELECT id FROM puja_categories WHERE (id = ? OR slug = ?) AND is_active = 1').get(Number(q.category) || 0, String(q.category));
    if (!cat) return { total: 0, page: 1, pages: 0, results: [] };
    catFilter = ' AND s.category_id = ?';
    catParams.push(cat.id);
  }

  // Mode filter applies to the services considered for price and category.
  let modeFilter = '';
  if (q.mode === 'online') modeFilter = " AND s.mode IN ('online','both')";
  if (q.mode === 'in_person') modeFilter = " AND s.mode IN ('in_person','both')";

  const priceSql = `(SELECT MIN(s.price) FROM pandit_services s WHERE s.pandit_id = p.id AND s.is_active = 1${catFilter}${modeFilter})`;

  if (q.city) { where.push('c.name = ? COLLATE NOCASE'); params.push(String(q.city).trim()); }
  if (q.locality) {
    where.push('EXISTS (SELECT 1 FROM pandit_service_areas a WHERE a.pandit_id = p.id AND a.locality LIKE ?)');
    params.push(`%${String(q.locality).trim().replace(/[%_]/g, '')}%`);
  }
  if (q.language) {
    where.push('EXISTS (SELECT 1 FROM pandit_languages l WHERE l.pandit_id = p.id AND l.language = ? COLLATE NOCASE)');
    params.push(String(q.language));
  }
  if (q.q) {
    where.push('(u.name LIKE ? OR p.bio LIKE ?)');
    const like = `%${String(q.q).trim().replace(/[%_]/g, '')}%`;
    params.push(like, like);
  }
  const minExp = parseInt(q.min_experience, 10);
  if (minExp > 0) { where.push('p.experience_years >= ?'); params.push(minExp); }

  // Requiring an active service (in the category/mode) makes every result bookable.
  where.push(`${priceSql} IS NOT NULL`);
  params.push(...catParams);

  const minPrice = parseInt(q.min_price, 10);
  const maxPrice = parseInt(q.max_price, 10);
  if (minPrice >= 0) { where.push(`${priceSql} >= ?`); params.push(...catParams, minPrice); }
  if (maxPrice >= 0) { where.push(`${priceSql} <= ?`); params.push(...catParams, maxPrice); }

  const minRating = Number(q.min_rating);
  if (minRating > 0) { where.push(`COALESCE(${RATING_SQL}, 0) >= ?`); params.push(minRating); }

  const sorts = {
    recommended: 'p.identity_verified DESC, (COALESCE(rating, 0) * (1 + MIN(review_count, 20) / 20.0)) DESC, p.experience_years DESC, p.id',
    rating: 'COALESCE(rating, 0) DESC, review_count DESC, p.id',
    experience: 'p.experience_years DESC, p.id',
    price_asc: 'min_price ASC, p.id',
    price_desc: 'min_price DESC, p.id',
  };
  const order = sorts[q.sort] || sorts.recommended;

  const sql = `SELECT p.*, u.name, c.name AS city, ${RATING_SQL} AS rating, ${REVIEWS_SQL} AS review_count, ${priceSql} AS min_price
    FROM pandit_profiles p JOIN users u ON u.id = p.user_id JOIN cities c ON c.id = p.city_id
    WHERE ${where.join(' AND ')} ORDER BY ${order}`;
  let rows = db.prepare(sql).all(...catParams, ...params);

  // Availability filters are confirmed using real slot data, not assumed.
  if (q.date && isValidDate(q.date)) {
    rows = rows.filter((r) => hasFreeTimeOn(r.id, q.date, catParams[0]));
  } else if (q.available === 'week') {
    const from = today();
    rows = rows.filter((r) => {
      for (let i = 0; i <= 7; i++) if (hasFreeTimeOn(r.id, addDays(from, i), catParams[0])) return true;
      return false;
    });
  }

  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 9, 1), 50);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const total = rows.length;
  const slice = rows.slice((page - 1) * limit, page * limit);
  const results = toCards(slice);
  if (q.date && isValidDate(q.date)) results.forEach((r) => { r.available_on = q.date; });
  return { total, page, pages: Math.ceil(total / limit), limit, results };
}

function hasFreeTimeOn(panditId, date, categoryId) {
  const svc = getDb().prepare(
    `SELECT MIN(duration_minutes) d FROM pandit_services WHERE pandit_id = ? AND is_active = 1 ${categoryId ? 'AND category_id = ?' : ''}`
  ).get(...(categoryId ? [panditId, categoryId] : [panditId]));
  if (!svc || !svc.d) return false;
  return availability.freeStarts(panditId, date, svc.d).length > 0;
}

function getPublicRow(id) {
  return getDb().prepare(
    `SELECT p.*, u.name, c.name AS city, c.state, c.lat, c.lng, ${RATING_SQL} AS rating, ${REVIEWS_SQL} AS review_count,
       (SELECT MIN(s.price) FROM pandit_services s WHERE s.pandit_id = p.id AND s.is_active = 1) AS min_price
     FROM pandit_profiles p JOIN users u ON u.id = p.user_id JOIN cities c ON c.id = p.city_id
     WHERE p.id = ? AND ${publicWhere()}`
  ).get(id);
}

function serviceRows(panditId, activeOnly = true) {
  return getDb().prepare(
    `SELECT s.*, c.name AS category_name, c.slug AS category_slug FROM pandit_services s
     JOIN puja_categories c ON c.id = s.category_id
     WHERE s.pandit_id = ? ${activeOnly ? 'AND s.is_active = 1' : ''} ORDER BY s.price`
  ).all(panditId).map(serializeService);
}

function serializeService(s) {
  return {
    id: s.id,
    category_id: s.category_id,
    category_name: s.category_name,
    category_slug: s.category_slug,
    name: s.name,
    description: s.description,
    duration_minutes: s.duration_minutes,
    price: s.price,
    samagri_included: !!s.samagri_included,
    travel_charges_apply: !!s.travel_charges_apply,
    travel_charge: s.travel_charge,
    mode: s.mode,
    requirements: s.requirements,
    is_active: !!s.is_active,
  };
}

/** Full public profile. Private phone, email, documents and addresses are never included. */
function publicProfile(id) {
  const row = getPublicRow(id);
  if (!row) return null;
  const [card] = toCards([row]);
  const db = getDb();
  const stats = db.prepare(
    "SELECT SUM(status = 'completed') AS completed, COUNT(*) AS total FROM bookings WHERE pandit_id = ?"
  ).get(id);
  return {
    ...card,
    bio: row.bio,
    state: row.state,
    // Approximate city-centre location only — never the pandit's address.
    approx_location: row.lat != null ? { lat: row.lat, lng: row.lng, label: `${row.city} (approximate city area)` } : null,
    member_since: row.created_at.slice(0, 10),
    verified_at: row.verified_at,
    services: serviceRows(id),
    completed_ceremonies: stats.completed || 0,
    next_available: availability.nextAvailableDate(id),
  };
}

function reviewsFor(panditId, limit = 20, offset = 0) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT r.id, r.rating, r.comment, r.created_at, b.booking_ref, b.ceremony_type, u.name AS customer_name
     FROM reviews r JOIN bookings b ON b.id = r.booking_id JOIN users u ON u.id = r.customer_id
     WHERE r.pandit_id = ? AND r.status = 'visible' ORDER BY r.created_at DESC LIMIT ? OFFSET ?`
  ).all(panditId, limit, offset);
  const summary = db.prepare(
    `SELECT COUNT(*) AS count, AVG(rating) AS average,
       SUM(rating = 5) s5, SUM(rating = 4) s4, SUM(rating = 3) s3, SUM(rating = 2) s2, SUM(rating = 1) s1
     FROM reviews WHERE pandit_id = ? AND status = 'visible'`
  ).get(panditId);
  return {
    summary: {
      count: summary.count,
      average: summary.average ? Math.round(summary.average * 10) / 10 : null,
      distribution: { 5: summary.s5 || 0, 4: summary.s4 || 0, 3: summary.s3 || 0, 2: summary.s2 || 0, 1: summary.s1 || 0 },
    },
    // Show first name + initial only, to protect reviewer privacy.
    reviews: rows.map((r) => ({ ...r, customer_name: shortName(r.customer_name) })),
  };
}

function shortName(name) {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

function isPublic(id) {
  return !!getPublicRow(id);
}

module.exports = { search, publicProfile, reviewsFor, serviceRows, serializeService, toCards, isPublic, publicWhere, shortName, RATING_SQL, REVIEWS_SQL };
