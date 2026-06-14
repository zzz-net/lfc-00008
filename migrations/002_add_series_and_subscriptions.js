function up(db) {
  const pragma = db.prepare("PRAGMA table_info(reservations)").all();
  const hasSeriesId = pragma.some(col => col.name === 'series_id');
  if (!hasSeriesId) {
    db.exec(`ALTER TABLE reservations ADD COLUMN series_id TEXT`);
    console.log('Added series_id column to reservations table');
  }

  const idxExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_reservations_series'"
  ).get();
  if (!idxExists) {
    db.exec(`CREATE INDEX idx_reservations_series ON reservations(series_id)`);
    console.log('Added idx_reservations_series index');
  }

  const subTableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='calendar_subscriptions'"
  ).get();
  if (!subTableExists) {
    db.exec(`
      CREATE TABLE calendar_subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        revoked_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX idx_cal_sub_token ON calendar_subscriptions(token);
      CREATE INDEX idx_cal_sub_user ON calendar_subscriptions(user_id);
    `);
    console.log('Created calendar_subscriptions table');
  }

  const templateTableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='reservation_templates'"
  ).get();
  if (!templateTableExists) {
    db.exec(`
      CREATE TABLE reservation_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        tags TEXT,
        room_id INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        day_of_week INTEGER,
        purpose TEXT,
        attendees INTEGER,
        config TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        UNIQUE(user_id, name)
      );
      CREATE INDEX idx_templates_user ON reservation_templates(user_id);
      CREATE INDEX idx_templates_room ON reservation_templates(room_id);
    `);
    console.log('Created reservation_templates table');
  }
}

module.exports = { up };
