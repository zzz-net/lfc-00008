const { all } = require('../db');
const { EXPIRE_AFTER_START_MINUTES, CHECKIN_GRACE_MINUTES } = require('../config');

function hasTimeConflict(roomId, startDatetime, endDatetime, excludeId = null) {
  const sql = excludeId
    ? `SELECT id FROM reservations 
       WHERE room_id = ? 
         AND status = 'approved'
         AND id != ?
         AND start_datetime < ? 
         AND end_datetime > ?`
    : `SELECT id FROM reservations 
       WHERE room_id = ? 
         AND status = 'approved'
         AND start_datetime < ? 
         AND end_datetime > ?`;

  const params = excludeId
    ? [roomId, excludeId, endDatetime, startDatetime]
    : [roomId, endDatetime, startDatetime];

  const conflicts = all(sql, params);
  return conflicts.length > 0;
}

function calculateExpireAt(startDatetime) {
  const start = new Date(startDatetime);
  const expire = new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * 60 * 1000);
  return expire.toISOString();
}

const RESERVATION_STATUSES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CANCELED: 'canceled',
  CHECKED_IN: 'checked_in',
  EXPIRED: 'expired',
  COMPLETED: 'completed'
};

const VALID_TRANSITIONS = {
  [RESERVATION_STATUSES.PENDING]: [RESERVATION_STATUSES.APPROVED, RESERVATION_STATUSES.REJECTED, RESERVATION_STATUSES.CANCELED],
  [RESERVATION_STATUSES.APPROVED]: [RESERVATION_STATUSES.CHECKED_IN, RESERVATION_STATUSES.CANCELED, RESERVATION_STATUSES.EXPIRED, RESERVATION_STATUSES.COMPLETED],
  [RESERVATION_STATUSES.CHECKED_IN]: [RESERVATION_STATUSES.COMPLETED],
  [RESERVATION_STATUSES.REJECTED]: [],
  [RESERVATION_STATUSES.CANCELED]: [],
  [RESERVATION_STATUSES.EXPIRED]: [],
  [RESERVATION_STATUSES.COMPLETED]: []
};

function canTransition(from, to) {
  return VALID_TRANSITIONS[from] && VALID_TRANSITIONS[from].includes(to);
}

function buildTodoQuery(user, filters = {}) {
  const { room_id, status } = filters;
  const now = new Date();

  if (user.role === 'admin') {
    return buildAdminTodo(now, { room_id, status });
  } else {
    return buildUserTodo(user.id, now);
  }
}

function buildUserTodo(userId, now) {
  const nowIso = now.toISOString();
  
  const graceStartIso = new Date(now.getTime() - CHECKIN_GRACE_MINUTES * 60 * 1000).toISOString();

  const sql = `
    SELECT 
      r.id,
      r.room_id,
      r.user_id,
      r.start_datetime,
      r.end_datetime,
      r.status,
      r.purpose,
      r.expire_at,
      rm.name as room_name,
      u.username as user_name
    FROM reservations r
    JOIN rooms rm ON r.room_id = rm.id
    JOIN users u ON r.user_id = u.id
    WHERE r.user_id = ?
      AND r.status IN (?, ?)
    ORDER BY r.start_datetime ASC
  `;

  const reservations = all(sql, [userId, RESERVATION_STATUSES.PENDING, RESERVATION_STATUSES.APPROVED]);

  const todos = [];

  for (const r of reservations) {
    const start = new Date(r.start_datetime);
    const expireAt = new Date(r.expire_at);

    if (r.status === RESERVATION_STATUSES.PENDING) {
      if (start > now) {
        todos.push({
          reservation_id: r.id,
          action: 'cancel',
          reason: '您的预约正在等待审批，可取消',
          room_name: r.room_name,
          start_datetime: r.start_datetime,
          status: r.status,
          urgency_time: r.start_datetime
        });
      }
    } else if (r.status === RESERVATION_STATUSES.APPROVED) {
      if (start > now) {
        todos.push({
          reservation_id: r.id,
          action: 'cancel',
          reason: '预约已批准，可在开始前取消',
          room_name: r.room_name,
          start_datetime: r.start_datetime,
          status: r.status,
          urgency_time: r.start_datetime
        });
      }

      if (nowIso >= graceStartIso && nowIso <= r.expire_at) {
        todos.push({
          reservation_id: r.id,
          action: 'checkin',
          reason: '预约已到签到时间，请尽快签到',
          room_name: r.room_name,
          start_datetime: r.start_datetime,
          status: r.status,
          urgency_time: r.expire_at
        });
      }
    }
  }

  todos.sort((a, b) => new Date(a.urgency_time) - new Date(b.urgency_time));
  return todos.map(t => {
    const { urgency_time, ...rest } = t;
    return rest;
  });
}

function buildAdminTodo(now, filters = {}) {
  const { room_id, status } = filters;
  const nowIso = now.toISOString();

  let sql = `
    SELECT 
      r.id,
      r.room_id,
      r.user_id,
      r.start_datetime,
      r.end_datetime,
      r.status,
      r.purpose,
      r.expire_at,
      rm.name as room_name,
      u.username as user_name
    FROM reservations r
    JOIN rooms rm ON r.room_id = rm.id
    JOIN users u ON r.user_id = u.id
    WHERE 1=1
  `;
  let params = [];

  if (room_id) {
    sql += ' AND r.room_id = ?';
    params.push(room_id);
  }

  if (status) {
    sql += ' AND r.status = ?';
    params.push(status);
  } else {
    sql += ' AND r.status IN (?, ?)';
    params.push(RESERVATION_STATUSES.PENDING, RESERVATION_STATUSES.APPROVED);
  }

  sql += ' ORDER BY r.start_datetime ASC';

  const reservations = all(sql, params);

  const todos = [];

  for (const r of reservations) {
    const start = new Date(r.start_datetime);
    const expireAt = new Date(r.expire_at);

    if (r.status === RESERVATION_STATUSES.PENDING) {
      todos.push({
        reservation_id: r.id,
        action: 'approve',
        reason: '有新的预约需要审批',
        room_name: r.room_name,
        start_datetime: r.start_datetime,
        status: r.status,
        urgency_time: r.start_datetime
      });
      todos.push({
        reservation_id: r.id,
        action: 'reject',
        reason: '可拒绝该预约申请',
        room_name: r.room_name,
        start_datetime: r.start_datetime,
        status: r.status,
        urgency_time: r.start_datetime
      });
    } else if (r.status === RESERVATION_STATUSES.APPROVED) {
      if (nowIso > r.expire_at) {
        todos.push({
          reservation_id: r.id,
          action: 'attention',
          reason: '预约已超时未签到，需关注处理',
          room_name: r.room_name,
          start_datetime: r.start_datetime,
          status: r.status,
          urgency_time: r.expire_at
        });
      }
    }
  }

  todos.sort((a, b) => new Date(a.urgency_time) - new Date(b.urgency_time));
  return todos.map(t => {
    const { urgency_time, ...rest } = t;
    return rest;
  });
}

module.exports = {
  hasTimeConflict,
  calculateExpireAt,
  RESERVATION_STATUSES,
  VALID_TRANSITIONS,
  canTransition,
  buildTodoQuery,
  buildUserTodo,
  buildAdminTodo
};
