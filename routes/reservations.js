const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { run, get, all, transaction } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');
const { isBlacklisted } = require('../utils/blacklist');
const { hasTimeConflict, calculateExpireAt, RESERVATION_STATUSES, buildTodoQuery } = require('../utils/reservation');

const router = express.Router();

router.get('/todo', authenticateToken, (req, res) => {
  const { room_id, status } = req.query;

  if (req.user.role !== 'admin' && (room_id || status)) {
    return res.status(403).json({ error: '普通用户不支持 room_id 或 status 过滤' });
  }

  const todos = buildTodoQuery(req.user, { room_id, status });
  res.json({ items: todos });
});

router.get('/', authenticateToken, (req, res) => {
  const { status, room_id, start_date, end_date } = req.query;
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
  let params = [];

  if (req.user.role !== 'admin') {
    sql += ' AND r.user_id = ?';
    params.push(req.user.id);
  }

  if (status) {
    sql += ' AND r.status = ?';
    params.push(status);
  }
  if (room_id) {
    sql += ' AND r.room_id = ?';
    params.push(room_id);
  }
  if (start_date) {
    sql += ' AND DATE(r.start_datetime) >= ?';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND DATE(r.start_datetime) <= ?';
    params.push(end_date);
  }

  sql += ' ORDER BY r.created_at DESC';

  const reservations = all(sql, params);
  res.json(reservations);
});

router.get('/:id', authenticateToken, (req, res) => {
  const reservation = get(
    `SELECT r.*, 
            rm.name as room_name, 
            u.username as user_name,
            au.username as approver_name
     FROM reservations r
     JOIN rooms rm ON r.room_id = rm.id
     JOIN users u ON r.user_id = u.id
     LEFT JOIN users au ON r.approved_by = au.id
     WHERE r.id = ?`,
    [req.params.id]
  );

  if (!reservation) {
    return res.status(404).json({ error: '预约不存在' });
  }

  if (req.user.role !== 'admin' && reservation.user_id !== req.user.id) {
    return res.status(403).json({ error: '无权查看此预约' });
  }

  res.json(reservation);
});

router.post('/', authenticateToken, (req, res) => {
  const { room_id, start_datetime, end_datetime, purpose, attendees } = req.body;

  if (!room_id || !start_datetime || !end_datetime) {
    return res.status(400).json({ error: '房间ID、开始时间和结束时间不能为空' });
  }

  const room = get('SELECT * FROM rooms WHERE id = ? AND status = ?', [room_id, 'active']);
  if (!room) {
    return res.status(404).json({ error: '房间不存在或未启用' });
  }

  const start = new Date(start_datetime);
  const end = new Date(end_datetime);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: '时间格式无效，请使用 ISO 8601 格式' });
  }
  
  if (start >= end) {
    return res.status(400).json({ error: '开始时间必须早于结束时间' });
  }

  if (start <= new Date()) {
    return res.status(400).json({ error: '预约开始时间必须晚于当前时间' });
  }

  const blacklistRecord = isBlacklisted(req.user.id);
  if (blacklistRecord) {
    return res.status(403).json({ 
      error: '您已被列入黑名单，无法预约',
      reason: blacklistRecord.reason,
      end_date: blacklistRecord.end_date
    });
  }

  if (hasTimeConflict(room_id, start_datetime, end_datetime)) {
    return res.status(409).json({ error: '该时段已被其他预约占用' });
  }

  const expireAt = calculateExpireAt(start_datetime);

  const tx = transaction(() => {
    const result = run(
      `INSERT INTO reservations 
       (room_id, user_id, start_datetime, end_datetime, purpose, attendees, status, expire_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [room_id, req.user.id, start_datetime, end_datetime, purpose || null, attendees || null, RESERVATION_STATUSES.PENDING, expireAt]
    );

    logAudit(req.user.id, ACTIONS.CREATE_RESERVATION, {
      reservationId: result.lastInsertRowid,
      newStatus: RESERVATION_STATUSES.PENDING,
      details: { roomId: room_id, start_datetime, end_datetime }
    });

    return result.lastInsertRowid;
  });

  try {
    const reservationId = tx();
    const reservation = get('SELECT * FROM reservations WHERE id = ?', [reservationId]);
    res.status(201).json(reservation);
  } catch (err) {
    console.error('Create reservation error:', err);
    res.status(500).json({ error: '创建预约失败' });
  }
});

router.post('/:id/checkin', authenticateToken, (req, res) => {
  const { id } = req.params;

  const reservation = get('SELECT * FROM reservations WHERE id = ?', [id]);
  if (!reservation) {
    return res.status(404).json({ error: '预约不存在' });
  }

  if (req.user.role !== 'admin' && reservation.user_id !== req.user.id) {
    return res.status(403).json({ error: '无权为此预约签到' });
  }

  const now = new Date();

  if (reservation.status !== RESERVATION_STATUSES.APPROVED) {
    logAudit(req.user.id, ACTIONS.CHECKIN_FAILED, {
      reservationId: id,
      oldStatus: reservation.status,
      newStatus: reservation.status,
      details: { reason: 'invalid_status', current_status: reservation.status, checkin_time: now.toISOString() }
    });
    return res.status(400).json({ error: `当前状态为 ${reservation.status}，无法签到` });
  }

  const start = new Date(reservation.start_datetime);
  const { CHECKIN_GRACE_MINUTES } = require('../config');
  const graceStart = new Date(start.getTime() - CHECKIN_GRACE_MINUTES * 60 * 1000);
  const expireAt = new Date(reservation.expire_at);

  if (now < graceStart) {
    logAudit(req.user.id, ACTIONS.CHECKIN_FAILED, {
      reservationId: id,
      oldStatus: reservation.status,
      newStatus: reservation.status,
      details: { reason: 'too_early', checkin_time: now.toISOString(), earliest_checkin: graceStart.toISOString() }
    });
    return res.status(400).json({ 
      error: '签到时间未到',
      earliest_checkin: graceStart.toISOString()
    });
  }

  if (now > expireAt) {
    logAudit(req.user.id, ACTIONS.CHECKIN_FAILED, {
      reservationId: id,
      oldStatus: reservation.status,
      newStatus: reservation.status,
      details: { reason: 'expired', checkin_time: now.toISOString(), expire_at: expireAt.toISOString() }
    });
    return res.status(400).json({ 
      error: '预约已超时失效，无法签到',
      expired_at: expireAt.toISOString()
    });
  }

  const oldStatus = reservation.status;

  const tx = transaction(() => {
    run(
      `UPDATE reservations 
       SET status = ?, checkin_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [RESERVATION_STATUSES.CHECKED_IN, id]
    );

    logAudit(req.user.id, ACTIONS.CHECKIN, {
      reservationId: id,
      oldStatus,
      newStatus: RESERVATION_STATUSES.CHECKED_IN,
      details: { checkin_time: now.toISOString() }
    });
  });

  try {
    tx();
    const updated = get('SELECT * FROM reservations WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    console.error('Checkin error:', err);
    res.status(500).json({ error: '签到失败' });
  }
});

router.post('/:id/cancel', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const reservation = get('SELECT * FROM reservations WHERE id = ?', [id]);
  if (!reservation) {
    return res.status(404).json({ error: '预约不存在' });
  }

  const isOwner = reservation.user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: '无权取消此预约' });
  }

  if (![RESERVATION_STATUSES.PENDING, RESERVATION_STATUSES.APPROVED].includes(reservation.status)) {
    return res.status(400).json({ error: `当前状态为 ${reservation.status}，无法取消` });
  }

  if (!isAdmin && new Date(reservation.start_datetime) <= new Date()) {
    return res.status(400).json({ error: '预约已开始，无法取消' });
  }

  const oldStatus = reservation.status;

  const tx = transaction(() => {
    run(
      `UPDATE reservations 
       SET status = ?, canceled_at = CURRENT_TIMESTAMP, canceled_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [RESERVATION_STATUSES.CANCELED, req.user.id, id]
    );

    logAudit(req.user.id, ACTIONS.CANCEL_RESERVATION, {
      reservationId: id,
      oldStatus,
      newStatus: RESERVATION_STATUSES.CANCELED,
      details: { reason, canceled_by: req.user.username }
    });
  });

  try {
    tx();
    const updated = get('SELECT * FROM reservations WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    console.error('Cancel error:', err);
    res.status(500).json({ error: '取消失败' });
  }
});

module.exports = router;
