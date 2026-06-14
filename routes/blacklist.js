const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validateBody, validateQuery, AppError, validateDateFormat } = require('../middleware/validate');
const { run, get, all } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');
const { getLocalDateStr } = require('../utils/blacklist');

const router = express.Router();

const listQuerySchema = {
  active: { type: 'string', enum: ['true', 'false'], label: '是否有效' }
};

const createSchema = {
  user_id: { required: true, type: 'integer', label: '用户ID' },
  reason: { type: 'string', label: '原因' },
  start_date: { required: true, type: 'string', custom: (v) => validateDateFormat(v) ? null : '日期格式无效，请使用 YYYY-MM-DD 格式', label: '开始日期' },
  end_date: { type: 'string', custom: (v) => v === undefined || validateDateFormat(v) ? null : '日期格式无效，请使用 YYYY-MM-DD 格式', label: '结束日期' },
  is_permanent: { type: 'boolean', label: '是否永久' }
};

router.get('/', authenticateToken, requireAdmin, validateQuery(listQuerySchema), (req, res) => {
  const { active } = req.query;
  let sql = `
    SELECT b.*, u.username as user_name, cu.username as creator_name
    FROM blacklist b
    JOIN users u ON b.user_id = u.id
    JOIN users cu ON b.created_by = cu.id
  `;
  let params = [];

  if (active === 'true') {
    const today = getLocalDateStr();
    sql += ` WHERE (b.is_permanent = 1 OR (b.start_date <= ? AND (b.end_date IS NULL OR b.end_date >= ?)))`;
    params = [today, today];
  }
  sql += ' ORDER BY b.created_at DESC';

  const records = all(sql, params);
  res.json(records);
});

router.post('/', authenticateToken, requireAdmin, validateBody(createSchema), (req, res) => {
  const { user_id, reason, start_date, end_date, is_permanent = false } = req.body;

  const user = get('SELECT id, username, role FROM users WHERE id = ?', [user_id]);
  if (!user) {
    throw new AppError('用户不存在', 404);
  }

  if (user.role === 'admin') {
    throw new AppError('不能将管理员加入黑名单', 400);
  }

  if (!is_permanent && !end_date) {
    throw new AppError('非永久黑名单必须指定结束日期', 400);
  }

  if (end_date && end_date < start_date) {
    throw new AppError('结束日期不能早于开始日期', 400);
  }

  const result = run(
    `INSERT INTO blacklist (user_id, reason, start_date, end_date, is_permanent, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [user_id, reason || null, start_date, end_date || null, is_permanent ? 1 : 0, req.user.id]
  );

  const record = get(`
    SELECT b.*, u.username as user_name, cu.username as creator_name
    FROM blacklist b
    JOIN users u ON b.user_id = u.id
    JOIN users cu ON b.created_by = cu.id
    WHERE b.id = ?
  `, [result.lastInsertRowid]);

  logAudit(req.user.id, ACTIONS.ADD_BLACKLIST, {
    details: { userId: user_id, userName: user.username, reason, start_date, end_date, is_permanent }
  });

  res.status(201).json(record);
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;

  const record = get('SELECT * FROM blacklist WHERE id = ?', [id]);
  if (!record) {
    throw new AppError('黑名单记录不存在', 404);
  }

  run('DELETE FROM blacklist WHERE id = ?', [id]);

  logAudit(req.user.id, ACTIONS.REMOVE_BLACKLIST, {
    details: { blacklistId: id, userId: record.user_id }
  });

  res.json({ message: '已从黑名单移除' });
});

module.exports = router;
