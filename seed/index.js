const path = require('path');
const fs = require('fs');

function runSeeds(db) {
  const seedsDir = __dirname;
  const files = fs.readdirSync(seedsDir)
    .filter(f => f.match(/^.*\.js$/) && f !== 'index.js')
    .sort();

  for (const file of files) {
    const seed = require(path.join(seedsDir, file));
    if (typeof seed.up === 'function') {
      console.log(`Running seed: ${file}`);
      seed.up(db);
    }
  }
}

module.exports = { runSeeds };
