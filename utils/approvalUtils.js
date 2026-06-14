const { get } = require('../db');
const { hasTimeConflict } = require('./timeUtils');

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

function canApprove(reservation, currentUser) {
  const errors = [];

  if (!reservation) {
    errors.push('预约不存在');
    return { allowed: false, errors };
  }

  if (reservation.user_id === currentUser.id) {
    errors.push('不能审批自己的预约');
    return { allowed: false, errors };
  }

  if (!canTransition(reservation.status, RESERVATION_STATUSES.APPROVED)) {
    errors.push(`无法从 ${reservation.status} 状态变更为 ${RESERVATION_STATUSES.APPROVED}`);
    return { allowed: false, errors };
  }

  if (hasTimeConflict(reservation.room_id, reservation.start_datetime, reservation.end_datetime, reservation.id, ['approved'])) {
    errors.push('该时段已被其他已批准的预约占用');
    return { allowed: false, errors, isConflict: true };
  }

  return { allowed: true, errors };
}

function canReject(reservation, currentUser) {
  const errors = [];

  if (!reservation) {
    errors.push('预约不存在');
    return { allowed: false, errors };
  }

  if (reservation.user_id === currentUser.id) {
    errors.push('不能审批自己的预约');
    return { allowed: false, errors };
  }

  if (!canTransition(reservation.status, RESERVATION_STATUSES.REJECTED)) {
    errors.push(`无法从 ${reservation.status} 状态变更为 ${RESERVATION_STATUSES.REJECTED}`);
    return { allowed: false, errors };
  }

  return { allowed: true, errors };
}

function canCancel(reservation, currentUser) {
  const errors = [];

  if (!reservation) {
    errors.push('预约不存在');
    return { allowed: false, errors };
  }

  const isOwner = reservation.user_id === currentUser.id;
  const isAdmin = currentUser.role === 'admin';

  if (!isOwner && !isAdmin) {
    errors.push('无权取消此预约');
    return { allowed: false, errors };
  }

  if (![RESERVATION_STATUSES.PENDING, RESERVATION_STATUSES.APPROVED].includes(reservation.status)) {
    errors.push(`当前状态为 ${reservation.status}，无法取消`);
    return { allowed: false, errors };
  }

  if (!isAdmin && new Date(reservation.start_datetime) <= new Date()) {
    errors.push('预约已开始，无法取消');
    return { allowed: false, errors };
  }

  return { allowed: true, errors };
}

function canCheckin(reservation, currentUser) {
  const errors = [];

  if (!reservation) {
    errors.push('预约不存在');
    return { allowed: false, errors, shouldLog: false };
  }

  const isOwner = reservation.user_id === currentUser.id;
  const isAdmin = currentUser.role === 'admin';

  if (!isOwner && !isAdmin) {
    errors.push('无权为此预约签到');
    return { allowed: false, errors, shouldLog: false };
  }

  if (reservation.status !== RESERVATION_STATUSES.APPROVED) {
    errors.push(`当前状态为 ${reservation.status}，无法签到`);
    return { allowed: false, errors, shouldLog: true, reason: 'invalid_status', currentStatus: reservation.status };
  }

  return { allowed: true, errors };
}

function canView(reservation, currentUser) {
  const errors = [];

  if (!reservation) {
    errors.push('预约不存在');
    return { allowed: false, errors };
  }

  const isOwner = reservation.user_id === currentUser.id;
  const isAdmin = currentUser.role === 'admin';

  if (!isOwner && !isAdmin) {
    errors.push('无权查看此预约');
    return { allowed: false, errors };
  }

  return { allowed: true, errors };
}

function canViewSeries(reservations, currentUser) {
  if (!reservations || reservations.length === 0) {
    return { allowed: false, errors: ['预约系列不存在'] };
  }

  const isOwner = reservations[0].user_id === currentUser.id;
  const isAdmin = currentUser.role === 'admin';

  if (!isOwner && !isAdmin) {
    return { allowed: false, errors: ['无权查看此预约系列'] };
  }

  return { allowed: true, errors: [] };
}

function checkAutoApproval(reservation, rules = []) {
  const autoApprovalRules = rules.filter(r => r.rule_type === 'auto_approval' && r.is_enabled);
  
  if (autoApprovalRules.length === 0) {
    return { autoApprove: false, reason: '无启用的自动审批规则' };
  }

  for (const rule of autoApprovalRules) {
    const config = rule.config || {};
    if (!config.enabled) continue;

    const start = new Date(reservation.start_datetime);
    const end = new Date(reservation.end_datetime);
    const durationHours = (end - start) / (1000 * 60 * 60);

    if (config.max_hours && durationHours > config.max_hours) {
      continue;
    }

    return { autoApprove: true, reason: `符合规则: ${rule.rule_name}` };
  }

  return { autoApprove: false, reason: '不符合自动审批条件' };
}

module.exports = {
  RESERVATION_STATUSES,
  VALID_TRANSITIONS,
  canTransition,
  canApprove,
  canReject,
  canCancel,
  canCheckin,
  canView,
  canViewSeries,
  checkAutoApproval
};
