const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

exports.submit = async (req, res) => {
  try {
    const { request_id, rating, comment } = req.body;
    if (!request_id || !rating) return err(res, 'request_id and rating required');
    if (rating < 1 || rating > 5) return err(res, 'Rating must be 1-5');

    // Verify tenant owns this request
    const [[mr]] = await pool.query(`
      SELECT mr.id FROM maintenance_requests mr
      JOIN tenancies ten ON mr.tenancy_id=ten.id
      JOIN tenants t ON ten.tenant_id=t.id
      WHERE mr.id=? AND t.user_id=? AND mr.status='completed'`, [request_id, req.user.sub]);
    if (!mr) return err(res, 'Request not found or not yet completed', 404);

    await pool.query(
      'INSERT INTO maintenance_ratings (request_id,tenant_id,rating,comment) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE rating=?,comment=?',
      [request_id, req.user.sub, rating, comment||null, rating, comment||null]);

    ok(res, { message: 'Rating submitted. Thank you for your feedback!' });
  } catch(e) { safeErr(res, e); }
};

exports.getStats = async (req, res) => {
  try {
    const [[stats]] = await pool.query(`
      SELECT AVG(r.rating) AS avg_rating, COUNT(r.id) AS total_ratings,
        SUM(r.rating=5) AS five_star, SUM(r.rating=4) AS four_star,
        SUM(r.rating=3) AS three_star, SUM(r.rating<=2) AS low_rated
      FROM maintenance_ratings r
      JOIN maintenance_requests mr ON r.request_id=mr.id
      JOIN properties p ON mr.property_id=p.id
      WHERE 1=1 ${req.query.property_id ? 'AND p.id='+parseInt(req.query.property_id) : ''}`);
    const [recent] = await pool.query(`
      SELECT r.*,mr.title,u.full_name AS tenant_name,p.name AS property_name
      FROM maintenance_ratings r JOIN maintenance_requests mr ON r.request_id=mr.id
      JOIN tenants t ON r.tenant_id=t.id JOIN users u ON t.user_id=u.id
      JOIN properties p ON mr.property_id=p.id
      ORDER BY r.created_at DESC LIMIT 10`);
    ok(res, { stats, recent_ratings: recent });
  } catch(e) { safeErr(res, e); }
};
