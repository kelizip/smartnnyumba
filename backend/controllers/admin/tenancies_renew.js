// backend/controllers/admin/tenancies_enhanced.js
// ADD these exports to the existing tenancies controller
// New endpoints:
//   PUT /api/tenancies/:id/renew   — extend lease with new end_date + optional rent change
//   GET /api/tenancies/expiring    — list leases expiring within N days

const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');
const { notify } = require('./notifications');
const sms = require('../../services/sms');

// ── Renew a lease ─────────────────────────────────────────────
exports.renew = async (req, res) => {
  try {
    const { new_end_date, new_rent_amount, notes } = req.body;
    if (!new_end_date) return err(res, 'new_end_date is required');

    const [[ten]] = await pool.query(`
      SELECT ten.*,u.full_name AS tenant_name,u.phone,u.id AS user_id,
             un.unit_number,pr.name AS property_name
      FROM tenancies ten
      JOIN tenants t ON ten.tenant_id=t.id JOIN users u ON t.user_id=u.id
      JOIN units un ON ten.unit_id=un.id JOIN properties pr ON un.property_id=pr.id
      WHERE ten.id=?`, [req.params.id]);

    if (!ten) return err(res, 'Tenancy not found', 404);
    if (!['active','notice_given','approved'].includes(ten.status)) return err(res, 'Can only renew active or notice-given tenancies');

    const rentAmount = new_rent_amount || ten.rent_amount;

    await pool.query(
      'UPDATE tenancies SET end_date=?, rent_amount=?, renewal_notes=?, renewed_at=NOW(), renewed_by=? WHERE id=?',
      [new_end_date, rentAmount, notes || null, req.user.sub, req.params.id]);

    // Notify tenant
    if (ten.user_id) {
      await notify(pool, {
        user_id: ten.user_id, type: 'lease_renewal',
        title: 'Lease renewed ✓',
        message: `Your lease for unit ${ten.unit_number} has been renewed until ${new_end_date}. New rent: KES ${Number(rentAmount).toLocaleString()}/mo.`,
        action_url: '/tenant'
      });
      if (ten.phone) {
        await sms.send({
          phone: ten.phone, type: 'lease_renewal', user_id: ten.user_id,
          message: `SmartNyumba: Dear ${ten.tenant_name.split(' ')[0]}, your lease for unit ${ten.unit_number} has been renewed until ${new_end_date}. Rent: KES ${Number(rentAmount).toLocaleString()}/mo.`
        });
      }
    }

    ok(res, { message: 'Lease renewed successfully' });
  } catch(e) { safeErr(res, e); }
};

// ── Get expiring leases ───────────────────────────────────────
exports.getExpiring = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 60;
    const [rows] = await pool.query(`
      SELECT ten.id, ten.end_date, ten.rent_amount, ten.status,
             u.full_name AS tenant_name, u.phone, un.unit_number,
             pr.name AS property_name,
             DATEDIFF(ten.end_date, CURDATE()) AS days_remaining
      FROM tenancies ten
      JOIN tenants t ON ten.tenant_id=t.id JOIN users u ON t.user_id=u.id
      JOIN units un ON ten.unit_id=un.id JOIN properties pr ON un.property_id=pr.id
      WHERE ten.status='active' AND ten.end_date IS NOT NULL
        AND DATEDIFF(ten.end_date, CURDATE()) BETWEEN 0 AND ?
      ORDER BY ten.end_date ASC`, [days]);
    ok(res, { tenancies: rows });
  } catch(e) { safeErr(res, e); }
};