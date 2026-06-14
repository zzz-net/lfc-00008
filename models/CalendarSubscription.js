const { run, get, all } = require('../db');
const crypto = require('crypto');

class CalendarSubscription {
  static create(userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const result = run(
      'INSERT INTO calendar_subscriptions (user_id, token) VALUES (?, ?)',
      [userId, token]
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    return get(
      `SELECT c.*, u.username as user_name 
       FROM calendar_subscriptions c
       JOIN users u ON c.user_id = u.id
       WHERE c.id = ?`,
      [id]
    );
  }

  static findByToken(token) {
    return get(
      `SELECT c.*, u.username as user_name 
       FROM calendar_subscriptions c
       JOIN users u ON c.user_id = u.id
       WHERE c.token = ? AND c.is_active = 1`,
      [token]
    );
  }

  static findByUserId(userId) {
    return all(
      `SELECT c.*, u.username as user_name 
       FROM calendar_subscriptions c
       JOIN users u ON c.user_id = u.id
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC`,
      [userId]
    );
  }

  static revoke(id, userId) {
    return run(
      `UPDATE calendar_subscriptions 
       SET is_active = 0, revoked_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
  }

  static delete(id) {
    return run('DELETE FROM calendar_subscriptions WHERE id = ?', [id]);
  }
}

module.exports = CalendarSubscription;
