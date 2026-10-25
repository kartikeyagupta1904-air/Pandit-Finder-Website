-- Pandit Finder database schema (SQLite)
-- Times are stored as minutes from midnight (start_min / end_min), dates as 'YYYY-MM-DD'.
-- Timestamps are ISO-8601 UTC strings produced by SQLite's datetime('now').

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  role            TEXT    NOT NULL CHECK (role IN ('customer','pandit','admin')),
  name            TEXT    NOT NULL CHECK (length(name) BETWEEN 2 AND 100),
  email           TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT    NOT NULL,
  phone           TEXT,
  status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  last_login_at   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS customer_profiles (
  user_id             INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  city                TEXT,
  preferred_language  TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cities (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  state   TEXT,
  lat     REAL,
  lng     REAL
);

-- ---------------------------------------------------------------------------
-- Pandits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pandit_profiles (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id              INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  city_id              INTEGER NOT NULL REFERENCES cities(id),
  bio                  TEXT    NOT NULL DEFAULT '',
  experience_years     INTEGER NOT NULL DEFAULT 0 CHECK (experience_years BETWEEN 0 AND 80),
  photo_path           TEXT,
  preferred_contact    TEXT    NOT NULL DEFAULT 'platform' CHECK (preferred_contact IN ('platform','phone','email')),
  offers_online        INTEGER NOT NULL DEFAULT 0 CHECK (offers_online IN (0,1)),
  verification_status  TEXT    NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','approved','rejected')),
  rejection_reason     TEXT,
  identity_verified    INTEGER NOT NULL DEFAULT 0 CHECK (identity_verified IN (0,1)),
  experience_verified  INTEGER NOT NULL DEFAULT 0 CHECK (experience_verified IN (0,1)),
  verified_at          TEXT,
  verified_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_sample            INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0,1)),
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pandit_city ON pandit_profiles(city_id);
CREATE INDEX IF NOT EXISTS idx_pandit_status ON pandit_profiles(verification_status);

CREATE TABLE IF NOT EXISTS pandit_languages (
  pandit_id  INTEGER NOT NULL REFERENCES pandit_profiles(id) ON DELETE CASCADE,
  language   TEXT    NOT NULL COLLATE NOCASE,
  PRIMARY KEY (pandit_id, language)
);
CREATE INDEX IF NOT EXISTS idx_pandit_languages_lang ON pandit_languages(language);

CREATE TABLE IF NOT EXISTS puja_categories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  slug         TEXT    NOT NULL UNIQUE,
  description  TEXT    NOT NULL DEFAULT '',
  icon         TEXT    NOT NULL DEFAULT 'bi-flower1',
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pandit_specializations (
  pandit_id    INTEGER NOT NULL REFERENCES pandit_profiles(id) ON DELETE CASCADE,
  category_id  INTEGER NOT NULL REFERENCES puja_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (pandit_id, category_id)
);

CREATE TABLE IF NOT EXISTS pandit_service_areas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pandit_id  INTEGER NOT NULL REFERENCES pandit_profiles(id) ON DELETE CASCADE,
  locality   TEXT    NOT NULL COLLATE NOCASE,
  UNIQUE (pandit_id, locality)
);
CREATE INDEX IF NOT EXISTS idx_service_areas_locality ON pandit_service_areas(locality);

-- Private documents. Files live in uploads/private (never served statically).
CREATE TABLE IF NOT EXISTS pandit_verification_documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pandit_id      INTEGER NOT NULL REFERENCES pandit_profiles(id) ON DELETE CASCADE,
  doc_type       TEXT    NOT NULL CHECK (doc_type IN ('identity','address','certificate','other')),
  original_name  TEXT    NOT NULL,
  stored_name    TEXT    UNIQUE,
  mime_type      TEXT    NOT NULL,
  size_bytes     INTEGER NOT NULL,
  purged_at      TEXT,
  uploaded_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_docs_pandit ON pandit_verification_documents(pandit_id);

CREATE TABLE IF NOT EXISTS pandit_services (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  pandit_id             INTEGER NOT NULL REFERENCES pandit_profiles(id) ON DELETE CASCADE,
  category_id           INTEGER NOT NULL REFERENCES puja_categories(id),
  name                  TEXT    NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  description           TEXT    NOT NULL DEFAULT '',
  duration_minutes      INTEGER NOT NULL CHECK (duration_minutes BETWEEN 30 AND 720 AND duration_minutes % 30 = 0),
  price                 INTEGER NOT NULL CHECK (price BETWEEN 0 AND 10000000),
  samagri_included      INTEGER NOT NULL DEFAULT 0 CHECK (samagri_included IN (0,1)),
  travel_charges_apply  INTEGER NOT NULL DEFAULT 0 CHECK (travel_charges_apply IN (0,1)),
  travel_charge         INTEGER NOT NULL DEFAULT 0 CHECK (travel_charge >= 0),
  mode                  TEXT    NOT NULL DEFAULT 'in_person' CHECK (mode IN ('in_person','online','both')),
  requirements          TEXT    NOT NULL DEFAULT '',
  is_active             INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_services_pandit ON pandit_services(pandit_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON pandit_services(category_id);

-- Open availability windows published by a pandit for a given date.
CREATE TABLE IF NOT EXISTS availability_slots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pandit_id  INTEGER NOT NULL REFERENCES pandit_profiles(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  start_min  INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1410),
  end_min    INTEGER NOT NULL CHECK (end_min BETWEEN 30 AND 1440),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (end_min > start_min),
  UNIQUE (pandit_id, date, start_min)
);
CREATE INDEX IF NOT EXISTS idx_slots_pandit_date ON availability_slots(pandit_id, date);

CREATE TABLE IF NOT EXISTS blocked_dates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pandit_id  INTEGER NOT NULL REFERENCES pandit_profiles(id) ON DELETE CASCADE,
  date       TEXT    NOT NULL,
  reason     TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pandit_id, date)
);

-- ---------------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_ref          TEXT    NOT NULL UNIQUE,
  customer_id          INTEGER NOT NULL REFERENCES users(id),
  pandit_id            INTEGER NOT NULL REFERENCES pandit_profiles(id),
  service_id           INTEGER NOT NULL REFERENCES pandit_services(id),
  category_id          INTEGER REFERENCES puja_categories(id),
  ceremony_type        TEXT    NOT NULL,
  date                 TEXT    NOT NULL,
  start_min            INTEGER NOT NULL CHECK (start_min BETWEEN 0 AND 1410),
  end_min              INTEGER NOT NULL CHECK (end_min BETWEEN 30 AND 1440),
  service_mode         TEXT    NOT NULL DEFAULT 'in_person' CHECK (service_mode IN ('in_person','online')),
  location_text        TEXT    NOT NULL,
  estimated_price      INTEGER NOT NULL CHECK (estimated_price >= 0),
  price_breakdown      TEXT    NOT NULL DEFAULT '{}',
  samagri_requirements TEXT    NOT NULL DEFAULT '',
  customer_notes       TEXT    NOT NULL DEFAULT '',
  status               TEXT    NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','accepted','rejected','confirmed','completed','cancelled')),
  status_reason        TEXT,
  cancelled_by         INTEGER REFERENCES users(id),
  reminder_sent        INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (end_min > start_min)
);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_pandit_date ON bookings(pandit_id, date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- Database-level guarantee: a pandit can never hold two overlapping accepted/confirmed bookings.
-- This protects against concurrent requests even if application checks are bypassed.
CREATE TRIGGER IF NOT EXISTS trg_bookings_no_overlap_insert
BEFORE INSERT ON bookings
WHEN NEW.status IN ('accepted','confirmed')
BEGIN
  SELECT RAISE(ABORT, 'BOOKING_OVERLAP')
  WHERE EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.pandit_id = NEW.pandit_id AND b.date = NEW.date
      AND b.status IN ('accepted','confirmed')
      AND b.start_min < NEW.end_min AND NEW.start_min < b.end_min
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_bookings_no_overlap_update
BEFORE UPDATE OF status, date, start_min, end_min ON bookings
WHEN NEW.status IN ('accepted','confirmed')
BEGIN
  SELECT RAISE(ABORT, 'BOOKING_OVERLAP')
  WHERE EXISTS (
    SELECT 1 FROM bookings b
    WHERE b.id <> NEW.id AND b.pandit_id = NEW.pandit_id AND b.date = NEW.date
      AND b.status IN ('accepted','confirmed')
      AND b.start_min < NEW.end_min AND NEW.start_min < b.end_min
  );
END;

-- Full status/reschedule history for each booking.
CREATE TABLE IF NOT EXISTS booking_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id   INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor_id     INTEGER REFERENCES users(id),
  event        TEXT    NOT NULL,
  from_status  TEXT,
  to_status    TEXT,
  note         TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_booking_events_booking ON booking_events(booking_id);

-- In-platform messages between customer and pandit for a booking.
CREATE TABLE IF NOT EXISTS booking_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  sender_id   INTEGER NOT NULL REFERENCES users(id),
  body        TEXT    NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_booking_messages_booking ON booking_messages(booking_id);

CREATE TABLE IF NOT EXISTS payments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id           INTEGER NOT NULL REFERENCES bookings(id),
  provider             TEXT    NOT NULL CHECK (provider IN ('pay_later','razorpay','offline')),
  provider_order_id    TEXT    UNIQUE,
  provider_payment_id  TEXT    UNIQUE,
  amount               INTEGER NOT NULL CHECK (amount >= 0),
  currency             TEXT    NOT NULL DEFAULT 'INR',
  status               TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','successful','failed','refunded')),
  recorded_by          INTEGER REFERENCES users(id),
  notes                TEXT    NOT NULL DEFAULT '',
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);

CREATE TABLE IF NOT EXISTS reviews (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id       INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  customer_id      INTEGER NOT NULL REFERENCES users(id),
  pandit_id        INTEGER NOT NULL REFERENCES pandit_profiles(id) ON DELETE CASCADE,
  rating           INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment          TEXT    NOT NULL DEFAULT '' CHECK (length(comment) <= 2000),
  status           TEXT    NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden')),
  moderation_note  TEXT,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reviews_pandit ON reviews(pandit_id, status);

CREATE TABLE IF NOT EXISTS favourites (
  customer_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pandit_id    INTEGER NOT NULL REFERENCES pandit_profiles(id) ON DELETE CASCADE,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (customer_id, pandit_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL DEFAULT '',
  link        TEXT,
  is_read     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read);

CREATE TABLE IF NOT EXISTS complaints (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id  INTEGER NOT NULL REFERENCES users(id),
  kind         TEXT    NOT NULL CHECK (kind IN ('profile_report','complaint')),
  pandit_id    INTEGER REFERENCES pandit_profiles(id) ON DELETE SET NULL,
  booking_id   INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  subject      TEXT    NOT NULL,
  details      TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','dismissed')),
  admin_note   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT    NOT NULL,
  entity_type  TEXT,
  entity_id    INTEGER,
  details      TEXT    NOT NULL DEFAULT '{}',
  ip           TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS platform_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Server-side session storage (express-session).
CREATE TABLE IF NOT EXISTS sessions (
  sid      TEXT PRIMARY KEY,
  sess     TEXT NOT NULL,
  expires  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
