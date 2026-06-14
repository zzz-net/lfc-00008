const { run, get, all } = require('../db');

class TimeSlot {
  static create(data) {
    const { room_id, start_time, end_time, day_of_week, is_recurring = false } = data;
    const result = run(
      'INSERT INTO time_slots (room_id, start_time, end_time, day_of_week, is_recurring) VALUES (?, ?, ?, ?, ?)',
      [room_id, start_time, end_time, day_of_week || null, is_recurring ? 1 : 0]
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    return get(
      `SELECT t.*, r.name as room_name 
       FROM time_slots t
       JOIN rooms r ON t.room_id = r.id
       WHERE t.id = ?`,
      [id]
    );
  }

  static findAll(filters = {}) {
    let sql = `
      SELECT t.*, r.name as room_name 
      FROM time_slots t
      JOIN rooms r ON t.room_id = r.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.room_id) {
      sql += ' AND t.room_id = ?';
      params.push(filters.room_id);
    }
    if (filters.day_of_week !== undefined && filters.day_of_week !== null) {
      sql += ' AND t.day_of_week = ?';
      params.push(filters.day_of_week);
    }
    if (filters.is_recurring !== undefined) {
      sql += ' AND t.is_recurring = ?';
      params.push(filters.is_recurring ? 1 : 0);
    }

    sql += ' ORDER BY t.day_of_week, t.start_time';
    return all(sql, params);
  }

  static update(id, updates) {
    run(
      `UPDATE time_slots 
       SET room_id = COALESCE(?, room_id),
           start_time = COALESCE(?, start_time),
           end_time = COALESCE(?, end_time),
           day_of_week = COALESCE(?, day_of_week),
           is_recurring = COALESCE(?, is_recurring)
       WHERE id = ?`,
      [updates.room_id, updates.start_time, updates.end_time, updates.day_of_week, updates.is_recurring !== undefined ? (updates.is_recurring ? 1 : 0) : undefined, id]
    );
    return this.findById(id);
  }

  static delete(id) {
    return run('DELETE FROM time_slots WHERE id = ?', [id]);
  }
}

module.exports = TimeSlot;
