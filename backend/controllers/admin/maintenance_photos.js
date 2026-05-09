// backend/controllers/admin/maintenance_photos.js
// Add photo upload/retrieval to maintenance requests
//
// New routes (add to routes/maintenance.js):
//   POST /api/maintenance/:id/photos     — upload photo(s)
//   GET  /api/maintenance/:id/photos     — get photos for request
//   DELETE /api/maintenance/photos/:pid  — delete a photo

const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

// ── Upload photos ─────────────────────────────────────────────
exports.upload = async (req, res) => {
  try {
    if (!req.files?.length && !req.file) return err(res, 'No files uploaded');
    const files = req.files || [req.file];
    const { type = 'report' } = req.body; // 'before' | 'after' | 'report'

    const [[mr]] = await pool.query('SELECT id,property_id FROM maintenance_requests WHERE id=?', [req.params.id]);
    if (!mr) return err(res, 'Maintenance request not found', 404);

    const inserted = [];
    for (const file of files) {
      const url = `/uploads/maintenance/${file.filename}`;
      const [r] = await pool.query(
        `INSERT INTO maintenance_photos (request_id, url, photo_type, uploaded_by, original_name)
         VALUES (?,?,?,?,?)`,
        [req.params.id, url, type, req.user.sub, file.originalname]);
      inserted.push({ id: r.insertId, url, type });
    }

    ok(res, { photos: inserted, message: `${inserted.length} photo(s) uploaded` }, 201);
  } catch(e) { safeErr(res, e); }
};

// ── Get photos for a request ──────────────────────────────────
exports.getPhotos = async (req, res) => {
  try {
    const [photos] = await pool.query(
      `SELECT mp.*, u.full_name AS uploaded_by_name
       FROM maintenance_photos mp
       LEFT JOIN users u ON mp.uploaded_by=u.id
       WHERE mp.request_id=?
       ORDER BY mp.created_at DESC`,
      [req.params.id]);
    ok(res, { photos });
  } catch(e) { safeErr(res, e); }
};

// ── Delete a photo ────────────────────────────────────────────
exports.deletePhoto = async (req, res) => {
  try {
    const [[photo]] = await pool.query('SELECT * FROM maintenance_photos WHERE id=?', [req.params.pid]);
    if (!photo) return err(res, 'Photo not found', 404);

    // Delete file from disk
    try {
      const path = require('path');
      const fs   = require('fs');
      const filePath = path.join(__dirname, '../../', photo.url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}

    await pool.query('DELETE FROM maintenance_photos WHERE id=?', [req.params.pid]);
    ok(res, { message: 'Photo deleted' });
  } catch(e) { safeErr(res, e); }
};