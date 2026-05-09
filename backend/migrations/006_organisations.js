'use strict';
module.exports = {
  name: '006_organisations',
  async up(pool) {
    const conn = await pool.getConnection();
    await conn.beginTransaction();
    try {
      await conn.query(`
        CREATE TABLE IF NOT EXISTS organisations (
          id              INT AUTO_INCREMENT PRIMARY KEY,
          slug            VARCHAR(80) UNIQUE NOT NULL,
          name            VARCHAR(200) NOT NULL,
          plan            ENUM('starter','professional','enterprise') DEFAULT 'starter',
          plan_expires_at DATETIME,
          max_units       INT DEFAULT 50,
          max_users       INT DEFAULT 10,
          max_properties  INT DEFAULT 3,
          is_active       TINYINT DEFAULT 1,
          owner_user_id   INT,
          billing_email   VARCHAR(200),
          timezone        VARCHAR(60) DEFAULT 'Africa/Nairobi',
          currency        CHAR(3) DEFAULT 'KES',
          logo_url        VARCHAR(500),
          primary_colour  VARCHAR(7) DEFAULT '#5b7fff',
          custom_domain   VARCHAR(200),
          created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_org_slug (slug),
          INDEX idx_org_domain (custom_domain)
        ) ENGINE=InnoDB`);

      const [[existingOrg]] = await conn.query('SELECT id FROM organisations WHERE id=1');
      if (!existingOrg) {
        await conn.query(`INSERT INTO organisations
          (id,slug,name,plan,plan_expires_at,max_units,max_users,max_properties)
          VALUES (1,'default','SmartNyumba Default','enterprise','2099-12-31',99999,9999,9999)`);
      }

      const tables = [
        'users','properties','units','tenants','tenancies',
        'invoices','payments','receipts','expenses','maintenance_requests',
        'visitors','announcements','messages','notifications','cases',
        'documents','inspections','vacate_notices','vendors','vendor_invoices',
        'access_log','audit_log','settings','webhooks','cron_logs',
        'parking_slots','parking_allocations',
      ];

      const [cols] = await conn.query(
        "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='org_id'");
      const hasOrgId = new Set(cols.map(c => c.TABLE_NAME));

      for (const t of tables) {
        if (hasOrgId.has(t)) continue;
        const [[ex]] = await conn.query(
          'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[t]);
        if (!ex) continue;
        await conn.query(`ALTER TABLE ${t} ADD COLUMN org_id INT NOT NULL DEFAULT 1`).catch(()=>{});
        await conn.query(`ALTER TABLE ${t} ADD INDEX idx_${t}_org (org_id)`).catch(()=>{});
      }
      await conn.commit();
    } catch(e) { await conn.rollback(); throw e; }
    finally { conn.release(); }
  },
};
