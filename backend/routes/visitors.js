const router = require('express').Router();
const auth   = require('../middleware/auth');
const c      = require('../controllers/admin/visitors');
router.get('/',        auth(['super_admin','property_manager','security','tenant']), c.getAll);
router.post('/',       auth(['super_admin','property_manager','security','tenant']), c.checkIn);
router.put('/:id/out', auth(['super_admin','property_manager','security','tenant']), c.checkOut);

// ── Check-in a pre-registered visitor ────────────────────────
router.put('/:id/check-in', auth(['super_admin','property_manager','security']), async (req, res) => {
  const pool = require('../config/db');
  try {
    const [result] = await pool.query(
      "UPDATE visitors SET status='checked_in', check_in_time=NOW() WHERE id=?",
      [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Visitor not found' });
    res.json({ message: 'Visitor checked in' });
  } catch (e) {
    // Fallback if check_in_time column doesn't exist
    try {
      await pool.query("UPDATE visitors SET status='checked_in' WHERE id=?", [req.params.id]);
      res.json({ message: 'Visitor checked in' });
    } catch (e2) { res.status(500).json({ error: e2.message }); }
  }
});

// ── Pre-register a visitor ───────────────────────────────────
router.post('/pre-register', auth(['tenant','super_admin','property_manager']), async (req, res) => {
  const pool = require('../config/db');
  try {
    const { property_id, unit_id, name, phone, id_number, vehicle_plate, purpose, expected_date } = req.body;
    if (!name || !property_id) return res.status(400).json({ error: 'name and property_id required' });

    // Try with expected_date column first; fall back to basic insert if column doesn't exist
    let r;
    try {
      [r] = await pool.query(
        'INSERT INTO visitors (property_id,unit_id,name,phone,id_number,vehicle_plate,purpose,status,expected_date,registered_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [property_id, unit_id||null, name, phone||null, id_number||null, vehicle_plate||null, purpose||null, 'pre_registered', expected_date||null, req.user.sub]);
    } catch (colErr) {
      if (colErr.message.includes('expected_date') || colErr.message.includes('registered_by')) {
        // Columns not yet migrated — insert without them
        [r] = await pool.query(
          'INSERT INTO visitors (property_id,unit_id,name,phone,id_number,vehicle_plate,purpose,status) VALUES (?,?,?,?,?,?,?,?)',
          [property_id, unit_id||null, name, phone||null, id_number||null, vehicle_plate||null, purpose||null, 'pre_registered']);
      } else { throw colErr; }
    }
    res.status(201).json({ id: r.insertId, message: 'Visitor pre-registered' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Get pre-registered visitors ───────────────────────────────
router.get('/pre-registered', auth(), async (req, res) => {
  const pool = require('../config/db');
  try {
    // Safe query - expected_date may not exist on older schemas
    let sql = "SELECT id,property_id,unit_id,name,phone,id_number,vehicle_plate,purpose,status,created_at FROM visitors WHERE status='pre_registered' AND 1=1";
    const params = [];
    if (req.query.unit_id)     { sql += ' AND unit_id=?';     params.push(req.query.unit_id); }
    if (req.query.property_id) { sql += ' AND property_id=?'; params.push(req.query.property_id); }
    sql += ' ORDER BY created_at DESC LIMIT 50';
    const [rows] = await pool.query(sql, params);
    res.json({ visitors: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

// ── Visitor blacklist ─────────────────────────────────────────
router.get('/blacklist', auth(['super_admin','property_manager','security']), async (req, res) => {
  const pool = require('../config/db');
  try {
    const [rows] = await pool.query(
      'SELECT * FROM visitor_blacklist ORDER BY created_at DESC'
    ).catch(() => [[]]); // table may not exist yet
    res.json({ blacklist: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/blacklist', auth(['super_admin','property_manager']), async (req, res) => {
  const pool = require('../config/db');
  try {
    const { id_number, vehicle_plate, name, reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason required' });
    await pool.query(
      'CREATE TABLE IF NOT EXISTS visitor_blacklist (id INT AUTO_INCREMENT PRIMARY KEY, id_number VARCHAR(30), vehicle_plate VARCHAR(20), name VARCHAR(100), reason TEXT, added_by INT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)'
    );
    const [r] = await pool.query(
      'INSERT INTO visitor_blacklist (id_number,vehicle_plate,name,reason,added_by) VALUES (?,?,?,?,?)',
      [id_number||null, vehicle_plate||null, name||null, reason, req.user.sub]);
    res.status(201).json({ id: r.insertId, message: 'Added to blacklist' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/blacklist/:id', auth(['super_admin','property_manager']), async (req, res) => {
  const pool = require('../config/db');
  try {
    await pool.query('DELETE FROM visitor_blacklist WHERE id=?', [req.params.id]);
    res.json({ message: 'Removed from blacklist' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
