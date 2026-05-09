// backend/routes/maintenance.js  — FULL FILE (replace entirely)
const router  = require('express').Router();
const multer  = require('multer');
const path    = require('path');
const auth    = require('../middleware/auth');
const c       = require('../controllers/admin/maintenance');
const photos  = require('../controllers/admin/maintenance_photos');
const pool    = require('../config/db');
const { ok, err } = require('../utils/helpers');

// Photo upload storage
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/maintenance');
    require('fs').mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `maint-${req.params.id}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const photoUpload = multer({
  storage: photoStorage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const roles      = ['super_admin', 'property_manager', 'caretaker'];
const adminRoles = ['super_admin', 'property_manager', 'caretaker'];

// ── Existing maintenance routes ───────────────────────────────
router.get('/',    auth(),      c.getAll);   // filtered by role inside controller
router.post('/',   auth(),      c.create);   // tenants can submit requests
router.put('/:id', auth(roles), c.update);

// ── Maintenance photos (NEW) ──────────────────────────────────

// GET  /api/maintenance/:id/photos  — get all photos for a request
router.get('/:id/photos',  auth(), photos.getPhotos);

// POST /api/maintenance/:id/photos  — upload 1–5 photos to a request
// Body (form-data): photos (files), type (before|after|report)
router.post('/:id/photos',
  auth(roles),
  photoUpload.array('photos', 5),
  photos.upload
);

// DELETE /api/maintenance/photos/:pid  — delete a specific photo by photo id
router.delete('/photos/:pid', auth(adminRoles), photos.deletePhoto);

// ── Preventive maintenance schedules (NEW) ────────────────────

// GET  /api/maintenance/schedules?property_id=1  — list all schedules
router.get('/schedules', auth(adminRoles), async (req, res) => {
  try {
    const pid = req.query.property_id;
    const [rows] = await pool.query(
      `SELECT ms.*, p.name AS property_name
       FROM maintenance_schedules ms
       JOIN properties p ON ms.property_id = p.id
       WHERE ms.is_active = 1 ${pid ? 'AND ms.property_id=?' : ''}
       ORDER BY ms.next_due ASC`,
      pid ? [pid] : []
    );
    ok(res, { schedules: rows });
  } catch (e) { err(res, e.message, 500); }
});

// POST /api/maintenance/schedules  — create a new preventive schedule
// Body: { title, property_id, category, frequency_days, start_date }
router.post('/schedules', auth(adminRoles), async (req, res) => {
  try {
    const { title, property_id, category, frequency_days, start_date } = req.body;
    if (!title || !property_id || !frequency_days)
      return err(res, 'title, property_id and frequency_days are required');

    const firstDue = start_date || new Date().toISOString().split('T')[0];

    const [r] = await pool.query(
      `INSERT INTO maintenance_schedules
       (property_id, title, category, frequency_days, next_due, is_active, created_by)
       VALUES (?,?,?,?,?,1,?)`,
      [property_id, title, category || 'other', frequency_days, firstDue, req.user.sub]
    );
    ok(res, { id: r.insertId, message: 'Schedule created' }, 201);
  } catch (e) { err(res, e.message, 500); }
});

// PUT  /api/maintenance/schedules/:id  — update or deactivate a schedule
router.put('/schedules/:id', auth(adminRoles), async (req, res) => {
  try {
    const { title, category, frequency_days, is_active, next_due } = req.body;
    await pool.query(
      `UPDATE maintenance_schedules
       SET title=COALESCE(?,title),
           category=COALESCE(?,category),
           frequency_days=COALESCE(?,frequency_days),
           is_active=COALESCE(?,is_active),
           next_due=COALESCE(?,next_due)
       WHERE id=?`,
      [title || null, category || null, frequency_days || null,
       is_active ?? null, next_due || null, req.params.id]
    );
    ok(res, { message: 'Schedule updated' });
  } catch (e) { err(res, e.message, 500); }
});

// DELETE /api/maintenance/schedules/:id  — soft-delete (deactivate)
router.delete('/schedules/:id', auth(adminRoles), async (req, res) => {
  try {
    await pool.query('UPDATE maintenance_schedules SET is_active=0 WHERE id=?', [req.params.id]);
    ok(res, { message: 'Schedule deactivated' });
  } catch (e) { err(res, e.message, 500); }
});

// GET /api/maintenance/:id/updates — fetch update history for a request
router.get('/:id/updates', auth(), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT mu.*, u.full_name AS updated_by_name
       FROM maintenance_updates mu
       LEFT JOIN users u ON mu.user_id = u.id
       WHERE mu.request_id = ?
       ORDER BY mu.created_at ASC`,
      [req.params.id]
    );
    ok(res, { updates: rows });
  } catch (e) { err(res, e.message, 500); }
});

module.exports = router;
