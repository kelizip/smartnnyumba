const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

exports.getAll = async (req, res) => {
  try {
    let sql = `SELECT a.*,u.full_name AS posted_by,p.name AS property_name
      FROM announcements a JOIN users u ON a.created_by=u.id
      LEFT JOIN properties p ON a.property_id=p.id WHERE 1=1`;
    const params = [];

    if (req.user.role === 'tenant') {
      // Tenants see announcements from staff of their property only
      const [[t]] = await pool.query(`SELECT un.property_id FROM tenants t JOIN tenancies ten ON t.id=ten.tenant_id AND ten.status IN ('active','approved','pending') JOIN units un ON ten.unit_id=un.id WHERE t.user_id=? LIMIT 1`, [req.user.sub]);
      if (t) { sql += ' AND a.property_id=? AND a.target_audience IN(?,?)'; params.push(t.property_id,'staff','all'); }
      else return ok(res, { announcements: [] });
    } else if (req.user.role === 'security' || req.user.role === 'caretaker') {
      // Staff see announcements for their assigned property
      if (req.user.role === 'property_manager') {
      sql += ' AND (a.property_id IS NULL OR a.property_id IN (SELECT id FROM properties WHERE manager_id=?))';
      params.push(req.user.sub);
    } else if (req.user.property_id) {
      sql += ' AND (a.property_id=? OR a.property_id IS NULL)'; params.push(req.user.property_id);
    }
    }

    sql += ' ORDER BY a.created_at DESC LIMIT 30';
    const [rows] = await pool.query(sql, params);
    ok(res, { announcements: rows });
  } catch(e) { safeErr(res, e); }
};

exports.create = async (req, res) => {
  try {
    const { property_id, title, message, priority, expires_at, target_audience } = req.body;
    if (!title || !message) return err(res, 'title and message required');

    let final_property_id = property_id || null;
    let final_audience    = target_audience || 'all';
    const role = req.user.role;

    // Tenant can only post to staff of their property
    if (role === 'tenant') {
      const [[t]] = await pool.query(`SELECT un.property_id FROM tenants t JOIN tenancies ten ON t.id=ten.tenant_id AND ten.status IN ('active','approved','pending') JOIN units un ON ten.unit_id=un.id WHERE t.user_id=? LIMIT 1`, [req.user.sub]);
      if (!t) return err(res, 'No active tenancy found', 400);
      final_property_id = t.property_id;
      final_audience    = 'staff'; // Force staff only
    }

    const [r] = await pool.query(
      'INSERT INTO announcements (property_id,title,message,priority,expires_at,created_by,target_audience,posted_by_role) VALUES (?,?,?,?,?,?,?,?)',
      [final_property_id, title, message, priority||'normal', expires_at||null, req.user.sub, final_audience, role]);
    ok(res, { id: r.insertId, message: 'Announcement posted' }, 201);
  } catch(e) { safeErr(res, e); }
};

exports.remove = async (req, res) => {
  try {
    const [result] = await pool.query(
      'DELETE FROM announcements WHERE id = ?', [req.params.id]);
    if (result.affectedRows === 0) return err(res, 'Announcement not found', 404);
    ok(res, { message: 'Announcement deleted' });
  } catch(e) { safeErr(res, e); }
};
