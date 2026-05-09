const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

exports.getAll = async (req, res) => {
  try {
    let sql = `SELECT u.*,p.name AS property_name,p.location,
      usr.full_name AS tenant_name,usr.phone AS tenant_phone,usr.email AS tenant_email,
      ten.id AS tenancy_id,ten.rent_amount AS tenancy_rent
      FROM units u JOIN properties p ON u.property_id=p.id
      LEFT JOIN tenancies ten ON u.id=ten.unit_id AND ten.status='active'
      LEFT JOIN tenants t ON ten.tenant_id=t.id
      LEFT JOIN users usr ON t.user_id=usr.id WHERE 1=1`;
    const params = [];
    if (req.query.property_id) { sql += ' AND u.property_id=?'; params.push(req.query.property_id); }
    if (req.query.status)      { sql += ' AND u.status=?';      params.push(req.query.status); }
    // Property manager: only show units in their assigned properties
    if (req.user.role === 'property_manager' && req.user.property_id) {
      sql += ' AND p.manager_id=?'; params.push(req.user.sub);
    }
    // Caretaker/Security: only show units in their assigned property
    if (['caretaker','security'].includes(req.user.role) && req.user.property_id) {
      sql += ' AND u.property_id=?'; params.push(req.user.property_id);
    }
    sql += ' ORDER BY p.name,u.floor,u.unit_number';
    const [rows] = await pool.query(sql, params);
    ok(res, { units: rows });
  } catch(e) { safeErr(res, e); }
};

exports.create = async (req, res) => {
  try {
    const { property_id,unit_number,floor,type,rent_amount,deposit_amount,status } = req.body;
    if (!property_id||!unit_number||!rent_amount) return err(res, 'property_id, unit_number and rent_amount required');
    const [r] = await pool.query('INSERT INTO units (property_id,unit_number,floor,type,rent_amount,deposit_amount,status) VALUES (?,?,?,?,?,?,?)',
      [property_id, unit_number, floor||1, type||'one_bedroom', rent_amount, deposit_amount||0, status||'vacant']);
    ok(res, { id: r.insertId, message: 'Unit created' }, 201);
  } catch(e) { safeErr(res, e); }
};

exports.update = async (req, res) => {
  try {
    // Security cannot edit units
    if (req.user.role === 'security') return err(res, 'Security staff cannot edit units', 403);
    const { unit_number,floor,type,rent_amount,deposit_amount,status } = req.body;
    await pool.query('UPDATE units SET unit_number=?,floor=?,type=?,rent_amount=?,deposit_amount=?,status=? WHERE id=?',
      [unit_number, floor||1, type, rent_amount, deposit_amount||0, status, req.params.id]);
    ok(res, { message: 'Unit updated' });
  } catch(e) { safeErr(res, e); }
};
