const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { run, get, transaction } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');
const { hasTimeConflict, RESERVATION_STATUSES, canTransition } = require('../utils/reservation');

const router = express.Router();

router.post('/:id/approve', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { comment } = req.body;

  const reservation = get('SELECT * FROM reservations WHERE id = ?', [id]);
  if (!reservation) {
    return res.status(404).json({ error: '预约不存在' });
  }

  if (reservation.user_id === req.user.id) {
    return res.status(403).json({ error: '不能审批自己的预约' });
  }

  const oldStatus = reservation.status;
  const newStatus = RESERVATION_STATUSES.APPROVED;

  if (!canTransition(oldStatus, newStatus)) {
    return res.status(400).json({ error: `无法从 ${oldStatus} 状态变更为 ${newStatus}` });
  }

  if (hasTimeConflict(reservation.room_id, reservation.start_datetime, reservation.end_datetime, id)) {
    return res.status(409).json({ error: '该时段已被其他已批准的预约占用' });
  }

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

  try {
    tx();
    const updated = get('SELECT * FROM reservations WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: '审批失败' });
  }
});

router.post('/:id/reject', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  const reservation = get('SELECT * FROM reservations WHERE id = ?', [id]);
  if (!reservation) {
    return res.status(404).json({ error: '预约不存在' });
  }

  if (reservation.user_id === req.user.id) {
    return res.status(403).json({ error: '不能审批自己的预约' });
  }

  const oldStatus = reservation.status;
  const newStatus = RESERVATION_STATUSES.REJECTED;

  if (!canTransition(oldStatus, newStatus)) {
    return res.status(400).json({ error: `无法从 ${oldStatus} 状态变更为 ${newStatus}` });
  }

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

  try {
    tx();
    const updated = get('SELECT * FROM reservations WHERE id = ?', [id]);
    res.json(updated);
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ error: '拒绝失败' });
  }
});

module.exports = router;
