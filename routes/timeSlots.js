const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validateBody, validateQuery, AppError, validateTimeFormat } = require('../middleware/validate');
const { run, get, all } = require('../db');

const router = express.Router();

const listQuerySchema = {
  room_id: { type: 'integer', label: '房间ID' }
};

const createSchema = {
  room_id: { required: true, type: 'integer', label: '房间ID' },
  start_time: { required: true, type: 'string', custom: (v) => validateTimeFormat(v) ? null : '时间格式无效，请使用 HH:MM 格式', label: '开始时间' },
  end_time: { required: true, type: 'string', custom: (v) => validateTimeFormat(v) ? null : '时间格式无效，请使用 HH:MM 格式', label: '结束时间' },
  day_of_week: { type: 'integer', min: 0, max: 6, label: '星期几' },
  is_recurring: { type: 'boolean', label: '是否重复' }
};

const updateSchema = {
  start_time: { type: 'string', custom: (v) => v === undefined || validateTimeFormat(v) ? null : '时间格式无效，请使用 HH:MM 格式', label: '开始时间' },
  end_time: { type: 'string', custom: (v) => v === undefined || validateTimeFormat(v) ? null : '时间格式无效，请使用 HH:MM 格式', label: '结束时间' },
  day_of_week: { type: 'integer', min: 0, max: 6, label: '星期几' },
  is_recurring: { type: 'boolean', label: '是否重复' }
};

router.get('/', authenticateToken, validateQuery(listQuerySchema), (req, res) => {
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
    throw new AppError('时段不存在', 404);
  }
  res.json(slot);
});

router.post('/', authenticateToken, requireAdmin, validateBody(createSchema), (req, res) => {
  const { room_id, start_time, end_time, day_of_week, is_recurring = 0 } = req.body;

  const room = get('SELECT id FROM rooms WHERE id = ?', [room_id]);
  if (!room) {
    throw new AppError('房间不存在', 404);
  }

  if (start_time >= end_time) {
    throw new AppError('开始时间必须早于结束时间', 400);
  }

  const result = run(
    `INSERT INTO time_slots (room_id, start_time, end_time, day_of_week, is_recurring)
     VALUES (?, ?, ?, ?, ?)`,
    [room_id, start_time, end_time, day_of_week !== undefined ? day_of_week : null, is_recurring ? 1 : 0]
  );

  const slot = get('SELECT * FROM time_slots WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json(slot);
});

router.put('/:id', authenticateToken, requireAdmin, validateBody(updateSchema), (req, res) => {
  const { id } = req.params;
  const { start_time, end_time, day_of_week, is_recurring } = req.body;

  const slot = get('SELECT * FROM time_slots WHERE id = ?', [id]);
  if (!slot) {
    throw new AppError('时段不存在', 404);
  }

  const newStart = start_time || slot.start_time;
  const newEnd = end_time || slot.end_time;
  if (newStart >= newEnd) {
    throw new AppError('开始时间必须早于结束时间', 400);
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
    throw new AppError('时段不存在', 404);
  }

  run('DELETE FROM time_slots WHERE id = ?', [id]);
  res.json({ message: '删除成功' });
});

module.exports = router;
