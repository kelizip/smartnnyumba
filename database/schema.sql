-- ============================================================
-- SMART NYUMBA PRO — Complete Database Schema
-- Commercial Grade | Based on SILQU Proposal
-- ============================================================

CREATE DATABASE IF NOT EXISTS smartnyumba CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE smartnyumba;

-- ── USERS & AUTH ─────────────────────────────────────────────
CREATE TABLE users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(150) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  phone         VARCHAR(20)  DEFAULT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('super_admin','property_manager','tenant','caretaker','security') NOT NULL,
  avatar_url    VARCHAR(300) DEFAULT NULL,
  is_active     TINYINT(1)   DEFAULT 1,
  last_login    TIMESTAMP    NULL DEFAULT NULL,
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_role  (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE refresh_tokens (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  token      VARCHAR(512) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE password_resets (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  token      VARCHAR(255) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used       TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ── PROPERTIES & UNITS ───────────────────────────────────────
CREATE TABLE properties (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  location    VARCHAR(255) DEFAULT NULL,
  address     TEXT         DEFAULT NULL,
  description TEXT         DEFAULT NULL,
  manager_id  INT          DEFAULT NULL COMMENT 'property_manager user id',
  logo_url    VARCHAR(300) DEFAULT NULL,
  is_active   TINYINT(1)   DEFAULT 1,
  created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_manager (manager_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE units (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  property_id    INT NOT NULL,
  unit_number    VARCHAR(50) NOT NULL,
  floor          INT         DEFAULT 1,
  type           ENUM('single','bedsitter','one_bedroom','two_bedroom','three_bedroom','studio','penthouse','shop','office') DEFAULT 'one_bedroom',
  rent_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  deposit_amount DECIMAL(12,2) DEFAULT 0,
  status         ENUM('occupied','vacant','reserved','under_maintenance') DEFAULT 'vacant',
  description    TEXT DEFAULT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_unit (property_id, unit_number),
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE,
  INDEX idx_property (property_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── TENANCIES ────────────────────────────────────────────────
CREATE TABLE tenants (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  user_id           INT NOT NULL UNIQUE,
  id_number         VARCHAR(50)  DEFAULT NULL,
  emergency_contact VARCHAR(150) DEFAULT NULL,
  emergency_phone   VARCHAR(20)  DEFAULT NULL,
  vehicle_plate     VARCHAR(20)  DEFAULT NULL,
  created_at        TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tenancies (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id    INT NOT NULL,
  unit_id      INT NOT NULL,
  start_date   DATE NOT NULL,
  end_date     DATE DEFAULT NULL,
  rent_amount  DECIMAL(12,2) NOT NULL,
  deposit      DECIMAL(12,2) DEFAULT 0,
  status       ENUM('active','terminated','expired','notice_given') DEFAULT 'active',
  notes        TEXT DEFAULT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (unit_id) REFERENCES units(id),
  INDEX idx_tenant (tenant_id),
  INDEX idx_unit   (unit_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── BILLING & INVOICES ───────────────────────────────────────
CREATE TABLE invoices (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tenancy_id  INT NOT NULL,
  type        ENUM('rent','water','electricity','service_charge','garbage','parking','penalty','deposit','other') NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  balance     DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'remaining unpaid amount',
  due_date    DATE NOT NULL,
  status      ENUM('unpaid','paid','partial','overdue','cancelled','waived') DEFAULT 'unpaid',
  notes       TEXT DEFAULT NULL,
  month_year  VARCHAR(7)   DEFAULT NULL COMMENT 'YYYY-MM for dedup',
  created_by  INT DEFAULT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenancy_id) REFERENCES tenancies(id),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_tenancy (tenancy_id),
  INDEX idx_status  (status),
  INDEX idx_due     (due_date),
  INDEX idx_month   (tenancy_id, type, month_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE payments (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id       INT NOT NULL,
  tenancy_id       INT NOT NULL,
  amount           DECIMAL(12,2) NOT NULL,
  payment_method   ENUM('mpesa','bank','cash','cheque','wallet') NOT NULL,
  transaction_code VARCHAR(100) DEFAULT NULL,
  mpesa_phone      VARCHAR(20)  DEFAULT NULL,
  reference        VARCHAR(200) DEFAULT NULL,
  notes            TEXT DEFAULT NULL,
  recorded_by      INT DEFAULT NULL,
  is_reversed      TINYINT(1) DEFAULT 0,
  reversed_at      TIMESTAMP NULL DEFAULT NULL,
  paid_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id)   REFERENCES invoices(id),
  FOREIGN KEY (tenancy_id)   REFERENCES tenancies(id),
  FOREIGN KEY (recorded_by)  REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_invoice  (invoice_id),
  INDEX idx_tenancy  (tenancy_id),
  INDEX idx_paid_at  (paid_at),
  INDEX idx_txn_code (transaction_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE receipts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  payment_id     INT NOT NULL UNIQUE,
  receipt_number VARCHAR(50) NOT NULL UNIQUE,
  issued_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_id) REFERENCES payments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tenant_ledger (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tenancy_id  INT NOT NULL,
  type        ENUM('debit','credit') NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  balance     DECIMAL(12,2) DEFAULT 0 COMMENT 'running balance',
  description VARCHAR(255) DEFAULT NULL,
  ref_type    VARCHAR(50)  DEFAULT NULL,
  ref_id      INT DEFAULT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenancy_id) REFERENCES tenancies(id),
  INDEX idx_tenancy (tenancy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── M-PESA ───────────────────────────────────────────────────
CREATE TABLE mpesa_transactions (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  checkout_request_id VARCHAR(100) UNIQUE,
  merchant_request_id VARCHAR(100),
  invoice_id          INT DEFAULT NULL,
  tenancy_id          INT DEFAULT NULL,
  phone               VARCHAR(20) NOT NULL,
  amount              DECIMAL(12,2) NOT NULL,
  transaction_code    VARCHAR(100) DEFAULT NULL UNIQUE,
  result_code         INT DEFAULT NULL,
  result_desc         VARCHAR(255) DEFAULT NULL,
  status              ENUM('pending','completed','failed','cancelled','timeout') DEFAULT 'pending',
  raw_callback        MEDIUMTEXT DEFAULT NULL,
  initiated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at        TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  INDEX idx_checkout (checkout_request_id),
  INDEX idx_status   (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── EXPENSES ─────────────────────────────────────────────────
CREATE TABLE expenses (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  property_id  INT NOT NULL,
  title        VARCHAR(200) NOT NULL,
  description  TEXT DEFAULT NULL,
  amount       DECIMAL(12,2) NOT NULL,
  category     ENUM('repairs','plumbing','electrical','cleaning','security','landscaping','utilities','admin','salaries','insurance','other') DEFAULT 'other',
  vendor       VARCHAR(150) DEFAULT NULL,
  receipt_ref  VARCHAR(100) DEFAULT NULL,
  expense_date DATE NOT NULL,
  created_by   INT NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (created_by)  REFERENCES users(id),
  INDEX idx_property (property_id),
  INDEX idx_date (expense_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── SERVICE CHARGES ───────────────────────────────────────────
CREATE TABLE service_charge_configs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  property_id INT NOT NULL,
  name        VARCHAR(100) NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  frequency   ENUM('monthly','quarterly','annually','once') DEFAULT 'monthly',
  is_active   TINYINT(1) DEFAULT 1,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── UTILITY READINGS ──────────────────────────────────────────
CREATE TABLE utility_readings (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  unit_id          INT NOT NULL,
  utility_type     ENUM('water','electricity','gas') NOT NULL,
  previous_reading DECIMAL(10,2) DEFAULT 0,
  current_reading  DECIMAL(10,2) NOT NULL,
  units_consumed   DECIMAL(10,2) GENERATED ALWAYS AS (current_reading - previous_reading) STORED,
  rate_per_unit    DECIMAL(8,2) NOT NULL,
  amount           DECIMAL(12,2) GENERATED ALWAYS AS ((current_reading - previous_reading) * rate_per_unit) STORED,
  reading_date     DATE NOT NULL,
  read_by          INT NOT NULL,
  invoice_id       INT DEFAULT NULL,
  image_url        VARCHAR(300) DEFAULT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (unit_id)    REFERENCES units(id),
  FOREIGN KEY (read_by)    REFERENCES users(id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL,
  INDEX idx_unit (unit_id),
  INDEX idx_date (reading_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── LATE FEES ─────────────────────────────────────────────────
CREATE TABLE late_fee_rules (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  property_id       INT DEFAULT NULL COMMENT 'NULL = global',
  grace_period_days INT DEFAULT 5,
  fee_type          ENUM('percentage','fixed') DEFAULT 'percentage',
  fee_value         DECIMAL(8,2) DEFAULT 5.00,
  max_fee           DECIMAL(12,2) DEFAULT NULL,
  is_active         TINYINT(1) DEFAULT 1,
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── MAINTENANCE ───────────────────────────────────────────────
CREATE TABLE maintenance_requests (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tenancy_id  INT DEFAULT NULL,
  unit_id     INT NOT NULL,
  property_id INT NOT NULL,
  title       VARCHAR(200) NOT NULL,
  description TEXT DEFAULT NULL,
  category    ENUM('plumbing','electrical','structural','appliance','pest','cleaning','security','other') DEFAULT 'other',
  priority    ENUM('low','normal','urgent','emergency') DEFAULT 'normal',
  status      ENUM('open','assigned','in_progress','completed','cancelled') DEFAULT 'open',
  assigned_to INT DEFAULT NULL,
  cost        DECIMAL(12,2) DEFAULT NULL,
  resolved_at TIMESTAMP NULL DEFAULT NULL,
  images      TEXT DEFAULT NULL COMMENT 'JSON array of image URLs',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (unit_id)     REFERENCES units(id),
  FOREIGN KEY (property_id) REFERENCES properties(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_status   (status),
  INDEX idx_priority (priority),
  INDEX idx_assigned (assigned_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE maintenance_updates (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  request_id INT NOT NULL,
  user_id    INT NOT NULL,
  note       TEXT NOT NULL,
  status     ENUM('open','assigned','in_progress','completed','cancelled') DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── STAFF TASKS ───────────────────────────────────────────────
CREATE TABLE staff_tasks (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  assigned_to  INT NOT NULL,
  assigned_by  INT NOT NULL,
  property_id  INT DEFAULT NULL,
  unit_id      INT DEFAULT NULL,
  title        VARCHAR(200) NOT NULL,
  description  TEXT DEFAULT NULL,
  priority     ENUM('low','normal','urgent','emergency') DEFAULT 'normal',
  status       ENUM('pending','in_progress','completed','cancelled') DEFAULT 'pending',
  due_date     DATE DEFAULT NULL,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  notes        TEXT DEFAULT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id),
  INDEX idx_assigned (assigned_to),
  INDEX idx_status   (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── VISITORS ──────────────────────────────────────────────────
CREATE TABLE visitors (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  property_id      INT NOT NULL,
  unit_id          INT DEFAULT NULL,
  tenancy_id       INT DEFAULT NULL,
  name             VARCHAR(150) NOT NULL,
  phone            VARCHAR(20)  DEFAULT NULL,
  id_number        VARCHAR(50)  DEFAULT NULL,
  vehicle_plate    VARCHAR(20)  DEFAULT NULL,
  purpose          VARCHAR(255) DEFAULT NULL,
  host_name        VARCHAR(150) DEFAULT NULL,
  checked_in_by    INT DEFAULT NULL,
  checked_out_by   INT DEFAULT NULL,
  check_in         TIMESTAMP NULL DEFAULT NULL,
  check_out        TIMESTAMP NULL DEFAULT NULL,
  expected_out     TIMESTAMP NULL DEFAULT NULL,
  status           ENUM('pre_registered','checked_in','checked_out') DEFAULT 'checked_in',
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (property_id)   REFERENCES properties(id),
  FOREIGN KEY (unit_id)       REFERENCES units(id) ON DELETE SET NULL,
  FOREIGN KEY (checked_in_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_property (property_id),
  INDEX idx_status   (status),
  INDEX idx_checkin  (check_in)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── PARKING ───────────────────────────────────────────────────
CREATE TABLE parking_slots (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  property_id INT NOT NULL,
  slot_number VARCHAR(20) NOT NULL,
  type        ENUM('resident','visitor','reserved','disabled') DEFAULT 'resident',
  status      ENUM('vacant','occupied','reserved','blocked') DEFAULT 'vacant',
  notes       VARCHAR(255) DEFAULT NULL,
  UNIQUE KEY uq_slot (property_id, slot_number),
  FOREIGN KEY (property_id) REFERENCES properties(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE parking_allocations (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  slot_id        INT NOT NULL,
  tenancy_id     INT NOT NULL,
  vehicle_plate  VARCHAR(20) DEFAULT NULL,
  vehicle_make   VARCHAR(100) DEFAULT NULL,
  assigned_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  released_at    TIMESTAMP NULL DEFAULT NULL,
  is_active      TINYINT(1) DEFAULT 1,
  FOREIGN KEY (slot_id)    REFERENCES parking_slots(id),
  FOREIGN KEY (tenancy_id) REFERENCES tenancies(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── COMMUNICATION ─────────────────────────────────────────────
CREATE TABLE announcements (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  property_id INT DEFAULT NULL COMMENT 'NULL = all properties',
  title       VARCHAR(200) NOT NULL,
  message     TEXT NOT NULL,
  priority    ENUM('normal','important','urgent') DEFAULT 'normal',
  expires_at  TIMESTAMP NULL DEFAULT NULL,
  created_by  INT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_property (property_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  type       VARCHAR(50) DEFAULT 'general',
  title      VARCHAR(200) DEFAULT NULL,
  message    TEXT NOT NULL,
  action_url VARCHAR(300) DEFAULT NULL,
  is_read    TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user   (user_id),
  INDEX idx_unread (user_id, is_read)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sms_logs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT DEFAULT NULL,
  phone        VARCHAR(20) NOT NULL,
  message      TEXT NOT NULL,
  type         ENUM('payment_reminder','receipt','maintenance','announcement','welcome','otp','custom') DEFAULT 'custom',
  status       ENUM('pending','sent','failed') DEFAULT 'pending',
  provider_ref VARCHAR(100) DEFAULT NULL,
  cost         DECIMAL(8,4) DEFAULT NULL,
  sent_at      TIMESTAMP NULL DEFAULT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_phone  (phone),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── VACATE NOTICES ────────────────────────────────────────────
CREATE TABLE vacate_notices (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  tenancy_id       INT NOT NULL,
  notice_date      DATE NOT NULL,
  vacate_date      DATE NOT NULL,
  reason           TEXT DEFAULT NULL,
  status           ENUM('pending','acknowledged','processed','cancelled') DEFAULT 'pending',
  acknowledged_by  INT DEFAULT NULL,
  processed_at     TIMESTAMP NULL DEFAULT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenancy_id)      REFERENCES tenancies(id),
  FOREIGN KEY (acknowledged_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── SYSTEM ────────────────────────────────────────────────────
CREATE TABLE audit_logs (
  id         BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT DEFAULT NULL,
  action     VARCHAR(100) NOT NULL,
  entity     VARCHAR(100) DEFAULT NULL,
  entity_id  INT DEFAULT NULL,
  details    TEXT DEFAULT NULL,
  ip_address VARCHAR(45) DEFAULT NULL,
  user_agent VARCHAR(300) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user   (user_id),
  INDEX idx_entity (entity, entity_id),
  INDEX idx_action (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE system_alerts (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  property_id INT DEFAULT NULL,
  title       VARCHAR(200) NOT NULL,
  message     TEXT NOT NULL,
  severity    ENUM('info','warning','critical') DEFAULT 'info',
  raised_by   INT DEFAULT NULL,
  is_resolved TINYINT(1) DEFAULT 0,
  resolved_at TIMESTAMP NULL DEFAULT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (raised_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE settings (
  setting_key   VARCHAR(100) PRIMARY KEY,
  setting_value TEXT DEFAULT NULL,
  description   VARCHAR(255) DEFAULT NULL,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE cron_logs (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  job_name          VARCHAR(100) NOT NULL,
  status            ENUM('running','success','failed') DEFAULT 'running',
  records_processed INT DEFAULT 0,
  message           TEXT DEFAULT NULL,
  started_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at       TIMESTAMP NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── DEFAULT DATA ──────────────────────────────────────────────
INSERT INTO settings (setting_key, setting_value, description) VALUES
('system_name',        'Smart Nyumba RMS',           'Application name'),
('currency',           'KES',                         'Default currency'),
('mpesa_enabled',      '0',                           'Enable M-Pesa payments'),
('sms_enabled',        '0',                           'Enable SMS notifications'),
('late_fees_enabled',  '1',                           'Enable automatic late fees'),
('grace_period_days',  '5',                           'Days after due date before late fee'),
('late_fee_percent',   '5',                           'Late fee percentage'),
('auto_invoice_day',   '1',                           'Day of month to auto-generate invoices'),
('water_rate',         '80',                          'KES per unit for water'),
('electricity_rate',   '25',                          'KES per unit for electricity'),
('cron_secret',        'snp_cron_2024_change_me',     'Cron job secret key'),
('smtp_enabled',       '0',                           'Enable email notifications'),
('system_version',     '1.0.0',                       'Current version');

INSERT INTO late_fee_rules (grace_period_days, fee_type, fee_value) VALUES (5, 'percentage', 5.00);

SELECT 'Smart Nyumba RMS schema created successfully!' AS status;
