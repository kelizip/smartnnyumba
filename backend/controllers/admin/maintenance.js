const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');
const { notify } = require('./notifications');

exports.getAll = async (req, res) => {
  try {
    let sql = `SELECT mr.*,un.unit_number,pr.name AS property_name,us.full_name AS assigned_name
      FROM maintenance_requests mr JOIN units un ON mr.unit_id=un.id
      JOIN properties pr ON mr.property_id=pr.id LEFT JOIN users us ON mr.assigned_to=us.id WHERE 1=1`;
    const params = [];
    if (req.query.status)      { sql += ' AND mr.status=?';      params.push(req.query.status); }
    if (req.query.property_id) { sql += ' AND mr.property_id=?'; params.push(req.query.property_id); }
    if (req.query.tenancy_id)  { sql += ' AND mr.tenancy_id=?';  params.push(req.query.tenancy_id); }

    // Manager: only maintenance requests in their properties
    if (req.user.role === 'property_manager') {
      sql += ' AND pr.manager_id=?'; params.push(req.user.sub);
    }
    // Security: only their property
    else if (req.user.role === 'security' && req.user.property_id) {
      sql += ' AND mr.property_id=?'; params.push(req.user.property_id);
    }

    // Caretaker: only their assigned requests
    if (req.user.role === 'caretaker') {
      if (req.query.assigned_to) {
        sql += ' AND mr.assigned_to=?'; params.push(req.query.assigned_to);
      } else {
        sql += ' AND mr.assigned_to=?'; params.push(req.user.sub);
      }
    } else if (req.query.assigned_to) {
      sql += ' AND mr.assigned_to=?'; params.push(req.query.assigned_to);
    }

    // Pagination
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const offset = (page - 1) * limit;
    sql += " ORDER BY FIELD(mr.priority,'emergency','urgent','normal','low'),mr.created_at DESC LIMIT ? OFFSET ?";
    const [rows] = await pool.query(sql, [...params, limit, offset]);
    // Count query mirrors the scoped main query
    let countSql = 'SELECT COUNT(*) AS total FROM maintenance_requests mr JOIN properties pr ON mr.property_id=pr.id WHERE 1=1';
    const countParams = [];
    if (req.query.status)      { countSql += ' AND mr.status=?';      countParams.push(req.query.status); }
    if (req.query.property_id) { countSql += ' AND mr.property_id=?'; countParams.push(req.query.property_id); }
    if (req.user.role === 'property_manager') { countSql += ' AND pr.manager_id=?'; countParams.push(req.user.sub); }
    else if (['caretaker','security'].includes(req.user.role) && req.user.property_id) { countSql += ' AND mr.property_id=?'; countParams.push(req.user.property_id); }
    const [[{total}]] = await pool.query(countSql, countParams);
    ok(res, { requests: rows, meta: { total, page, pages: Math.ceil(total/limit) } });
  } catch(e) { safeErr(res, e); }
};

exports.create = async (req, res) => {
  try {
    const { unit_id, title, description, category, priority, tenancy_id } = req.body;
    if (!unit_id||!title) return err(res, 'unit_id and title required');
    const [[unit]] = await pool.query('SELECT property_id FROM units WHERE id=?', [unit_id]);
    if (!unit) return err(res, 'Unit not found', 404);
    const [r] = await pool.query(
      'INSERT INTO maintenance_requests (unit_id,property_id,title,description,category,priority,tenancy_id) VALUES (?,?,?,?,?,?,?)',
      [unit_id, unit.property_id, title, description||null, category||'other', priority||'normal', tenancy_id||null]);

    if (priority === 'emergency' || priority === 'urgent') {
      try {
        // Only notify super admins AND the manager of THIS specific property (not all managers)
        const [managers] = await pool.query(
          `SELECT u.id,u.phone,u.role FROM users u
           WHERE u.is_active=1 AND (
             u.role='super_admin' OR
             (u.role='property_manager' AND u.id=(SELECT manager_id FROM properties WHERE id=? LIMIT 1))
           )`, [property_id||null]);
        const sms = require('../../services/sms');
        for (const mgr of managers) {
          if (mgr.phone) await sms.send({ phone: mgr.phone, message: `🚨 ${priority.toUpperCase()} maintenance: "${title}". Immediate attention required. SmartNyumba RMS.`, type:'maintenance' });
          await notify(pool, { user_id: mgr.id, type:'maintenance', title:`${priority==='emergency'?'🚨':'⚠️'} ${priority.toUpperCase()} maintenance`, message:`"${title}" requires immediate attention`, action_url: mgr.role === 'property_manager' ? '/manager/maintenance' : '/admin/maintenance' });
        }
        await pool.query('UPDATE maintenance_requests SET sms_alerted=1 WHERE id=?', [r.insertId]);
      } catch (_) {}
    }
    ok(res, { id: r.insertId, message: 'Request created' }, 201);
  } catch(e) { safeErr(res, e); }
};

exports.update = async (req, res) => {
  try {
    const { status, assigned_to, cost, notes } = req.body;

    // Get current state to detect assignment change
    const [[current]] = await pool.query('SELECT * FROM maintenance_requests WHERE id=?', [req.params.id]);
    if (!current) return err(res, 'Request not found', 404);

    const resolved = status === 'completed' ? ',resolved_at=NOW()' : '';
    await pool.query(`UPDATE maintenance_requests SET status=?,assigned_to=?,cost=?${resolved} WHERE id=?`,
      [status, assigned_to||null, cost||null, req.params.id]);
    if (notes) await pool.query('INSERT INTO maintenance_updates (request_id,user_id,note,status) VALUES (?,?,?,?)',
      [req.params.id, req.user.sub, notes, status]);

    // Notify newly assigned caretaker/staff
    if (assigned_to && String(assigned_to) !== String(current.assigned_to)) {
      await notify(pool, {
        user_id: assigned_to, type: 'maintenance',
        title: '🔧 New maintenance task assigned',
        message: '"' + current.title + '" has been assigned to you. Please attend promptly.',
        action_url: '/caretaker/maintenance',
      });
      // Also SMS the assignee
      try {
        const [[assignee]] = await pool.query('SELECT phone FROM users WHERE id=?', [assigned_to]);
        if (assignee?.phone) {
          const sms = require('../../services/sms');
          await sms.send({ phone: assignee.phone, type: 'maintenance',
            message: 'SmartNyumba: Maintenance task assigned to you: "' + current.title + '". Log in to view details.' });
        }
      } catch (_) {}
    }

    // Notify tenant when completed
    if (status === 'completed') {
      const [[mr]] = await pool.query('SELECT tenancy_id,title FROM maintenance_requests WHERE id=?', [req.params.id]);
      if (mr?.tenancy_id) {
        const [[ten]] = await pool.query('SELECT t.user_id FROM tenants t JOIN tenancies ten ON t.id=ten.tenant_id WHERE ten.id=?', [mr.tenancy_id]);
        if (ten) await notify(pool, { user_id: ten.user_id, type:'maintenance',
          title:'Maintenance completed ✅', message:'"' + mr.title + '" has been resolved.', action_url:'/tenant/maintenance' });
      }
    }
    ok(res, { message: 'Request updated' });
  } catch(e) { safeErr(res, e); }
};
