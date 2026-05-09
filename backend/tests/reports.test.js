'use strict';
const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const { mockPool, mockReq, mockRes, makeUser } = require('./helpers');

before(() => {
  process.env.JWT_SECRET = 'test_secret_min_32_chars_long_enough_00';
  process.env.NODE_ENV   = 'test';
});

const freshController = (pool) => {
  require.cache[require.resolve('../config/db')] = { exports: pool };
  delete require.cache[require.resolve('../controllers/admin/reports_enhanced')];
  return require('../controllers/admin/reports_enhanced');
};

describe('Enhanced P&L report', () => {
  test('returns correct income/expense/NOI structure', async () => {
    const pool = mockPool({
      'SUM(CASE WHEN i.type': [[{ gross_income: 500000, total_invoiced: 550000 }]],
      'SUM(e.amount) AS total_expenses': [[{ total_expenses: 120000 }]],
      'SUM(u.rent_amount) AS potential': [[{ potential_monthly_rent: 600000 }]],
      'SELECT SUM(i.amount) AS income, i.type': [[]],
      'SELECT e.category, SUM(e.amount)': [[]],
    });
    const c = freshController(pool);
    const req = mockReq({ user: makeUser('super_admin'), query: { month_year: '2024-03' } });
    const res = mockRes();
    await c.pnl(req, res);
    res.assertSuccess();
    const { body } = res;
    assert.ok('gross_income'    in body, 'should include gross_income');
    assert.ok('total_expenses'  in body, 'should include total_expenses');
    assert.ok('net_income'      in body, 'should include net_income');
    assert.ok('vacancy_loss'    in body, 'should include vacancy_loss');
    assert.equal(typeof body.net_income, 'number', 'net_income should be a number');
  });

  test('property_manager gets scoped results', async () => {
    const pool = mockPool({
      'SUM(CASE WHEN i.type': [[{ gross_income: 100000, total_invoiced: 110000 }]],
      'SUM(e.amount) AS total_expenses': [[{ total_expenses: 30000 }]],
      'SUM(u.rent_amount) AS potential': [[{ potential_monthly_rent: 120000 }]],
      'SELECT SUM(i.amount) AS income, i.type': [[]],
      'SELECT e.category, SUM(e.amount)': [[]],
    });
    const c = freshController(pool);
    const req = mockReq({ user: makeUser('property_manager', { sub: 5 }), query: { month_year: '2024-03' } });
    const res = mockRes();
    await c.pnl(req, res);
    res.assertSuccess();
    const managerQuery = pool._calls.find(c => c.sql.includes('manager_id') && c.params.includes(5));
    assert.ok(managerQuery, 'query should be scoped to manager_id');
  });

  test('net_income = gross_income - total_expenses', async () => {
    const gross = 400000, expenses = 95000;
    const pool = mockPool({
      'SUM(CASE WHEN i.type': [[{ gross_income: gross, total_invoiced: 420000 }]],
      'SUM(e.amount) AS total_expenses': [[{ total_expenses: expenses }]],
      'SUM(u.rent_amount) AS potential': [[{ potential_monthly_rent: 450000 }]],
      'SELECT SUM(i.amount) AS income, i.type': [[]],
      'SELECT e.category, SUM(e.amount)': [[]],
    });
    const c = freshController(pool);
    const req = mockReq({ user: makeUser('super_admin'), query: { month_year: '2024-03' } });
    const res = mockRes();
    await c.pnl(req, res);
    res.assertSuccess();
    assert.equal(res.body.net_income, gross - expenses, 'net_income must equal gross - expenses');
  });
});

describe('Cashflow forecast', () => {
  test('returns 3-month forecast array', async () => {
    const pool = mockPool({
      'AVG(monthly_collected)': [[{ avg_monthly_collected: 380000, collection_rate: 85.5 }]],
      'SUM(rent_amount) AS expected': [[{ expected_monthly_rent: 450000 }]],
      'AVG(monthly_expenses)': [[{ avg_monthly_expenses: 80000 }]],
    });
    const c = freshController(pool);
    const req = mockReq({ user: makeUser('super_admin'), query: {} });
    const res = mockRes();
    await c.cashflowForecast(req, res);
    res.assertSuccess();
    assert.ok(Array.isArray(res.body.forecast), 'forecast should be an array');
    assert.equal(res.body.forecast.length, 3, 'should return 3 months');
    const m = res.body.forecast[0];
    assert.ok('month'              in m, 'each month should have month label');
    assert.ok('projected_income'   in m, 'each month should have projected_income');
    assert.ok('projected_expenses' in m, 'each month should have projected_expenses');
    assert.ok('net'                in m, 'each month should have net');
  });

  test('collection_rate between 0 and 100', async () => {
    const pool = mockPool({
      'AVG(monthly_collected)': [[{ avg_monthly_collected: 500000, collection_rate: 92.3 }]],
      'SUM(rent_amount) AS expected': [[{ expected_monthly_rent: 541667 }]],
      'AVG(monthly_expenses)': [[{ avg_monthly_expenses: 90000 }]],
    });
    const c = freshController(pool);
    const req = mockReq({ user: makeUser('owner', { sub: 9 }), query: {} });
    const res = mockRes();
    await c.cashflowForecast(req, res);
    res.assertSuccess();
    const rate = res.body.collection_rate;
    assert.ok(rate >= 0 && rate <= 100, `collection_rate ${rate} should be between 0 and 100`);
  });
});

describe('Maintenance KPIs', () => {
  test('returns overall + byCategory + topUnits', async () => {
    const pool = mockPool({
      'COUNT(*) AS total, AVG': [[{ total: 45, avg_resolution_hours: 18.5, total_cost: 250000 }]],
      'mr.category, COUNT': [[
        { category: 'plumbing',    total: 20, avg_hours: 12, cost: 90000 },
        { category: 'electrical',  total: 15, avg_hours: 8,  cost: 75000 },
        { category: 'structural',  total: 10, avg_hours: 36, cost: 85000 },
      ]],
      'u.unit_number, p.name, COUNT': [[
        { unit_number: 'A1', property_name: 'Sunset Apts', request_count: 8, total_cost: 45000 },
      ]],
    });
    const c = freshController(pool);
    const req = mockReq({ user: makeUser('super_admin'), query: {} });
    const res = mockRes();
    await c.maintenanceKpis(req, res);
    res.assertSuccess();
    assert.ok(res.body.overall,      'should have overall');
    assert.ok(res.body.byCategory,   'should have byCategory');
    assert.ok(res.body.topUnits,     'should have topUnits');
    assert.equal(res.body.overall.total, 45);
    assert.equal(res.body.byCategory.length, 3);
  });
});

describe('Occupancy trend', () => {
  test('returns 12-month trend array', async () => {
    const pool = mockPool({
      'COUNT(*) AS total_units FROM units': [[{ total_units: 80 }]],
      'DATE_FORMAT.*month.*occupancy': [[
        ...Array.from({ length: 12 }, (_, i) => ({
          month: `2024-${String(i+1).padStart(2,'0')}`,
          occupied: 60 + i, total: 80, occupancy_rate: 75 + i,
        })),
      ]],
      'u.type, COUNT': [[]],
    });
    const c = freshController(pool);
    const req = mockReq({ user: makeUser('super_admin'), query: {} });
    const res = mockRes();
    await c.occupancyTrend(req, res);
    res.assertSuccess();
    assert.equal(res.body.trend.length, 12, 'should return 12 months of data');
    assert.ok(res.body.current_total >= 0, 'current_total should be non-negative');
  });
});

describe('Waive late fee', () => {
  test('super_admin can waive any late fee', async () => {
    const pool = mockPool({
      'SELECT * FROM invoices WHERE id': [[{ id: 5, status: 'overdue', late_fee: 500, balance: 5500 }]],
      'UPDATE invoices': [{ affectedRows: 1 }],
      'INSERT INTO audit_log': [{ insertId: 1 }],
    });
    const c = freshController(pool);
    const req = mockReq({ user: makeUser('super_admin', { sub: 1 }), params: { id: '5' }, body: { reason: 'Tenant hardship' } });
    const res = mockRes();
    await c.waiveLateFee(req, res);
    res.assertSuccess();
    const update = pool._calls.find(c => c.sql.includes('UPDATE invoices') && c.sql.includes('late_fee'));
    assert.ok(update, 'should UPDATE the invoice late_fee');
  });

  test('property_manager cannot waive fee outside their properties', async () => {
    const pool = mockPool({
      'SELECT * FROM invoices WHERE id': [[{
        id: 99, status: 'overdue', late_fee: 200, balance: 5200,
        manager_id: 7, // different manager
      }]],
    });
    const c = freshController(pool);
    const req = mockReq({ user: makeUser('property_manager', { sub: 3 }), params: { id: '99' }, body: {} });
    const res = mockRes();
    await c.waiveLateFee(req, res);
    assert.ok(res.statusCode === 403 || res.statusCode === 404, 'should not allow cross-manager waive');
  });
});
