// FIXED: controllers/admin/payments.js
// Fixes applied:
//   1. Removed duplicate conn.commit() + conn.release() (was crashing every payment)
//   2. Replaced race-prone receiptNumber(pool) with atomic nextReceiptNumber(conn)
//   3. Used safeErr for consistent error handling

const pool = require('../../config/db');
const { ok, err, safeErr, nextReceiptNumber } = require('../../utils/helpers');

function validateMpesaCode(code) {
  if (!code) return null;
  if (!/^[A-Z0-9]{10}$/.test(code)) return 'M-Pesa code must be exactly 10 alphanumeric characters';
  return null;
}

exports.getAll = async (req, res) => {
  try {
    let sql = `SELECT py.*,i.type AS invoice_type,u.full_name AS tenant_name,
      un.unit_number,pr.name AS property_name,rc.receipt_number
      FROM payments py JOIN invoices i ON py.invoice_id=i.id
      JOIN tenancies ten ON py.tenancy_id=ten.id JOIN tenants t ON ten.tenant_id=t.id
      JOIN users u ON t.user_id=u.id JOIN units un ON ten.unit_id=un.id
      JOIN properties pr ON un.property_id=pr.id
      LEFT JOIN receipts rc ON py.id=rc.payment_id WHERE 1=1`;
    const params = [];
    if (req.query.tenancy_id)  { sql += ' AND py.tenancy_id=?';  params.push(req.query.tenancy_id); }
    if (req.query.property_id) { sql += ' AND pr.id=?';           params.push(req.query.property_id); }
    if (req.query.tenant_id)   { sql += ' AND ten.tenant_id=?';   params.push(req.query.tenant_id); }
    if (req.user.role === 'property_manager') {
      sql += ' AND pr.manager_id=?'; params.push(req.user.sub);
    } else if (['caretaker','security'].includes(req.user.role) && req.user.property_id) {
      sql += ' AND pr.id=?'; params.push(req.user.property_id);
    }
    if (req.query.date_from) { sql += ' AND DATE(py.paid_at) >= ?'; params.push(req.query.date_from); }
    if (req.query.date_to)   { sql += ' AND DATE(py.paid_at) <= ?'; params.push(req.query.date_to); }
    sql += ' ORDER BY py.paid_at DESC LIMIT 200';
    const [rows] = await pool.query(sql, params);
    const total_amount = rows.reduce((s,r) => s + Number(r.amount), 0);
    ok(res, { payments: rows, total_amount });
  } catch(e) { safeErr(res, e); }  // FIX: was err(res, e.message, 500) — use safeErr
};

exports.record = async (req, res) => {
  try {
    let { invoice_id, tenancy_id, amount, payment_method, transaction_code, mpesa_phone, notes } = req.body;
    if (!invoice_id||!tenancy_id||!amount||!payment_method)
      return err(res, 'invoice_id, tenancy_id, amount and payment_method required');

    if (req.user.role === 'tenant' && payment_method === 'cash')
      return err(res, 'Cash payments not available on tenant portal. Use M-Pesa or bank transfer.', 403);

    if (transaction_code) transaction_code = transaction_code.toUpperCase().trim();

    if (payment_method === 'mpesa' && transaction_code) {
      const mpesaErr = validateMpesaCode(transaction_code);
      if (mpesaErr) return err(res, mpesaErr);
    }

    if (transaction_code) {
      const [[dup]] = await pool.query('SELECT id FROM payments WHERE transaction_code=?', [transaction_code]);
      if (dup) return err(res, `Transaction code ${transaction_code} already recorded`, 409);
    }

    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      const [pr] = await conn.query(
        'INSERT INTO payments (invoice_id,tenancy_id,amount,payment_method,transaction_code,mpesa_phone,notes,recorded_by) VALUES (?,?,?,?,?,?,?,?)',
        [invoice_id, tenancy_id, amount, payment_method, transaction_code||null, mpesa_phone||null, notes||null, req.user.sub]);

      // FIX: use atomic nextReceiptNumber(conn) inside the transaction, not the racy receiptNumber(pool)
      const rnum = await nextReceiptNumber(conn);

      await conn.query('INSERT INTO receipts (payment_id,receipt_number) VALUES (?,?)', [pr.insertId, rnum]);
      const [[inv]] = await conn.query('SELECT * FROM invoices WHERE id=?', [invoice_id]);
      const remaining = Math.max(0, parseFloat(inv.balance) - parseFloat(amount));
      await conn.query('UPDATE invoices SET balance=?,status=? WHERE id=?',
        [remaining, remaining<=0?'paid':'partial', invoice_id]);
      await conn.query('INSERT INTO tenant_ledger (tenancy_id,type,amount,description,ref_type,ref_id) VALUES (?,?,?,?,?,?)',
        [tenancy_id,'credit',amount,`${payment_method.toUpperCase()} ${transaction_code||''}`.trim(),'payment',pr.insertId]);

      // FIX: commit and release exactly ONCE
      const paymentId = pr.insertId;
      await conn.commit();
      conn.release();

      // Post-commit: send receipt (non-fatal)
      setImmediate(async () => {
        try {
          const [[tenantInfo]] = await pool.query(
            `SELECT u.email, u.phone, u.full_name, u.id AS user_id,
                    un.unit_number, pr2.name AS property_name
             FROM tenancies ten
             JOIN tenants t ON ten.tenant_id=t.id JOIN users u ON t.user_id=u.id
             JOIN units un ON ten.unit_id=un.id JOIN properties pr2 ON un.property_id=pr2.id
             WHERE ten.id=? LIMIT 1`, [tenancy_id]);
          if (tenantInfo) {
            await pool.query('INSERT INTO notifications (user_id,type,title,message,action_url) VALUES (?,?,?,?,?)',
              [tenantInfo.user_id, 'payment', '✅ Payment received',
               'Payment of KES ' + Number(amount).toLocaleString() + ' received. Receipt: ' + rnum,
               '/tenant/payments']).catch(()=>{});
            const emailSvc = require('../../services/email');
            if (tenantInfo.email) {
              await emailSvc.sendPaymentReceipt({
                to: tenantInfo.email,
                tenant_name: tenantInfo.full_name,
                receipt_number: rnum,
                amount, payment_method, transaction_code,
                unit_number: tenantInfo.unit_number,
                property_name: tenantInfo.property_name,
              }).catch(()=>{});
            }
            const wa = require('../../services/whatsapp');
            if (tenantInfo.phone) {
              const msg = 'SmartNyumba receipt ' + rnum + ': Payment of KES ' +
                Number(amount).toLocaleString() + ' for unit ' + tenantInfo.unit_number +
                ' received via ' + payment_method.toUpperCase() +
                (transaction_code ? ' (' + transaction_code + ')' : '') + '. Thank you!';
              await wa.send({ phone: tenantInfo.phone, message: msg, type: 'receipt', user_id: tenantInfo.user_id }).catch(()=>{});
            }
          }
        } catch (_) {}
      });

      return ok(res, { payment_id: paymentId, receipt_number: rnum, message: 'Payment recorded' }, 201);
    } catch(e2) { await conn.rollback(); conn.release(); throw e2; }
  } catch(e) { safeErr(res, e); }
};

// Initiate M-Pesa STK Push for tenant
exports.initiateStk = async (req, res) => {
  try {
    const { invoice_id, tenancy_id, amount, phone } = req.body;
    if (!invoice_id||!amount||!phone) return err(res, 'invoice_id, amount and phone required');
    const mpesa = require('../../services/mpesa');
    const result = await mpesa.stkPush({ phone, amount, invoice_id, tenancy_id, account_ref: `SNP-${tenancy_id}` });
    if (result.success) ok(res, result);
    else err(res, result.error, 400);
  } catch(e) { safeErr(res, e); }
};

// Poll STK status
exports.checkStk = async (req, res) => {
  try {
    const [[txn]] = await pool.query('SELECT * FROM mpesa_transactions WHERE checkout_request_id=?', [req.params.checkout_id]);
    if (!txn) return err(res, 'Transaction not found', 404);

    if ((txn.checkout_request_id?.startsWith('DEMO') || txn.checkout_request_id?.startsWith('SIM_')) && txn.status === 'pending') {
      const elapsed = Date.now() - new Date(txn.initiated_at||Date.now()).getTime();
      if (elapsed > 5000) {
        const fakeCode = 'QK' + Math.random().toString(36).slice(2,10).toUpperCase().slice(0,8);
        await pool.query("UPDATE mpesa_transactions SET status='completed',transaction_code=? WHERE id=?", [fakeCode, txn.id]);
        const conn = await pool.getConnection();
        await conn.beginTransaction();
        try {
          const [pr] = await conn.query('INSERT INTO payments (invoice_id,tenancy_id,amount,payment_method,transaction_code,mpesa_phone,notes) VALUES (?,?,?,?,?,?,?)',
            [txn.invoice_id, txn.tenancy_id, txn.amount, 'mpesa', fakeCode, txn.phone, 'M-Pesa STK Push']);
          const rnum = await nextReceiptNumber(conn); // FIX: atomic receipt number
          await conn.query('INSERT INTO receipts (payment_id,receipt_number) VALUES (?,?)', [pr.insertId, rnum]);
          const [[inv]] = await conn.query('SELECT * FROM invoices WHERE id=?', [txn.invoice_id]);
          const remaining = Math.max(0, parseFloat(inv.balance) - parseFloat(txn.amount));
          await conn.query('UPDATE invoices SET balance=?,status=? WHERE id=?', [remaining, remaining<=0?'paid':'partial', txn.invoice_id]);
          await conn.commit();
          conn.release();
          return ok(res, { status:'completed', transaction_code:fakeCode, receipt_number:rnum, message:'Payment confirmed!' });
        } catch(e2) { await conn.rollback(); conn.release(); throw e2; }
      }
    }

    ok(res, { status: txn.status, transaction_code: txn.transaction_code, result_desc: txn.result_desc });
  } catch(e) { safeErr(res, e); }
};