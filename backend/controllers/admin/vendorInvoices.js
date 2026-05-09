const pool = require('../../config/db');
const { ok, err, safeErr } = require('../../utils/helpers');

exports.getAll = async (req, res) => {
  try {
    let sql = `SELECT vi.*, v.name AS vendor_name, p.name AS property_name, u.full_name AS approved_by_name
      FROM vendor_invoices vi
      JOIN vendors v ON vi.vendor_id = v.id
      JOIN properties p ON vi.property_id = p.id
      LEFT JOIN users u ON vi.approved_by = u.id
      WHERE 1=1`;
    const params = [];
    if (req.user.role === 'property_manager') { sql += ' AND p.manager_id=?'; params.push(req.user.sub); }
    else if (req.user.property_id) { sql += ' AND vi.property_id=?'; params.push(req.user.property_id); }
    if (req.query.property_id) { sql += ' AND vi.property_id=?'; params.push(req.query.property_id); }
    if (req.query.status) { sql += ' AND vi.status=?'; params.push(req.query.status); }
    sql += ' ORDER BY vi.created_at DESC LIMIT 100';
    const [rows] = await pool.query(sql, params);
    ok(res, { invoices: rows });
  } catch(e) { err(res, e.message, 500); }
};

exports.create = async (req, res) => {
  try {
    const { vendor_id, property_id, amount, description, invoice_date, due_date, invoice_ref } = req.body;
    if (!vendor_id||!property_id||!amount) return err(res, 'vendor_id, property_id and amount required');
    const [r] = await pool.query(
      'INSERT INTO vendor_invoices (vendor_id,property_id,amount,description,invoice_date,due_date,invoice_ref,created_by) VALUES (?,?,?,?,?,?,?,?)',
      [vendor_id, property_id, amount, description||null, invoice_date||null, due_date||null, invoice_ref||null, req.user.sub]
    );
    ok(res, { id: r.insertId }, 201);
  } catch(e) { err(res, e.message, 500); }
};

exports.approve = async (req, res) => {
  try {
    await pool.query(
      "UPDATE vendor_invoices SET status='approved', approved_by=?, approved_at=NOW() WHERE id=?",
      [req.user.sub, req.params.id]
    );
    ok(res, { message: 'Invoice approved' });
  } catch(e) { err(res, e.message, 500); }
};

exports.markPaid = async (req, res) => {
  try {
    const { payment_ref } = req.body;
    await pool.query(
      "UPDATE vendor_invoices SET status='paid', payment_ref=?, paid_at=NOW() WHERE id=?",
      [payment_ref||null, req.params.id]
    );
    ok(res, { message: 'Invoice marked as paid' });
  } catch(e) { err(res, e.message, 500); }
};
