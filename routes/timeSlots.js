const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { run, get, all } = require('../db');

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  const { room_id } = req.query;
  let sql = 'SELECT ts.*, r.name as room_name FROM time_slots ts JOIN rooms r ON ts.room_id = r.id';
  let params = [];
  
  if (room_id) {
    sql += ' WHERE ts.room_id = ?';
    params.push(room_id);
  }
  sql += ' ORDER BY ts.room_id, ts.day_of_week, ts.start_time';
  
  const slots = all(sql, params);
  res.json(slots);
});

router.get('/:id', authenticateToken, (req, res) => {
  const slot = get(
    'SELECT ts.*, r.name as room_name FROM time_slots ts JOIN rooms r ON ts.room_id = r.id WHERE ts.id = ?',
    [req.params.id]
  );
  if (!slot) {
    return res.status(404).json({ error: '时段不存在' });
  }
  res.json(slot);
});

router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const { room_id, start_time, end_time, day_of_week, is_recurring = 0 } = req.body;

  if (!room_id || !start_time || !end_time) {
    return res.status(400).json({ error: '房间ID、开始时间和结束时间不能为空' });
  }

  const room = get('SELECT id FROM rooms WHERE id = ?', [room_id]);
  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
  if (!timeRegex.test(start_time) || !timeRegex.test(end_time)) {
    return res.status(400).json({ error: '时间格式应为 HH:MM' });
  }

  if (start_time >= end_time) {
    return res.status(400).json({ error: '开始时间必须早于结束时间' });
  }

  if (day_of_week !== undefined && (day_of_week < 0 || day_of_week > 6)) {
    return res.status(400).json({ error: 'day_of_week 应为 0-6（周日到周六）' });
  }

  try {
    const result = run(
      `INSERT INTO time_slots (room_id, start_time, end_time, day_of_week, is_recurring)
       VALUES (?, ?, ?, ?, ?)`,
      [room_id, start_time, end_time, day_of_week !== undefined ? day_of_week : null, is_recurring ? 1 : 0]
    );

    const slot = get('SELECT * FROM time_slots WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(slot);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: '该时段已存在' });
    }
    throw err;
  }
});

router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { start_time, end_time, day_of_week, is_recurring } = req.body;

  const slot = get('SELECT * FROM time_slots WHERE id = ?', [id]);
  if (!slot) {
    return res.status(404).json({ error: '时段不存在' });
  }

  if (start_time || end_time) {
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if ((start_time && !timeRegex.test(start_time)) || (end_time && !timeRegex.test(end_time))) {
      return res.status(400).json({ error: '时间格式应为 HH:MM' });
    }
    const newStart = start_time || slot.start_time;
    const newEnd = end_time || slot.end_time;
    if (newStart >= newEnd) {
      return res.status(400).json({ error: '开始时间必须早于结束时间' });
    }
  }

  if (day_of_week !== undefined && (day_of_week < 0 || day_of_week > 6)) {
    return res.status(400).json({ error: 'day_of_week 应为 0-6（周日到周六）' });
  }

  run(
    `UPDATE time_slots 
     SET start_time = COALESCE(?, start_time),
         end_time = COALESCE(?, end_time),
         day_of_week = COALESCE(?, day_of_week),
         is_recurring = COALESCE(?, is_recurring)
     WHERE id = ?`,
    [start_time, end_time, day_of_week, is_recurring !== undefined ? (is_recurring ? 1 : 0) : null, id]
  );

  const updated = get('SELECT * FROM time_slots WHERE id = ?', [id]);
  res.json(updated);
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;

  const slot = get('SELECT * FROM time_slots WHERE id = ?', [id]);
  if (!slot) {
    return res.status(404).json({ error: '时段不存在' });
  }

  run('DELETE FROM time_slots WHERE id = ?', [id]);
  res.json({ message: '删除成功' });
});

module.exports = router;
