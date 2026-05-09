'use strict';

/**
 * SmartNyumba Pro — Auth Tests (self-contained)
 * Run: node --test tests/auth.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { mockRes } = require('./helpers');

process.env.JWT_SECRET = 'test_secret_min_32_chars_long_enough_xyz';
process.env.NODE_ENV   = 'test';

// ─────────────────────────────────────────────────────────────
describe('JWT auth middleware', () => {
  const auth = require('../middleware/auth');

  const makeReq = (token) => ({
    headers: token ? { authorization: `Bearer ${token}` } : {},
    socket:  { remoteAddress: '127.0.0.1' },
  });

  test('rejects no Authorization header', () => {
    const res = mockRes();
    auth()(makeReq(null), res, () => { throw new Error('should not call next'); });
    assert.equal(res._status, 401);
    assert.equal(res._body.error, 'Authentication required');
  });

  test('rejects malformed JWT', () => {
    const res = mockRes();
    auth()(makeReq('not.a.jwt'), res, () => { throw new Error('should not call next'); });
    assert.equal(res._status, 401);
  });

  test('rejects expired JWT', () => {
    const jwt = require('jsonwebtoken');
    const tok = jwt.sign({ sub: 1, role: 'tenant' }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    const res = mockRes();
    auth()(makeReq(tok), res, () => { throw new Error('should not call next'); });
    assert.equal(res._status, 401);
    assert.equal(res._body.code, 'TOKEN_EXPIRED');
  });

  test('rejects MFA-pending token on protected route', () => {
    const jwt = require('jsonwebtoken');
    const tok = jwt.sign({ sub: 1, type: 'mfa_pending' }, process.env.JWT_SECRET, { expiresIn: '5m' });
    const res = mockRes();
    auth()(makeReq(tok), res, () => { throw new Error('should not call next'); });
    assert.equal(res._status, 401);
    assert.equal(res._body.requires_mfa, true);
  });

  test('rejects insufficient role', () => {
    const jwt = require('jsonwebtoken');
    const tok = jwt.sign({ sub: 2, role: 'tenant' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = mockRes();
    auth(['super_admin'])(makeReq(tok), res, () => { throw new Error('should not call next'); });
    assert.equal(res._status, 403);
  });

  test('calls next() and populates req.user for valid token', () => {
    const jwt = require('jsonwebtoken');
    const tok = jwt.sign({ sub: 5, role: 'super_admin', name: 'Admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const req = makeReq(tok);
    const res = mockRes();
    let called = false;
    auth(['super_admin'])(req, res, () => { called = true; });
    assert.ok(called);
    assert.equal(req.user.sub, 5);
  });

  test('allows any authenticated role when no restriction given', () => {
    const jwt = require('jsonwebtoken');
    const tok = jwt.sign({ sub: 3, role: 'caretaker' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const req = makeReq(tok);
    const res = mockRes();
    let called = false;
    auth()(req, res, () => { called = true; });
    assert.ok(called);
  });
});

// ─────────────────────────────────────────────────────────────
describe('Error codes', () => {
  const { CODES, apiErr, err } = require('../utils/errorCodes');

  test('every CODES entry has matching .code key', () => {
    for (const [key, val] of Object.entries(CODES)) {
      assert.equal(val.code, key);
      assert.ok(val.message);
    }
  });

  test('apiErr produces correct HTTP response', () => {
    const res = mockRes();
    apiErr(res, CODES.INVOICE_NOT_FOUND, 404);
    assert.equal(res._status, 404);
    assert.equal(res._body.code, 'INVOICE_NOT_FOUND');
    assert.equal(res._body.success, false);
  });

  test('apiErr merges extra fields', () => {
    const res = mockRes();
    apiErr(res, CODES.VALIDATION, 422, { details: [{ field: 'email' }] });
    assert.ok(Array.isArray(res._body.details));
  });

  test('err() string is backward compatible', () => {
    const { err } = require('../utils/helpers');
    const res = mockRes();
    err(res, 'Something broke', 500);
    assert.equal(res._status, 500);
    assert.equal(res._body.error, 'Something broke');
  });

  test('err() with CODES entry is structured', () => {
    const { err, CODES } = require('../utils/helpers');
    const res = mockRes();
    err(res, CODES.DUPLICATE_PAYMENT, 409);
    assert.equal(res._body.code, 'DUPLICATE_PAYMENT');
  });
});

// ─────────────────────────────────────────────────────────────
describe('Password reset token security', () => {
  const crypto = require('crypto');
  const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

  test('token hash is deterministic', () => {
    const raw = crypto.randomBytes(48).toString('hex');
    assert.equal(hash(raw), hash(raw));
  });

  test('different tokens produce different hashes', () => {
    const t1 = crypto.randomBytes(48).toString('hex');
    const t2 = crypto.randomBytes(48).toString('hex');
    assert.notEqual(hash(t1), hash(t2));
  });

  test('raw token is 96 hex chars (48 bytes)', () => {
    const raw = crypto.randomBytes(48).toString('hex');
    assert.equal(raw.length, 96);
    assert.match(raw, /^[0-9a-f]+$/);
  });

  test('hash is 64 chars (SHA-256)', () => {
    assert.equal(hash('test').length, 64);
  });
});

// ─────────────────────────────────────────────────────────────
describe('Input validation patterns', () => {
  test('search LIKE escaping', () => {
    const raw  = "100% profit_loss\\path";
    const safe = raw.replace(/[%_\\]/g, '\\$&').slice(0, 100);
    assert.equal(safe, '100\\% profit\\_loss\\\\path');
  });

  test('search capped at 100 chars', () => {
    assert.equal('x'.repeat(200).slice(0, 100).length, 100);
  });

  test('valid M-Pesa codes match pattern', () => {
    for (const c of ['QK12345678', 'AB1234567C', '0000000000']) {
      assert.match(c, /^[A-Z0-9]{10}$/);
    }
  });

  test('invalid M-Pesa codes do not match', () => {
    for (const c of ['SHORT', 'TOOLONGCODE1', 'HAS-HYPHEN', 'HAS SPACE1']) {
      assert.doesNotMatch(c, /^[A-Z0-9]{10}$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────
describe('Audit middleware', () => {
  const audit = require('../middleware/audit');

  test('calls next() immediately', () => {
    const req = { headers: {}, params: {}, body: {}, socket: { remoteAddress: '::1' } };
    const res = mockRes();
    let called = false;
    audit('TEST', 'units')(req, res, () => { called = true; });
    assert.ok(called);
  });
});
