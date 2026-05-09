'use strict';
require('dotenv').config();

const app  = require('./app');
const cron = require('./scripts/cron');
const pool = require('./config/db');

const PORT = parseInt(process.env.PORT) || 3002;

const { validateEnv } = require('./scripts/validate_env');
validateEnv(); // Exits immediately if critical env vars are missing

async function start() {
  // ── Run DB migrations BEFORE accepting any requests ──────────
  try {
    const { runMigrations } = require('./scripts/auto_migrate');
    await runMigrations(pool);
  } catch (e) {
    global.logger.warn('Auto-migration warning: ' + e.message);
  }

  // ── Start HTTP server ─────────────────────────────────────────
  const server = app.listen(PORT, () => {
    global.logger.info(`🚀 Smart Nyumba Pro API listening on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    // Bootstrap webhook delivery table (idempotent)
    require('./services/webhooks').bootstrap().catch(e =>
      global.logger.warn('Webhook bootstrap failed (errno ' + (e.errno||'?') + '): ' + e.message)
    );
    cron.start();
  });

  // ── Graceful shutdown ─────────────────────────────────────────
  const shutdown = (signal) => {
    global.logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      global.logger.info('HTTP server closed');
      try { await pool.end(); global.logger.info('Database pool closed'); } catch (_) {}
      process.exit(0);
    });
    setTimeout(() => { global.logger.error('Forced shutdown after timeout'); process.exit(1); }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  return server;
}

start().catch(e => {
  if (global.logger) global.logger.error('Fatal startup error: ' + e.message);
  else console.error('Fatal startup error:', e.message);
  process.exit(1);
});
process.on("uncaughtException", err => {
  console.error("UNCAUGHT:", err);
});

process.on("unhandledRejection", err => {
  console.error("UNHANDLED:", err);
});