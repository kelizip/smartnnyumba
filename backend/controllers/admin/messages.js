const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

exports.getInbox = async (req, res) => {
  try {
    // Messages addressed directly to this user
    // OR broadcast messages (to_user_id IS NULL) for the user's property:
    //   - manager/owner: via properties.manager_id / owner_id
    //   - caretaker/security/any staff: via users.property_id
    const [rows] = await pool.query(`
      SELECT m.*,
        u.full_name AS from_name, u.role AS from_role,
        u.profile_photo AS from_photo,
        p.name AS property_name,
        (SELECT COUNT(*) FROM messages r WHERE r.parent_id = m.id) AS reply_count
      FROM messages m
      JOIN users u ON m.from_user_id = u.id
      JOIN properties p ON m.property_id = p.id
      WHERE m.parent_id IS NULL
        AND (
          m.to_user_id = ?
          OR m.from_user_id = ?
          OR (
            m.to_user_id IS NULL
            AND (
              m.property_id IN (
                SELECT id FROM properties WHERE manager_id = ? OR owner_id = ?
                UNION
                SELECT property_id FROM users WHERE id = ? AND property_id IS NOT NULL
              )
              OR EXISTS (SELECT 1 FROM users WHERE id = ? AND role = 'super_admin')
            )
          )
        )
      ORDER BY m.created_at DESC LIMIT 100`,
      [req.user.sub, req.user.sub, req.user.sub, req.user.sub, req.user.sub, req.user.sub]);
    const unread = rows.filter(r => !r.is_read).length;
    ok(res, { messages: rows, unread });
  } catch(e) { safeErr(res, e); }
};

exports.getSent = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT m.*, u.full_name AS to_name, p.name AS property_name
      FROM messages m
      LEFT JOIN users u ON m.to_user_id = u.id
      JOIN properties p ON m.property_id = p.id
      WHERE m.from_user_id = ?
      ORDER BY m.created_at DESC LIMIT 100`,
      [req.user.sub]);
    ok(res, { messages: rows });
  } catch(e) { safeErr(res, e); }
};

exports.send = async (req, res) => {
  try {
    const { property_id, to_user_id, subject, body } = req.body;
    if (!body) return err(res, 'Message body required');

    let pid = property_id || null;

    // Auto-detect property for tenants and property-assigned staff
    if (!pid) {
      if (req.user.role === 'tenant') {
        const [[t]] = await pool.query(
          `SELECT un.property_id FROM tenants t
           JOIN tenancies ten ON t.id = ten.tenant_id AND ten.status IN ('active','approved','pending')
           JOIN units un ON ten.unit_id = un.id
           WHERE t.user_id = ? ORDER BY ten.created_at DESC LIMIT 1`,
          [req.user.sub]);
        if (t) pid = t.property_id;
      } else if (req.user.property_id) {
        pid = req.user.property_id;
      }
    }
    // Super admins can send without a property_id (it becomes a system-wide message)
    if (!pid && req.user.role === 'super_admin') {
      // Use the first property found (or leave null for system broadcast)
      try {
        const [[fp]] = await pool.query('SELECT id FROM properties LIMIT 1');
        pid = fp?.id || null;
      } catch (_) {}
    }
    // Last resort: if sending to a specific user and they have a property, use that
    if (!pid && to_user_id) {
      try {
        const [[recipient]] = await pool.query('SELECT property_id FROM users WHERE id=?', [to_user_id]);
        if (recipient?.property_id) pid = recipient.property_id;
      } catch (_) {}
    }
    // If still no property_id, try to get ANY property in the system for cross-property messages
    if (!pid) {
      try {
        const [[anyProp]] = await pool.query('SELECT id FROM properties LIMIT 1');
        pid = anyProp?.id || null;
      } catch (_) {}
    }
    if (!pid) return err(res, 'No property found. Please ensure properties are configured in the system.');

    const [r] = await pool.query(
      'INSERT INTO messages (property_id,from_user_id,to_user_id,subject,body) VALUES (?,?,?,?,?)',
      [pid, req.user.sub, to_user_id || null, subject || null, body]);

    // Notify direct recipient
    if (to_user_id) {
      await pool.query(
        'INSERT INTO notifications (user_id,type,title,message,action_url) VALUES (?,?,?,?,?)',
        [to_user_id, 'message', `New message from ${req.user.name}`, subject || body.slice(0, 80), '/messages']);
    } else {
      // Broadcast: notify ALL active staff at the property (manager, caretaker, security, etc.)
      // excluding the sender
      const [staffList] = await pool.query(
        `SELECT DISTINCT u.id FROM users u
         WHERE u.is_active = 1 AND u.id != ?
           AND (
             u.property_id = ?
             OR u.id IN (SELECT manager_id FROM properties WHERE id = ? AND manager_id IS NOT NULL)
             OR u.id IN (SELECT owner_id  FROM properties WHERE id = ? AND owner_id  IS NOT NULL)
           )`,
        [req.user.sub, pid, pid, pid]);
      for (const s of staffList) {
        await pool.query(
          'INSERT INTO notifications (user_id,type,title,message,action_url) VALUES (?,?,?,?,?)',
          [s.id, 'message', `📢 Message from ${req.user.name}`, subject || body.slice(0, 80), '/messages']
        ).catch(() => {});
      }
    }
    ok(res, { id: r.insertId, message: 'Message sent' }, 201);
  } catch(e) { safeErr(res, e); }
};

exports.markRead = async (req, res) => {
  try {
    await pool.query('UPDATE messages SET is_read=1 WHERE id=? AND to_user_id=?', [req.params.id, req.user.sub]);
    ok(res, { message: 'Marked as read' });
  } catch(e) { safeErr(res, e); }
};

exports.reply = async (req, res) => {
  try {
    const { body } = req.body;
    if (!body) return err(res, 'Reply body required');
    const [[orig]] = await pool.query('SELECT * FROM messages WHERE id=?', [req.params.id]);
    if (!orig) return err(res, 'Original message not found', 404);
    const to = orig.from_user_id === req.user.sub ? orig.to_user_id : orig.from_user_id;
    await pool.query(
      'INSERT INTO messages (property_id,from_user_id,to_user_id,subject,body,parent_id) VALUES (?,?,?,?,?,?)',
      [orig.property_id, req.user.sub, to, `Re: ${orig.subject || ''}`, body, orig.id]);
    // Notify the original thread participants (not just one person)
    // Get all participants in this thread
    const [participants] = await pool.query(
      `SELECT DISTINCT from_user_id AS uid FROM messages WHERE id=? OR parent_id=?
       UNION
       SELECT DISTINCT to_user_id AS uid FROM messages WHERE (id=? OR parent_id=?) AND to_user_id IS NOT NULL`,
      [orig.id, orig.id, orig.id, orig.id]
    );
    for (const p of participants) {
      if (p.uid && p.uid !== req.user.sub) {
        await pool.query(
          'INSERT INTO notifications (user_id,type,title,message,action_url) VALUES (?,?,?,?,?)',
          [p.uid, 'message', `Reply from ${req.user.name}`, body.slice(0, 80), '/messages']
        ).catch(() => {});
      }
    }
    ok(res, { message: 'Reply sent' }, 201);
  } catch(e) { safeErr(res, e); }
};

// GET /messages/staff — returns all users at the same property(ies) as the requester.
// Works for every role: caretaker, security, tenant, manager, admin, owner.
exports.getStaff = async (req, res) => {
  try {
    const uid  = req.user.sub;
    const role = req.user.role;
    let propertyIds = [];

    if (role === 'super_admin') {
      // Admin sees everyone
      const [rows] = await pool.query(
        `SELECT id, full_name, role, profile_photo, property_id
         FROM users WHERE is_active=1 AND id != ? ORDER BY full_name`, [uid]);
      return ok(res, { staff: rows });
    }

    if (role === 'owner') {
      const [props] = await pool.query('SELECT id FROM properties WHERE owner_id=?', [uid]);
      propertyIds = props.map(p => p.id);
    } else if (role === 'property_manager') {
      const [props] = await pool.query('SELECT id FROM properties WHERE manager_id=?', [uid]);
      propertyIds = props.map(p => p.id);
    } else if (req.user.property_id) {
      // caretaker, security — assigned to one property
      propertyIds = [req.user.property_id];
    } else if (role === 'tenant') {
      // Tenant: get their active tenancy's property
      const [[t]] = await pool.query(
        `SELECT un.property_id FROM tenants t
         JOIN tenancies ten ON t.id = ten.tenant_id AND ten.status IN ('active','approved')
         JOIN units un ON ten.unit_id = un.id
         WHERE t.user_id = ? LIMIT 1`, [uid]);
      if (t) propertyIds = [t.property_id];
    }

    if (!propertyIds.length) return ok(res, { staff: [] });

    const placeholders = propertyIds.map(() => '?').join(',');

    // Staff: users assigned to these properties (any role)
    const [staff] = await pool.query(
      `SELECT DISTINCT u.id, u.full_name, u.role, u.profile_photo, u.property_id
       FROM users u
       WHERE u.is_active = 1
         AND u.id != ?
         AND (
           u.property_id IN (${placeholders})
           OR u.id IN (SELECT manager_id FROM properties WHERE id IN (${placeholders}) AND manager_id IS NOT NULL)
           OR u.id IN (SELECT owner_id  FROM properties WHERE id IN (${placeholders}) AND owner_id  IS NOT NULL)
         )
       ORDER BY
         FIELD(u.role,'super_admin','property_manager','owner','caretaker','security','tenant'),
         u.full_name`,
      [uid, ...propertyIds, ...propertyIds, ...propertyIds]);

    ok(res, { staff });
  } catch(e) { safeErr(res, e); }
};

// GET /messages/:id/thread — returns full thread (original + all replies)
exports.getThread = async (req, res) => {
  try {
    const msgId = req.params.id;
    // Get the root message
    const [[root]] = await pool.query('SELECT * FROM messages WHERE id=?', [msgId]);
    if (!root) return err(res, 'Message not found', 404);
    const rootId = root.parent_id || root.id;

    const [thread] = await pool.query(
      `SELECT m.*,
         uf.full_name AS from_name, uf.role AS from_role, uf.profile_photo AS from_photo,
         ut.full_name AS to_name
       FROM messages m
       JOIN users uf ON m.from_user_id = uf.id
       LEFT JOIN users ut ON m.to_user_id = ut.id
       WHERE m.id = ? OR m.parent_id = ?
       ORDER BY m.created_at ASC`,
      [rootId, rootId]);

    ok(res, { thread });
  } catch(e) { safeErr(res, e); }
};
