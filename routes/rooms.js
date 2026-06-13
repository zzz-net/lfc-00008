const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { run, get, all } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  const { status } = req.query;
  let sql = 'SELECT * FROM rooms';
  let params = [];
  
  if (status) {
    sql += ' WHERE status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  
  const rooms = all(sql, params);
  res.json(rooms);
});

router.get('/:id', authenticateToken, (req, res) => {
  const room = get('SELECT * FROM rooms WHERE id = ?', [req.params.id]);
  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }
  res.json(room);
});

router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const { name, description, capacity, location, status = 'active' } = req.body;

  if (!name) {
    return res.status(400).json({ error: '房间名称不能为空' });
  }

  const existing = get('SELECT id FROM rooms WHERE name = ?', [name]);
  if (existing) {
    return res.status(400).json({ error: '房间名称已存在' });
  }

  const result = run(
    `INSERT INTO rooms (name, description, capacity, location, status)
     VALUES (?, ?, ?, ?, ?)`,
    [name, description || null, capacity || null, location || null, status]
  );

  const room = get('SELECT * FROM rooms WHERE id = ?', [result.lastInsertRowid]);
  
  logAudit(req.user.id, ACTIONS.CREATE_ROOM, {
    details: { roomId: room.id, name }
  });

  res.status(201).json(room);
});

router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { name, description, capacity, location, status } = req.body;

  const room = get('SELECT * FROM rooms WHERE id = ?', [id]);
  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  if (name && name !== room.name) {
    const existing = get('SELECT id FROM rooms WHERE name = ? AND id != ?', [name, id]);
    if (existing) {
      return res.status(400).json({ error: '房间名称已存在' });
    }
  }

  run(
    `UPDATE rooms 
     SET name = COALESCE(?, name),
         description = COALESCE(?, description),
         capacity = COALESCE(?, capacity),
         location = COALESCE(?, location),
         status = COALESCE(?, status),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [name, description, capacity, location, status, id]
  );

  const updated = get('SELECT * FROM rooms WHERE id = ?', [id]);
  
  logAudit(req.user.id, ACTIONS.UPDATE_ROOM, {
    details: { roomId: id, changes: req.body }
  });

  res.json(updated);
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;

  const room = get('SELECT * FROM rooms WHERE id = ?', [id]);
  if (!room) {
    return res.status(404).json({ error: '房间不存在' });
  }

  const pendingReservations = get(
    `SELECT COUNT(*) as count FROM reservations 
     WHERE room_id = ? AND status IN ('pending', 'approved')`,
    [id]
  );
  
  if (pendingReservations.count > 0) {
    return res.status(400).json({ error: '该房间存在待处理或已批准的预约，无法删除' });
  }

  run('DELETE FROM rooms WHERE id = ?', [id]);
  
  logAudit(req.user.id, ACTIONS.DELETE_ROOM, {
    details: { roomId: id, name: room.name }
  });

  res.json({ message: '删除成功' });
});

module.exports = router;
