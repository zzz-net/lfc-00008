const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { run, get, all } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');

const router = express.Router();

router.get('/', authenticateToken, requireAdmin, (req, res) => {
  const { active } = req.query;
  let sql = `
    SELECT b.*, u.username as user_name, cu.username as creator_name
    FROM blacklist b
    JOIN users u ON b.user_id = u.id
    JOIN users cu ON b.created_by = cu.id
  `;
  let params = [];

  if (active === 'true') {
    const now = new Date().toISOString().split('T')[0];
    sql += ` WHERE (b.is_permanent = 1 OR (b.start_date <= ? AND (b.end_date IS NULL OR b.end_date >= ?)))`;
    params = [now, now];
  }
  sql += ' ORDER BY b.created_at DESC';

  const records = all(sql, params);
  res.json(records);
});

router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const { user_id, reason, start_date, end_date, is_permanent = false } = req.body;

  if (!user_id || !start_date) {
    return res.status(400).json({ error: '用户ID和开始日期不能为空' });
  }

  const user = get('SELECT id, username FROM users WHERE id = ?', [user_id]);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  if (user.role === 'admin') {
    return res.status(400).json({ error: '不能将管理员加入黑名单' });
  }

  if (!is_permanent && !end_date) {
    return res.status(400).json({ error: '非永久黑名单必须指定结束日期' });
  }

  if (end_date && end_date < start_date) {
    return res.status(400).json({ error: '结束日期不能早于开始日期' });
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
    return res.status(404).json({ error: '黑名单记录不存在' });
  }

  run('DELETE FROM blacklist WHERE id = ?', [id]);

  logAudit(req.user.id, ACTIONS.REMOVE_BLACKLIST, {
    details: { blacklistId: id, userId: record.user_id }
  });

  res.json({ message: '已从黑名单移除' });
});

module.exports = router;
