const router = require('express').Router();
const auth   = require('../middleware/auth');
const sms    = require('../services/sms');
const pool   = require('../config/db');
const { ok, err } = require('../utils/helpers');

// Send custom SMS
router.post('/', auth(['super_admin','property_manager']), async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) return err(res, 'phone and message required');
    const result = await sms.send({ phone, message, type:'custom', user_id: req.user.sub });
    ok(res, result);
  } catch (e) { err(res, e.message, 500); }
});

// Bulk payment reminders
router.post('/reminders', auth(['super_admin','property_manager']), async (req, res) => {
  try {
    const [overdue] = await pool.query(`
      SELECT u.full_name,u.phone,ten.rent_amount,un.unit_number,MIN(i.due_date) oldest
      FROM invoices i JOIN tenancies ten ON i.tenancy_id=ten.id
      JOIN tenants t ON ten.tenant_id=t.id JOIN users u ON t.user_id=u.id
      JOIN units un ON ten.unit_id=un.id
      WHERE i.status IN('unpaid','overdue') AND u.phone IS NOT NULL
      GROUP BY ten.id`);
    let sent = 0;
    for (const t of overdue) {
      const r = await sms.sendPaymentReminder({ tenant_name: t.full_name, phone: t.phone, amount: t.rent_amount, due_date: t.oldest, unit_number: t.unit_number });
      if (r.success) sent++;
    }
    ok(res, { sent, total: overdue.length, message: `${sent} reminders sent` });
  } catch (e) { err(res, e.message, 500); }
});

// SMS logs
router.get('/logs', auth(['super_admin','property_manager']), async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM sms_logs ORDER BY created_at DESC LIMIT 50');
    ok(res, { logs: rows });
  } catch (e) { err(res, e.message, 500); }
});

module.exports = router;
