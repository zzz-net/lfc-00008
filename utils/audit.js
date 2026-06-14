const { run } = require('../db');

function logAudit(userId, action, options = {}) {
  const { reservationId = null, oldStatus = null, newStatus = null, details = null, ipAddress = null } = options;
  
  run(
    `INSERT INTO audit_logs (reservation_id, user_id, action, old_status, new_status, details, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [reservationId, userId, action, oldStatus, newStatus, details ? JSON.stringify(details) : null, ipAddress]
  );
}

const ACTIONS = {
  LOGIN: 'login',
  CREATE_RESERVATION: 'create_reservation',
  CREATE_RECURRING_SERIES: 'create_recurring_series',
  APPROVE_RESERVATION: 'approve_reservation',
  REJECT_RESERVATION: 'reject_reservation',
  CANCEL_RESERVATION: 'cancel_reservation',
  CHECKIN: 'checkin',
  CHECKIN_FAILED: 'checkin_failed',
  EXPIRE: 'expire',
  COMPLETE: 'complete',
  CREATE_ROOM: 'create_room',
  UPDATE_ROOM: 'update_room',
  DELETE_ROOM: 'delete_room',
  ADD_BLACKLIST: 'add_blacklist',
  REMOVE_BLACKLIST: 'remove_blacklist',
  UPDATE_APPROVAL_RULE: 'update_approval_rule'
};

module.exports = {
  logAudit,
  ACTIONS
};
