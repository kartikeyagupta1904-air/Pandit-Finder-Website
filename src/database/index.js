'use strict';
// Holds the single database connection used by the running app.
let db = null;

module.exports = {
  setDb(instance) { db = instance; },
  getDb() {
    if (!db) throw new Error('Database not initialised');
    return db;
  },
};
