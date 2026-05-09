'use strict';

const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || '127.0.0.1',
  port:               parseInt(process.env.DB_PORT) || 3306,
  user:               process.env.DB_USER     || 'root',
  password:           process.env.DB_PASSWORD || '',
  database:           process.env.DB_NAME     || 'smartnyumba',
  connectionLimit:    parseInt(process.env.DB_POOL_LIMIT) || 30,
  waitForConnections: true,
  queueLimit:         0,
  dateStrings:        true,
  timezone:           '+03:00',           // East Africa Time
  connectTimeout:     10000,
  ssl:                process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  // Named placeholders support
  namedPlaceholders:  false,
  // Auto-reconnect
  enableKeepAlive:    true,
  keepAliveInitialDelay: 0,
});

// ── Pool event monitoring ─────────────────────────────────────
pool.on('connection', (conn) => {
  if (global.logger) global.logger.debug(`DB new connection id=${conn.threadId}`);
});

// ── Startup connectivity check ────────────────────────────────
pool.getConnection()
  .then(conn => {
    if (global.logger) global.logger.info('✅ Database connected');
    else console.log('✅ Database connected');
    conn.release();
  })
  .catch(err => {
    const msg = `❌ Database connection failed: ${err.message}`;
    if (global.logger) global.logger.error(msg);
    else console.error(msg);
    // In production, crash fast so the process manager restarts
    if (process.env.NODE_ENV === 'production') process.exit(1);
  });

// ── Helper: run a query and log slow queries ──────────────────
const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_MS) || 500;
const originalQuery = pool.query.bind(pool);

pool.query = async function timedQuery(sql, params) {
  const start = Date.now();
  try {
    const result = await originalQuery(sql, params);
    const ms = Date.now() - start;
    if (ms > SLOW_QUERY_THRESHOLD_MS && global.logger) {
      global.logger.warn(`SLOW QUERY (${ms}ms): ${typeof sql === 'string' ? sql.slice(0, 200) : '[object]'}`);
    }
    return result;
  } catch (e) {
    const ms = Date.now() - start;
    if (global.logger) {
      global.logger.error(`DB query error (${ms}ms): ${e.message} | SQL: ${typeof sql === 'string' ? sql.slice(0, 200) : '[object]'}`);
    }
    throw e;
  }
};

module.exports = pool;