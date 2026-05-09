const axios = require('axios');
const pool  = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

async function getDarajaToken() {
  const env = process.env.MPESA_ENV || 'sandbox';
  const url = env === 'production'
    ? 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
    : 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials';
  const creds = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const { data } = await axios.get(url, { headers: { Authorization: `Basic ${creds}` } });
  return data.access_token;
}

function generatePassword() {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey   = process.env.MPESA_PASSKEY;
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g,'').slice(0,14);
  const password  = Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
  return { password, timestamp };
}

// Initiate STK Push
exports.initiate = async (req, res) => {
  try {
    let { invoice_id, tenancy_id, amount, phone } = req.body;
    if (!invoice_id || !amount || !phone) return err(res, 'invoice_id, amount and phone required');

    // Normalise phone
    phone = phone.replace(/^0/, '254').replace(/^\+/, '').replace(/\s/g,'');
    if (!/^254\d{9}$/.test(phone)) return err(res, 'Invalid phone number. Use format: 07XX XXX XXX');

    // Check invoice belongs to this tenant
    if (req.user.role === 'tenant') {
      const [[inv]] = await pool.query(
        `SELECT i.id FROM invoices i JOIN tenancies ten ON i.tenancy_id=ten.id
         JOIN tenants t ON ten.tenant_id=t.id WHERE i.id=? AND t.user_id=? AND i.status IN('unpaid','partial','overdue')`,
        [invoice_id, req.user.sub]);
      if (!inv) return err(res, 'Invoice not found or already paid', 404);
    }

    // Check if M-Pesa is enabled (check both keys, fall back to env vars)
    const [settingRows] = await pool.query(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('mpesa_enabled','mpesa_stk_enabled')");
    const settingsMap = Object.fromEntries(settingRows.map(r => [r.setting_key, r.setting_value]));
    // Check if M-Pesa is enabled — any of the 3 keys being '1' means it's on
    const mpesaEnabled =
      settingsMap['mpesa_enabled']     === '1' ||
      settingsMap['mpesa_stk_enabled'] === '1' ||
      settingsMap['mpesa_stk_push']    === '1' ||
      (process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_KEY.length > 5 &&
       process.env.MPESA_SHORTCODE && process.env.MPESA_SHORTCODE.length > 3);

    if (!mpesaEnabled) {
      // Demo/simulation mode — still proceeds so tenant sees the flow
      const demoRef = `DEMO${Date.now().toString().slice(-8)}`;
      try {
        await pool.query(
          'INSERT INTO mpesa_transactions (checkout_request_id,invoice_id,tenancy_id,phone,amount,status,initiated_by) VALUES (?,?,?,?,?,?,?)',
          [demoRef, invoice_id, tenancy_id||null, phone, amount, 'pending', req.user.sub]);
      } catch (_) {}
      return ok(res, {
        checkout_request_id: demoRef,
        message: 'STK push sent (demo mode). Configure Daraja credentials in Settings to go live.',
        demo: true
      });
    }

    const token = await getDarajaToken();
    const { password, timestamp } = generatePassword();
    const shortcode = process.env.MPESA_SHORTCODE;
    const env = process.env.MPESA_ENV || 'sandbox';
    const stkUrl = env === 'production'
      ? 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
      : 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest';

    const { data } = await axios.post(stkUrl, {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.ceil(parseFloat(amount)),
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: `SNP-${tenancy_id}`,
      TransactionDesc: `SmartNyumba Rent Payment`,
    }, { headers: { Authorization: `Bearer ${token}` } });

    if (data.ResponseCode !== '0') return err(res, data.ResponseDescription || 'STK push failed');

    await pool.query(
      'INSERT INTO mpesa_transactions (checkout_request_id,merchant_request_id,invoice_id,tenancy_id,phone,amount,status,initiated_by) VALUES (?,?,?,?,?,?,?,?)',
      [data.CheckoutRequestID, data.MerchantRequestID, invoice_id, tenancy_id, phone, amount, 'pending', req.user.sub]);

    ok(res, {
      checkout_request_id: data.CheckoutRequestID,
      message: 'STK push sent! Check your phone and enter your M-Pesa PIN.',
    });
  } catch (e) {
    const msg = e.response?.data?.errorMessage || e.message;
    err(res, `M-Pesa error: ${msg}`, 500);
  }
};

// Check STK status
exports.checkStatus = async (req, res) => {
  try {
    const { checkout_id } = req.params;
    const [[txn]] = await pool.query(
      'SELECT status,transaction_code,result_desc,amount,completed_at FROM mpesa_transactions WHERE checkout_request_id=?',
      [checkout_id]);
    if (!txn) return err(res, 'Transaction not found', 404);
    ok(res, { transaction: txn });
  } catch(e) { safeErr(res, e); }
};

// M-Pesa callback
exports.callback = async (req, res) => {
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  try {
    const stk = req.body.Body?.stkCallback;
    if (!stk) return;
    const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stk;
    const [[txn]] = await pool.query('SELECT * FROM mpesa_transactions WHERE checkout_request_id=?', [CheckoutRequestID]);
    if (!txn) return;

    if (ResultCode === 0) {
      const meta = {};
      (CallbackMetadata?.Item||[]).forEach(i => { meta[i.Name] = i.Value; });
      const txnCode = meta.MpesaReceiptNumber;
      const payerName = meta.FirstName ? `${meta.FirstName} ${meta.MiddleName||''} ${meta.LastName||''}`.trim() : null;

      await pool.query(
        'UPDATE mpesa_transactions SET status=?,transaction_code=?,result_code=?,result_desc=?,mpesa_name=?,completed_at=NOW() WHERE checkout_request_id=?',
        ['completed', txnCode, ResultCode, ResultDesc, payerName, CheckoutRequestID]);

      // Auto-record payment
      if (txn.invoice_id && txn.tenancy_id) {
        const { receiptNumber } = require('../../utils/helpers');
        const conn = await pool.getConnection();
        await conn.beginTransaction();
        try {
          const [pr] = await conn.query(
            'INSERT INTO payments (invoice_id,tenancy_id,amount,payment_method,transaction_code,mpesa_phone,notes) VALUES (?,?,?,?,?,?,?)',
            [txn.invoice_id, txn.tenancy_id, txn.amount, 'mpesa', txnCode, txn.phone, `M-Pesa STK - ${payerName||''}`]);
          const rnum = await receiptNumber(pool);
          await conn.query('INSERT INTO receipts (payment_id,receipt_number) VALUES (?,?)', [pr.insertId, rnum]);
          const [[inv]] = await conn.query('SELECT balance FROM invoices WHERE id=?', [txn.invoice_id]);
          const remaining = Math.max(0, parseFloat(inv.balance) - parseFloat(txn.amount));
          await conn.query('UPDATE invoices SET balance=?,status=? WHERE id=?',
            [remaining, remaining<=0?'paid':'partial', txn.invoice_id]);
          await conn.query('INSERT INTO tenant_ledger (tenancy_id,type,amount,description,ref_type,ref_id) VALUES (?,?,?,?,?,?)',
            [txn.tenancy_id,'credit',txn.amount,`M-Pesa ${txnCode}`,'payment',pr.insertId]);
          await conn.commit(); conn.release();
        } catch (e2) { await conn.rollback(); conn.release(); }
      }
    } else {
      await pool.query('UPDATE mpesa_transactions SET status=?,result_code=?,result_desc=? WHERE checkout_request_id=?',
        [ResultCode===1032?'cancelled':'failed', ResultCode, ResultDesc, CheckoutRequestID]);
    }
  } catch (e) { console.error('STK callback error:', e.message); }
};
