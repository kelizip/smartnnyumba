'use strict';
const crypto = require('crypto');

const ok = (res, payload = {}, code = 200) => res.status(code).json({ success: true, ...payload });
const err = (res, message, code = 400, details = null) => {
  const body = { error: message };
  if (details) body.details = details;
  return res.status(code).json(body);
};
const safeErr = (res, e, fallback = 'Server error') => {
  global.logger?.error(e);
  const msg = process.env.NODE_ENV === 'production' ? fallback : (e.message || fallback);
  return res.status(500).json({ error: msg });
};

const paginate = async (pool, sql, params, page = 1, limit = 20) => {
  const safePage  = Math.max(1, parseInt(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const offset    = (safePage - 1) * safeLimit;
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM (${sql}) _cw`, params);
  const [rows] = await pool.query(`${sql} LIMIT ? OFFSET ?`, [...params, safeLimit, offset]);
  return { data: rows, meta: { total: parseInt(total), page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) } };
};

// Race-condition-proof receipt numbers using DB sequence
const nextReceiptNumber = async (conn) => {
  const year = new Date().getFullYear();
  await conn.query(
    `INSERT INTO receipt_sequences (year,next_val) VALUES (?,2)
     ON DUPLICATE KEY UPDATE next_val=next_val+1`, [year]);
  const [[{ n }]] = await conn.query(
    'SELECT next_val-1 AS n FROM receipt_sequences WHERE year=?', [year]);
  return `RCP-${year}-${String(n).padStart(5,'0')}`;
};
// Legacy alias — kept for backwards compat but warns
const receiptNumber = async (pool) => {
  const year = new Date().getFullYear();
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM receipts WHERE YEAR(created_at)=?',[year]);
  return `RCP-${year}-${String(parseInt(n)+1).padStart(5,'0')}`;
};

// Encryption helpers for PII fields (Kenya Data Protection Act)
const ENC_KEY = () => {
  const k = process.env.ENCRYPTION_KEY;
  if (!k || k.length < 64) return null;
  return Buffer.from(k, 'hex');
};
const encrypt = (text) => {
  const key = ENC_KEY();
  if (!key || !text) return text;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return iv.toString('hex') + ':' + Buffer.concat([cipher.update(String(text)), cipher.final()]).toString('hex');
};
const decrypt = (val) => {
  const key = ENC_KEY();
  if (!key || !val || !val.includes(':')) return val;
  try {
    const [ivHex, enc] = val.split(':');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex,'hex'));
    return Buffer.concat([decipher.update(Buffer.from(enc,'hex')), decipher.final()]).toString();
  } catch { return val; }
};

const rand     = (byteLen = 32) => crypto.randomBytes(byteLen).toString('hex');
const sanitize = (str) => String(str ?? '').replace(/<[^>]*>/g,'').trim();
const kes      = (n) => `KES ${Number(n||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const monthYear= (d) => { const dt = d ? new Date(d) : new Date(); return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}`; };
const fmtDate  = (d) => { if (!d) return ''; return new Date(d).toLocaleDateString('en-KE',{timeZone:'Africa/Nairobi',day:'2-digit',month:'short',year:'numeric'}); };
const clamp    = (val,min,max) => Math.min(max,Math.max(min,val));

// Validate Kenyan phone numbers
const validatePhone = (p) => /^(\+?254|0)7\d{8}$/.test(String(p||'').replace(/\s/g,''));

// Strong password: 8+ chars, 1 uppercase, 1 digit
const strongPassword = (p) => p && p.length >= 8 && /[A-Z]/.test(p) && /[0-9]/.test(p);

module.exports = { ok, err, safeErr, paginate, nextReceiptNumber, receiptNumber,
  encrypt, decrypt, rand, sanitize, kes, monthYear, fmtDate, clamp,
  validatePhone, strongPassword };
