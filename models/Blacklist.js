const { run, get, all } = require('../db');

class Blacklist {
  static create(data, createdBy) {
    const { user_id, reason, start_date, end_date, is_permanent = false } = data;
    const result = run(
      `INSERT INTO blacklist 
       (user_id, reason, start_date, end_date, is_permanent, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user_id, reason || null, start_date, end_date || null, is_permanent ? 1 : 0, createdBy]
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    return get(
      `SELECT b.*, 
              u.username as user_name,
              cb.username as created_by_name
       FROM blacklist b
       JOIN users u ON b.user_id = u.id
       JOIN users cb ON b.created_by = cb.id
       WHERE b.id = ?`,
      [id]
    );
  }

  static findAll(filters = {}) {
    let sql = `
      SELECT b.*, 
             u.username as user_name,
             cb.username as created_by_name
      FROM blacklist b
      JOIN users u ON b.user_id = u.id
      JOIN users cb ON b.created_by = cb.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.active) {
      const today = new Date();
      const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      sql += ` AND (
        b.is_permanent = 1 
        OR (b.start_date <= ? AND (b.end_date IS NULL OR b.end_date >= ?))
      )`;
      params.push(localDate, localDate);
    }

    if (filters.user_id) {
      sql += ' AND b.user_id = ?';
      params.push(filters.user_id);
    }

    sql += ' ORDER BY b.created_at DESC';
    return all(sql, params);
  }

  static findActiveForUser(userId) {
    const today = new Date();
    const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    
    return get(
      `SELECT * FROM blacklist 
       WHERE user_id = ? 
         AND (
           is_permanent = 1 
           OR (start_date <= ? AND (end_date IS NULL OR end_date >= ?))
         )
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, localDate, localDate]
    );
  }

  static delete(id) {
    return run('DELETE FROM blacklist WHERE id = ?', [id]);
  }
}

module.exports = Blacklist;
