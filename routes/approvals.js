const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validateBody, AppError } = require('../middleware/validate');
const { run, get, transaction } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');
const { RESERVATION_STATUSES, canApprove, canReject } = require('../utils/approvalUtils');

const router = express.Router();

const approveSchema = {
  comment: { type: 'string', label: '审批意见' }
};

const rejectSchema = {
  reason: { type: 'string', label: '拒绝原因' }
};

router.post('/:id/approve', authenticateToken, requireAdmin, validateBody(approveSchema), (req, res) => {
  const { id } = req.params;
  const { comment } = req.body;

  const reservation = get('SELECT * FROM reservations WHERE id = ?', [id]);
  const approvalCheck = canApprove(reservation, req.user);
  
  if (!approvalCheck.allowed) {
    throw new AppError(approvalCheck.errors[0], approvalCheck.isConflict ? 409 : (reservation ? 400 : 404));
  }

  const oldStatus = reservation.status;
  const newStatus = RESERVATION_STATUSES.APPROVED;

  const tx = transaction(() => {
    run(
      `UPDATE reservations 
       SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newStatus, req.user.id, id]
    );

    logAudit(req.user.id, ACTIONS.APPROVE_RESERVATION, {
      reservationId: id,
      oldStatus,
      newStatus,
      details: { comment, approver: req.user.username }
    });
  });

  tx();
  const updated = get('SELECT * FROM reservations WHERE id = ?', [id]);
  res.json(updated);
});

router.post('/:id/reject', authenticateToken, requireAdmin, validateBody(rejectSchema), (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const reservation = get('SELECT * FROM reservations WHERE id = ?', [id]);
  const rejectCheck = canReject(reservation, req.user);
  
  if (!rejectCheck.allowed) {
    throw new AppError(rejectCheck.errors[0], reservation ? 400 : 404);
  }

  const oldStatus = reservation.status;
  const newStatus = RESERVATION_STATUSES.REJECTED;

  const tx = transaction(() => {
    run(
      `UPDATE reservations 
       SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newStatus, req.user.id, id]
    );

    logAudit(req.user.id, ACTIONS.REJECT_RESERVATION, {
      reservationId: id,
      oldStatus,
      newStatus,
      details: { reason, approver: req.user.username }
    });
  });

  tx();
  const updated = get('SELECT * FROM reservations WHERE id = ?', [id]);
  res.json(updated);
});

module.exports = router;
