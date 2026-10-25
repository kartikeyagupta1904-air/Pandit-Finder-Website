'use strict';
const config = require('../config');
const { getDb } = require('../database');

/**
 * In-app notifications are always stored. Email is attempted only when an SMTP
 * provider is configured AND the optional `nodemailer` package is installed.
 * Nothing claims an email was sent unless the provider accepted it.
 */
let transport = null;
let emailState = 'disabled'; // 'disabled' | 'ready' | 'unavailable'

function initEmail() {
  if (!config.smtp.host) return;
  try {
    // Optional dependency: npm install nodemailer
    // eslint-disable-next-line global-require
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
    emailState = 'ready';
  } catch {
    emailState = 'unavailable';
    console.warn('[notify] SMTP_HOST is set but nodemailer is not installed. Run `npm install nodemailer`. Using in-app notifications only.');
  }
}
initEmail();

function emailStatus() {
  return emailState;
}

function notify(userId, type, title, body = '', link = null) {
  const db = getDb();
  db.prepare('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)')
    .run(userId, type, title, body, link);

  if (emailState === 'ready') {
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    if (user) {
      transport.sendMail({ from: config.smtp.from || config.smtp.user, to: user.email, subject: `Pandit Finder: ${title}`, text: `${body}\n\n${link || ''}` })
        .catch((err) => console.warn('[notify] email delivery failed:', err.message));
    }
  }
}

module.exports = { notify, emailStatus };
