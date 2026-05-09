// backend/services/email.js  — NEW FILE
// Nodemailer-based email service for receipts, reminders, and notifications
// Configure via Settings: smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name

const pool = require('../config/db');

let transporterCache = null;
let transporterBuiltAt = 0;

async function getTransporter() {
  // Rebuild transporter if settings may have changed (cache for 5 min)
  if (transporterCache && Date.now() - transporterBuiltAt < 5 * 60 * 1000) return transporterCache;

  try {
    const [settings] = await pool.query(
      "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from_name','email_enabled')");
    const cfg = Object.fromEntries(settings.map(s => [s.setting_key, s.setting_value]));

    if (cfg.email_enabled !== '1' || !cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass) {
      return null;
    }

    const nodemailer = require('nodemailer');
    transporterCache = nodemailer.createTransport({
      host: cfg.smtp_host,
      port: parseInt(cfg.smtp_port || 587),
      secure: parseInt(cfg.smtp_port) === 465,
      auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
    });
    transporterCache._fromName = cfg.smtp_from_name || 'SmartNyumba';
    transporterCache._fromEmail = cfg.smtp_user;
    transporterBuiltAt = Date.now();
    return transporterCache;
  } catch (e) {
    console.error('Email transporter init error:', e.message);
    return null;
  }
}

async function sendMail({ to, subject, html, text }) {
  const transporter = await getTransporter();
  if (!transporter) {
    console.log(`Email (disabled/unconfigured) to ${to}: ${subject}`);
    return { success: false, reason: 'email not configured' };
  }
  try {
    const info = await transporter.sendMail({
      from: `"${transporter._fromName}" <${transporter._fromEmail}>`,
      to, subject, html, text,
    });
    return { success: true, messageId: info.messageId };
  } catch (e) {
    const now = Date.now();
    if (!global._lastEmailErrLog || now - global._lastEmailErrLog > 3600000) {
      console.error('Email send error (further errors suppressed for 1h):', e.message);
      global._lastEmailErrLog = now;
    }
    return { success: false, error: e.message };
  }
}

// ── Templates ─────────────────────────────────────────────────

function baseTemplate(content) {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; margin: 0; padding: 20px; }
    .container { max-width: 560px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
    .header { background: linear-gradient(135deg, #0369a1, #0284c7); padding: 28px 32px; }
    .header h1 { color: white; margin: 0; font-size: 20px; font-weight: 700; }
    .header p { color: #bae6fd; margin: 4px 0 0; font-size: 13px; }
    .body { padding: 28px 32px; }
    .amount-box { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 18px; text-align: center; margin: 20px 0; }
    .amount-box .amount { font-size: 32px; font-weight: 700; color: #0369a1; }
    .amount-box .label { font-size: 12px; color: #64748b; margin-top: 4px; }
    .details { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .details td { padding: 8px 4px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
    .details td:first-child { color: #64748b; width: 40%; }
    .details td:last-child { color: #1e293b; font-weight: 500; }
    .badge-green { background: #dcfce7; color: #166534; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; }
    .footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 32px; text-align: center; font-size: 11px; color: #94a3b8; }
    .btn { display: inline-block; background: #0284c7; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SmartNyumba RMS</h1>
      <p>Rental Management System</p>
    </div>
    <div class="body">${content}</div>
    <div class="footer">This is an automated message from SmartNyumba RMS. Please do not reply to this email.</div>
  </div>
</body>
</html>`;
}

async function sendPaymentReceipt({ tenant_name, email, amount, unit_number, property_name, receipt_number, payment_method, paid_at }) {
  if (!email) return { success: false, reason: 'no email' };
  const name = tenant_name.split(' ')[0];
  const dateStr = paid_at ? new Date(paid_at).toLocaleDateString('en-KE', { day:'numeric', month:'long', year:'numeric' }) : new Date().toLocaleDateString('en-KE');

  const html = baseTemplate(`
    <p style="color:#1e293b;font-size:15px;">Dear <strong>${name}</strong>,</p>
    <p style="color:#64748b;font-size:13px;margin-top:4px;">Your payment has been received and recorded. Thank you!</p>
    <div class="amount-box">
      <div class="amount">KES ${Number(amount).toLocaleString('en-KE', {minimumFractionDigits:2})}</div>
      <div class="label"><span class="badge-green">✓ Payment confirmed</span></div>
    </div>
    <table class="details">
      <tr><td>Receipt No.</td><td>${receipt_number}</td></tr>
      <tr><td>Date</td><td>${dateStr}</td></tr>
      <tr><td>Unit</td><td>${unit_number}</td></tr>
      <tr><td>Property</td><td>${property_name}</td></tr>
      <tr><td>Payment method</td><td style="text-transform:capitalize;">${(payment_method||'').replace('_',' ')}</td></tr>
    </table>
    <p style="color:#64748b;font-size:12px;margin-top:16px;">Please keep this receipt for your records. You can also download your full statement from the tenant portal.</p>
  `);

  return sendMail({
    to: email,
    subject: `✓ Payment Receipt ${receipt_number} — KES ${Number(amount).toLocaleString()} | SmartNyumba`,
    html,
    text: `Dear ${name}, your payment of KES ${Number(amount).toLocaleString()} has been received. Receipt: ${receipt_number}. Date: ${dateStr}. Unit: ${unit_number}.`,
  });
}

async function sendRentReminder({ tenant_name, email, amount, unit_number, property_name, due_date }) {
  if (!email) return { success: false, reason: 'no email' };
  const name = tenant_name.split(' ')[0];
  const html = baseTemplate(`
    <p style="color:#1e293b;font-size:15px;">Dear <strong>${name}</strong>,</p>
    <p style="color:#64748b;font-size:13px;">This is a friendly reminder that your rent payment is due soon.</p>
    <div class="amount-box">
      <div class="amount">KES ${Number(amount).toLocaleString('en-KE', {minimumFractionDigits:2})}</div>
      <div class="label">Due on <strong>${due_date}</strong></div>
    </div>
    <table class="details">
      <tr><td>Unit</td><td>${unit_number}</td></tr>
      <tr><td>Property</td><td>${property_name}</td></tr>
      <tr><td>Due date</td><td>${due_date}</td></tr>
    </table>
    <p style="color:#64748b;font-size:12px;">Pay via M-Pesa or log in to the tenant portal to pay online. Late payments may attract a penalty fee.</p>
  `);
  return sendMail({
    to: email,
    subject: `Rent reminder — KES ${Number(amount).toLocaleString()} due ${due_date} | SmartNyumba`,
    html,
    text: `Dear ${name}, your rent of KES ${Number(amount).toLocaleString()} for unit ${unit_number} is due on ${due_date}.`,
  });
}

async function sendLeaseExpiry({ tenant_name, email, unit_number, property_name, end_date, days_remaining }) {
  if (!email) return { success: false, reason: 'no email' };
  const name = tenant_name.split(' ')[0];
  const html = baseTemplate(`
    <p style="color:#1e293b;font-size:15px;">Dear <strong>${name}</strong>,</p>
    <p style="color:#dc2626;font-size:13px;font-weight:500;">⚠️ Your lease expires in <strong>${days_remaining} days</strong> on ${end_date}.</p>
    <table class="details" style="margin-top:16px;">
      <tr><td>Unit</td><td>${unit_number}</td></tr>
      <tr><td>Property</td><td>${property_name}</td></tr>
      <tr><td>Expiry date</td><td><strong>${end_date}</strong></td></tr>
    </table>
    <p style="color:#64748b;font-size:12px;margin-top:16px;">Please contact your property manager to arrange renewal or give formal notice to vacate. Failure to act may result in your lease lapsing.</p>
  `);
  return sendMail({
    to: email,
    subject: `⚠️ Your lease expires in ${days_remaining} days — SmartNyumba`,
    html,
    text: `Dear ${name}, your lease for unit ${unit_number} expires in ${days_remaining} days on ${end_date}.`,
  });
}

// ── Welcome email (new tenancy) ───────────────────────────────
async function sendWelcome({ to, tenant_name, unit_number, property_name, start_date, rent_amount, deposit }) {
  if (!to) return { success: false, reason: 'no email' };
  const name = tenant_name.split(' ')[0];
  const html = baseTemplate(`
    <p style="color:#1e293b;font-size:15px;">Dear <strong>${name}</strong>, welcome to <strong>${property_name}</strong>!</p>
    <p style="color:#64748b;font-size:13px;">Your tenancy has been set up. Here are your details:</p>
    <table class="details" style="margin-top:16px;">
      <tr><td>Unit</td><td><strong>${unit_number}</strong></td></tr>
      <tr><td>Property</td><td>${property_name}</td></tr>
      <tr><td>Start date</td><td>${start_date}</td></tr>
      <tr><td>Monthly rent</td><td><strong>KES ${Number(rent_amount).toLocaleString()}</strong></td></tr>
      <tr><td>Deposit</td><td>KES ${Number(deposit||0).toLocaleString()}</td></tr>
    </table>
    <p style="color:#64748b;font-size:13px;margin-top:16px;">Log in to the SmartNyumba tenant portal to view your invoices, make payments, and submit maintenance requests.</p>
    <p style="color:#64748b;font-size:12px;">If you have any questions, please contact your property manager.</p>
  `);
  return sendMail({
    to, subject: 'Welcome to ' + property_name + ' — SmartNyumba',
    html, text: 'Dear ' + name + ', welcome! Your tenancy for unit ' + unit_number + ' at ' + property_name + ' starts ' + start_date + '. Monthly rent: KES ' + Number(rent_amount).toLocaleString() + '.',
  });
}

// ── Payment receipt (called from payments controller) ──────────
async function sendPaymentReceipt({ to, tenant_name, receipt_number, amount, payment_method, transaction_code, unit_number, property_name }) {
  if (!to) return { success: false, reason: 'no email' };
  const name = tenant_name.split(' ')[0];
  const dateStr = new Date().toLocaleDateString('en-KE', { year:'numeric', month:'long', day:'numeric' });
  const html = baseTemplate(`
    <p style="color:#1e293b;font-size:15px;">Dear <strong>${name}</strong>,</p>
    <p style="color:#64748b;font-size:13px;">Your payment has been received. Here is your receipt:</p>
    <div class="amount-box">
      <div class="amount">KES ${Number(amount).toLocaleString('en-KE', { minimumFractionDigits: 2 })}</div>
      <div class="label">Receipt: ${receipt_number}</div>
    </div>
    <table class="details">
      <tr><td>Date</td><td>${dateStr}</td></tr>
      <tr><td>Unit</td><td>${unit_number}</td></tr>
      <tr><td>Property</td><td>${property_name||''}</td></tr>
      <tr><td>Payment method</td><td style="text-transform:capitalize;">${(payment_method||'').replace('_',' ')}</td></tr>
      ${transaction_code ? '<tr><td>Reference</td><td>' + transaction_code + '</td></tr>' : ''}
    </table>
    <p style="color:#64748b;font-size:12px;margin-top:16px;">Please keep this receipt for your records.</p>
  `);
  return sendMail({
    to, subject: '✓ Payment Receipt ' + receipt_number + ' — KES ' + Number(amount).toLocaleString() + ' | SmartNyumba',
    html, text: 'Dear ' + name + ', your payment of KES ' + Number(amount).toLocaleString() + ' has been received. Receipt: ' + receipt_number + '.',
  });
}

module.exports = { sendMail, sendPaymentReceipt, sendRentReminder, sendLeaseExpiry, sendWelcome };