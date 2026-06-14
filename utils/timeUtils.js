const { all } = require('../db');
const { EXPIRE_AFTER_START_MINUTES, CHECKIN_GRACE_MINUTES, MAX_RECURRING_OCCURRENCES } = require('../config');
const crypto = require('crypto');

const RECURRING_PATTERNS = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  BIWEEKLY: 'biweekly',
  MONTHLY: 'monthly'
};

const VALID_RECURRING_PATTERNS = Object.values(RECURRING_PATTERNS);

function generateSeriesId() {
  return 'sr_' + crypto.randomBytes(12).toString('hex');
}

function generateRecurringDates(startDatetime, endDatetime, pattern, occurrences) {
  const dates = [];
  const start = new Date(startDatetime);
  const end = new Date(endDatetime);
  const durationMs = end.getTime() - start.getTime();
  const originalDay = start.getDate();

  for (let i = 0; i < occurrences; i++) {
    const currentStart = new Date(start);

    switch (pattern) {
      case RECURRING_PATTERNS.DAILY:
        currentStart.setDate(currentStart.getDate() + i);
        break;
      case RECURRING_PATTERNS.WEEKLY:
        currentStart.setDate(currentStart.getDate() + i * 7);
        break;
      case RECURRING_PATTERNS.BIWEEKLY:
        currentStart.setDate(currentStart.getDate() + i * 14);
        break;
      case RECURRING_PATTERNS.MONTHLY:
        currentStart.setDate(1);
        currentStart.setMonth(start.getMonth() + i);
        const lastDayOfTargetMonth = new Date(currentStart.getFullYear(), currentStart.getMonth() + 1, 0).getDate();
        currentStart.setDate(Math.min(originalDay, lastDayOfTargetMonth));
        currentStart.setHours(start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds());
        break;
    }

    const currentEnd = new Date(currentStart.getTime() + durationMs);
    dates.push({
      start_datetime: currentStart.toISOString(),
      end_datetime: currentEnd.toISOString()
    });
  }

  return dates;
}

function hasTimeConflict(roomId, startDatetime, endDatetime, excludeId = null, statuses = ['approved', 'pending']) {
  const statusPlaceholders = statuses.map(() => '?').join(', ');
  const sql = excludeId
    ? `SELECT id FROM reservations 
       WHERE room_id = ? 
         AND status IN (${statusPlaceholders})
         AND id != ?
         AND start_datetime < ? 
         AND end_datetime > ?`
    : `SELECT id FROM reservations 
       WHERE room_id = ? 
         AND status IN (${statusPlaceholders})
         AND start_datetime < ? 
         AND end_datetime > ?`;

  const params = excludeId
    ? [roomId, ...statuses, excludeId, endDatetime, startDatetime]
    : [roomId, ...statuses, endDatetime, startDatetime];

  const conflicts = all(sql, params);
  return conflicts.length > 0;
}

function hasTimeConflictOnCreate(roomId, startDatetime, endDatetime, excludeId = null) {
  return hasTimeConflict(roomId, startDatetime, endDatetime, excludeId, ['approved']);
}

function getConflictingReservations(roomId, startDatetime, endDatetime, excludeId = null) {
  const sql = excludeId
    ? `SELECT r.*, rm.name as room_name, u.username as user_name
       FROM reservations r
       JOIN rooms rm ON r.room_id = rm.id
       JOIN users u ON r.user_id = u.id
       WHERE r.room_id = ? 
         AND r.status IN ('approved', 'pending')
         AND r.id != ?
         AND r.start_datetime < ? 
         AND r.end_datetime > ?`
    : `SELECT r.*, rm.name as room_name, u.username as user_name
       FROM reservations r
       JOIN rooms rm ON r.room_id = rm.id
       JOIN users u ON r.user_id = u.id
       WHERE r.room_id = ? 
         AND r.status IN ('approved', 'pending')
         AND r.start_datetime < ? 
         AND r.end_datetime > ?`;

  const params = excludeId
    ? [roomId, excludeId, endDatetime, startDatetime]
    : [roomId, endDatetime, startDatetime];

  return all(sql, params);
}

function calculateExpireAt(startDatetime) {
  const start = new Date(startDatetime);
  const expire = new Date(start.getTime() + EXPIRE_AFTER_START_MINUTES * 60 * 1000);
  return expire.toISOString();
}

function validateTimeFormat(timeStr) {
  const regex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
  return regex.test(timeStr);
}

function validateDateFormat(dateStr) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && 
         date.getMonth() === month - 1 && 
         date.getDate() === day;
}

function validateISODateTime(dateTimeStr) {
  const date = new Date(dateTimeStr);
  return !isNaN(date.getTime()) && dateTimeStr.includes('T') && dateTimeStr.includes('Z');
}

function buildDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}`).toISOString();
}

function getLocalDayOfWeek(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getDay();
}

function isFutureDateTime(dateTimeStr) {
  const date = new Date(dateTimeStr);
  return date > new Date();
}

function isValidDateRange(startDatetime, endDatetime) {
  const start = new Date(startDatetime);
  const end = new Date(endDatetime);
  return !isNaN(start.getTime()) && !isNaN(end.getTime()) && start < end;
}

function isWithinCheckinWindow(reservation) {
  const now = new Date();
  const start = new Date(reservation.start_datetime);
  const graceStart = new Date(start.getTime() - CHECKIN_GRACE_MINUTES * 60 * 1000);
  const expireAt = new Date(reservation.expire_at);
  return now >= graceStart && now <= expireAt;
}

function isCheckinTooEarly(reservation) {
  const now = new Date();
  const start = new Date(reservation.start_datetime);
  const graceStart = new Date(start.getTime() - CHECKIN_GRACE_MINUTES * 60 * 1000);
  return now < graceStart;
}

function isCheckinExpired(reservation) {
  const now = new Date();
  const expireAt = new Date(reservation.expire_at);
  return now > expireAt;
}

function getLocalDateStr(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = {
  RECURRING_PATTERNS,
  VALID_RECURRING_PATTERNS,
  MAX_RECURRING_OCCURRENCES,
  generateSeriesId,
  generateRecurringDates,
  hasTimeConflict,
  hasTimeConflictOnCreate,
  getConflictingReservations,
  calculateExpireAt,
  validateTimeFormat,
  validateDateFormat,
  validateISODateTime,
  buildDateTime,
  getLocalDayOfWeek,
  isFutureDateTime,
  isValidDateRange,
  isWithinCheckinWindow,
  isCheckinTooEarly,
  isCheckinExpired,
  getLocalDateStr
};
