
// ── GET single user with full details ─────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [[user]] = await pool.query(
      `SELECT u.*,
        p.name AS property_name,
        COALESCE(t.id_number, u.id_number) AS id_number,
        COALESCE(t.passport_number, u.passport_number) AS passport_number,
        COALESCE(t.emergency_contact, u.emergency_contact) AS emergency_contact,
        COALESCE(t.emergency_phone, u.emergency_phone) AS emergency_phone,
        COALESCE(t.vehicle_plate, u.vehicle_plate) AS vehicle_plate,
        t.id AS tenant_id
       FROM users u
       LEFT JOIN properties p ON u.property_id=p.id
       LEFT JOIN tenants t ON t.user_id=u.id
       WHERE u.id=?`, [req.params.id]);
    if (!user) return err(res, 'User not found', 404);

    // Remove password hash from response
    delete user.password_hash;

    // If tenant, also get tenancy info
    let tenancy = null;
    if (user.tenant_id) {
      const [[ten]] = await pool.query(
        `SELECT ten.*, un.unit_number, pr.name AS property_name
         FROM tenancies ten
         JOIN units un ON ten.unit_id=un.id
         JOIN properties pr ON un.property_id=pr.id
         WHERE ten.tenant_id=? AND ten.status='active' LIMIT 1`,
        [user.tenant_id]).catch(() => [[]]);
      if (ten) tenancy = ten;
    }

    ok(res, { user: { ...user, tenancy } });
  } catch(e) { safeErr(res, e); }
};

// backend/controllers/admin/users.js
const bcrypt = require('bcryptjs');
const pool   = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

/**
 * Ensure suspension columns exist — fixes deployments where the migration
 * adding is_suspended was never run. Safe to call multiple times.
 */
async function ensureColumns() {
  try {
    // Fast check: try selecting the column. If it exists this completes instantly.
    // If errno 1054 (ER_BAD_FIELD_ERROR) the column is missing — add it.
    // information_schema.COLUMNS was slow (600-800ms on every boot).
    await pool.query('SELECT is_suspended FROM users LIMIT 0');
    return; // column exists, nothing to do
  } catch (e) {
    if (e.errno !== 1054) return; // unexpected error — skip silently
  }
  // First boot or missed migration — add all suspension columns
  for (const sql of [
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended TINYINT(1) NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at DATETIME NULL',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_by INT UNSIGNED NULL',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason TEXT NULL',
  ]) {
    await pool.query(sql).catch(() => {});
  }
}
ensureColumns().catch(() => {});

exports.getAll = async (req, res) => {
  try {
    // Select is_suspended directly — avoids the separate query + silent-catch anti-pattern.
    // If the column is missing, ensureColumns() (called at startup) will have added it.
    let sql = `
      SELECT u.id, u.full_name, u.email, u.phone, u.role, u.property_id,
        u.is_active, u.last_login, u.created_at, u.profile_photo,
        u.id_number, u.passport_number, u.emergency_contact, u.emergency_phone, u.vehicle_plate,
        COALESCE(u.is_suspended, 0) AS is_suspended,
        u.suspension_reason, u.suspended_at,
        p.name AS property_name
      FROM users u LEFT JOIN properties p ON u.property_id=p.id
      WHERE 1=1`;
    const params = [];
    if (req.query.role) { sql += ' AND u.role=?'; params.push(req.query.role); }
    sql += ' ORDER BY u.role, u.full_name';

    const [rows] = await pool.query(sql, params);

    const [counts] = await pool.query('SELECT role, COUNT(*) AS count FROM users GROUP BY role');
    ok(res, {
      users: rows,
      counts: Object.fromEntries(counts.map(c => [c.role, parseInt(c.count)]))
    });
  } catch(e) { err(res, e.message, 500); }
};

exports.create = async (req, res) => {
  try {
    const { full_name, email, phone, role, password, property_id, id_number, passport_number } = req.body;
    if (!full_name || !email || !role || !password) return err(res, 'Name, email, role and password required');
    const [[ex]] = await pool.query('SELECT id FROM users WHERE email=?', [email]);
    if (ex) return err(res, 'Email already in use', 409);
    const hash = await bcrypt.hash(password, 12);
    const [r] = await pool.query(
      'INSERT INTO users (full_name,email,phone,password_hash,role,property_id) VALUES (?,?,?,?,?,?)',
      [full_name, email, phone||null, hash, role, property_id||null]);
    if (role === 'tenant') {
      await pool.query('INSERT INTO tenants (user_id,id_number,passport_number) VALUES (?,?,?)',
        [r.insertId, id_number||null, passport_number||null]);
    }
    ok(res, { id: r.insertId, message: 'User created' }, 201);
  } catch(e) { err(res, e.message, 500); }
};

exports.update = async (req, res) => {
  try {
    const {
      full_name, phone, role, is_active, property_id,
      emergency_contact, emergency_phone, id_number, vehicle_plate,
    } = req.body;

    // Update base fields
    await pool.query(
      'UPDATE users SET full_name=?,phone=?,role=?,is_active=?,property_id=? WHERE id=?',
      [full_name, phone||null, role, is_active??1, property_id||null, req.params.id]
    );

    // Update identity/emergency columns (safe — skipped if column doesn't exist)
    try {
      await pool.query(
        `UPDATE users SET
           id_number=?,
           emergency_contact=?,
           emergency_phone=?,
           vehicle_plate=?
         WHERE id=?`,
        [id_number||null, emergency_contact||null, emergency_phone||null,
         vehicle_plate ? vehicle_plate.toUpperCase() : null,
         req.params.id]
      );
    } catch (_) {}

    // Also sync to tenants table if tenant
    try {
      const [[t]] = await pool.query('SELECT id FROM tenants WHERE user_id=?', [req.params.id]);
      if (t && (emergency_contact !== undefined || emergency_phone !== undefined)) {
        await pool.query(
          'UPDATE tenants SET emergency_contact=COALESCE(?,emergency_contact), emergency_phone=COALESCE(?,emergency_phone), id_number=COALESCE(?,id_number) WHERE user_id=?',
          [emergency_contact||null, emergency_phone||null, id_number||null, req.params.id]
        );
      }
    } catch (_) {}

    ok(res, { message: 'User updated' });
  } catch(e) { err(res, e.message, 500); }
};

exports.resetPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) return err(res, 'Min 8 characters');
    const hash = await bcrypt.hash(password, 12);
    await pool.query('UPDATE users SET password_hash=? WHERE id=?', [hash, req.params.id]);
    ok(res, { message: 'Password reset successfully' });
  } catch(e) { err(res, e.message, 500); }
};

// ── NEW: Delete user ──────────────────────────────────────────
exports.deleteUser = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);

    // Prevent deleting own account
    if (targetId === req.user.sub) return err(res, 'You cannot delete your own account', 400);

    const [[target]] = await pool.query('SELECT role, full_name FROM users WHERE id=?', [targetId]);
    if (!target) return err(res, 'User not found', 404);

    // Prevent deleting other super admins
    if (target.role === 'super_admin') return err(res, 'Super admin accounts cannot be deleted', 403);

    // Check for active tenancies before deleting tenant
    if (target.role === 'tenant') {
      const [[t]] = await pool.query('SELECT id FROM tenants WHERE user_id=?', [targetId]);
      if (t) {
        const [[activeLease]] = await pool.query(
          "SELECT id FROM tenancies WHERE tenant_id=? AND status='active'", [t.id]);
        if (activeLease) return err(res, 'Cannot delete a tenant with an active tenancy. Terminate the tenancy first.', 400);
      }
    }

    // Use a transaction to safely remove all related data
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      // 1. Revoke sessions
      await conn.query('DELETE FROM refresh_tokens WHERE user_id=?', [targetId]);

      // 2. Safe cleanup: try UPDATE, fallback to DELETE if column is NOT NULL
      const safeNull = async (tbl, col, id) => {
        try { await conn.query('UPDATE ' + tbl + ' SET ' + col + '=NULL WHERE ' + col + '=?', [id]); }
        catch (_) { try { await conn.query('DELETE FROM ' + tbl + ' WHERE ' + col + '=?', [id]); } catch (_2) {} }
      };

      // Clean up all FK references
      await safeNull('case_comments', 'user_id', targetId);
      await safeNull('notifications', 'user_id', targetId);
      await safeNull('cases', 'raised_by', targetId);
      await safeNull('announcements', 'created_by', targetId);
      await safeNull('maintenance_requests', 'assigned_to', targetId);
      await safeNull('maintenance_updates', 'user_id', targetId);
      await safeNull('messages', 'from_user_id', targetId);
      await safeNull('messages', 'to_user_id', targetId);
      await safeNull('visitors', 'registered_by', targetId);
      await safeNull('visitors', 'checked_in_by', targetId);
      await safeNull('payments', 'recorded_by', targetId);
      await safeNull('expenses', 'recorded_by', targetId);
      await safeNull('maintenance_requests', 'reported_by', targetId);

      // 3. If tenant: clean ALL dependent records in correct FK order
      if (target.role === 'tenant') {
        const [[trow]] = await conn.query('SELECT id FROM tenants WHERE user_id=?', [targetId]);
        if (trow) {
          // Get all tenancy IDs for this tenant
          const [tenancyIds] = await conn.query('SELECT id FROM tenancies WHERE tenant_id=?', [trow.id]);
          const ids = tenancyIds.map(r => r.id);

          if (ids.length) {
            const placeholders = ids.map(() => '?').join(',');
            // Clean child records in dependency order (deepest first)
            await conn.query('DELETE FROM tenant_ledger          WHERE tenancy_id IN (' + placeholders + ')', ids).catch(() => {});
            await conn.query('DELETE FROM receipts               WHERE payment_id IN (SELECT id FROM payments WHERE tenancy_id IN (' + placeholders + '))', [...ids]).catch(() => {});
            await conn.query('DELETE FROM payments               WHERE tenancy_id IN (' + placeholders + ')', ids).catch(() => {});
            await conn.query('DELETE FROM invoices               WHERE tenancy_id IN (' + placeholders + ')', ids).catch(() => {});
            await conn.query('DELETE FROM maintenance_requests   WHERE tenancy_id IN (' + placeholders + ')', ids).catch(() => {});
            await conn.query('DELETE FROM deposit_refunds        WHERE tenancy_id IN (' + placeholders + ')', ids).catch(() => {});
            await conn.query('DELETE FROM vacate_notices         WHERE tenancy_id IN (' + placeholders + ')', ids).catch(() => {});
            // Now safe to delete tenancies
            await conn.query('DELETE FROM tenancies WHERE tenant_id=?', [trow.id]);
          }
          await conn.query('DELETE FROM tenants WHERE user_id=?', [targetId]).catch(() => {});
        }
      }

      // 4. Delete the user
      await conn.query('DELETE FROM users WHERE id=?', [targetId]);
      await conn.commit();
      conn.release();
      ok(res, { message: `${target.full_name} has been deleted` });
    } catch (deleteErr) {
      await conn.rollback();
      conn.release();
      throw deleteErr;
    }
  } catch(e) { err(res, e.message, 500); }
};

exports.suspend = async (req, res) => {
  try {
    const { reason } = req.body;
    const [[target]] = await pool.query('SELECT role FROM users WHERE id=?', [req.params.id]);
    if (!target) return err(res, 'User not found', 404);
    if (!['property_manager','caretaker','security'].includes(target.role))
      return err(res, 'Can only suspend managers, caretakers or security staff');
    try {
      await pool.query('UPDATE users SET is_suspended=1,suspended_at=NOW(),suspended_by=?,suspension_reason=?,is_active=0 WHERE id=?',
        [req.user.sub, reason||null, req.params.id]);
    } catch(_) {
      await pool.query('UPDATE users SET is_active=0 WHERE id=?', [req.params.id]);
    }
    await pool.query('DELETE FROM refresh_tokens WHERE user_id=?', [req.params.id]);
    ok(res, { message: 'User suspended' });
  } catch(e) { err(res, e.message, 500); }
};

exports.unsuspend = async (req, res) => {
  try {
    try {
      await pool.query('UPDATE users SET is_suspended=0,suspended_at=NULL,suspended_by=NULL,suspension_reason=NULL,is_active=1 WHERE id=?', [req.params.id]);
    } catch(_) {
      await pool.query('UPDATE users SET is_active=1 WHERE id=?', [req.params.id]);
    }
    ok(res, { message: 'User reinstated' });
  } catch(e) { err(res, e.message, 500); }
};

exports.uploadPhoto = async (req, res) => {
  try {
    if (!req.file) return err(res, 'No file uploaded');
    const userId = req.params.id || req.user.sub;
    const photoUrl = `/uploads/photos/${req.file.filename}`;
    await pool.query('UPDATE users SET profile_photo=? WHERE id=?', [photoUrl, userId]);
    ok(res, { photo_url: photoUrl, message: 'Photo updated' });
  } catch(e) { err(res, e.message, 500); }
};

exports.search = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return ok(res, { results: [] });
    const like = `%${q}%`;
    const [tenants] = await pool.query(`
      SELECT 'tenant' AS type, u.id, u.full_name AS name, u.email, u.phone,
        un.unit_number, p.name AS property_name
      FROM users u JOIN tenants t ON u.id=t.user_id
      LEFT JOIN tenancies ten ON t.id=ten.tenant_id AND ten.status='active'
      LEFT JOIN units un ON ten.unit_id=un.id
      LEFT JOIN properties p ON un.property_id=p.id
      WHERE u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? LIMIT 5`, [like,like,like]);
    const [units] = await pool.query(`
      SELECT 'unit' AS type, u.id, CONCAT(u.unit_number,' - ',p.name) AS name, u.status
      FROM units u JOIN properties p ON u.property_id=p.id
      WHERE u.unit_number LIKE ? LIMIT 5`, [like]);
    ok(res, { results: [...tenants, ...units] });
  } catch(e) { err(res, e.message, 500); }
};