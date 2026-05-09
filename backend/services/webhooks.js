/**
 * Webhook delivery service — v2
 *
 * Changes from v1:
 *  - Exponential backoff retry queue (up to 5 attempts before disabling)
 *  - Delivery attempts logged to webhook_deliveries table
 *  - Auto-disable after 10 *consecutive* failures (vs. simple count in v1)
 *  - Per-event idempotency key prevents duplicate delivery on crash-restart
 */
'use strict';

const crypto  = require('crypto');
const pool    = require('../config/db');

const MAX_ATTEMPTS   = 5;
const BACKOFF_BASE_S = 60;   // 1 min → 2 min → 4 min → 8 min → 16 min
const DISABLE_AFTER  = 10;   // consecutive failures before auto-disable
const DELIVERY_TIMEOUT_MS = 10_000;

/** Sign a payload with HMAC-SHA256 using the subscriber's secret. */
function sign(payload, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** One delivery attempt — returns { ok, status, error }. */
async function attemptDelivery(subscriber, event, payload) {
  const payloadStr  = JSON.stringify(payload);
  const signature   = sign(payloadStr, subscriber.secret);
  const controller  = new AbortController();
  const timer       = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const resp = await fetch(subscriber.url, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-SmartNyumba-Signature': signature,
        'X-SmartNyumba-Event':     event,
        'X-SmartNyumba-Delivery':  payload.delivery_id || '',
      },
      body:   payloadStr,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, status: 0, error: e.message };
  }
}

/** Enqueue a delivery attempt into webhook_deliveries. */
async function enqueue(subscriberId, event, payload, attemptNumber = 1, deliverAt = null) {
  const deliver_at = deliverAt || new Date().toISOString().slice(0, 19).replace('T', ' ');
  await pool.query(
    `INSERT IGNORE INTO webhook_deliveries
     (subscriber_id, event, payload, attempt_number, deliver_at, status, delivery_id)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    [subscriberId, event, JSON.stringify(payload), attemptNumber, deliver_at, payload.delivery_id]
  ).catch(() => {});
}

/**
 * Deliver an event to all active subscribers.
 * Fire-and-forget — does not block the caller.
 */
function deliverEvent(event, data) {
  setImmediate(async () => {
    let subscribers;
    try {
      [subscribers] = await pool.query(
        "SELECT * FROM webhooks WHERE is_active=1 AND (events='*' OR FIND_IN_SET(?,events))",
        [event]
      );
    } catch { return; }

    const delivery_id = crypto.randomUUID();
    const payload = { event, data, delivery_id, timestamp: new Date().toISOString() };

    for (const sub of subscribers) {
      await enqueue(sub.id, event, payload, 1);
      setImmediate(() => processQueue(sub.id));
    }
  });
}

/**
 * Process pending deliveries for one subscriber — with exponential backoff.
 * Called after enqueueing and also by the retry cron every 2 minutes.
 */
async function processQueue(subscriberId) {
  let sub;
  try {
    [[sub]] = await pool.query('SELECT * FROM webhooks WHERE id=? AND is_active=1', [subscriberId]);
    if (!sub) return;

    const [pending] = await pool.query(
      `SELECT * FROM webhook_deliveries
       WHERE subscriber_id=? AND status='pending' AND deliver_at<=NOW()
       ORDER BY deliver_at LIMIT 10`,
      [subscriberId]
    );

    for (const delivery of pending) {
      // Mark as in-flight
      await pool.query("UPDATE webhook_deliveries SET status='sending' WHERE id=?", [delivery.id]);

      const payload = JSON.parse(delivery.payload);
      const result  = await attemptDelivery(sub, delivery.event, payload);

      if (result.ok) {
        await pool.query(
          "UPDATE webhook_deliveries SET status='delivered', delivered_at=NOW(), response_status=? WHERE id=?",
          [result.status, delivery.id]
        );
        // Reset consecutive fail count on success
        await pool.query("UPDATE webhooks SET fail_count=0 WHERE id=?", [sub.id]);
      } else {
        const nextAttempt = delivery.attempt_number + 1;
        const backoffSec  = BACKOFF_BASE_S * Math.pow(2, delivery.attempt_number - 1);

        if (nextAttempt <= MAX_ATTEMPTS) {
          // Schedule retry with backoff
          const retryAt = new Date(Date.now() + backoffSec * 1000)
            .toISOString().slice(0, 19).replace('T', ' ');
          await pool.query(
            "UPDATE webhook_deliveries SET status='pending', attempt_number=?, deliver_at=?, response_status=?, error=? WHERE id=?",
            [nextAttempt, retryAt, result.status, result.error || null, delivery.id]
          );
        } else {
          // Exhausted retries — mark failed
          await pool.query(
            "UPDATE webhook_deliveries SET status='failed', response_status=?, error=? WHERE id=?",
            [result.status, result.error || null, delivery.id]
          );
        }

        // Increment consecutive failure count
        await pool.query('UPDATE webhooks SET fail_count=fail_count+1 WHERE id=?', [sub.id]);

        // Auto-disable after DISABLE_AFTER consecutive failures
        const [[updated]] = await pool.query('SELECT fail_count FROM webhooks WHERE id=?', [sub.id]);
        if (updated.fail_count >= DISABLE_AFTER) {
          await pool.query(
            "UPDATE webhooks SET is_active=0, disabled_reason='Auto-disabled: 10 consecutive delivery failures' WHERE id=?",
            [sub.id]
          );
          global.logger?.warn(`Webhook ${sub.id} auto-disabled after ${DISABLE_AFTER} consecutive failures`);
        }
      }
    }
  } catch (e) {
    global.logger?.error(`Webhook processQueue error (sub ${subscriberId}): ${e.message}`);
  }
}

/**
 * Bootstrap: ensure webhook_deliveries table exists.
 * Called once at server startup.
 */
async function bootstrap() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      subscriber_id   INT NOT NULL,
      event           VARCHAR(100) NOT NULL,
      payload         JSON NOT NULL,
      delivery_id     VARCHAR(36),
      attempt_number  TINYINT UNSIGNED DEFAULT 1,
      status          ENUM('pending','sending','delivered','failed') DEFAULT 'pending',
      deliver_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      delivered_at    DATETIME,
      response_status SMALLINT,
      error           TEXT,
      created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_delivery (delivery_id),
      INDEX idx_pending (subscriber_id, status, deliver_at),
      FOREIGN KEY (subscriber_id) REFERENCES webhooks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `).catch(() => {});

  // Add disabled_reason column if missing (migration guard)
  await pool.query(
    "ALTER TABLE webhooks ADD COLUMN IF NOT EXISTS disabled_reason VARCHAR(255) NULL"
  ).catch(() => {});
}

/** Retry cron — call this every 2 minutes from cron.js. */
async function retryPending() {
  try {
    const [subs] = await pool.query(
      "SELECT DISTINCT subscriber_id FROM webhook_deliveries WHERE status='pending' AND deliver_at<=NOW() LIMIT 20"
    );
    await Promise.allSettled(subs.map(s => processQueue(s.subscriber_id)));
  } catch (e) {
    // Silently skip if the table doesn't exist yet (bootstrap hasn't run or failed).
    // ER_NO_SUCH_TABLE = errno 1146
    if (e.errno === 1146) return;
    global.logger?.error('Webhook retryPending error: ' + e.message);
  }
}

module.exports = { deliverEvent, processQueue, retryPending, bootstrap, sign };
