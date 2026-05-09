const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

exports.getAll = async (req, res) => {
  try {
    let sql = 'SELECT r.*,u.unit_number,pr.name AS property_name FROM utility_readings r JOIN units u ON r.unit_id=u.id JOIN properties pr ON u.property_id=pr.id WHERE 1=1';
    const params = [];
    if (req.query.unit_id) { sql += ' AND r.unit_id=?'; params.push(req.query.unit_id); }
    if (req.query.type)    { sql += ' AND r.utility_type=?'; params.push(req.query.type); }
    // Property scoping
    if (req.user.role === 'property_manager') {
      sql += ' AND pr.manager_id=?'; params.push(req.user.sub);
    } else if (req.user.property_id) {
      sql += ' AND u.property_id=?'; params.push(req.user.property_id);
    }
    sql += ' ORDER BY r.reading_date DESC LIMIT 50';
    const [rows] = await pool.query(sql, params);
    ok(res, { readings: rows });
  } catch(e) { safeErr(res, e); }
};

exports.create = async (req, res) => {
  try {
    const { unit_id,utility_type,current_reading,reading_date,previous_reading,generate_invoice,tenancy_id,due_date } = req.body;
    if (!unit_id||!utility_type||current_reading===undefined||!reading_date) return err(res, 'unit_id, utility_type, current_reading and reading_date required');
    const [settings] = await pool.query("SELECT setting_key,setting_value FROM settings WHERE setting_key IN('water_rate','electricity_rate')");
    const rates = Object.fromEntries(settings.map(s=>[s.setting_key,s.setting_value]));
    const rate = utility_type==='water' ? parseFloat(rates.water_rate||80) : parseFloat(rates.electricity_rate||25);
    const prev_r = parseFloat(previous_reading||0);
    const [r] = await pool.query('INSERT INTO utility_readings (unit_id,utility_type,previous_reading,current_reading,rate_per_unit,reading_date,read_by) VALUES (?,?,?,?,?,?,?)',
      [unit_id, utility_type, prev_r, current_reading, rate, reading_date, req.user.sub]);
    const [[rd]] = await pool.query('SELECT * FROM utility_readings WHERE id=?', [r.insertId]);
    let invoice_id = null;
    if (generate_invoice && tenancy_id && parseFloat(rd.amount) > 0) {
      const [ir] = await pool.query('INSERT INTO invoices (tenancy_id,type,amount,balance,due_date) VALUES (?,?,?,?,?)',
        [tenancy_id, utility_type, rd.amount, rd.amount, due_date||new Date(Date.now()+7*86400000).toISOString().split('T')[0]]);
      invoice_id = ir.insertId;
      await pool.query('UPDATE utility_readings SET invoice_id=? WHERE id=?', [invoice_id, r.insertId]);
    }
    ok(res, { id: r.insertId, amount: rd.amount, units_consumed: rd.units_consumed, invoice_id }, 201);
  } catch(e) { safeErr(res, e); }
};
