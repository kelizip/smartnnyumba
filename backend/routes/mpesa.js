const router = require('express').Router();
const auth   = require('../middleware/auth');
const mpesa  = require('../services/mpesa');
const { ok, err } = require('../utils/helpers');

// Initiate STK push
router.post('/stk', auth(['tenant','property_manager','super_admin']), async (req, res) => {
  try {
    const { phone, amount, invoice_id, tenancy_id, account_ref } = req.body;
    if (!phone || !amount || !invoice_id) return err(res, 'phone, amount, and invoice_id required');
    const result = await mpesa.stkPush({ phone, amount, invoice_id, tenancy_id, account_ref });
    if (result.success) ok(res, result);
    else err(res, result.error, 400);
  } catch (e) { err(res, e.message, 500); }
});

// Callback (no auth — called by Safaricom)
router.post('/callback', async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  await mpesa.handleCallback(req.body);
});

// Check STK status
router.get('/status/:checkout_id', auth(), async (req, res) => {
  try {
    const pool = require('../config/db');
    const [[txn]] = await pool.query('SELECT status,transaction_code,result_desc,amount FROM mpesa_transactions WHERE checkout_request_id=?', [req.params.checkout_id]);
    if (!txn) return err(res, 'Transaction not found', 404);
    ok(res, { transaction: txn });
  } catch (e) { err(res, e.message, 500); }
});

module.exports = router;

// ── M-Pesa callback IP allowlist middleware ───────────────────
// Safaricom's documented IP ranges for callbacks
const SAFARICOM_IPS = [
  '196.201.214.200', '196.201.214.206', '196.201.213.114',
  '196.201.214.207', '196.201.214.208', '196.201.213.44',
  '196.201.212.127', '196.201.212.128', '196.201.212.129',
  '196.201.212.136', '196.201.212.74',  '196.201.212.69',
];

function safaricomOnly(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next(); // skip in dev/sandbox
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  if (SAFARICOM_IPS.includes(ip)) return next();
  global.logger?.warn('M-Pesa callback from unknown IP: ' + ip);
  return res.status(403).json({ ResultCode: 1, ResultDesc: 'Forbidden' });
}

// Re-export the callback route with IP protection
// (Replace the existing callback route in this file if needed — just add the middleware)
// router.post('/callback', safaricomOnly, c.callback);  ← production version
