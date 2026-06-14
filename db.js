const Database = require('better-sqlite3');
const path = require('path');
const { runMigrations } = require('./migrations');
const { runSeeds } = require('./seed');

const dbPath = path.join(__dirname, 'booking.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  try {
    runMigrations(db);
    const tx = db.transaction(() => {
      runSeeds(db);
    });
    tx();
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
