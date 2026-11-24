/**
 * Lightweight schema guard for local/demo deployments.
 * Keeps an existing V1 database compatible with TalentMate V2 additions.
 */
async function ensureSchema(pool) {
  await addColumnIfMissing(pool, 'events', 'contact_id', 'INT DEFAULT NULL');
  await addColumnIfMissing(pool, 'events', 'event_type', "VARCHAR(40) DEFAULT 'general'");
  await addColumnIfMissing(pool, 'events', 'mail_status', "VARCHAR(30) DEFAULT 'none'");
  await addColumnIfMissing(pool, 'events', 'mail_subject', 'VARCHAR(200) DEFAULT NULL');
  await addColumnIfMissing(pool, 'events', 'mail_body_override', 'TEXT DEFAULT NULL');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id            INT          PRIMARY KEY AUTO_INCREMENT,
      user_id       INT          NOT NULL,
      name          VARCHAR(80)  NOT NULL,
      email         VARCHAR(120) DEFAULT NULL,
      phone         VARCHAR(40)  DEFAULT NULL,
      contact_type  VARCHAR(30)  DEFAULT 'friend',
      department    VARCHAR(80)  DEFAULT NULL,
      role          VARCHAR(120) DEFAULT NULL,
      birthday      DATE         DEFAULT NULL,
      onboard_date  DATE         DEFAULT NULL,
      avatar_color  VARCHAR(20)  DEFAULT '#1677FF',
      care_level    VARCHAR(20)  DEFAULT 'normal',
      care_warn_days   INT DEFAULT NULL,
      care_danger_days INT DEFAULT NULL,
      notes         TEXT         DEFAULT NULL,
      created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_contacts_user_name (user_id, name),
      INDEX idx_contacts_type (user_id, contact_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  // Existing DBs may miss care_* / phone columns if only ensureSchema ran before
  await addColumnIfMissing(pool, 'contacts', 'phone', 'VARCHAR(40) DEFAULT NULL');
  await addColumnIfMissing(pool, 'contacts', 'care_level', "VARCHAR(20) DEFAULT 'normal'");
  await addColumnIfMissing(pool, 'contacts', 'care_warn_days', 'INT DEFAULT NULL');
  await addColumnIfMissing(pool, 'contacts', 'care_danger_days', 'INT DEFAULT NULL');

  // Migrate legacy workplace contact types to personal circles
  await pool.query(`UPDATE contacts SET contact_type = 'friend' WHERE contact_type = 'employee'`);
  await pool.query(`UPDATE contacts SET contact_type = 'acquaintance' WHERE contact_type = 'candidate'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS interaction_logs (
      id          INT          PRIMARY KEY AUTO_INCREMENT,
      user_id     INT          NOT NULL,
      contact_id  INT          DEFAULT NULL,
      event_id    INT          DEFAULT NULL,
      action_type VARCHAR(40)  NOT NULL,
      title       VARCHAR(200) NOT NULL,
      detail      TEXT         DEFAULT NULL,
      occurred_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_logs_user_contact (user_id, contact_id, occurred_at),
      INDEX idx_logs_event (event_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function addColumnIfMissing(pool, table, column, definition) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (rows.length === 0) {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

module.exports = { ensureSchema };
