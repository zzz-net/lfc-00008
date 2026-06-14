const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { run, get, all, transaction } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');
const { isBlacklisted } = require('../utils/blacklist');
const { 
  hasTimeConflict, 
  calculateExpireAt, 
  RESERVATION_STATUSES, 
  buildTodoQuery,
  RECURRING_PATTERNS,
  VALID_RECURRING_PATTERNS,
  generateSeriesId,
  generateRecurringDates,
  MAX_RECURRING_OCCURRENCES
} = require('../utils/reservation');

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

router.get('/series/:series_id', authenticateToken, (req, res) => {
  const { series_id } = req.params;

  const reservations = all(
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
    [series_id]
  );

  if (reservations.length === 0) {
    return res.status(404).json({ error: '预约系列不存在' });
  }

  const isOwner = reservations[0].user_id === req.user.id;
  const isAdmin = req.user.role === 'admin';

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: '无权查看此预约系列' });
  }

  res.json({
    series_id,
    pattern: reservations[0].series_id ? 'recurring' : 'single',
    count: reservations.length,
    items: reservations
  });
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
  const { room_id, start_datetime, end_datetime, purpose, attendees, recurring } = req.body;

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

  if (recurring) {
    const { pattern, occurrences } = recurring;

    if (!VALID_RECURRING_PATTERNS.includes(pattern)) {
      return res.status(400).json({ 
        error: '无效的重复模式',
        valid_patterns: VALID_RECURRING_PATTERNS
      });
    }

    if (!Number.isInteger(occurrences) || occurrences < 2) {
      return res.status(400).json({ error: '重复次数必须是大于等于 2 的整数' });
    }

    if (occurrences > MAX_RECURRING_OCCURRENCES) {
      return res.status(400).json({ 
        error: `重复次数超过上限，最大允许 ${MAX_RECURRING_OCCURRENCES} 次`
      });
    }

    const dateList = generateRecurringDates(start_datetime, end_datetime, pattern, occurrences);

    for (let i = 0; i < dateList.length; i++) {
      const d = dateList[i];
      const dStart = new Date(d.start_datetime);

      if (dStart <= new Date()) {
        return res.status(400).json({ 
          error: `第 ${i + 1} 次预约的开始时间必须晚于当前时间`,
          occurrence: i + 1,
          start_datetime: d.start_datetime
        });
      }

      if (hasTimeConflict(room_id, d.start_datetime, d.end_datetime)) {
        return res.status(409).json({ 
          error: `第 ${i + 1} 次预约时段冲突`,
          occurrence: i + 1,
          start_datetime: d.start_datetime,
          end_datetime: d.end_datetime
        });
      }
    }

    const seriesId = generateSeriesId();

    const tx = transaction(() => {
      const createdIds = [];

      for (let i = 0; i < dateList.length; i++) {
        const d = dateList[i];
        const expireAt = calculateExpireAt(d.start_datetime);

        if (hasTimeConflict(room_id, d.start_datetime, d.end_datetime)) {
          throw new Error(`CONFLICT:第 ${i + 1} 次预约时段冲突`);
        }

        const result = run(
          `INSERT INTO reservations 
           (room_id, user_id, start_datetime, end_datetime, purpose, attendees, series_id, status, expire_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [room_id, req.user.id, d.start_datetime, d.end_datetime, purpose || null, attendees || null, seriesId, RESERVATION_STATUSES.PENDING, expireAt]
        );

        const reservationId = result.lastInsertRowid;
        createdIds.push(reservationId);

        logAudit(req.user.id, ACTIONS.CREATE_RESERVATION, {
          reservationId,
          newStatus: RESERVATION_STATUSES.PENDING,
          details: { 
            roomId: room_id, 
            start_datetime: d.start_datetime, 
            end_datetime: d.end_datetime,
            series_id: seriesId,
            occurrence: i + 1,
            total_occurrences: dateList.length,
            pattern
          }
        });
      }

      logAudit(req.user.id, ACTIONS.CREATE_RECURRING_SERIES, {
        reservationId: createdIds[0],
        details: {
          series_id: seriesId,
          pattern,
          occurrences: dateList.length,
          room_id,
          first_start: dateList[0].start_datetime,
          last_end: dateList[dateList.length - 1].end_datetime,
          reservation_ids: createdIds
        }
      });

      return { seriesId, createdIds };
    });

    try {
      const { seriesId, createdIds } = tx();
      const reservations = all(
        `SELECT * FROM reservations WHERE series_id = ? ORDER BY start_datetime ASC`,
        [seriesId]
      );
      res.status(201).json({
        series_id: seriesId,
        pattern,
        occurrences: reservations.length,
        items: reservations
      });
    } catch (err) {
      console.error('Create recurring reservation error:', err);
      if (err.message && err.message.startsWith('CONFLICT:')) {
        return res.status(409).json({ error: err.message.replace('CONFLICT:', '') });
      }
      res.status(500).json({ error: '创建周期性预约失败' });
    }

    return;
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
