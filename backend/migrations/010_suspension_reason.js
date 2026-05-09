module.exports = {
  up: async (db) => {
    const [cols] = await db.query(`SHOW COLUMNS FROM users LIKE 'suspension_reason'`);
    if (cols.length === 0) {
      await db.query(`ALTER TABLE users ADD COLUMN suspension_reason VARCHAR(255) NULL`);
    }
  }
};