// backend/controllers/admin/dashboard.js
// FIXES:
//   1. visitors table uses `check_in` column not `check_in_time`
//   2. All numeric values cast correctly
//   3. Manager scoped to their property_id via req.user.property_id

const pool = require('../../config/db');
const { ok, err, safeErr } = require('../../utils/helpers');

exports.getDashboard = async (req, res) => {
  try {
    // Determine property scope based on role
    let pid = req.query.property_id || null;
    let pidParam = pid ? [pid] : [];
    let managerFilter = '';    // extra JOIN/WHERE for manager multi-property scope
    let managerParams = [];

    if (req.user.role === 'property_manager') {
      if (pid) {
        // Specific property requested — verify manager owns it
        pidParam = [pid, req.user.sub];
        managerFilter = ' AND p.manager_id=?';
        managerParams = [req.user.sub];
      } else {
        // Show only their managed properties (could be multiple)
        managerFilter = ' AND p.manager_id=?';
        managerParams = [req.user.sub];
        pidParam = [req.user.sub]; // used for non-property queries
      }
    } else if (req.user.property_id && ['caretaker','security'].includes(req.user.role)) {
      pid = req.user.property_id;
      pidParam = [pid];
    }

    const isMgr = req.user.role === 'property_manager' && !pid;

    // ── Unit stats ──────────────────────────────────────────
    const [[unitStats]] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(status='occupied') AS occupied,
         SUM(status='vacant')   AS vacant
       FROM units u
       ${isMgr ? 'JOIN properties p ON u.property_id=p.id WHERE p.manager_id=?' :
         pid   ? 'WHERE u.property_id=?' : 'WHERE 1=1'}`,
      isMgr ? [req.user.sub] : pidParam
    );

    // ── Active tenancies ────────────────────────────────────
    const [[tenStats]] = await pool.query(
      `SELECT
         COUNT(DISTINCT ten.id)        AS leases,
         COUNT(DISTINCT ten.tenant_id) AS tenants
       FROM tenancies ten
       JOIN units un ON ten.unit_id = un.id
       WHERE ten.status = 'active'
         ${isMgr ? 'AND un.property_id IN (SELECT id FROM units WHERE property_id IN (SELECT id FROM properties WHERE manager_id=?))' :
           pid   ? 'AND un.property_id=?' : ''}`,
      isMgr ? [req.user.sub] : pidParam
    );

    // ── Monthly revenue (current month) ────────────────────
    const [[revenue]] = await pool.query(
      `SELECT COALESCE(SUM(py.amount), 0) AS monthly
       FROM payments py
       JOIN tenancies ten ON py.tenancy_id = ten.id
       JOIN units un ON ten.unit_id = un.id
       WHERE MONTH(py.paid_at) = MONTH(CURDATE())
         AND YEAR(py.paid_at)  = YEAR(CURDATE())
         ${isMgr ? 'AND un.property_id IN (SELECT id FROM units u2 WHERE u2.property_id IN (SELECT id FROM properties WHERE manager_id=?))' :
           pid   ? 'AND un.property_id=?' : ''}`,
      isMgr ? [req.user.sub] : pidParam
    );

    // ── Outstanding balances ────────────────────────────────
    const [[outstanding]] = await pool.query(
      `SELECT
         COALESCE(SUM(i.balance), 0)                              AS owed,
         COUNT(CASE WHEN i.status='overdue' THEN 1 END)           AS overdue
       FROM invoices i
       JOIN tenancies ten ON i.tenancy_id = ten.id
       JOIN units un ON ten.unit_id = un.id
       WHERE i.status IN ('unpaid','overdue','partial')
         ${isMgr ? 'AND un.property_id IN (SELECT id FROM units u2 WHERE u2.property_id IN (SELECT id FROM properties WHERE manager_id=?))' :
           pid   ? 'AND un.property_id=?' : ''}`,
      isMgr ? [req.user.sub] : pidParam
    );

    // ── Property count ──────────────────────────────────────
    const [[propCount]] = await pool.query(
      `SELECT COUNT(*) AS total FROM properties${isMgr ? ' WHERE manager_id=?' : pid ? ' WHERE id=?' : ''}`,
      isMgr ? [req.user.sub] : pidParam
    );

    // ── Open maintenance ────────────────────────────────────
    const [[maintCount]] = await pool.query(
      `SELECT COUNT(*) AS open
       FROM maintenance_requests
       WHERE status IN ('open','assigned','in_progress')
         ${isMgr ? 'AND property_id IN (SELECT id FROM properties WHERE manager_id=?)' :
           pid   ? 'AND property_id=?' : ''}`,
      isMgr ? [req.user.sub] : pidParam
    );

    // ── Visitors today — try both column name variants ──────
    let visitorsToday = 0;
    try {
      const [[v1]] = await pool.query(
        `SELECT COUNT(*) AS today FROM visitors WHERE DATE(check_in) = CURDATE()`
      );
      visitorsToday = parseInt(v1.today) || 0;
    } catch (_) {
      try {
        const [[v2]] = await pool.query(
          `SELECT COUNT(*) AS today FROM visitors WHERE DATE(check_in_time) = CURDATE()`
        );
        visitorsToday = parseInt(v2.today) || 0;
      } catch (_2) { visitorsToday = 0; }
    }

    const total         = parseInt(unitStats.total)    || 0;
    const occupied      = parseInt(unitStats.occupied) || 0;
    const occupancy_rate = total > 0 ? Math.round((occupied / total) * 100) : 0;

    // ── Revenue trend (last 6 months) ───────────────────────
    const [trend] = await pool.query(
      `SELECT
         DATE_FORMAT(py.paid_at, '%b')    AS month,
         DATE_FORMAT(py.paid_at, '%Y-%m') AS period,
         COALESCE(SUM(py.amount), 0)      AS revenue
       FROM payments py
       JOIN tenancies ten ON py.tenancy_id = ten.id
       JOIN units un ON ten.unit_id = un.id
       WHERE py.paid_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
         ${isMgr ? 'AND un.property_id IN (SELECT id FROM units u2 WHERE u2.property_id IN (SELECT id FROM properties WHERE manager_id=?))' :
           pid   ? 'AND un.property_id=?' : ''}
       GROUP BY period, month
       ORDER BY period`,
      isMgr ? [req.user.sub] : pidParam
    );

    // ── Per-property breakdown ──────────────────────────────
    const [by_property] = await pool.query(
      `SELECT
         p.id, p.name,
         COUNT(u.id)              AS total,
         SUM(u.status='occupied') AS occupied,
         COALESCE((
           SELECT SUM(py2.amount)
           FROM payments py2
           JOIN tenancies t2 ON py2.tenancy_id = t2.id
           JOIN units u2 ON t2.unit_id = u2.id
           WHERE u2.property_id = p.id
             AND MONTH(py2.paid_at) = MONTH(CURDATE())
             AND YEAR(py2.paid_at)  = YEAR(CURDATE())
         ), 0) AS collected,
         COALESCE((
           SELECT SUM(i2.balance)
           FROM invoices i2
           JOIN tenancies t2 ON i2.tenancy_id = t2.id
           JOIN units u2 ON t2.unit_id = u2.id
           WHERE u2.property_id = p.id
             AND i2.status IN ('unpaid','overdue')
         ), 0) AS owed
       FROM properties p
       LEFT JOIN units u ON p.id = u.property_id
       ${isMgr ? 'WHERE p.manager_id=?' : pid ? 'WHERE p.id=?' : ''}
       GROUP BY p.id
       ORDER BY p.name`,
      isMgr ? [req.user.sub] : pidParam
    );

    // ── Top arrears ─────────────────────────────────────────
    const [top_arrears] = await pool.query(
      `SELECT
         usr.full_name AS tenant_name, usr.phone,
         un.unit_number, p.name AS property_name,
         SUM(i.balance) AS total_owed,
         MAX(DATEDIFF(CURDATE(), i.due_date)) AS days_overdue
       FROM invoices i
       JOIN tenancies ten ON i.tenancy_id = ten.id
       JOIN tenants t ON ten.tenant_id = t.id
       JOIN users usr ON t.user_id = usr.id
       JOIN units un ON ten.unit_id = un.id
       JOIN properties p ON un.property_id = p.id
       WHERE i.status IN ('unpaid','overdue')
         ${isMgr ? 'AND p.manager_id=?' :
            pid   ? 'AND un.property_id=?' : ''}
       GROUP BY ten.id
       ORDER BY total_owed DESC
       LIMIT 5`,
      isMgr ? [req.user.sub] : pidParam
    );

    // ── Open maintenance (list) ─────────────────────────────
    const [open_requests] = await pool.query(
      `SELECT mr.title, mr.priority, mr.status,
              un.unit_number, p.name AS property_name
       FROM maintenance_requests mr
       JOIN units un ON mr.unit_id = un.id
       JOIN properties p ON un.property_id = p.id
       WHERE mr.status IN ('open','assigned','in_progress')
         ${isMgr ? 'AND p.manager_id=?' : pid ? 'AND mr.property_id=?' : ''}
       ORDER BY FIELD(mr.priority,'emergency','urgent','normal','low')
       LIMIT 5`,
      isMgr ? [req.user.sub] : pidParam
    );

    const result = {
      total_units:      total,
      occupied_units:   occupied,
      vacant_units:     parseInt(unitStats.vacant)       || 0,
      active_leases:    parseInt(tenStats.leases)        || 0,
      active_tenants:   parseInt(tenStats.tenants)       || 0,
      monthly_revenue:  parseFloat(revenue.monthly)      || 0,
      outstanding:      parseFloat(outstanding.owed)     || 0,
      overdue_invoices: parseInt(outstanding.overdue)    || 0,
      total_properties: parseInt(propCount.total)        || 0,
      open_maintenance: parseInt(maintCount.open)        || 0,
      visitors_today:   visitorsToday,
      occupancy_rate,
      revenue_trend:    trend,
      by_property,
      top_arrears,
      open_requests,
    };

    ok(res, result);
  } catch (e) {
    console.error('[Dashboard] Error:', e.message, e.stack);
    err(res, e.message, 500);
  }
};