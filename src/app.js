'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const config = require('./config');
const { openDatabase } = require('./database/db');
const { setDb } = require('./database');
const SQLiteStore = require('./middleware/session-store');
const { loadUser } = require('./middleware/auth');
const { csrfProtection } = require('./middleware/csrf');
const { HttpError } = require('./utils/errors');
const payments = require('./services/payments');

function createApp(opts = {}) {
  const db = openDatabase(opts.dbPath || config.dbPath);
  setDb(db);

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.locals.db = db;

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://checkout.razorpay.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
        connectSrc: ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
        frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  // Health check for the hosting platform: confirms the process is up and the database is readable.
  app.get('/healthz', (req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.set('Cache-Control', 'no-store').json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'database unavailable' });
    }
  });

  // Razorpay webhook needs the raw body for signature verification, so it is mounted before JSON parsing and CSRF.
  app.post('/api/payments/razorpay/webhook', express.raw({ type: 'application/json', limit: '100kb' }), (req, res, next) => {
    try {
      payments.handleWebhook(req.body, req.get('x-razorpay-signature'));
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));

  const store = new SQLiteStore(db);
  app.locals.sessionStore = store;
  app.use(session({
    name: 'pf.sid',
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 7 * 24 * 3600 * 1000 },
  }));

  // Static assets. Only profile photos are public; uploads/private is never mounted.
  const noCache = { setHeaders: (res) => res.set('Cache-Control', 'no-cache') };
  app.use('/vendor/bootstrap', express.static(path.join(config.root, 'node_modules/bootstrap/dist'), { maxAge: '7d' }));
  app.use('/vendor/bootstrap-icons', express.static(path.join(config.root, 'node_modules/bootstrap-icons/font'), { maxAge: '7d' }));
  app.use('/vendor/leaflet', express.static(path.join(config.root, 'node_modules/leaflet/dist'), { maxAge: '7d' }));
  app.use('/vendor/chart.js', express.static(path.join(config.root, 'node_modules/chart.js/dist'), { maxAge: '7d' }));
  app.use('/uploads/photos', express.static(path.join(config.uploadDir, 'photos'), {
    maxAge: '1d', fallthrough: false, dotfiles: 'deny',
    setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff'),
  }));
  app.use(express.static(path.join(config.root, 'public'), { extensions: ['html'], ...noCache }));

  // API
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: opts.loginRateLimit || config.loginRateLimit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
  });

  const api = express.Router();
  api.use(loadUser);
  api.use(csrfProtection);
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use('/auth', require('./routes/auth')({ authLimiter }));
  const panditRouter = require('./routes/pandit')();
  api.use('/pandit', panditRouter);
  // Alias from the original API spec: PUT /api/pandits/profile
  api.put('/pandits/profile', (req, res, next) => { req.url = '/profile'; panditRouter(req, res, next); });
  api.use('/', require('./routes/public')({ authLimiter }));
  api.use('/bookings', require('./routes/bookings')());
  api.use('/admin', require('./routes/admin')());
  api.use('/', require('./routes/account')());
  api.use((req, res) => res.status(404).json({ error: 'API endpoint not found.' }));
  app.use('/api', api);

  // Unknown pages
  app.use((req, res) => res.status(404).sendFile(path.join(config.root, 'public', '404.html')));

  // Errors: safe messages to the client, details only in server logs.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Malformed JSON body.');
    if (err.code === 'ENOENT' && req.path.startsWith('/uploads/')) err = new HttpError(404, 'Not found.');
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error('[error]', err);
    const body = { error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message };
    if (err.details && status < 500) body.fields = err.details;
    if (req.path.startsWith('/api') || req.xhr) return res.status(status).json(body);
    res.status(status).type('text').send(body.error);
  });

  return app;
}

module.exports = { createApp };
