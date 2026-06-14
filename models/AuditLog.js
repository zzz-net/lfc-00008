const { run, get, all } = require('../db');

class AuditLog {
  static create(data) {
    const { reservation_id, user_id, action, old_status, new_status, details, ip_address } = data;
    const detailsStr = details ? JSON.stringify(details) : null;
    const result = run(
      `INSERT INTO audit_logs 
       (reservation_id, user_id, action, old_status, new_status, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [reservation_id || null, user_id, action, old_status || null, new_status || null, detailsStr, ip_address || null]
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const log = get('SELECT * FROM audit_logs WHERE id = ?', [id]);
    if (log && log.details) {
      try {
        log.details = JSON.parse(log.details);
      } catch {
        log.details = {};
      }
    }
    return log;
  }

  static findByReservationId(reservationId) {
    const logs = all(
      `SELECT a.*, u.username as user_name 
       FROM audit_logs a
       JOIN users u ON a.user_id = u.id
       WHERE a.reservation_id = ?
       ORDER BY a.created_at DESC`,
      [reservationId]
    );
    return logs.map(log => {
      if (log.details) {
        try {
          log.details = JSON.parse(log.details);
        } catch {
          log.details = {};
        }
      }
      return log;
    });
  }

  static findByUserId(userId) {
    const logs = all(
      `SELECT a.*, u.username as user_name 
       FROM audit_logs a
       JOIN users u ON a.user_id = u.id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC`,
      [userId]
    );
    return logs.map(log => {
      if (log.details) {
        try {
          log.details = JSON.parse(log.details);
        } catch {
          log.details = {};
        }
      }
      return log;
    });
  }

  static findAll(filters = {}) {
    let sql = `
      SELECT a.*, u.username as user_name 
      FROM audit_logs a
      JOIN users u ON a.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (filters.action) {
      sql += ' AND a.action = ?';
      params.push(filters.action);
    }
    if (filters.user_id) {
      sql += ' AND a.user_id = ?';
      params.push(filters.user_id);
    }
    if (filters.start_date) {
      sql += ' AND DATE(a.created_at) >= ?';
      params.push(filters.start_date);
    }
    if (filters.end_date) {
      sql += ' AND DATE(a.created_at) <= ?';
      params.push(filters.end_date);
    }

    sql += ' ORDER BY a.created_at DESC';
    
    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    const logs = all(sql, params);
    return logs.map(log => {
      if (log.details) {
        try {
          log.details = JSON.parse(log.details);
        } catch {
          log.details = {};
        }
      }
      return log;
    });
  }
}

module.exports = AuditLog;
