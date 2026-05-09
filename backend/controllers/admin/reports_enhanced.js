// backend/controllers/admin/reports_enhanced.js
'use strict';

const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

// ── P&L Statement ─────────────────────────────────────────────
const pnl = async (req, res) => {
  try {
    const month_year = req.query.month_year || new Date().toISOString().slice(0, 7);
    const pid = req.query.property_id || null;
    const yr = month_year.slice(0, 4);
    const mo = month_year.slice(5, 7);

    const propFilter = pid ? ' AND p.id=?' : '';
    const propParams = pid ? [pid] : [];

    const [billed] = await pool.query(`
      SELECT p.id, p.name,
        COALESCE(SUM(i.amount),0) AS gross_billed,
        COALESCE(SUM(CASE WHEN i.status='paid' THEN i.amount ELSE i.amount-i.balance END),0) AS collected,
        COALESCE(SUM(CASE WHEN i.status IN('unpaid','overdue','partial') THEN i.balance ELSE 0 END),0) AS uncollected
      FROM properties p
      LEFT JOIN units u ON p.id=u.property_id
      LEFT JOIN tenancies ten ON u.id=ten.unit_id AND ten.status='active'
      LEFT JOIN invoices i ON ten.id=i.tenancy_id AND YEAR(i.created_at)=? AND MONTH(i.created_at)=?
      WHERE 1=1${propFilter}
      GROUP BY p.id, p.name
    `, [yr, mo, ...propParams]);

    const [expenses] = await pool.query(`
      SELECT p.id AS property_id, p.name AS property_name,
        e.category, COALESCE(SUM(e.amount),0) AS total
      FROM expenses e JOIN properties p ON e.property_id=p.id
      WHERE YEAR(e.expense_date)=? AND MONTH(e.expense_date)=?${propFilter}
      GROUP BY p.id, p.name, e.category
      ORDER BY p.name, total DESC
    `, [yr, mo, ...propParams]);

    const [vacant] = await pool.query(`
      SELECT p.id, COALESCE(SUM(u.rent_amount),0) AS vacancy_loss
      FROM properties p JOIN units u ON p.id=u.property_id
      WHERE u.status='vacant'${propFilter}
      GROUP BY p.id
    `, propParams);

    const vacancyMap = Object.fromEntries(vacant.map(v => [v.id, v.vacancy_loss]));

    const pnlResult = billed.map(prop => {
      const propExpenses = expenses.filter(e => e.property_id === prop.id);
      const totalExpenses = propExpenses.reduce((s, e) => s + Number(e.total), 0);
      const mgmtFee = 0; // placeholder
      const noi = Number(prop.collected) - totalExpenses - mgmtFee;

      return {
        property_id: prop.id,
        property_name: prop.name,
        gross_billed: Number(prop.gross_billed),
        collected: Number(prop.collected),
        uncollected: Number(prop.uncollected),
        vacancy_loss: Number(vacancyMap[prop.id] || 0),
        total_expenses: totalExpenses,
        expenses_by_category: propExpenses,
        management_fee: mgmtFee,
        net_operating_income: noi,
        collection_rate: prop.gross_billed > 0 ? Math.round((prop.collected / prop.gross_billed) * 100) : 0,
      };
    });

    const totals = pnlResult.reduce((acc, p) => {
      acc.gross_billed += p.gross_billed;
      acc.collected += p.collected;
      acc.total_expenses += p.total_expenses;
      acc.net_operating_income += p.net_operating_income;
      return acc;
    }, { gross_billed: 0, collected: 0, total_expenses: 0, net_operating_income: 0 });

    ok(res, { month_year, pnl: pnlResult, totals });
  } catch(e) { safeErr(res, e); }
};

// ── Cashflow Forecast ─────────────────────────────────────────
const cashflowForecast = async (req, res) => {
  try {
    const pid = req.query.property_id || null;
    const propFilter = pid ? ' AND u.property_id=?' : '';
    const propParams = pid ? [pid] : [];

    const [[rateRow]] = await pool.query(`
      SELECT COALESCE(SUM(py.amount),0) AS collected,
             COALESCE(SUM(i.amount),0) AS billed
      FROM invoices i
      JOIN tenancies ten ON i.tenancy_id=ten.id
      JOIN units u ON ten.unit_id=u.id
      LEFT JOIN payments py ON py.invoice_id=i.id
      WHERE i.type='rent' AND i.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
        ${propFilter}
    `, propParams);

    const collectionRate = rateRow.billed > 0 ? rateRow.collected / rateRow.billed : 0.8;

    const [[rentRow]] = await pool.query(`
      SELECT COALESCE(SUM(ten.rent_amount),0) AS expected_rent
      FROM tenancies ten JOIN units u ON ten.unit_id=u.id
      WHERE ten.status='active'${propFilter}
    `, propParams);

    const expectedRent = Number(rentRow.expected_rent) * collectionRate;

    const [[expRow]] = await pool.query(`
      SELECT COALESCE(SUM(amount),0)/3 AS avg_monthly
      FROM expenses
      WHERE expense_date >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
        ${pid ? 'AND property_id=?' : ''}
    `, pid ? [pid] : []);

    const avgExpenses = Number(expRow.avg_monthly);

    const forecast = [];
    for (let i = 1; i <= 3; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() + i, 1);
      const month = d.toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
      forecast.push({
        month,
        projected_income: Math.round(expectedRent),
        projected_expenses: Math.round(avgExpenses),
        net: Math.round(expectedRent - avgExpenses),
        status: expectedRent - avgExpenses >= 0 ? 'surplus' : 'shortfall',
      });
    }

    ok(res, {
      forecast,
      collection_rate: Math.round(collectionRate * 100),
      expected_monthly_rent: Math.round(expectedRent),
      avg_monthly_expenses: Math.round(avgExpenses),
    });
  } catch(e) { safeErr(res, e); }
};

// ── Maintenance KPIs ─────────────────────────────────────────
const maintenanceKpis = async (req, res) => {
  try {
    const pid = req.query.property_id || null;
    const pf = pid ? ' AND mr.property_id=?' : '';
    const pp = pid ? [pid] : [];

    const [byCategory] = await pool.query(`
      SELECT mr.category,
        COUNT(*) AS total,
        AVG(CASE WHEN mr.resolved_at IS NOT NULL
            THEN TIMESTAMPDIFF(HOUR, mr.created_at, mr.resolved_at) END) AS avg_hours,
        SUM(CASE WHEN mr.status IN('open','assigned','in_progress') THEN 1 ELSE 0 END) AS open_count,
        COALESCE(SUM(mr.cost),0) AS total_cost
      FROM maintenance_requests mr
      WHERE mr.created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)${pf}
      GROUP BY mr.category ORDER BY total DESC
    `, pp);

    ok(res, { byCategory });
  } catch(e) { safeErr(res, e); }
};

// ── Occupancy Trend ──────────────────────────────────────────
const occupancyTrend = async (req, res) => {
  try {
    const pid = req.query.property_id || null;

    const [trend] = await pool.query(`
      SELECT DATE_FORMAT(pay_date,'%b') AS month,
             DATE_FORMAT(pay_date,'%Y-%m') AS period,
             COUNT(DISTINCT ten.unit_id) AS occupied_units
      FROM (SELECT DISTINCT DATE_FORMAT(paid_at,'%Y-%m-01') AS pay_date, tenancy_id
            FROM payments WHERE paid_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)) p_sub
      JOIN tenancies ten ON p_sub.tenancy_id=ten.id
      JOIN units u ON ten.unit_id=u.id
      WHERE 1=1${pid ? ' AND u.property_id=?' : ''}
      GROUP BY period,month ORDER BY period
    `, pid ? [pid] : []);

    const [[unitTotal]] = await pool.query(
      `SELECT COUNT(*) AS total FROM units${pid ? ' WHERE property_id=?' : ''}`, pid ? [pid] : []);

    ok(res, {
      trend: trend.map(t => ({
        ...t,
        total_units: unitTotal.total,
        occupancy_rate: Math.round((t.occupied_units / (unitTotal.total || 1)) * 100),
      })),
      current_total: unitTotal.total,
    });
  } catch(e) { safeErr(res, e); }
};

// ── Waive Late Fee ───────────────────────────────────────────
const waiveLateFee = async (req, res) => {
  try {
    const [[inv]] = await pool.query(
      "SELECT * FROM invoices WHERE id=? AND type='penalty'", [req.params.id]
    );
    if (!inv) return err(res, 'Penalty invoice not found', 404);

    await pool.query(
      "UPDATE invoices SET status='cancelled', notes=CONCAT(IFNULL(notes,''), ' | Waived by admin on ', CURDATE()) WHERE id=?",
      [inv.id]
    );

    ok(res, { message: 'Late fee waived' });
  } catch(e) { safeErr(res, e); }
};

// ── Export all functions ──────────────────────────────────────
module.exports = {
  pnl,
  cashflowForecast,
  maintenanceKpis,
  occupancyTrend,
  waiveLateFee
};