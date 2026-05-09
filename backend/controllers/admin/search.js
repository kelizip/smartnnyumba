const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

exports.search = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return ok(res, { results: [] });
    const like = `%${q}%`;

    const results = [];

    // Tenants
    const [tenants] = await pool.query(
      `SELECT 'tenant' AS type, u.id, u.full_name AS title,
        CONCAT(u.email,' · ',COALESCE(u.phone,'')) AS subtitle,
        '/admin/tenants' AS url
       FROM users u WHERE u.role='tenant' AND u.is_active=1
       AND (u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?) LIMIT 5`,
      [like,like,like]);
    results.push(...tenants);

    // Units
    const [units] = await pool.query(
      `SELECT 'unit' AS type, u.id, CONCAT(u.unit_number,' - ',p.name) AS title,
        CONCAT(u.type,' · ',u.status) AS subtitle,
        '/admin/units' AS url
       FROM units u JOIN properties p ON u.property_id=p.id
       WHERE u.unit_number LIKE ? OR p.name LIKE ? LIMIT 5`,
      [like,like]);
    results.push(...units);

    // Properties
    const [props] = await pool.query(
      `SELECT 'property' AS type, id, name AS title, location AS subtitle, '/admin/properties' AS url
       FROM properties WHERE name LIKE ? OR location LIKE ? LIMIT 3`,
      [like,like]);
    results.push(...props);

    // Invoices
    const [invs] = await pool.query(
      `SELECT 'invoice' AS type, i.id,
        CONCAT('Invoice #',i.id,' - ',u.full_name) AS title,
        CONCAT(i.type,' · KES ',FORMAT(i.amount,0),' · ',i.status) AS subtitle,
        '/admin/invoices' AS url
       FROM invoices i JOIN tenancies ten ON i.tenancy_id=ten.id
       JOIN tenants t ON ten.tenant_id=t.id JOIN users u ON t.user_id=u.id
       WHERE u.full_name LIKE ? OR i.type LIKE ? LIMIT 3`,
      [like,like]);
    results.push(...invs);

    // Payments
    const [pmts] = await pool.query(
      `SELECT 'payment' AS type, py.id,
        CONCAT('Payment - ',u.full_name) AS title,
        CONCAT(COALESCE(py.transaction_code,''),' · KES ',FORMAT(py.amount,0)) AS subtitle,
        '/admin/payments' AS url
       FROM payments py JOIN tenancies ten ON py.tenancy_id=ten.id
       JOIN tenants t ON ten.tenant_id=t.id JOIN users u ON t.user_id=u.id
       WHERE py.transaction_code LIKE ? OR u.full_name LIKE ? LIMIT 3`,
      [like,like]);
    results.push(...pmts);

    ok(res, { results, query: q });
  } catch(e) { safeErr(res, e); }
};
