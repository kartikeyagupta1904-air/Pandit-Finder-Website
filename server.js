'use strict';
const config = require('./src/config');
const { createApp } = require('./src/app');
const { runMaintenance } = require('./src/services/maintenance');

const app = createApp();

function maintenance() {
  try {
    const r = runMaintenance();
    if (r.reminders || r.expired || r.purged) console.log('[maintenance]', r);
  } catch (err) {
    console.error('[maintenance] failed:', err.message);
  }
}
maintenance();
setInterval(maintenance, 15 * 60 * 1000).unref();

const server = app.listen(config.port, () => {
  console.log(`Pandit Finder running at http://localhost:${config.port} (${config.env})`);
  console.log(`Database: ${config.dbPath}`);
});

function shutdown() {
  server.close(() => {
    app.locals.db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
