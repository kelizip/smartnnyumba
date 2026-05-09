module.exports = {
  up: async (db) => {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_reason VARCHAR(255) NULL`);
  }
};