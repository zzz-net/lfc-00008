const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'booking.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrateColumns() {
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
}

function initDatabase() {
  try {
    migrateColumns();
  } catch (err) {
    console.error('Column migration failed:', err);
    throw err;
  }

  const migrate = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        capacity INTEGER,
        location TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS time_slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        day_of_week INTEGER,
        is_recurring INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
        UNIQUE(room_id, start_time, end_time, day_of_week)
      );

      CREATE TABLE IF NOT EXISTS blacklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        reason TEXT,
        start_date DATE NOT NULL,
        end_date DATE,
        is_permanent INTEGER DEFAULT 0,
        created_by INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (created_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS approval_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_name TEXT UNIQUE NOT NULL,
        rule_type TEXT NOT NULL,
        config TEXT,
        is_enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        start_datetime DATETIME NOT NULL,
        end_datetime DATETIME NOT NULL,
        purpose TEXT,
        attendees INTEGER,
        series_id TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        approved_by INTEGER,
        approved_at DATETIME,
        checkin_at DATETIME,
        canceled_at DATETIME,
        canceled_by INTEGER,
        expire_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_id) REFERENCES rooms(id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (approved_by) REFERENCES users(id),
        FOREIGN KEY (canceled_by) REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reservation_id INTEGER,
        user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        old_status TEXT,
        new_status TEXT,
        details TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reservation_id) REFERENCES reservations(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      CREATE INDEX IF NOT EXISTS idx_reservations_room_time ON reservations(room_id, start_datetime, end_datetime);
      CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id);
      CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
      CREATE INDEX IF NOT EXISTS idx_reservations_series ON reservations(series_id);
      CREATE INDEX IF NOT EXISTS idx_audit_reservation ON audit_logs(reservation_id);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
    `);

    const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin').count;
    if (adminCount === 0) {
      const hash = bcrypt.hashSync('admin123', 10);
      db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
      
      const userHash = bcrypt.hashSync('user123', 10);
      db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('user1', userHash, 'user');
      
      const userHash2 = bcrypt.hashSync('user456', 10);
      db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('user2', userHash2, 'user');
    }

    const ruleCount = db.prepare('SELECT COUNT(*) as count FROM approval_rules').get().count;
    if (ruleCount === 0) {
      db.prepare(`INSERT INTO approval_rules (rule_name, rule_type, config) VALUES (?, ?, ?)`).run(
        'default_auto_approval',
        'auto_approval',
        JSON.stringify({ enabled: false, max_hours: 2 })
      );
    }
  });

  try {
    migrate();
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Database initialization failed:', err);
    throw err;
  }
}

function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

function prepare(sql) {
  return db.prepare(sql);
}

function transaction(fn) {
  return db.transaction(fn);
}

module.exports = {
  db,
  initDatabase,
  run,
  get,
  all,
  prepare,
  transaction
};
