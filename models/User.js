const { run, get, all } = require('../db');
const bcrypt = require('bcryptjs');

class User {
  static create(username, password, role = 'user') {
    const hash = bcrypt.hashSync(password, 10);
    const result = run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      [username, hash, role]
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    return get('SELECT id, username, role, created_at FROM users WHERE id = ?', [id]);
  }

  static findByUsername(username) {
    return get('SELECT * FROM users WHERE username = ?', [username]);
  }

  static findAll() {
    return all('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');
  }

  static update(id, updates) {
    const fields = [];
    const params = [];
    
    if (updates.username !== undefined) {
      fields.push('username = ?');
      params.push(updates.username);
    }
    if (updates.password !== undefined) {
      fields.push('password_hash = ?');
      params.push(bcrypt.hashSync(updates.password, 10));
    }
    if (updates.role !== undefined) {
      fields.push('role = ?');
      params.push(updates.role);
    }
    
    params.push(id);
    
    run(`UPDATE users SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, params);
    return this.findById(id);
  }

  static delete(id) {
    return run('DELETE FROM users WHERE id = ?', [id]);
  }

  static verifyPassword(user, password) {
    return bcrypt.compareSync(password, user.password_hash);
  }
}

module.exports = User;
