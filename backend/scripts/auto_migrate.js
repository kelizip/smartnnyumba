
// ── Bootstrap: create all tables if they don't exist ─────────
async function createCoreTables(pool) {
  const tbls = [
    // users
    `CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(150) NOT NULL,
      email VARCHAR(150) UNIQUE,
      phone VARCHAR(20),
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('super_admin','property_manager','tenant','caretaker','security','owner') DEFAULT 'tenant',
      property_id INT DEFAULT NULL,
      profile_photo VARCHAR(500) DEFAULT NULL,
      is_active TINYINT(1) DEFAULT 1,
      is_suspended TINYINT(1) DEFAULT 0,
      suspend_reason VARCHAR(255) DEFAULT NULL,
      mfa_enabled TINYINT(1) DEFAULT 0,
      last_login DATETIME DEFAULT NULL,
      id_number VARCHAR(30) DEFAULT NULL,
      id_type VARCHAR(20) DEFAULT 'national_id',
      passport_number VARCHAR(30) DEFAULT NULL,
      emergency_contact VARCHAR(100) DEFAULT NULL,
      emergency_phone VARCHAR(20) DEFAULT NULL,
      vehicle_plate VARCHAR(20) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_role (role), INDEX idx_property (property_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS properties (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      location VARCHAR(200) DEFAULT NULL,
      address VARCHAR(300) DEFAULT NULL,
      description TEXT DEFAULT NULL,
      manager_id INT DEFAULT NULL,
      owner_id INT DEFAULT NULL,
      management_fee_pct DECIMAL(5,2) DEFAULT 0.00,
      kra_pin VARCHAR(20) DEFAULT NULL,
      business_reg VARCHAR(50) DEFAULT NULL,
      vat_number VARCHAR(30) DEFAULT NULL,
      invite_slug VARCHAR(60) UNIQUE DEFAULT NULL,
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS units (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      unit_number VARCHAR(50) NOT NULL,
      floor VARCHAR(20) DEFAULT NULL,
      type ENUM('bedsitter','one_bedroom','two_bedroom','three_bedroom','studio','penthouse','shop','office','other') DEFAULT 'one_bedroom',
      rent_amount DECIMAL(12,2) DEFAULT 0.00,
      deposit_amount DECIMAL(12,2) DEFAULT 0.00,
      status ENUM('vacant','occupied','maintenance','reserved') DEFAULT 'vacant',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_property (property_id), INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS tenants (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      id_number VARCHAR(30) DEFAULT NULL,
      passport_number VARCHAR(30) DEFAULT NULL,
      emergency_contact VARCHAR(100) DEFAULT NULL,
      emergency_phone VARCHAR(20) DEFAULT NULL,
      vehicle_plate VARCHAR(20) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS tenancies (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      unit_id INT NOT NULL,
      start_date DATE NOT NULL,
      end_date DATE DEFAULT NULL,
      rent_amount DECIMAL(12,2) NOT NULL,
      deposit DECIMAL(12,2) DEFAULT 0.00,
      deposit_paid DECIMAL(12,2) DEFAULT 0.00,
      payment_due_day TINYINT DEFAULT 1,
      status ENUM('active','terminated','expired','vacating') DEFAULT 'active',
      termination_date DATE DEFAULT NULL,
      termination_reason TEXT DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tenant (tenant_id), INDEX idx_unit (unit_id), INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenancy_id INT NOT NULL,
      type ENUM('rent','deposit','water','electricity','service_charge','utility','penalty','other') DEFAULT 'rent',
      amount DECIMAL(12,2) NOT NULL,
      balance DECIMAL(12,2) NOT NULL,
      due_date DATE NOT NULL,
      status ENUM('unpaid','partial','paid','overdue','cancelled','waived') DEFAULT 'unpaid',
      month_year VARCHAR(7) DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      parent_invoice_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tenancy (tenancy_id), INDEX idx_status (status), INDEX idx_due (due_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      invoice_id INT DEFAULT NULL,
      tenancy_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      payment_method ENUM('mpesa','bank','cash','cheque','card','other') DEFAULT 'mpesa',
      transaction_code VARCHAR(100) DEFAULT NULL,
      mpesa_phone VARCHAR(20) DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      recorded_by INT DEFAULT NULL,
      paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tenancy (tenancy_id), INDEX idx_paid_at (paid_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS receipts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      payment_id INT NOT NULL UNIQUE,
      receipt_number VARCHAR(30) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS tenant_ledger (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenancy_id INT NOT NULL,
      type ENUM('debit','credit') NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      description VARCHAR(255) DEFAULT NULL,
      ref_type VARCHAR(50) DEFAULT NULL,
      ref_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tenancy (tenancy_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT DEFAULT NULL,
      amount DECIMAL(12,2) NOT NULL,
      category VARCHAR(60) DEFAULT 'general',
      vendor VARCHAR(150) DEFAULT NULL,
      receipt_ref VARCHAR(100) DEFAULT NULL,
      receipt_url VARCHAR(500) DEFAULT NULL,
      expense_date DATE NOT NULL,
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_property (property_id), INDEX idx_date (expense_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS mpesa_transactions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      checkout_request_id VARCHAR(100) DEFAULT NULL,
      merchant_request_id VARCHAR(100) DEFAULT NULL,
      invoice_id INT DEFAULT NULL,
      tenancy_id INT DEFAULT NULL,
      phone VARCHAR(20) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      status ENUM('pending','completed','failed','expired','cancelled') DEFAULT 'pending',
      mpesa_receipt VARCHAR(50) DEFAULT NULL,
      failure_reason VARCHAR(255) DEFAULT NULL,
      initiated_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS maintenance_requests (
      id INT AUTO_INCREMENT PRIMARY KEY,
      unit_id INT DEFAULT NULL,
      property_id INT NOT NULL,
      tenancy_id INT DEFAULT NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT DEFAULT NULL,
      category ENUM('plumbing','electrical','structural','appliance','cleaning','pest_control','security','other') DEFAULT 'other',
      priority ENUM('emergency','urgent','normal','low') DEFAULT 'normal',
      status ENUM('open','assigned','in_progress','completed','closed','cancelled') DEFAULT 'open',
      assigned_to INT DEFAULT NULL,
      cost DECIMAL(12,2) DEFAULT NULL,
      resolved_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_property (property_id), INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS maintenance_updates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_id INT NOT NULL,
      user_id INT DEFAULT NULL,
      note TEXT DEFAULT NULL,
      status VARCHAR(50) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_request (request_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS maintenance_photos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_id INT NOT NULL,
      url VARCHAR(500) NOT NULL,
      photo_type ENUM('before','after','report') DEFAULT 'before',
      uploaded_by INT DEFAULT NULL,
      original_name VARCHAR(255) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_request (request_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS maintenance_ratings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      request_id INT NOT NULL UNIQUE,
      tenant_id INT DEFAULT NULL,
      rating TINYINT NOT NULL,
      comment TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS maintenance_schedules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      unit_id INT DEFAULT NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT DEFAULT NULL,
      frequency ENUM('once','daily','weekly','monthly','quarterly','annually') DEFAULT 'monthly',
      scheduled_date DATE NOT NULL,
      assigned_to INT DEFAULT NULL,
      status ENUM('pending','in_progress','completed','skipped') DEFAULT 'pending',
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS visitors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      unit_id INT DEFAULT NULL,
      tenancy_id INT DEFAULT NULL,
      name VARCHAR(150) NOT NULL,
      phone VARCHAR(20) DEFAULT NULL,
      id_number VARCHAR(30) DEFAULT NULL,
      vehicle_plate VARCHAR(20) DEFAULT NULL,
      purpose VARCHAR(200) DEFAULT NULL,
      host_name VARCHAR(150) DEFAULT NULL,
      host_user_id INT DEFAULT NULL,
      checked_in_by INT DEFAULT NULL,
      checked_out_by INT DEFAULT NULL,
      check_in DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      check_out DATETIME DEFAULT NULL,
      expected_date DATE DEFAULT NULL,
      registered_by INT DEFAULT NULL,
      status ENUM('checked_in','checked_out','pre_registered') DEFAULT 'checked_in',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_property (property_id), INDEX idx_checkin (check_in), INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS parking_slots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      slot_number VARCHAR(20) NOT NULL,
      type ENUM('resident','visitor','reserved','disabled') DEFAULT 'resident',
      status ENUM('vacant','occupied','reserved','maintenance') DEFAULT 'vacant',
      assigned_to_type ENUM('unassigned','tenant','visitor','staff') DEFAULT 'unassigned',
      assigned_to_user_id INT DEFAULT NULL,
      assigned_to_unit_id INT DEFAULT NULL,
      assigned_vehicle_plate VARCHAR(20) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_property (property_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      from_user_id INT NOT NULL,
      to_user_id INT DEFAULT NULL,
      subject VARCHAR(200) DEFAULT NULL,
      body TEXT NOT NULL,
      parent_id INT DEFAULT NULL,
      is_read TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_from (from_user_id), INDEX idx_to (to_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      type VARCHAR(50) DEFAULT 'info',
      title VARCHAR(200) NOT NULL,
      message TEXT DEFAULT NULL,
      action_url VARCHAR(300) DEFAULT NULL,
      property_id INT DEFAULT NULL,
      is_read TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id, is_read)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS announcements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT DEFAULT NULL,
      title VARCHAR(200) NOT NULL,
      message TEXT NOT NULL,
      priority ENUM('low','normal','high','urgent') DEFAULT 'normal',
      expires_at DATE DEFAULT NULL,
      created_by INT DEFAULT NULL,
      posted_by_role VARCHAR(30) DEFAULT NULL,
      target_audience ENUM('all','tenants','staff') DEFAULT 'all',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS utility_readings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      unit_id INT NOT NULL,
      utility_type ENUM('water','electricity','gas','other') DEFAULT 'water',
      previous_reading DECIMAL(12,2) DEFAULT 0,
      current_reading DECIMAL(12,2) NOT NULL,
      units_consumed DECIMAL(12,2) DEFAULT 0,
      rate_per_unit DECIMAL(10,4) DEFAULT 0,
      total_amount DECIMAL(12,2) DEFAULT 0,
      reading_date DATE NOT NULL,
      read_by INT DEFAULT NULL,
      invoice_id INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_unit (unit_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS shared_meters (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      name VARCHAR(100) NOT NULL,
      utility_type ENUM('water','electricity','gas') DEFAULT 'water',
      split_method ENUM('equal','by_unit','by_occupants','custom') DEFAULT 'equal',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS shared_meter_units (
      id INT AUTO_INCREMENT PRIMARY KEY,
      meter_id INT NOT NULL,
      unit_id INT NOT NULL,
      share_pct DECIMAL(5,2) DEFAULT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS security_logbook (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      log_type VARCHAR(50) DEFAULT 'general',
      title VARCHAR(200) NOT NULL,
      description TEXT DEFAULT NULL,
      severity ENUM('low','medium','high','critical') DEFAULT 'low',
      location VARCHAR(200) DEFAULT NULL,
      reported_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS security_log_incidents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      logged_by INT DEFAULT NULL,
      incident_type VARCHAR(100) DEFAULT NULL,
      description TEXT DEFAULT NULL,
      location VARCHAR(200) DEFAULT NULL,
      severity ENUM('low','medium','high','critical') DEFAULT 'low',
      occurred_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS security_log_patrols (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      officer_id INT DEFAULT NULL,
      route VARCHAR(200) DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      status ENUM('planned','in_progress','completed') DEFAULT 'planned',
      patrol_start DATETIME DEFAULT NULL,
      patrol_end DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS security_log_equipment (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      checked_by INT DEFAULT NULL,
      equipment VARCHAR(200) NOT NULL,
      status ENUM('ok','faulty','missing','maintenance') DEFAULT 'ok',
      notes TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS access_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT DEFAULT NULL,
      unit_id INT DEFAULT NULL,
      event_type VARCHAR(50) NOT NULL,
      actor_name VARCHAR(150) DEFAULT NULL,
      actor_id INT DEFAULT NULL,
      vehicle_plate VARCHAR(20) DEFAULT NULL,
      camera_id VARCHAR(50) DEFAULT NULL,
      gate_id VARCHAR(50) DEFAULT NULL,
      source VARCHAR(50) DEFAULT 'manual',
      notes TEXT DEFAULT NULL,
      recorded_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_property (property_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS documents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT DEFAULT NULL,
      tenancy_id INT DEFAULT NULL,
      tenant_id INT DEFAULT NULL,
      uploaded_by INT DEFAULT NULL,
      category VARCHAR(60) DEFAULT 'general',
      title VARCHAR(200) NOT NULL,
      filename VARCHAR(255) NOT NULL,
      file_url VARCHAR(500) NOT NULL,
      file_size INT DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS cases (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT DEFAULT NULL,
      tenancy_id INT DEFAULT NULL,
      raised_by INT NOT NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT DEFAULT NULL,
      category VARCHAR(60) DEFAULT 'general',
      priority ENUM('low','normal','high','urgent') DEFAULT 'normal',
      status ENUM('open','in_progress','resolved','closed') DEFAULT 'open',
      assigned_to INT DEFAULT NULL,
      resolved_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS case_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      case_id INT NOT NULL,
      user_id INT NOT NULL,
      comment TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS unit_inspections (
      id INT AUTO_INCREMENT PRIMARY KEY,
      unit_id INT NOT NULL,
      property_id INT NOT NULL,
      inspected_by INT DEFAULT NULL,
      inspection_date DATE NOT NULL,
      condition_rating TINYINT DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      checklist JSON DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS vendors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      category VARCHAR(60) DEFAULT 'general',
      phone VARCHAR(20) DEFAULT NULL,
      email VARCHAR(150) DEFAULT NULL,
      address TEXT DEFAULT NULL,
      notes TEXT DEFAULT NULL,
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS vacate_notices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenancy_id INT NOT NULL,
      notice_date DATE NOT NULL,
      vacate_date DATE NOT NULL,
      reason TEXT DEFAULT NULL,
      status ENUM('pending','confirmed','cancelled') DEFAULT 'pending',
      processed_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_tenancy (tenancy_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token VARCHAR(255) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS otp_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(20) NOT NULL,
      user_id INT DEFAULT NULL,
      code VARCHAR(10) NOT NULL,
      purpose VARCHAR(50) DEFAULT 'reset',
      expires_at DATETIME NOT NULL,
      used TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS mfa_otps (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL UNIQUE,
      otp_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      used TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      used TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      setting_key VARCHAR(100) NOT NULL UNIQUE,
      setting_value TEXT DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS cron_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      job_name VARCHAR(100) NOT NULL,
      status ENUM('running','success','failed') DEFAULT 'running',
      rows_affected INT DEFAULT 0,
      note VARCHAR(500) DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      started_at DATETIME DEFAULT NULL,
      finished_at DATETIME DEFAULT NULL,
      INDEX idx_job (job_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS audit_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT DEFAULT NULL,
      user_name VARCHAR(100) DEFAULT NULL,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50) DEFAULT NULL,
      entity_id INT DEFAULT NULL,
      details TEXT DEFAULT NULL,
      ip_address VARCHAR(45) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id), INDEX idx_entity (entity_type, entity_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS sms_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT DEFAULT NULL,
      phone VARCHAR(20) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(50) DEFAULT 'general',
      status ENUM('pending','sent','failed','demo') DEFAULT 'pending',
      provider_ref VARCHAR(100) DEFAULT NULL,
      error_msg VARCHAR(500) DEFAULT NULL,
      sent_at DATETIME DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_phone (phone)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS system_alerts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT DEFAULT NULL,
      title VARCHAR(200) NOT NULL,
      message TEXT NOT NULL,
      severity ENUM('info','warning','error','critical') DEFAULT 'info',
      is_resolved TINYINT(1) DEFAULT 0,
      raised_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS service_charge_rates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT NOT NULL,
      charge_type VARCHAR(60) NOT NULL,
      label VARCHAR(100) DEFAULT NULL,
      billing_method ENUM('fixed','per_unit','percentage') DEFAULT 'fixed',
      amount DECIMAL(12,2) DEFAULT 0,
      is_active TINYINT(1) DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS deposit_refunds (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenancy_id INT NOT NULL,
      tenant_id INT DEFAULT NULL,
      gross_deposit DECIMAL(12,2) DEFAULT 0,
      deductions DECIMAL(12,2) DEFAULT 0,
      net_refund DECIMAL(12,2) DEFAULT 0,
      reason TEXT DEFAULT NULL,
      status ENUM('pending','approved','paid','rejected') DEFAULT 'pending',
      processed_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS owner_remittances (
      id INT AUTO_INCREMENT PRIMARY KEY,
      owner_id INT NOT NULL,
      property_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      period VARCHAR(7) NOT NULL,
      notes TEXT DEFAULT NULL,
      recorded_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS schedules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT DEFAULT NULL,
      unit_id INT DEFAULT NULL,
      assigned_to INT DEFAULT NULL,
      title VARCHAR(200) NOT NULL,
      description TEXT DEFAULT NULL,
      scheduled_date DATE NOT NULL,
      status ENUM('pending','in_progress','completed','skipped') DEFAULT 'pending',
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS import_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      import_type VARCHAR(60) DEFAULT NULL,
      total_rows INT DEFAULT 0,
      imported INT DEFAULT 0,
      skipped INT DEFAULT 0,
      errors INT DEFAULT 0,
      imported_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS vendor_invoices (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vendor_id INT NOT NULL,
      property_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      description TEXT DEFAULT NULL,
      invoice_ref VARCHAR(100) DEFAULT NULL,
      invoice_date DATE DEFAULT NULL,
      due_date DATE DEFAULT NULL,
      status ENUM('pending','approved','paid','rejected') DEFAULT 'pending',
      approved_by INT DEFAULT NULL,
      approved_at DATETIME DEFAULT NULL,
      payment_ref VARCHAR(100) DEFAULT NULL,
      paid_at DATETIME DEFAULT NULL,
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_vendor (vendor_id),
      INDEX idx_property (property_id),
      INDEX idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS visitor_blacklist (
      id INT AUTO_INCREMENT PRIMARY KEY,
      property_id INT DEFAULT NULL,
      name VARCHAR(150) DEFAULT NULL,
      id_number VARCHAR(30) DEFAULT NULL,
      phone VARCHAR(20) DEFAULT NULL,
      reason TEXT DEFAULT NULL,
      added_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS webhooks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      url VARCHAR(500) NOT NULL,
      secret VARCHAR(100) DEFAULT NULL,
      events JSON DEFAULT NULL,
      is_active TINYINT(1) DEFAULT 1,
      created_by INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS whatsapp_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT DEFAULT NULL,
      phone VARCHAR(20) NOT NULL,
      message_type VARCHAR(50) DEFAULT 'text',
      status ENUM('pending','sent','failed') DEFAULT 'pending',
      provider_ref VARCHAR(100) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  ];

  for (const sql of tbls) {
    await pool.query(sql).catch(e => {
      // errno 1067 = ER_INVALID_DEFAULT — MySQL strict mode rejects DATETIME DEFAULT NULL
      // even when CREATE TABLE IF NOT EXISTS is skipped because the table already exists.
      // This is harmless — the existing table schema is correct.
      if (e.errno !== 1067 && global.logger) {
        global.logger.warn('createCoreTables: ' + e.message.slice(0, 80));
      }
    });
  }

  // Default settings
  const defaults = [
    ['system_name','Smart Nyumba Pro'],['currency','KES'],['timezone','Africa/Nairobi'],
    ['auto_invoice_day','1'],['late_fees_enabled','0'],['late_fee_percent','5'],
    ['grace_period_days','5'],['mpesa_enabled','0'],['sms_enabled','0'],
    ['email_enabled','0'],['whatsapp_enabled','0'],
  ];
  for (const [k,v] of defaults) {
    await pool.query(
      'INSERT IGNORE INTO settings (setting_key,setting_value) VALUES (?,?)', [k,v]
    ).catch(()=>{});
  }

  // Create default super admin if no users exist
  try {
    const [[{cnt}]] = await pool.query('SELECT COUNT(*) AS cnt FROM users');
    if (cnt === 0) {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('Admin@1234', 12);
      await pool.query(
        "INSERT INTO users (full_name,email,phone,password_hash,role,is_active) VALUES (?,?,?,?,?,1)",
        ['System Administrator','admin@smartnyumba.com','0700000000',hash,'super_admin']
      );
      if (global.logger) global.logger.info('✅ Default admin created: admin@smartnyumba.com / Admin@1234');
    }
  } catch(e) { if (global.logger) global.logger.warn('createCoreTables admin: ' + e.message); }
}

'use strict';

/**
 * auto_migrate.js
 * Adds missing columns to the users table safely.
 * Compatible with MySQL 5.7+ and MySQL 8+.
 * Runs before the server starts accepting connections.
 */
async function runMigrations(pool) {
  await createCoreTables(pool);
  const log = (msg) => { if (global.logger) global.logger.info(msg); else console.log(msg); };
  const warn = (msg) => { if (global.logger) global.logger.warn(msg); else console.warn(msg); };

  // Columns to add to users table: [name, definition]
  const columnsToAdd = [
    ['id_number',         'VARCHAR(30) DEFAULT NULL'],
    ['id_type',           "VARCHAR(20) DEFAULT 'national_id'"],
    ['passport_number',   'VARCHAR(30) DEFAULT NULL'],
    ['emergency_contact', 'VARCHAR(100) DEFAULT NULL'],
    ['emergency_phone',   'VARCHAR(20) DEFAULT NULL'],
    ['vehicle_plate',     'VARCHAR(20) DEFAULT NULL'],
    ['mfa_enabled',       'TINYINT(1) DEFAULT 0'],
    ['is_suspended',      'TINYINT(1) DEFAULT 0'],
    ['suspend_reason',    'VARCHAR(255) DEFAULT NULL'],
    ['profile_photo',     'VARCHAR(500) DEFAULT NULL'],
  ];

  // Check which columns already exist
  let existingCols = [];
  try {
    const [rows] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
    );
    existingCols = rows.map(r => r.COLUMN_NAME.toLowerCase());
  } catch (e) {
    warn('auto_migrate: could not read column list: ' + e.message);
    return;
  }

  // Add only the missing columns one at a time
  let added = 0;
  for (const [colName, colDef] of columnsToAdd) {
    if (existingCols.includes(colName.toLowerCase())) continue;
    try {
      await pool.query('ALTER TABLE users ADD COLUMN ' + colName + ' ' + colDef);
      added++;
    } catch (e) {
      warn('auto_migrate: could not add column ' + colName + ': ' + e.message);
    }
  }

  if (added > 0) {
    log('✅ Auto-migration: added ' + added + ' column(s) to users table');

    // Backfill from tenants table
    try {
      await pool.query(
        `UPDATE users u JOIN tenants t ON t.user_id = u.id SET
           u.id_number         = COALESCE(u.id_number, t.id_number),
           u.passport_number   = COALESCE(u.passport_number, t.passport_number),
           u.emergency_contact = COALESCE(u.emergency_contact, t.emergency_contact),
           u.emergency_phone   = COALESCE(u.emergency_phone, t.emergency_phone)
         WHERE u.id IS NOT NULL`
      );
    } catch (e) {
      warn('auto_migrate: backfill warning: ' + e.message);
    }
  } else {
    log('✅ Auto-migration: users table already up to date');
  }
}

// ── Performance indexes (safe to run multiple times) ──────────
async function ensureIndexes(pool) {
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_ten_status   ON tenancies(status)",
    "CREATE INDEX IF NOT EXISTS idx_ten_tenant   ON tenancies(tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_inv_status   ON invoices(status)",
    "CREATE INDEX IF NOT EXISTS idx_inv_tenancy  ON invoices(tenancy_id)",
    "CREATE INDEX IF NOT EXISTS idx_inv_due      ON invoices(due_date)",
    "CREATE INDEX IF NOT EXISTS idx_pay_tenancy  ON payments(tenancy_id)",
    "CREATE INDEX IF NOT EXISTS idx_notif_user   ON notifications(user_id,is_read)",
    "CREATE INDEX IF NOT EXISTS idx_mr_property  ON maintenance_requests(property_id)",
    "CREATE INDEX IF NOT EXISTS idx_vis_checkin  ON visitors(check_in)",
    "CREATE INDEX IF NOT EXISTS idx_unit_prop    ON units(property_id)",
  ];
  for (const sql of indexes) {
    await pool.query(sql).catch(() => {}); // safe if already exists
  }
}

module.exports = {
  runMigrations: async (pool) => {
    await runMigrations(pool);
    await ensureIndexes(pool);
  }
};

// Add receipt_url to expenses table
async function migrateExpenses(pool) {
  const log  = (m) => { if (global.logger) global.logger.info(m); else console.log(m); };
  const warn = (m) => { if (global.logger) global.logger.warn(m); else console.warn(m); };
  try {
    const [rows] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='expenses'"
    );
    const cols = rows.map(r => r.COLUMN_NAME.toLowerCase());
    if (!cols.includes('receipt_url')) {
      await pool.query("ALTER TABLE expenses ADD COLUMN receipt_url VARCHAR(500) DEFAULT NULL");
      log('✅ Auto-migration: added receipt_url to expenses');
    }
  } catch (e) { warn('migrateExpenses: ' + e.message); }
}


// Migrate cron_logs — add error_message column if missing
async function migrateCronLogs(pool) {
  const warn = (m) => { if (global.logger) global.logger.warn(m); else console.warn(m); };
  try {
    const [rows] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cron_logs'"
    );
    const cols = rows.map(r => r.COLUMN_NAME.toLowerCase());
    if (!cols.includes('error_message')) {
      await pool.query("ALTER TABLE cron_logs ADD COLUMN error_message TEXT DEFAULT NULL");
    }
    if (!cols.includes('rows_affected')) {
      await pool.query("ALTER TABLE cron_logs ADD COLUMN rows_affected INT DEFAULT 0");
    }
    if (!cols.includes('note')) {
      await pool.query("ALTER TABLE cron_logs ADD COLUMN note VARCHAR(500) DEFAULT NULL");
    }
  } catch (e) { warn('migrateCronLogs: ' + e.message); }
}

// Migrate mpesa_transactions — ensure created_at exists
async function migrateMpesa(pool) {
  const warn = (m) => { if (global.logger) global.logger.warn(m); else console.warn(m); };
  try {
    const [rows] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mpesa_transactions'"
    );
    if (!rows.length) return; // table doesn't exist yet
    const cols = rows.map(r => r.COLUMN_NAME.toLowerCase());
    if (!cols.includes('created_at')) {
      await pool.query("ALTER TABLE mpesa_transactions ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP");
    }
  } catch (e) { warn('migrateMpesa: ' + e.message); }
}


// Migrate visitors table — add expected_date and registered_by if missing
async function migrateVisitors(pool) {
  const warn = (m) => { if (global.logger) global.logger.warn(m); else console.warn(m); };
  try {
    // Check if table exists first
    const [tbls] = await pool.query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='visitors'"
    );
    if (!tbls.length) return; // table doesn't exist yet — will be created by full DB setup
    const [rows] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='visitors'"
    );
    if (!rows.length) return; // table doesn't exist yet
    const cols = rows.map(r => r.COLUMN_NAME.toLowerCase());
    if (!cols.includes('expected_date')) {
      await pool.query("ALTER TABLE visitors ADD COLUMN expected_date DATE DEFAULT NULL");
    }
    if (!cols.includes('registered_by')) {
      await pool.query("ALTER TABLE visitors ADD COLUMN registered_by INT DEFAULT NULL");
    }
    if (!cols.includes('status')) {
      try {
        await pool.query("ALTER TABLE visitors ADD COLUMN status ENUM('checked_in','checked_out','pre_registered') DEFAULT 'checked_in'");
      } catch (_) {}
    } else {
      // Try to ensure pre_registered is in the ENUM (safe, non-fatal)
      try {
        await pool.query("ALTER TABLE visitors MODIFY COLUMN status ENUM('checked_in','checked_out','pre_registered') DEFAULT 'checked_in'");
      } catch (_) {}
    }
  } catch (e) { warn('migrateVisitors: ' + e.message); }
}

const _origRun = module.exports.runMigrations;
module.exports.runMigrations = async (pool) => {
  await _origRun(pool);
  await migrateExpenses(pool);
  await migrateCronLogs(pool);
  await migrateMpesa(pool);
  await migrateVisitors(pool);
};

// Audit log table
const _origRun2 = module.exports.runMigrations;
module.exports.runMigrations = async (pool) => {
  await _origRun2(pool);
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        user_name VARCHAR(100),
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50),
        entity_id INT,
        details TEXT,
        ip_address VARCHAR(45),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user (user_id),
        INDEX idx_entity (entity_type, entity_id),
        INDEX idx_created (created_at)
      )`);
  } catch (_) {}
};

// Migrate tenancies — add new columns from enhanced controller
async function migrateTenancies(pool) {
  const warn = m => { if (global.logger) global.logger.warn(m); else console.warn(m); };
  try {
    const [rows] = await pool.query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tenancies'"
    );
    if (!rows.length) return;
    const cols = rows.map(r => r.COLUMN_NAME.toLowerCase());
    const toAdd = [
      ['payment_plan',       "VARCHAR(20) DEFAULT 'monthly'"],
      ['grace_period_days',  'TINYINT DEFAULT NULL'],
      ['penalty_rate',       'DECIMAL(5,2) DEFAULT NULL'],
      ['move_in_checklist',  'JSON DEFAULT NULL'],
      ['lease_document',     'VARCHAR(500) DEFAULT NULL'],
    ];
    for (const [col, def] of toAdd) {
      if (!cols.includes(col)) {
        await pool.query(`ALTER TABLE tenancies ADD COLUMN ${col} ${def}`).catch(e => warn('migrateTenancies ' + col + ': ' + e.message));
      }
    }
  } catch(e) { warn('migrateTenancies: ' + e.message); }
}


const _origRunT = module.exports.runMigrations;
module.exports.runMigrations = async (pool) => {
  await _origRunT(pool);
  await migrateTenancies(pool);
  // ── Run numbered SaaS migrations (006-009+) ─────────────────────────
  // migrate_runner tracks applied migrations in _migrations table,
  // so each file runs exactly once even across restarts.
  try {
    const runner = require('./migrate_runner');
    await runner.runAll(pool);
  } catch(e) {
    const warn = global.logger?.warn?.bind(global.logger) || console.warn;
    warn('SaaS migration runner error: ' + e.message);
  }
};
