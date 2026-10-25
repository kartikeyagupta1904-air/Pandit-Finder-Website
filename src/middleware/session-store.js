'use strict';
const session = require('express-session');

/** Minimal express-session store backed by the SQLite `sessions` table (sessions survive restarts). */
class SQLiteStore extends session.Store {
  constructor(db, { ttlMs = 7 * 24 * 3600 * 1000 } = {}) {
    super();
    this.db = db;
    this.ttlMs = ttlMs;
    this.getStmt = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?');
    this.setStmt = db.prepare('INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires');
    this.delStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.touchStmt = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
  }

  expiry(sess) {
    const exp = sess?.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + this.ttlMs;
    return exp;
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try { this.setStmt.run(sid, JSON.stringify(sess), this.expiry(sess)); cb && cb(null); } catch (e) { cb && cb(e); }
  }

  destroy(sid, cb) {
    try { this.delStmt.run(sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }

  touch(sid, sess, cb) {
    try { this.touchStmt.run(this.expiry(sess), sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }

  prune() {
    this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
  }
}

module.exports = SQLiteStore;
