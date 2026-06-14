const path = require('path');
const fs = require('fs');

function runMigrations(db) {
  const migrationsDir = __dirname;
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.match(/^\d+_.*\.js$/))
    .sort();

  for (const file of files) {
    const migration = require(path.join(migrationsDir, file));
    if (typeof migration.up === 'function') {
      console.log(`Running migration: ${file}`);
      migration.up(db);
    }
  }
}

module.exports = { runMigrations };
