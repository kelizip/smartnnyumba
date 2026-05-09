const router = require('express').Router();
const auth   = require('../middleware/auth');
const c      = require('../controllers/admin/dashboard');
router.get('/', auth(['super_admin','property_manager','caretaker','security','owner','tenant']), c.getDashboard);
module.exports = router;
