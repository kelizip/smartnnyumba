'use strict';

const router = require('express').Router();
const auth   = require('../middleware/auth');
const pool   = require('../config/db');

const ROLES = ['super_admin', 'property_manager'];

// ── GET all rates for a property ─────────────────────────────
router.get('/', auth(ROLES), async (req, res) => {
  try {
    const { property_id } = req.query;
    let sql = 'SELECT * FROM service_charge_rates WHERE 1=1';
    const params = [];
    if (property_id) { sql += ' AND property_id=?'; params.push(property_id); }
    if (req.user.role === 'property_manager' && req.user.property_id) {
      sql += ' AND property_id=?'; params.push(req.user.property_id);
    }
    sql += ' ORDER BY charge_type, created_at DESC';
    const [rows] = await pool.query(sql, params).catch(() => [[]]);
    res.json({ rates: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET rates sub-path ────────────────────────────────────────
router.get('/rates', auth(ROLES), async (req, res) => {
  try {
    const { property_id } = req.query;
    let sql = 'SELECT * FROM service_charge_rates WHERE is_active=1';
    const params = [];
    if (property_id) { sql += ' AND property_id=?'; params.push(property_id); }
    sql += ' ORDER BY charge_type';
    const [rows] = await pool.query(sql, params).catch(() => [[]]);
    res.json({ rates: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST create/update rate ───────────────────────────────────
router.post('/rates', auth(ROLES), async (req, res) => {
  try {
    // Auto-create table if missing
    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_charge_rates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        property_id INT NOT NULL,
        charge_type VARCHAR(50) NOT NULL,
        label VARCHAR(100) NOT NULL,
        billing_method ENUM('fixed','per_unit','shared_meter') DEFAULT 'fixed',
        amount DECIMAL(12,2) DEFAULT 0,
        is_active TINYINT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_property (property_id)
      )`).catch(() => {});

    const { id, property_id, charge_type, label, billing_method, amount, is_active } = req.body;
    if (!property_id || !charge_type || !label) return res.status(400).json({ error: 'property_id, charge_type and label required' });

    if (id) {
      await pool.query('UPDATE service_charge_rates SET charge_type=?,label=?,billing_method=?,amount=?,is_active=? WHERE id=?',
        [charge_type, label, billing_method||'fixed', amount||0, is_active??1, id]);
      return res.json({ id, message: 'Rate updated' });
    }

    const [r] = await pool.query('INSERT INTO service_charge_rates (property_id,charge_type,label,billing_method,amount,is_active) VALUES (?,?,?,?,?,?)',
      [property_id, charge_type, label, billing_method||'fixed', amount||0, is_active??1]);
    res.status(201).json({ id: r.insertId, message: 'Rate created' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST generate invoices for all active tenancies ───────────
router.post('/generate', auth(ROLES), async (req, res) => {
  try {
    const { property_id, month_year, charge_types } = req.body;
    if (!property_id || !month_year) return res.status(400).json({ error: 'property_id and month_year required' });

    // Get all active rates for the property
    let rateSql = 'SELECT * FROM service_charge_rates WHERE property_id=? AND is_active=1';
    const rateParams = [property_id];
    if (charge_types && charge_types.length) {
      rateSql += ' AND charge_type IN (' + charge_types.map(()=>'?').join(',') + ')';
      rateParams.push(...charge_types);
    }
    const [rates] = await pool.query(rateSql, rateParams).catch(() => [[]]);
    if (!rates.length) return res.json({ generated: 0, skipped: 0, message: 'No active rates found' });

    // Get active tenancies in property
    const [tenancies] = await pool.query(
      `SELECT ten.id FROM tenancies ten JOIN units u ON ten.unit_id=u.id
       WHERE u.property_id=? AND ten.status='active'`, [property_id]);

    let generated = 0, skipped = 0;
    const dueDate = month_year + '-28'; // Due end of month

    for (const ten of tenancies) {
      for (const rate of rates) {
        // Skip if already generated
        const [[ex]] = await pool.query(
          "SELECT id FROM invoices WHERE tenancy_id=? AND type=? AND month_year=? LIMIT 1",
          [ten.id, rate.charge_type, month_year]);
        if (ex) { skipped++; continue; }

        await pool.query(
          'INSERT INTO invoices (tenancy_id,type,amount,balance,due_date,month_year,notes) VALUES (?,?,?,?,?,?,?)',
          [ten.id, rate.charge_type, rate.amount, rate.amount, dueDate, month_year, rate.label]);
        generated++;
      }
    }

    res.json({ generated, skipped, message: generated + ' invoices generated, ' + skipped + ' skipped (already existed)' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST shared meter reading ─────────────────────────────────
router.post('/meter-reading', auth(ROLES), async (req, res) => {
  try {
    const { property_id, charge_type, units_consumed, unit_rate, reading_date, month_year, notes } = req.body;
    if (!property_id || !units_consumed || !unit_rate) return res.status(400).json({ error: 'property_id, units_consumed and unit_rate required' });

    const totalBill = parseFloat(units_consumed) * parseFloat(unit_rate);

    // Get active tenancies in property
    const [tenancies] = await pool.query(
      `SELECT ten.id FROM tenancies ten JOIN units u ON ten.unit_id=u.id
       WHERE u.property_id=? AND ten.status='active'`, [property_id]);

    if (!tenancies.length) return res.json({ generated: 0, per_unit: 0, total: totalBill, count: 0 });

    const perUnit = totalBill / tenancies.length;
    const my = month_year || new Date().toISOString().slice(0, 7);
    const dueDate = my + '-28';
    const invoiceType = charge_type || 'water';
    let generated = 0;

    for (const ten of tenancies) {
      const [[ex]] = await pool.query(
        "SELECT id FROM invoices WHERE tenancy_id=? AND type=? AND month_year=? LIMIT 1",
        [ten.id, invoiceType, my]);
      if (ex) continue;
      await pool.query(
        'INSERT INTO invoices (tenancy_id,type,amount,balance,due_date,month_year,notes) VALUES (?,?,?,?,?,?,?)',
        [ten.id, invoiceType, perUnit.toFixed(2), perUnit.toFixed(2), dueDate, my, notes || (invoiceType + ' meter reading ' + reading_date)]);
      generated++;
    }

    res.json({ generated, per_unit: perUnit, total: totalBill, count: tenancies.length, message: 'Meter reading saved, ' + generated + ' invoices created' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
