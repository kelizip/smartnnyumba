const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

exports.getAll = async (req, res) => {
  try {
    let sql = `SELECT sl.*,u.full_name AS reported_by_name,p.name AS property_name
      FROM security_logbook sl JOIN users u ON sl.reported_by=u.id
      JOIN properties p ON sl.property_id=p.id WHERE 1=1`;
    const params = [];
    if (req.query.property_id) { sql += ' AND sl.property_id=?'; params.push(req.query.property_id); }
    if (req.query.log_type)    { sql += ' AND sl.log_type=?';    params.push(req.query.log_type); }
    if (req.query.severity)    { sql += ' AND sl.severity=?';    params.push(req.query.severity); }
    if (req.user.role === 'security' && req.user.property_id) {
      sql += ' AND sl.property_id=?'; params.push(req.user.property_id);
    }
    sql += ' ORDER BY sl.created_at DESC LIMIT 100';
    const [rows] = await pool.query(sql, params);
    ok(res, { logs: rows });
  } catch(e) { safeErr(res, e); }
};

exports.create = async (req, res) => {
  try {
    const { property_id, log_type, title, description, severity, location } = req.body;
    let pid = property_id;
    if (!pid && req.user.property_id) pid = req.user.property_id;
    if (!pid) return err(res, 'property_id required');
    if (!log_type || !title) return err(res, 'log_type and title required');

    const [r] = await pool.query(
      'INSERT INTO security_logbook (property_id,log_type,title,description,severity,location,reported_by) VALUES (?,?,?,?,?,?,?)',
      [pid, log_type, title, description||null, severity||'low', location||null, req.user.sub]);

    // Alert management on high severity
    if (severity === 'high' || severity === 'critical') {
      const [managers] = await pool.query("SELECT id FROM users WHERE role IN('super_admin','property_manager') AND is_active=1");
      for (const m of managers) {
        await pool.query('INSERT INTO notifications (user_id,type,title,message,action_url) VALUES (?,?,?,?,?)',
          [m.id, 'security', `${severity.toUpperCase()} security event`, title, '/security/logbook']);
      }
    }
    ok(res, { id: r.insertId, message: 'Log entry created' }, 201);
  } catch(e) { safeErr(res, e); }
};

exports.resolve = async (req, res) => {
  try {
    await pool.query('UPDATE security_logbook SET resolved=1,resolved_at=NOW(),resolved_by=? WHERE id=?',
      [req.user.sub, req.params.id]);
    ok(res, { message: 'Marked as resolved' });
  } catch(e) { safeErr(res, e); }
};
