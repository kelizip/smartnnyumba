// backend/routes/users.js
const router  = require('express').Router();
const auth    = require('../middleware/auth');
const { photoUpload } = require('../middleware/upload');
const c       = require('../controllers/admin/users');

router.get('/',              auth(['super_admin','property_manager']), c.getAll);
router.get('/search',        auth(), c.search);
router.get('/:id',           auth(['super_admin','property_manager','security','caretaker']), c.getOne);
router.post('/',             auth(['super_admin']), c.create);
router.put('/:id',           auth(['super_admin']), c.update);
router.put('/:id/password',  auth(['super_admin']), c.resetPassword);
router.put('/:id/suspend',   auth(['super_admin','owner']), c.suspend);
router.put('/:id/unsuspend', auth(['super_admin','owner']), c.unsuspend);
router.delete('/:id',        auth(['super_admin']), c.deleteUser);   // ← NEW
router.post('/:id/photo',    auth(), photoUpload.single('photo'), c.uploadPhoto);

// ── Invite user by email ─────────────────────────────────────
router.post('/invite', auth(['super_admin', 'property_manager']), async (req, res) => {
  const pool = require('../config/db');
  const bcrypt = require('bcryptjs');
  try {
    const { email, role, property_id, full_name } = req.body;
    if (!email || !role) return res.status(400).json({ error: 'email and role required' });

    const validRoles = ['property_manager','caretaker','security','owner','tenant'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    // Managers can only invite caretakers/security, and only to their own properties
    if (req.user.role === 'property_manager') {
      const allowedForManager = ['caretaker','security'];
      if (!allowedForManager.includes(role))
        return res.status(403).json({ error: 'Managers can only invite caretakers and security staff' });
      if (property_id) {
        const [[prop]] = await pool.query('SELECT id FROM properties WHERE id=? AND manager_id=?', [property_id, req.user.sub]);
        if (!prop) return res.status(403).json({ error: 'You can only assign staff to your own properties' });
      }
    }

    // Check if user already exists
    const [[exists]] = await pool.query('SELECT id FROM users WHERE email=?', [email]);
    if (exists) return res.status(409).json({ error: 'A user with this email already exists' });

    // Generate temp password
    const tempPw = Math.random().toString(36).slice(-8) + 'A1!';
    const hash = await bcrypt.hash(tempPw, 12);
    const name = full_name || email.split('@')[0];

    const [r] = await pool.query(
      'INSERT INTO users (full_name,email,role,password_hash,property_id,is_active) VALUES (?,?,?,?,?,1)',
      [name, email, role, hash, property_id || null]);

    // Send invite email (non-fatal)
    try {
      const emailSvc = require('../services/email');
      await emailSvc.sendMail({
        to: email,
        subject: 'You have been invited to SmartNyumba',
        html: '<p>Hello ' + name + ',</p><p>You have been invited to SmartNyumba as <strong>' + role.replace('_',' ') + '</strong>.</p><p>Your temporary password is: <code>' + tempPw + '</code></p><p>Please log in and change your password immediately.</p>',
        text: 'Hello ' + name + ', you have been invited to SmartNyumba. Temporary password: ' + tempPw,
      });
    } catch (_) {}

    res.status(201).json({
      id: r.insertId,
      message: 'User invited successfully. Credentials sent to ' + email,
      temp_password: tempPw, // Show in UI so admin can share manually if email fails
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ── Emergency details — accessible to managers and security ──
router.get('/:id/emergency', auth(['super_admin','property_manager','security','caretaker']), async (req, res) => {
  const pool = require('../config/db');
  try {
    const [[user]] = await pool.query(
      `SELECT u.id, u.full_name, u.phone, u.email, u.role,
              u.emergency_contact, u.emergency_phone,
              u.id_type, u.id_number, u.passport_number,
              u.vehicle_plate,
              t.emergency_contact AS t_emergency_contact,
              t.emergency_phone AS t_emergency_phone,
              t.id_number AS t_id_number,
              t.vehicle_plate AS t_vehicle_plate
       FROM users u
       LEFT JOIN tenants t ON t.user_id = u.id
       WHERE u.id = ?`, [req.params.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    // Merge tenants data as fallback
    const details = {
      full_name:         user.full_name,
      phone:             user.phone,
      role:              user.role,
      id_type:           user.id_type,
      id_number:         user.id_number || user.t_id_number,
      passport_number:   user.passport_number,
      emergency_contact: user.emergency_contact || user.t_emergency_contact,
      emergency_phone:   user.emergency_phone || user.t_emergency_phone,
      vehicle_plate:     user.vehicle_plate || user.t_vehicle_plate,
    };
    res.json({ emergency: details });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/approve', auth(['super_admin']), require('../controllers/auth/selfRegister').approveUser);

module.exports = router;