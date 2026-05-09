'use strict';

const router = require('express').Router();
const auth   = require('../middleware/auth');
const { paymentSchema } = require('../middleware/validators');
const { auditMiddleware } = require('../middleware/audit');
const c = require('../controllers/admin/payments');

router.get('/',                   auth(),  c.getAll);
router.post('/',                  auth(),  paymentSchema, auditMiddleware('RECORD_PAYMENT', 'payments'), c.record);
router.post('/stk/initiate',      auth(),  c.initiateStk);
router.get('/stk/:checkout_id',   auth(),  c.checkStk);

module.exports = router;