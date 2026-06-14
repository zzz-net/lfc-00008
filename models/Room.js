const { run, get, all } = require('../db');

class Room {
  static create(data) {
    const { name, description, capacity, location, status = 'active' } = data;
    const result = run(
      'INSERT INTO rooms (name, description, capacity, location, status) VALUES (?, ?, ?, ?, ?)',
      [name, description || null, capacity || null, location || null, status]
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    return get('SELECT * FROM rooms WHERE id = ?', [id]);
  }

  static findAll(filters = {}) {
    let sql = 'SELECT * FROM rooms WHERE 1=1';
    const params = [];
    
    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }
    
    sql += ' ORDER BY created_at DESC';
    return all(sql, params);
  }

  static findByName(name) {
    return get('SELECT * FROM rooms WHERE name = ?', [name]);
  }

  static update(id, updates) {
    run(
      `UPDATE rooms 
       SET name = COALESCE(?, name),
           description = COALESCE(?, description),
           capacity = COALESCE(?, capacity),
           location = COALESCE(?, location),
           status = COALESCE(?, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [updates.name, updates.description, updates.capacity, updates.location, updates.status, id]
    );
    return this.findById(id);
  }

  static delete(id) {
    return run('DELETE FROM rooms WHERE id = ?', [id]);
  }

  static hasActiveReservations(id) {
    const result = get(
      `SELECT COUNT(*) as count FROM reservations 
       WHERE room_id = ? AND status IN ('pending', 'approved')`,
      [id]
    );
    return result.count > 0;
  }
}

module.exports = Room;
