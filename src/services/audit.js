'use strict';
const { getDb } = require('../database');

function audit(req, action, entityType, entityId, details = {}) {
  getDb().prepare(
    'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(req?.user?.id ?? null, action, entityType ?? null, entityId ?? null, JSON.stringify(details), req?.ip ?? null);
}

module.exports = { audit };
