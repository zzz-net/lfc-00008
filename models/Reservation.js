const { run, get, all, transaction } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');

class Reservation {
  static create(data, userId) {
    const { room_id, start_datetime, end_datetime, purpose, attendees, series_id, status, expire_at } = data;
    
    const result = run(
      `INSERT INTO reservations 
       (room_id, user_id, start_datetime, end_datetime, purpose, attendees, series_id, status, expire_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [room_id, userId, start_datetime, end_datetime, purpose || null, attendees || null, series_id || null, status, expire_at]
    );
    
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    return get(
      `SELECT r.*, 
              rm.name as room_name, 
              u.username as user_name,
              au.username as approver_name
       FROM reservations r
       JOIN rooms rm ON r.room_id = rm.id
       JOIN users u ON r.user_id = u.id
       LEFT JOIN users au ON r.approved_by = au.id
       WHERE r.id = ?`,
      [id]
    );
  }

  static findBySeriesId(seriesId) {
    return all(
      `SELECT r.*, 
              rm.name as room_name, 
              u.username as user_name,
              au.username as approver_name
       FROM reservations r
       JOIN rooms rm ON r.room_id = rm.id
       JOIN users u ON r.user_id = u.id
       LEFT JOIN users au ON r.approved_by = au.id
       WHERE r.series_id = ?
       ORDER BY r.start_datetime ASC`,
      [seriesId]
    );
  }

  static findAll(filters = {}, user = null) {
    let sql = `
      SELECT r.*, 
             rm.name as room_name, 
             u.username as user_name,
             au.username as approver_name
      FROM reservations r
      JOIN rooms rm ON r.room_id = rm.id
      JOIN users u ON r.user_id = u.id
      LEFT JOIN users au ON r.approved_by = au.id
      WHERE 1=1
    `;
    const params = [];

    if (user && user.role !== 'admin') {
      sql += ' AND r.user_id = ?';
      params.push(user.id);
    }

    if (filters.status) {
      sql += ' AND r.status = ?';
      params.push(filters.status);
    }
    if (filters.room_id) {
      sql += ' AND r.room_id = ?';
      params.push(filters.room_id);
    }
    if (filters.start_date) {
      sql += ' AND DATE(r.start_datetime) >= ?';
      params.push(filters.start_date);
    }
    if (filters.end_date) {
      sql += ' AND DATE(r.start_datetime) <= ?';
      params.push(filters.end_date);
    }

    sql += ' ORDER BY r.created_at DESC';
    return all(sql, params);
  }

  static updateStatus(id, newStatus, { userId, action, comment, approverId } = {}) {
    const old = get('SELECT * FROM reservations WHERE id = ?', [id]);
    
    run(
      `UPDATE reservations 
       SET status = ?, 
           approved_by = COALESCE(?, approved_by), 
           approved_at = CASE WHEN ? IS NOT NULL THEN CURRENT_TIMESTAMP ELSE approved_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newStatus, approverId, approverId, id]
    );

    if (action && userId) {
      logAudit(userId, action, {
        reservationId: id,
        oldStatus: old.status,
        newStatus,
        details: { comment, approver: userId }
      });
    }

    return this.findById(id);
  }

  static checkin(id, userId) {
    const old = get('SELECT * FROM reservations WHERE id = ?', [id]);
    
    run(
      `UPDATE reservations 
       SET status = 'checked_in', 
           checkin_at = CURRENT_TIMESTAMP, 
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [id]
    );

    logAudit(userId, ACTIONS.CHECKIN, {
      reservationId: id,
      oldStatus: old.status,
      newStatus: 'checked_in',
      details: { checkin_time: new Date().toISOString() }
    });

    return this.findById(id);
  }

  static cancel(id, userId, reason) {
    const old = get('SELECT * FROM reservations WHERE id = ?', [id]);
    
    run(
      `UPDATE reservations 
       SET status = 'canceled', 
           canceled_at = CURRENT_TIMESTAMP, 
           canceled_by = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [userId, id]
    );

    logAudit(userId, ACTIONS.CANCEL_RESERVATION, {
      reservationId: id,
      oldStatus: old.status,
      newStatus: 'canceled',
      details: { reason, canceled_by: userId }
    });

    return this.findById(id);
  }

  static delete(id) {
    return run('DELETE FROM reservations WHERE id = ?', [id]);
  }
}

module.exports = Reservation;
