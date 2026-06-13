const { all } = require('../db');
const { EXPIRE_AFTER_START_MINUTES } = require('../config');

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

module.exports = {
  hasTimeConflict,
  calculateExpireAt,
  RESERVATION_STATUSES,
  VALID_TRANSITIONS,
  canTransition
};
