const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

exports.getAll = async (req, res) => {
  try {
    let where = 'WHERE 1=1';
    const params = [];

    // Property manager: only see properties assigned to them
    if (req.user.role === 'property_manager') {
      where += ' AND (p.manager_id=? OR p.id IN (SELECT property_id FROM users WHERE id=? AND property_id IS NOT NULL))';
      params.push(req.user.sub, req.user.sub);
    }
    // Caretaker/security: only see their assigned property
    else if (['caretaker','security'].includes(req.user.role) && req.user.property_id) {
      where += ' AND p.id=?';
      params.push(req.user.property_id);
    }

    const [rows] = await pool.query(`
      SELECT p.*,u.full_name AS manager_name,
        COUNT(DISTINCT un.id)                                AS total_units,
        SUM(un.status='occupied')                            AS occupied_units,
        SUM(un.status='vacant')                              AS vacant_units,
        COALESCE(SUM(CASE WHEN i.status IN('unpaid','overdue','partial') THEN i.balance END),0) AS outstanding
      FROM properties p
      LEFT JOIN users u ON p.manager_id=u.id
      LEFT JOIN units un ON p.id=un.property_id
      LEFT JOIN tenancies ten ON un.id=ten.unit_id AND ten.status='active'
      LEFT JOIN invoices i ON ten.id=i.tenancy_id AND i.status IN('unpaid','overdue','partial')
      ${where}
      GROUP BY p.id ORDER BY p.name`, params);
    ok(res, { properties: rows });
  } catch(e) { safeErr(res, e); }
};

exports.create = async (req, res) => {
  try {
    const { name, location, address, description, manager_id, owner_id, management_fee_pct } = req.body;
    if (!name) return err(res, 'Property name is required');
    let mgr = manager_id || null;
    if (!mgr && req.user.role === 'property_manager') mgr = req.user.sub;
    const [r] = await pool.query(
      'INSERT INTO properties (name,location,address,description,manager_id,owner_id,management_fee_pct) VALUES (?,?,?,?,?,?,?)',
      [name, location||null, address||null, description||null, mgr, owner_id||null, management_fee_pct||0]);
    // Set property_id on manager user record
    if (mgr) await pool.query('UPDATE users SET property_id=? WHERE id=? AND property_id IS NULL', [r.insertId, mgr]);
    ok(res, { id: r.insertId, message: 'Property created' }, 201);
  } catch(e) { safeErr(res, e); }
};

exports.update = async (req, res) => {
  try {
    const { name, location, address, description, manager_id, owner_id, management_fee_pct } = req.body;

    // Get old manager before updating
    const [[old]] = await pool.query('SELECT manager_id, id FROM properties WHERE id=?', [req.params.id]);
    if (!old) return err(res, 'Property not found', 404);

    await pool.query(
      'UPDATE properties SET name=?,location=?,address=?,description=?,manager_id=?,owner_id=?,management_fee_pct=? WHERE id=?',
      [name, location||null, address||null, description||null, manager_id||null, owner_id||null, management_fee_pct||0, req.params.id]);

    // If manager changed: clear old manager's property_id, set new manager's property_id
    if (String(old.manager_id) !== String(manager_id)) {
      if (old.manager_id) {
        await pool.query('UPDATE users SET property_id=NULL WHERE id=? AND property_id=?', [old.manager_id, req.params.id]);
      }
      if (manager_id) {
        await pool.query('UPDATE users SET property_id=? WHERE id=?', [req.params.id, manager_id]);
      }
    }

    ok(res, { message: 'Property updated' });
  } catch(e) { safeErr(res, e); }
};

exports.getOne = async (req, res) => {
  try {
    const [[p]] = await pool.query(
      `SELECT p.*,
        u.full_name AS manager_name, u.phone AS manager_phone, u.email AS manager_email,
        o.full_name AS owner_name,
        COUNT(DISTINCT un.id) AS total_units,
        SUM(un.status='occupied') AS occupied_units,
        SUM(un.status='vacant') AS vacant_units
       FROM properties p
       LEFT JOIN users u ON p.manager_id=u.id
       LEFT JOIN users o ON p.owner_id=o.id
       LEFT JOIN units un ON p.id=un.property_id
       WHERE p.id=? GROUP BY p.id`,
      [req.params.id]);
    if (!p) return err(res, 'Property not found', 404);

    // Staff assigned to this property
    const [staff] = await pool.query(
      `SELECT id,full_name,email,phone,role,profile_photo,is_active,last_login
       FROM users WHERE property_id=? AND role IN('caretaker','security','property_manager')
       ORDER BY role,full_name`,
      [req.params.id]);

    const [units] = await pool.query(
      'SELECT * FROM units WHERE property_id=? ORDER BY floor,unit_number',
      [req.params.id]);

    ok(res, { property: { ...p, staff }, units });
  } catch(e) { safeErr(res, e); }
};

exports.delete = async (req, res) => {
  try {
    const [[p]] = await pool.query('SELECT id FROM properties WHERE id=?', [req.params.id]);
    if (!p) return err(res, 'Property not found', 404);
    // Safety check: block delete if property has active tenancies
    const [[{ active }]] = await pool.query(
      `SELECT COUNT(*) AS active FROM tenancies ten
       JOIN units u ON ten.unit_id=u.id
       WHERE u.property_id=? AND ten.status IN('active','approved')`, [req.params.id]);
    if (active > 0) return err(res,
      `Cannot delete: this property has ${active} active tenancy${active>1?'s':''}. Terminate all tenancies first.`, 409);
    await pool.query('DELETE FROM properties WHERE id=?', [req.params.id]);
    ok(res, { message: 'Property deleted' });
  } catch(e) { safeErr(res, e); }
};
