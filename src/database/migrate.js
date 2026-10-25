'use strict';
// Creates or upgrades the database schema and reference data: npm run migrate
const config = require('../config');
const { openDatabase } = require('./db');

const db = openDatabase(config.dbPath);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
console.log(`Database ready at ${config.dbPath}`);
console.log(`Tables: ${tables.map((t) => t.name).join(', ')}`);
db.close();
