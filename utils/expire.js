const { run, all, transaction } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');
const { RESERVATION_STATUSES, canTransition } = require('../utils/reservation');

function processExpiredReservations() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  
  const expired = all(
    `SELECT * FROM reservations 
     WHERE status = ? 
       AND expire_at <= ?`,
    [RESERVATION_STATUSES.APPROVED, now]
  );

  if (expired.length === 0) return 0;

  const tx = transaction(() => {
    for (const r of expired) {
      if (canTransition(r.status, RESERVATION_STATUSES.EXPIRED)) {
        run(
          `UPDATE reservations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [RESERVATION_STATUSES.EXPIRED, r.id]
        );
        logAudit(r.user_id, ACTIONS.EXPIRE, {
          reservationId: r.id,
          oldStatus: r.status,
          newStatus: RESERVATION_STATUSES.EXPIRED,
          details: { expire_at: r.expire_at, auto: true }
        });
      }
    }
  });

  try {
    tx();
    console.log(`Processed ${expired.length} expired reservations at ${new Date().toISOString()}`);
    return expired.length;
  } catch (err) {
    console.error('Error processing expired reservations:', err);
    return 0;
  }
}

function processCompletedReservations() {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  
  const completed = all(
    `SELECT * FROM reservations 
     WHERE status IN (?, ?)
       AND end_datetime <= ?`,
    [RESERVATION_STATUSES.APPROVED, RESERVATION_STATUSES.CHECKED_IN, now]
  );

  if (completed.length === 0) return 0;

  const tx = transaction(() => {
    for (const r of completed) {
      const targetStatus = r.status === RESERVATION_STATUSES.CHECKED_IN 
        ? RESERVATION_STATUSES.COMPLETED 
        : RESERVATION_STATUSES.EXPIRED;
      
      if (canTransition(r.status, targetStatus)) {
        run(
          `UPDATE reservations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [targetStatus, r.id]
        );
        logAudit(r.user_id, targetStatus === RESERVATION_STATUSES.COMPLETED ? 'complete' : ACTIONS.EXPIRE, {
          reservationId: r.id,
          oldStatus: r.status,
          newStatus: targetStatus,
          details: { end_datetime: r.end_datetime, auto: true }
        });
      }
    }
  });

  try {
    tx();
    console.log(`Processed ${completed.length} completed reservations at ${new Date().toISOString()}`);
    return completed.length;
  } catch (err) {
    console.error('Error processing completed reservations:', err);
    return 0;
  }
}

function startExpireScheduler(intervalMs = 60000) {
  processExpiredReservations();
  processCompletedReservations();
  return setInterval(() => {
    processExpiredReservations();
    processCompletedReservations();
  }, intervalMs);
}

module.exports = {
  processExpiredReservations,
  processCompletedReservations,
  startExpireScheduler
};
