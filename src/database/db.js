'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { CITIES, CATEGORIES, DEFAULT_SETTINGS } = require('./reference-data');

/**
 * Opens (and creates if needed) the SQLite database, applies the schema and
 * inserts required reference data. Safe to run repeatedly.
 */
function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  const insertCity = db.prepare('INSERT OR IGNORE INTO cities (name, state, lat, lng) VALUES (?, ?, ?, ?)');
  const insertCat = db.prepare('INSERT OR IGNORE INTO puja_categories (name, slug, description, icon, sort_order) VALUES (?, ?, ?, ?, ?)');
  const insertSetting = db.prepare('INSERT OR IGNORE INTO platform_settings (key, value) VALUES (?, ?)');
  db.transaction(() => {
    for (const c of CITIES) insertCity.run(...c);
    CATEGORIES.forEach((c, i) => insertCat.run(c[0], c[1], c[2], c[3], i));
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);
  })();
}

module.exports = { openDatabase, migrate };
