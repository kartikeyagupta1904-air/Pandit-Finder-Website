'use strict';
/**
 * Creates (or resets) an administrator account. Credentials come from the
 * environment or an interactive prompt — never from the code.
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run create-admin
 */
const readline = require('readline');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { openDatabase } = require('./db');

function ask(q, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}

(async () => {
  const email = (process.env.ADMIN_EMAIL || await ask('Admin email: ')).toLowerCase();
  const name = process.env.ADMIN_NAME || 'Administrator';
  const password = process.env.ADMIN_PASSWORD || await ask('Admin password (min 12 chars): ', true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('Invalid email.'); process.exit(1); }
  if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    console.error('Password must be at least 12 characters and include letters and numbers.');
    process.exit(1);
  }
  const db = openDatabase(config.dbPath);
  const hash = await bcrypt.hash(password, 12);
  const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
  if (existing && existing.role !== 'admin') {
    console.error('That email belongs to a non-admin account. Use a different email.');
    process.exit(1);
  }
  if (existing) {
    db.prepare("UPDATE users SET password_hash = ?, status = 'active', updated_at = datetime('now') WHERE id = ?").run(hash, existing.id);
    console.log(`Admin password reset for ${email}.`);
  } else {
    db.prepare("INSERT INTO users (role, name, email, password_hash) VALUES ('admin', ?, ?, ?)").run(name, email, hash);
    console.log(`Admin account created for ${email}.`);
  }
  db.prepare("INSERT INTO audit_logs (action, entity_type, details) VALUES ('admin.created_via_cli', 'user', ?)").run(JSON.stringify({ email }));
  db.close();
})();
