const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { AppError } = require('../middleware/validate');
const { run, get, all } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');
const { generateSingleIcs, generateSubscriptionIcs, generateRoomIcs, generateSubscriptionToken } = require('../utils/ics');

const router = express.Router();

function getIpAddress(req) {
  return req.ip || req.connection.remoteAddress || null;
}

function getReservationWithDetails(id) {
  return get(
    `SELECT r.*,
            rm.name as room_name,
            rm.location as room_location,
            u.username as user_name
     FROM reservations r
     JOIN rooms rm ON r.room_id = rm.id
     JOIN users u ON r.user_id = u.id
     WHERE r.id = ?`,
    [id]
  );
}

function getUserReservations(userId) {
  return all(
    `SELECT r.*,
            rm.name as room_name,
            rm.location as room_location,
            u.username as user_name
     FROM reservations r
     JOIN rooms rm ON r.room_id = rm.id
     JOIN users u ON r.user_id = u.id
     WHERE r.user_id = ?
       AND r.status IN ('approved', 'checked_in', 'completed')
     ORDER BY r.start_datetime ASC`,
    [userId]
  );
}

function getRoomReservations(roomId) {
  return all(
    `SELECT r.*,
            rm.name as room_name,
            rm.location as room_location,
            u.username as user_name
     FROM reservations r
     JOIN rooms rm ON r.room_id = rm.id
     JOIN users u ON r.user_id = u.id
     WHERE r.room_id = ?
       AND r.status IN ('approved', 'checked_in', 'completed')
     ORDER BY r.start_datetime ASC`,
    [roomId]
  );
}

router.get('/reservation/:id/ics', authenticateToken, (req, res) => {
  const { id } = req.params;

  const reservation = getReservationWithDetails(id);
  if (!reservation) {
    throw new AppError('预约不存在', 404);
  }

  if (req.user.role !== 'admin' && reservation.user_id !== req.user.id) {
    throw new AppError('无权导出此预约', 403);
  }

  const ics = generateSingleIcs(reservation);

  logAudit(req.user.id, ACTIONS.CALENDAR_EXPORT_ICS, {
    reservationId: id,
    details: {
      type: 'single_reservation',
      reservation_id: id,
      is_admin: req.user.role === 'admin'
    },
    ipAddress: getIpAddress(req)
  });

  const filename = `reservation_${id}.ics`;
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(ics);
});

router.get('/subscribe/status', authenticateToken, (req, res) => {
  const existing = get(
    'SELECT token, is_active, created_at FROM calendar_subscriptions WHERE user_id = ? AND is_active = 1',
    [req.user.id]
  );

  if (!existing) {
    return res.json({ active: false });
  }

  res.json({
    active: true,
    subscription_url: `/api/calendar/subscribe/feed/${existing.token}`,
    created_at: existing.created_at
  });
});

router.get('/subscribe/feed/:token', (req, res) => {
  const { token } = req.params;

  const subscription = get(
    'SELECT * FROM calendar_subscriptions WHERE token = ? AND is_active = 1',
    [token]
  );

  if (!subscription) {
    throw new AppError('订阅链接无效或已撤销', 404);
  }

  const reservations = getUserReservations(subscription.user_id);
  const ics = generateSubscriptionIcs(reservations);

  logAudit(subscription.user_id, ACTIONS.CALENDAR_SUBSCRIBE_ACCESS, {
    details: {
      type: 'subscription_access',
      subscription_id: subscription.id,
      event_count: reservations.length,
      accessed_via: 'token'
    },
    ipAddress: getIpAddress(req)
  });

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'inline; filename="calendar.ics"');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(ics);
});

router.post('/subscribe', authenticateToken, (req, res) => {
  const existing = get(
    'SELECT * FROM calendar_subscriptions WHERE user_id = ? AND is_active = 1',
    [req.user.id]
  );

  if (existing) {
    return res.json({
      subscription_url: `/api/calendar/subscribe/feed/${existing.token}`,
      token: existing.token,
      created_at: existing.created_at,
      message: '已有有效订阅链接'
    });
  }

  const token = generateSubscriptionToken();

  const result = run(
    'INSERT INTO calendar_subscriptions (user_id, token) VALUES (?, ?)',
    [req.user.id, token]
  );

  logAudit(req.user.id, ACTIONS.CALENDAR_SUBSCRIBE, {
    details: {
      type: 'subscription_created',
      subscription_id: result.lastInsertRowid
    },
    ipAddress: getIpAddress(req)
  });

  res.status(201).json({
    subscription_url: `/api/calendar/subscribe/feed/${token}`,
    token,
    message: '订阅链接已创建'
  });
});

router.post('/subscribe/regenerate', authenticateToken, (req, res) => {
  const existing = get(
    'SELECT * FROM calendar_subscriptions WHERE user_id = ? AND is_active = 1',
    [req.user.id]
  );

  if (existing) {
    run(
      'UPDATE calendar_subscriptions SET is_active = 0, revoked_at = CURRENT_TIMESTAMP WHERE id = ?',
      [existing.id]
    );
  }

  const token = generateSubscriptionToken();

  const result = run(
    'INSERT INTO calendar_subscriptions (user_id, token) VALUES (?, ?)',
    [req.user.id, token]
  );

  logAudit(req.user.id, ACTIONS.CALENDAR_SUBSCRIBE_REGENERATE, {
    details: {
      type: 'subscription_regenerated',
      old_subscription_id: existing ? existing.id : null,
      new_subscription_id: result.lastInsertRowid
    },
    ipAddress: getIpAddress(req)
  });

  res.json({
    subscription_url: `/api/calendar/subscribe/feed/${token}`,
    token,
    message: '订阅链接已重新生成，旧链接已失效'
  });
});

router.delete('/subscribe', authenticateToken, (req, res) => {
  const existing = get(
    'SELECT * FROM calendar_subscriptions WHERE user_id = ? AND is_active = 1',
    [req.user.id]
  );

  if (!existing) {
    throw new AppError('没有有效的订阅链接', 404);
  }

  run(
    'UPDATE calendar_subscriptions SET is_active = 0, revoked_at = CURRENT_TIMESTAMP WHERE id = ?',
    [existing.id]
  );

  logAudit(req.user.id, ACTIONS.CALENDAR_SUBSCRIBE_REVOKE, {
    details: {
      type: 'subscription_revoked',
      subscription_id: existing.id
    },
    ipAddress: getIpAddress(req)
  });

  res.json({ message: '订阅链接已撤销' });
});

router.get('/rooms/:id/ics', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;

  const room = get('SELECT * FROM rooms WHERE id = ?', [id]);
  if (!room) {
    throw new AppError('房间不存在', 404);
  }

  const reservations = getRoomReservations(id);
  const ics = generateRoomIcs(reservations, room.name);

  logAudit(req.user.id, ACTIONS.CALENDAR_ROOM_EXPORT_ICS, {
    details: {
      type: 'room_export',
      room_id: id,
      room_name: room.name,
      event_count: reservations.length
    },
    ipAddress: getIpAddress(req)
  });

  const filename = `room_${id}_${room.name}.ics`;
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.send(ics);
});

module.exports = router;
