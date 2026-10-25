'use strict';
const { getDb } = require('../database');
const { DEFAULT_SETTINGS } = require('../database/reference-data');

// Whitelist of editable settings with their validation.
const SETTING_RULES = {
  cancellation_hours: { type: 'int', min: 0, max: 720 },
  min_lead_hours: { type: 'int', min: 0, max: 720 },
  max_advance_days: { type: 'int', min: 7, max: 730 },
  document_retention_days: { type: 'int', min: 1, max: 3650 },
  support_email: { type: 'string', max: 200 },
  support_phone: { type: 'string', max: 40 },
  allow_new_pandit_applications: { type: 'bool' },
};

function getAll() {
  const rows = getDb().prepare('SELECT key, value FROM platform_settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function get(key) {
  const row = getDb().prepare('SELECT value FROM platform_settings WHERE key = ?').get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}

function getInt(key) {
  return parseInt(get(key), 10);
}

module.exports = { SETTING_RULES, getAll, get, getInt };
