'use strict';
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) {
  if (isProd) {
    throw new Error('SESSION_SECRET must be set (32+ characters) when NODE_ENV=production.');
  }
  // Development only: random per-process secret. Sessions reset when the server restarts.
  sessionSecret = crypto.randomBytes(48).toString('hex');
  if (env !== 'test') {
    console.warn('[config] SESSION_SECRET not set — using a temporary random secret (logins reset on restart). Copy .env.example to .env.');
  }
}

const root = path.join(__dirname, '..', '..');

module.exports = {
  env,
  isProd,
  root,
  port: parseInt(process.env.PORT, 10) || 3000,
  sessionSecret,
  dbPath: process.env.DATABASE_PATH ? path.resolve(root, process.env.DATABASE_PATH) : path.join(root, 'data', 'pandit-finder.db'),
  uploadDir: process.env.UPLOAD_DIR ? path.resolve(root, process.env.UPLOAD_DIR) : path.join(root, 'uploads'),
  trustProxy: process.env.TRUST_PROXY === '1',
  showSampleData: process.env.SHOW_SAMPLE_DATA !== '0',
  loginRateLimit: parseInt(process.env.LOGIN_RATE_LIMIT, 10) || 10,
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
  },
};
