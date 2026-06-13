const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { all, get } = require('../db');

const router = express.Router();

router.get('/', authenticateToken, requireAdmin, (req, res) => {
  const { reservation_id, user_id, action, limit = 100, offset = 0 } = req.query;
  
  let sql = `
    SELECT al.*, 
           u.username as user_name,
           r.room_id,
           rm.name as room_name
    FROM audit_logs al
    JOIN users u ON al.user_id = u.id
    LEFT JOIN reservations r ON al.reservation_id = r.id
    LEFT JOIN rooms rm ON r.room_id = rm.id
    WHERE 1=1
  `;
  let params = [];

  if (reservation_id) {
    sql += ' AND al.reservation_id = ?';
    params.push(reservation_id);
  }
  if (user_id) {
    sql += ' AND al.user_id = ?';
    params.push(user_id);
  }
  if (action) {
    sql += ' AND al.action = ?';
    params.push(action);
  }

  sql += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const logs = all(sql, params);
  
  const result = logs.map(log => ({
    ...log,
    details: log.details ? JSON.parse(log.details) : null
  }));

  res.json(result);
});

router.get('/reservation/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  
  const logs = all(`
    SELECT al.*, u.username as user_name
    FROM audit_logs al
    JOIN users u ON al.user_id = u.id
    WHERE al.reservation_id = ?
    ORDER BY al.created_at ASC
  `, [id]);

  if (logs.length === 0) {
    const reservation = get('SELECT * FROM reservations WHERE id = ?', [id]);
    if (!reservation) {
      return res.status(404).json({ error: '预约不存在' });
    }
    if (req.user.role !== 'admin' && reservation.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权查看此预约的审计日志' });
    }
  } else {
    const reservation = get('SELECT * FROM reservations WHERE id = ?', [id]);
    if (req.user.role !== 'admin' && reservation.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权查看此预约的审计日志' });
    }
  }

  const result = logs.map(log => ({
    ...log,
    details: log.details ? JSON.parse(log.details) : null
  }));

  res.json(result);
});

router.get('/me', authenticateToken, (req, res) => {
  const { limit = 50, offset = 0, action } = req.query;
  
  let sql = `
    SELECT al.*, u.username as user_name
    FROM audit_logs al
    JOIN users u ON al.user_id = u.id
    WHERE al.user_id = ?
  `;
  let params = [req.user.id];

  if (action) {
    sql += ' AND al.action = ?';
    params.push(action);
  }

  sql += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const logs = all(sql, params);
  
  const result = logs.map(log => ({
    ...log,
    details: log.details ? JSON.parse(log.details) : null
  }));

  res.json(result);
});

module.exports = router;
