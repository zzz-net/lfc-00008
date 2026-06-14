const { all } = require('../db');
const { CHECKIN_GRACE_MINUTES } = require('../config');
const {
  hasTimeConflict,
  hasTimeConflictOnCreate,
  calculateExpireAt,
  RECURRING_PATTERNS,
  VALID_RECURRING_PATTERNS,
  generateSeriesId,
  generateRecurringDates,
  MAX_RECURRING_OCCURRENCES
} = require('./timeUtils');

const {
  RESERVATION_STATUSES,
  VALID_TRANSITIONS,
  canTransition
} = require('./approvalUtils');

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

      const graceStart = new Date(start.getTime() - CHECKIN_GRACE_MINUTES * 60 * 1000);
      if (now >= graceStart && nowIso <= r.expire_at) {
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
  hasTimeConflictOnCreate,
  calculateExpireAt,
  RESERVATION_STATUSES,
  VALID_TRANSITIONS,
  canTransition,
  buildTodoQuery,
  buildUserTodo,
  buildAdminTodo,
  RECURRING_PATTERNS,
  VALID_RECURRING_PATTERNS,
  generateSeriesId,
  generateRecurringDates,
  MAX_RECURRING_OCCURRENCES
};
