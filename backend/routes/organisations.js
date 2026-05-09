'use strict';
const router = require('express').Router();
const auth   = require('../middleware/auth');
const c      = require('../controllers/admin/organisations');
const SA     = ['super_admin'];

router.get  ('/me',    auth(SA), c.getMyOrg);
router.patch('/me',    auth(SA), c.update);
router.get  ('/audit', auth(SA), c.auditLog);
module.exports = router;
