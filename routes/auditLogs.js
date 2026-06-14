const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validateQuery, AppError } = require('../middleware/validate');
const { all, get } = require('../db');

const router = express.Router();

const listQuerySchema = {
  reservation_id: { type: 'integer', label: '预约ID' },
  user_id: { type: 'integer', label: '用户ID' },
  action: { type: 'string', label: '操作类型' },
  limit: { type: 'integer', min: 1, max: 1000, label: '数量限制' },
  offset: { type: 'integer', min: 0, label: '偏移量' }
};

const meQuerySchema = {
  limit: { type: 'integer', min: 1, max: 1000, label: '数量限制' },
  offset: { type: 'integer', min: 0, label: '偏移量' },
  action: { type: 'string', label: '操作类型' }
};

function parseDetails(log) {
  if (!log) return null;
  return {
    ...log,
    details: log.details ? JSON.parse(log.details) : null
  };
}

router.get('/', authenticateToken, requireAdmin, validateQuery(listQuerySchema), (req, res) => {
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
  params.push(limit, offset);

  const logs = all(sql, params);
  res.json(logs.map(parseDetails));
});

router.get('/reservation/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  
  const reservation = get('SELECT * FROM reservations WHERE id = ?', [id]);
  if (!reservation) {
    throw new AppError('预约不存在', 404);
  }
  if (req.user.role !== 'admin' && reservation.user_id !== req.user.id) {
    throw new AppError('无权查看此预约的审计日志', 403);
  }
  
  const logs = all(`
    SELECT al.*, u.username as user_name
    FROM audit_logs al
    JOIN users u ON al.user_id = u.id
    WHERE al.reservation_id = ?
    ORDER BY al.created_at ASC
  `, [id]);

  res.json(logs.map(parseDetails));
});

router.get('/me', authenticateToken, validateQuery(meQuerySchema), (req, res) => {
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
  params.push(limit, offset);

  const logs = all(sql, params);
  res.json(logs.map(parseDetails));
});

module.exports = router;
