const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

exports.getAll = async (req, res) => {
  try {
    let sql = `SELECT vn.*,u.full_name AS tenant_name,u.phone,un.unit_number,pr.name AS property_name
      FROM vacate_notices vn JOIN tenancies ten ON vn.tenancy_id=ten.id
      JOIN tenants t ON ten.tenant_id=t.id JOIN users u ON t.user_id=u.id
      JOIN units un ON ten.unit_id=un.id JOIN properties pr ON un.property_id=pr.id
      WHERE 1=1`;
    const params = [];
    if (req.user.role === 'tenant') {
      sql += ' AND t.user_id=?'; params.push(req.user.sub);
    }
    if (req.query.property_id) { sql += ' AND pr.id=?'; params.push(req.query.property_id); }
    if (req.query.status)      { sql += ' AND vn.status=?'; params.push(req.query.status); }
    if (req.user.role === 'property_manager' && req.user.property_id) {
      sql += ' AND pr.id=?'; params.push(req.user.property_id);
    }
    sql += ' ORDER BY vn.created_at DESC';
    const [rows] = await pool.query(sql, params);
    ok(res, { notices: rows });
  } catch(e) { safeErr(res, e); }
};

exports.create = async (req, res) => {
  try {
    const { tenancy_id,vacate_date,reason } = req.body;
    if (!tenancy_id||!vacate_date) return err(res, 'tenancy_id and vacate_date required');
    const [r] = await pool.query('INSERT INTO vacate_notices (tenancy_id,notice_date,vacate_date,reason) VALUES (?,CURDATE(),?,?)',
      [tenancy_id, vacate_date, reason||null]);
    await pool.query("UPDATE tenancies SET status='notice_given' WHERE id=?", [tenancy_id]);
    ok(res, { id: r.insertId, message: 'Vacate notice submitted' }, 201);
  } catch(e) { safeErr(res, e); }
};

exports.update = async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE vacate_notices SET status=?,acknowledged_by=? WHERE id=?', [status, req.user.sub, req.params.id]);
    ok(res, { message: 'Notice updated' });
  } catch(e) { safeErr(res, e); }
};
