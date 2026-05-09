const pool = require('../../config/db');
const { ok, err } = require('../../utils/helpers');

exports.getAll = async (req, res) => {
  try {
    let sql = `SELECT ps.*,pr.name AS property_name,
      u.full_name AS assigned_user_name,un.unit_number AS assigned_unit
      FROM parking_slots ps JOIN properties pr ON ps.property_id=pr.id
      LEFT JOIN users u ON ps.assigned_to_user_id=u.id
      LEFT JOIN units un ON ps.assigned_to_unit_id=un.id`;
    const params = [];
    // Scope: manager→assigned properties only; caretaker/security→their property only
    if (req.user.role === 'property_manager') {
      sql += ' WHERE pr.manager_id=?';
      params.push(req.user.sub);
    } else if (req.user.property_id) {
      sql += ' WHERE ps.property_id=?';
      params.push(req.user.property_id);
    }
    sql += ' ORDER BY pr.name,ps.slot_number';
    const [slots] = await pool.query(sql, params);
    ok(res, { slots });
  } catch(e) { safeErr(res, e); }
};

exports.create = async (req, res) => {
  try {
    const { property_id, slot_number, type } = req.body;
    if (!property_id || !slot_number) return err(res, 'property_id and slot_number required');

    // Enforce: manager can only create slots in their own properties
    if (req.user.role === 'property_manager') {
      const [[prop]] = await pool.query('SELECT id FROM properties WHERE id=? AND manager_id=?', [property_id, req.user.sub]);
      if (!prop) return err(res, 'You can only add parking slots to your assigned properties', 403);
    }
    // Caretaker/security can only add slots to their property
    if (['caretaker','security'].includes(req.user.role) && req.user.property_id) {
      if (parseInt(property_id) !== req.user.property_id) return err(res, 'You can only manage parking in your assigned property', 403);
    }

    const [r] = await pool.query('INSERT INTO parking_slots (property_id,slot_number,type) VALUES (?,?,?)',
      [property_id, slot_number, type||'resident']);
    ok(res, { id: r.insertId }, 201);
  } catch(e) { safeErr(res, e); }
};

exports.assign = async (req, res) => {
  try {
    const { assignee_type, user_id, unit_id, vehicle_plate, visitor_name } = req.body;
    const slotId = req.params.id;
    if (!assignee_type) return err(res, 'assignee_type required');

    const plate = vehicle_plate ? vehicle_plate.toUpperCase().trim() : null;

    // Check slot not already occupied
    const [[slot]] = await pool.query('SELECT * FROM parking_slots WHERE id=?', [slotId]);
    if (!slot) return err(res, 'Slot not found', 404);
    if (slot.assigned_to_type !== 'unassigned' && assignee_type !== 'unassigned')
      return err(res, `Slot is already assigned to a ${slot.assigned_to_type}. Release it first.`, 409);

    if (assignee_type === 'unassigned') {
      await pool.query("UPDATE parking_slots SET assigned_to_type='unassigned',assigned_to_user_id=NULL,assigned_to_unit_id=NULL,assigned_vehicle_plate=NULL,status='vacant' WHERE id=?", [slotId]);
      return ok(res, { message: 'Slot released' });
    }

    await pool.query(
      "UPDATE parking_slots SET assigned_to_type=?,assigned_to_user_id=?,assigned_to_unit_id=?,assigned_vehicle_plate=?,status='occupied' WHERE id=?",
      [assignee_type, user_id||null, unit_id||null, plate, slotId]);
    ok(res, { message: `Slot assigned to ${assignee_type}` });
  } catch(e) { safeErr(res, e); }
};

exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE parking_slots SET status=? WHERE id=?', [status, req.params.id]);
    ok(res, { message: 'Slot updated' });
  } catch(e) { safeErr(res, e); }
};
