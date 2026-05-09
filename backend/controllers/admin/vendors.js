const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

exports.getAll = async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM vendors ORDER BY name');
    ok(res, { vendors: rows });
  } catch(e) { safeErr(res, e); }
};

exports.create = async (req, res) => {
  try {
    const { name, category, phone, email, address, notes } = req.body;
    if (!name) return err(res, 'Vendor name required');
    const [r] = await pool.query(
      'INSERT INTO vendors (name,category,phone,email,address,notes) VALUES (?,?,?,?,?,?)',
      [name, category||'other', phone||null, email||null, address||null, notes||null]);
    ok(res, { id: r.insertId, message: 'Vendor added' }, 201);
  } catch(e) { safeErr(res, e); }
};

exports.update = async (req, res) => {
  try {
    const { name, category, phone, email, address, rating, notes, is_active } = req.body;
    await pool.query(
      'UPDATE vendors SET name=?,category=?,phone=?,email=?,address=?,rating=?,notes=?,is_active=? WHERE id=?',
      [name, category||'other', phone||null, email||null, address||null, rating||null, notes||null, is_active??1, req.params.id]);
    ok(res, { message: 'Vendor updated' });
  } catch(e) { safeErr(res, e); }
};

exports.getJobs = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT mr.*,un.unit_number,pr.name AS property_name
      FROM maintenance_requests mr JOIN units un ON mr.unit_id=un.id
      JOIN properties pr ON mr.property_id=pr.id
      WHERE mr.vendor_id=? ORDER BY mr.created_at DESC`, [req.params.id]);
    ok(res, { jobs: rows });
  } catch(e) { safeErr(res, e); }
};
