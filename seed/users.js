const bcrypt = require('bcryptjs');
const { get } = require('../db');

function up(db) {
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin').count;
  if (adminCount === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
    
    const userHash = bcrypt.hashSync('user123', 10);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('user1', userHash, 'user');
    
    const userHash2 = bcrypt.hashSync('user456', 10);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('user2', userHash2, 'user');
    
    console.log('Seeded default users: admin, user1, user2');
  }
}

module.exports = { up };
