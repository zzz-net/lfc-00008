const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { validateBody, validateQuery, validateISODateTime, AppError } = require('../middleware/validate');
const { asyncHandler } = require('../middleware/errorHandler');
const { run, get, all, transaction } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');
const { isBlacklisted } = require('../utils/blacklist');
const { buildTodoQuery } = require('../utils/reservation');
const {
  RESERVATION_STATUSES,
  canApprove,
  canReject,
  canCancel,
  canCheckin,
  canView,
  canViewSeries
} = require('../utils/approvalUtils');
const {
  hasTimeConflict,
  hasTimeConflictOnCreate,
  calculateExpireAt,
  generateSeriesId,
  generateRecurringDates,
  VALID_RECURRING_PATTERNS,
  MAX_RECURRING_OCCURRENCES,
  isFutureDateTime,
  isValidDateRange,
  isCheckinTooEarly,
  isCheckinExpired,
  validateISODateTime: validateISO
} = require('../utils/timeUtils');
const { CHECKIN_GRACE_MINUTES } = require('../config');

const router = express.Router();

const todoQuerySchema = {
  room_id: { type: 'integer', label: '房间ID' },
  status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'canceled', 'checked_in', 'expired', 'completed'], label: '状态' }
};

const listQuerySchema = {
  status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'canceled', 'checked_in', 'expired', 'completed'], label: '状态' },
  room_id: { type: 'integer', label: '房间ID' },
  start_date: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/, patternMessage: '日期格式为 YYYY-MM-DD', label: '开始日期' },
  end_date: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/, patternMessage: '日期格式为 YYYY-MM-DD', label: '结束日期' }
};

const createSchema = {
  room_id: { required: true, type: 'integer', label: '房间ID' },
  start_datetime: { required: true, type: 'string', custom: (v) => validateISO(v) ? null : '时间格式无效，请使用 ISO 8601 格式', label: '开始时间' },
  end_datetime: { required: true, type: 'string', custom: (v) => validateISO(v) ? null : '时间格式无效，请使用 ISO 8601 格式', label: '结束时间' },
  purpose: { type: 'string', label: '用途' },
  attendees: { type: 'integer', min: 1, label: '参会人数' },
  recurring: {
    type: 'object',
    custom: (v) => {
      if (!v) return null;
      if (!VALID_RECURRING_PATTERNS.includes(v.pattern)) return '无效的重复模式';
      if (!Number.isInteger(v.occurrences) || v.occurrences < 2) return '重复次数必须是大于等于 2 的整数';
      if (v.occurrences > MAX_RECURRING_OCCURRENCES) return `重复次数超过上限，最大允许 ${MAX_RECURRING_OCCURRENCES} 次`;
      return null;
    },
    label: '重复规则'
  }
};

const cancelSchema = {
  reason: { type: 'string', label: '取消原因' }
};

router.get('/todo', authenticateToken, validateQuery(todoQuerySchema), (req, res) => {
  const { room_id, status } = req.query;

  if (req.user.role !== 'admin' && (room_id || status)) {
    throw new AppError('普通用户不支持 room_id 或 status 过滤', 403);
  }

  const todos = buildTodoQuery(req.user, { room_id, status });
  res.json({ items: todos });
});

router.get('/', authenticateToken, validateQuery(listQuerySchema), (req, res) => {
  const reservations = all(
    `SELECT r.*, 
            rm.name as room_name, 
            u.username as user_name,
            au.username as approver_name
     FROM reservations r
     JOIN rooms rm ON r.room_id = rm.id
     JOIN users u ON r.user_id = u.id
     LEFT JOIN users au ON r.approved_by = au.id
     WHERE 1=1
     ORDER BY r.created_at DESC`
  );

  let filtered = reservations;
  if (req.user.role !== 'admin') {
    filtered = reservations.filter(r => r.user_id === req.user.id);
  }

  const { status, room_id, start_date, end_date } = req.query;
  if (status) filtered = filtered.filter(r => r.status === status);
  if (room_id) filtered = filtered.filter(r => r.room_id === room_id);
  if (start_date) filtered = filtered.filter(r => r.start_datetime.slice(0, 10) >= start_date);
  if (end_date) filtered = filtered.filter(r => r.start_datetime.slice(0, 10) <= end_date);

  res.json(filtered);
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

  const viewCheck = canViewSeries(reservations, req.user);
  if (!viewCheck.allowed) {
    throw new AppError(viewCheck.errors[0], 404);
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

  const viewCheck = canView(reservation, req.user);
  if (!viewCheck.allowed) {
    throw new AppError(viewCheck.errors[0], reservation ? 403 : 404);
  }

  res.json(reservation);
});

router.post('/', authenticateToken, validateBody(createSchema), asyncHandler(async (req, res) => {
  const { room_id, start_datetime, end_datetime, purpose, attendees, recurring } = req.body;

  if (!isValidDateRange(start_datetime, end_datetime)) {
    throw new AppError('开始时间必须早于结束时间', 400);
  }

  if (!isFutureDateTime(start_datetime)) {
    throw new AppError('预约开始时间必须晚于当前时间', 400);
  }

  const room = get('SELECT * FROM rooms WHERE id = ? AND status = ?', [room_id, 'active']);
  if (!room) {
    throw new AppError('房间不存在或未启用', 404);
  }

  const blacklistRecord = isBlacklisted(req.user.id);
  if (blacklistRecord) {
    throw new AppError('您已被列入黑名单，无法预约', 403, {
      reason: blacklistRecord.reason,
      end_date: blacklistRecord.end_date
    });
  }

  if (recurring) {
    const { pattern, occurrences } = recurring;
    const dateList = generateRecurringDates(start_datetime, end_datetime, pattern, occurrences);

    for (let i = 0; i < dateList.length; i++) {
      const d = dateList[i];
      if (!isFutureDateTime(d.start_datetime)) {
        throw new AppError(`第 ${i + 1} 次预约的开始时间必须晚于当前时间`, 400, {
          occurrence: i + 1,
          start_datetime: d.start_datetime
        });
      }
      if (hasTimeConflictOnCreate(room_id, d.start_datetime, d.end_datetime)) {
        throw new AppError(`第 ${i + 1} 次预约时段冲突`, 409, {
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
        if (hasTimeConflictOnCreate(room_id, d.start_datetime, d.end_datetime)) {
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

    const { createdIds } = tx();
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
    return;
  }

  if (hasTimeConflictOnCreate(room_id, start_datetime, end_datetime)) {
    throw new AppError('该时段已被其他预约占用', 409);
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

  const reservationId = tx();
  const reservation = get('SELECT * FROM reservations WHERE id = ?', [reservationId]);
  res.status(201).json(reservation);
}));

router.post('/:id/checkin', authenticateToken, (req, res) => {
  const { id } = req.params;
  const reservation = get('SELECT * FROM reservations WHERE id = ?', [id]);

  const checkinCheck = canCheckin(reservation, req.user);
  if (!checkinCheck.allowed) {
    if (checkinCheck.shouldLog) {
      logAudit(req.user.id, ACTIONS.CHECKIN_FAILED, {
        reservationId: id,
        oldStatus: reservation.status,
        newStatus: reservation.status,
        details: { 
          reason: checkinCheck.reason, 
          current_status: checkinCheck.currentStatus,
          checkin_time: new Date().toISOString()
        }
      });
    }
    throw new AppError(checkinCheck.errors[0], 400);
  }

  const now = new Date();
  const start = new Date(reservation.start_datetime);
  const graceStart = new Date(start.getTime() - CHECKIN_GRACE_MINUTES * 60 * 1000);
  const expireAt = new Date(reservation.expire_at);

  if (isCheckinTooEarly(reservation)) {
    logAudit(req.user.id, ACTIONS.CHECKIN_FAILED, {
      reservationId: id,
      oldStatus: reservation.status,
      newStatus: reservation.status,
      details: { reason: 'too_early', checkin_time: now.toISOString(), earliest_checkin: graceStart.toISOString() }
    });
    throw new AppError('签到时间未到', 400, { earliest_checkin: graceStart.toISOString() });
  }

  if (isCheckinExpired(reservation)) {
    logAudit(req.user.id, ACTIONS.CHECKIN_FAILED, {
      reservationId: id,
      oldStatus: reservation.status,
      newStatus: reservation.status,
      details: { reason: 'expired', checkin_time: now.toISOString(), expire_at: expireAt.toISOString() }
    });
    throw new AppError('预约已超时失效，无法签到', 400, { expired_at: expireAt.toISOString() });
  }

  const tx = transaction(() => {
    run(
      `UPDATE reservations 
       SET status = ?, checkin_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [RESERVATION_STATUSES.CHECKED_IN, id]
    );
    logAudit(req.user.id, ACTIONS.CHECKIN, {
      reservationId: id,
      oldStatus: reservation.status,
      newStatus: RESERVATION_STATUSES.CHECKED_IN,
      details: { checkin_time: now.toISOString() }
    });
  });

  tx();
  const updated = get('SELECT * FROM reservations WHERE id = ?', [id]);
  res.json(updated);
});

router.post('/:id/cancel', authenticateToken, validateBody(cancelSchema), (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const reservation = get('SELECT * FROM reservations WHERE id = ?', [id]);

  const cancelCheck = canCancel(reservation, req.user);
  if (!cancelCheck.allowed) {
    throw new AppError(cancelCheck.errors[0], reservation ? 403 : 404);
  }

  const tx = transaction(() => {
    run(
      `UPDATE reservations 
       SET status = ?, canceled_at = CURRENT_TIMESTAMP, canceled_by = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [RESERVATION_STATUSES.CANCELED, req.user.id, id]
    );
    logAudit(req.user.id, ACTIONS.CANCEL_RESERVATION, {
      reservationId: id,
      oldStatus: reservation.status,
      newStatus: RESERVATION_STATUSES.CANCELED,
      details: { reason, canceled_by: req.user.username }
    });
  });

  tx();
  const updated = get('SELECT * FROM reservations WHERE id = ?', [id]);
  res.json(updated);
});

module.exports = router;
