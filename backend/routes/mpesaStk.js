const router = require('express').Router();
const auth   = require('../middleware/auth');
const c      = require('../controllers/admin/mpesaStk');
router.post('/initiate',          auth(), c.initiate);
router.get('/status/:checkout_id',auth(), c.checkStatus);
router.post('/callback',          c.callback);
module.exports = router;
