const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { run, get, all, transaction } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');
const { isBlacklisted } = require('../utils/blacklist');
const { hasTimeConflict, calculateExpireAt, RESERVATION_STATUSES } = require('../utils/reservation');

const router = express.Router();

function parseTags(tags) {
  if (!tags) return null;
  if (Array.isArray(tags)) return JSON.stringify(tags);
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags);
      return JSON.stringify(parsed);
    } catch {
      return JSON.stringify([tags]);
    }
  }
  return null;
}

function formatTemplate(template) {
  if (!template) return null;
  const result = { ...template };
  if (template.tags) {
    try {
      result.tags = JSON.parse(template.tags);
    } catch {
      result.tags = [];
    }
  } else {
    result.tags = [];
  }
  if (template.config) {
    try {
      result.config = JSON.parse(template.config);
    } catch {
      result.config = {};
    }
  } else {
    result.config = {};
  }
  return result;
}

function buildDateTime(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}`).toISOString();
}

function getLocalDayOfWeek(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getDay();
}

function validateTimeFormat(timeStr) {
  const regex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
  return regex.test(timeStr);
}

router.get('/', authenticateToken, (req, res) => {
  const { tag, room_id } = req.query;
  let sql = `
    SELECT t.*, 
           rm.name as room_name,
           u.username as user_name
    FROM reservation_templates t
    JOIN rooms rm ON t.room_id = rm.id
    JOIN users u ON t.user_id = u.id
    WHERE 1=1
  `;
  let params = [];

  if (req.user.role !== 'admin') {
    sql += ' AND t.user_id = ?';
    params.push(req.user.id);
  }

  if (room_id) {
    sql += ' AND t.room_id = ?';
    params.push(room_id);
  }

  sql += ' ORDER BY t.updated_at DESC';

  let templates = all(sql, params);

  if (tag) {
    templates = templates.filter(t => {
      if (!t.tags) return false;
      try {
        const tags = JSON.parse(t.tags);
        return tags.includes(tag);
      } catch {
        return false;
      }
    });
  }

  res.json(templates.map(formatTemplate));
});

router.get('/:id', authenticateToken, (req, res) => {
  const template = get(
    `SELECT t.*, 
            rm.name as room_name,
            u.username as user_name
     FROM reservation_templates t
     JOIN rooms rm ON t.room_id = rm.id
     JOIN users u ON t.user_id = u.id
     WHERE t.id = ?`,
    [req.params.id]
  );

  if (!template) {
    return res.status(404).json({ error: '模板不存在' });
  }

  if (req.user.role !== 'admin' && template.user_id !== req.user.id) {
    return res.status(403).json({ error: '无权查看此模板' });
  }

  res.json(formatTemplate(template));
});

router.post('/', authenticateToken, (req, res) => {
  const { name, tags, room_id, start_time, end_time, day_of_week, purpose, attendees, config } = req.body;

  if (!name || !room_id || !start_time || !end_time) {
    return res.status(400).json({ error: '模板名称、房间ID、开始时间和结束时间不能为空' });
  }

  if (!validateTimeFormat(start_time) || !validateTimeFormat(end_time)) {
    return res.status(400).json({ error: '时间格式无效，请使用 HH:MM 格式' });
  }

  if (start_time >= end_time) {
    return res.status(400).json({ error: '开始时间必须早于结束时间' });
  }

  if (day_of_week !== undefined && day_of_week !== null) {
    if (!Number.isInteger(day_of_week) || day_of_week < 0 || day_of_week > 6) {
      return res.status(400).json({ error: 'day_of_week 必须是 0-6 的整数' });
    }
  }

  const room = get('SELECT * FROM rooms WHERE id = ? AND status = ?', [room_id, 'active']);
  if (!room) {
    return res.status(404).json({ error: '房间不存在或未启用' });
  }

  const existing = get('SELECT id FROM reservation_templates WHERE user_id = ? AND name = ?', [req.user.id, name]);
  if (existing) {
    return res.status(400).json({ error: '您已有同名模板' });
  }

  const tagsStr = parseTags(tags);
  const configStr = config ? JSON.stringify(config) : null;

  const result = run(
    `INSERT INTO reservation_templates 
     (user_id, name, tags, room_id, start_time, end_time, day_of_week, purpose, attendees, config)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, name, tagsStr, room_id, start_time, end_time, day_of_week || null, purpose || null, attendees || null, configStr]
  );

  const template = get('SELECT * FROM reservation_templates WHERE id = ?', [result.lastInsertRowid]);

  logAudit(req.user.id, ACTIONS.CREATE_TEMPLATE, {
    details: {
      templateId: template.id,
      name,
      room_id,
      start_time,
      end_time
    }
  });

  res.status(201).json(formatTemplate(template));
});

router.put('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { name, tags, room_id, start_time, end_time, day_of_week, purpose, attendees, config } = req.body;

  const template = get('SELECT * FROM reservation_templates WHERE id = ?', [id]);
  if (!template) {
    return res.status(404).json({ error: '模板不存在' });
  }

  if (req.user.role !== 'admin' && template.user_id !== req.user.id) {
    return res.status(403).json({ error: '无权修改此模板' });
  }

  if (start_time && !validateTimeFormat(start_time)) {
    return res.status(400).json({ error: '开始时间格式无效，请使用 HH:MM 格式' });
  }

  if (end_time && !validateTimeFormat(end_time)) {
    return res.status(400).json({ error: '结束时间格式无效，请使用 HH:MM 格式' });
  }

  const newStartTime = start_time || template.start_time;
  const newEndTime = end_time || template.end_time;

  if (newStartTime >= newEndTime) {
    return res.status(400).json({ error: '开始时间必须早于结束时间' });
  }

  if (day_of_week !== undefined && day_of_week !== null) {
    if (!Number.isInteger(day_of_week) || day_of_week < 0 || day_of_week > 6) {
      return res.status(400).json({ error: 'day_of_week 必须是 0-6 的整数' });
    }
  }

  if (room_id) {
    const room = get('SELECT * FROM rooms WHERE id = ? AND status = ?', [room_id, 'active']);
    if (!room) {
      return res.status(404).json({ error: '房间不存在或未启用' });
    }
  }

  if (name && name !== template.name) {
    const existing = get('SELECT id FROM reservation_templates WHERE user_id = ? AND name = ? AND id != ?', [template.user_id, name, id]);
    if (existing) {
      return res.status(400).json({ error: '您已有同名模板' });
    }
  }

  const tagsStr = tags !== undefined ? parseTags(tags) : template.tags;
  const configStr = config !== undefined ? JSON.stringify(config) : template.config;

  let dayOfWeekValue;
  let dayOfWeekSql;
  if (day_of_week === undefined) {
    dayOfWeekSql = 'day_of_week = day_of_week';
    dayOfWeekValue = null;
  } else {
    dayOfWeekSql = 'day_of_week = ?';
    dayOfWeekValue = day_of_week;
  }

  const params = [name, tagsStr, room_id, start_time, end_time];
  if (day_of_week !== undefined) {
    params.push(dayOfWeekValue);
  }
  params.push(purpose, attendees, configStr, id);

  run(
    `UPDATE reservation_templates 
     SET name = COALESCE(?, name),
         tags = ?,
         room_id = COALESCE(?, room_id),
         start_time = COALESCE(?, start_time),
         end_time = COALESCE(?, end_time),
         ${dayOfWeekSql},
         purpose = COALESCE(?, purpose),
         attendees = COALESCE(?, attendees),
         config = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    params
  );

  const updated = get('SELECT * FROM reservation_templates WHERE id = ?', [id]);

  logAudit(req.user.id, ACTIONS.UPDATE_TEMPLATE, {
    details: {
      templateId: id,
      changes: req.body
    }
  });

  res.json(formatTemplate(updated));
});

router.delete('/:id', authenticateToken, (req, res) => {
  const { id } = req.params;

  const template = get('SELECT * FROM reservation_templates WHERE id = ?', [id]);
  if (!template) {
    return res.status(404).json({ error: '模板不存在' });
  }

  if (req.user.role !== 'admin' && template.user_id !== req.user.id) {
    return res.status(403).json({ error: '无权删除此模板' });
  }

  run('DELETE FROM reservation_templates WHERE id = ?', [id]);

  logAudit(req.user.id, ACTIONS.DELETE_TEMPLATE, {
    details: {
      templateId: id,
      name: template.name
    }
  });

  res.json({ message: '删除成功' });
});

router.post('/:id/create-reservation', authenticateToken, (req, res) => {
  const { id } = req.params;
  const { date, purpose, attendees } = req.body;

  if (!date) {
    return res.status(400).json({ error: '预约日期不能为空' });
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date)) {
    return res.status(400).json({ error: '日期格式无效，请使用 YYYY-MM-DD 格式' });
  }

  const template = get('SELECT * FROM reservation_templates WHERE id = ?', [id]);
  if (!template) {
    return res.status(404).json({ error: '模板不存在' });
  }

  if (req.user.role !== 'admin' && template.user_id !== req.user.id) {
    return res.status(403).json({ error: '无权使用此模板' });
  }

  const room = get('SELECT * FROM rooms WHERE id = ? AND status = ?', [template.room_id, 'active']);
  if (!room) {
    return res.status(404).json({ error: '模板关联的房间不存在或未启用' });
  }

  if (template.day_of_week !== null && template.day_of_week !== undefined) {
    const requestedDay = getLocalDayOfWeek(date);
    if (requestedDay !== template.day_of_week) {
      const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      return res.status(400).json({ 
        error: `模板限定为${dayNames[template.day_of_week]}，选择的日期是${dayNames[requestedDay]}`,
        expected_day_of_week: template.day_of_week,
        actual_day_of_week: requestedDay
      });
    }
  }

  const start_datetime = buildDateTime(date, template.start_time);
  const end_datetime = buildDateTime(date, template.end_time);

  const start = new Date(start_datetime);
  const end = new Date(end_datetime);

  if (start <= new Date()) {
    return res.status(400).json({ error: '预约开始时间必须晚于当前时间' });
  }

  const blacklistRecord = isBlacklisted(req.user.id);
  if (blacklistRecord) {
    return res.status(403).json({ 
      error: '您已被列入黑名单，无法预约',
      reason: blacklistRecord.reason,
      end_date: blacklistRecord.end_date
    });
  }

  if (hasTimeConflict(template.room_id, start_datetime, end_datetime)) {
    const conflictingReservations = all(
      `SELECT r.*, rm.name as room_name, u.username as user_name
       FROM reservations r
       JOIN rooms rm ON r.room_id = rm.id
       JOIN users u ON r.user_id = u.id
       WHERE r.room_id = ? 
         AND r.status IN ('approved', 'pending')
         AND r.start_datetime < ? 
         AND r.end_datetime > ?`,
      [template.room_id, end_datetime, start_datetime]
    );

    return res.status(409).json({ 
      error: '该时段已被其他预约占用',
      conflicts: conflictingReservations.map(r => ({
        reservation_id: r.id,
        user_name: r.user_name,
        start_datetime: r.start_datetime,
        end_datetime: r.end_datetime,
        purpose: r.purpose
      }))
    });
  }

  const expireAt = calculateExpireAt(start_datetime);
  const finalPurpose = purpose || template.purpose;
  const finalAttendees = attendees || template.attendees;

  const tx = transaction(() => {
    const result = run(
      `INSERT INTO reservations 
       (room_id, user_id, start_datetime, end_datetime, purpose, attendees, status, expire_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [template.room_id, req.user.id, start_datetime, end_datetime, finalPurpose || null, finalAttendees || null, RESERVATION_STATUSES.PENDING, expireAt]
    );

    const reservationId = result.lastInsertRowid;

    logAudit(req.user.id, ACTIONS.CREATE_RESERVATION_FROM_TEMPLATE, {
      reservationId,
      newStatus: RESERVATION_STATUSES.PENDING,
      details: {
        templateId: id,
        templateName: template.name,
        roomId: template.room_id,
        start_datetime,
        end_datetime,
        date
      }
    });

    logAudit(req.user.id, ACTIONS.CREATE_RESERVATION, {
      reservationId,
      newStatus: RESERVATION_STATUSES.PENDING,
      details: {
        roomId: template.room_id,
        start_datetime,
        end_datetime,
        fromTemplate: id,
        templateName: template.name
      }
    });

    return reservationId;
  });

  try {
    const reservationId = tx();
    const reservation = get(
      `SELECT r.*, rm.name as room_name, u.username as user_name
       FROM reservations r
       JOIN rooms rm ON r.room_id = rm.id
       JOIN users u ON r.user_id = u.id
       WHERE r.id = ?`,
      [reservationId]
    );
    res.status(201).json({
      ...reservation,
      from_template: id,
      template_name: template.name
    });
  } catch (err) {
    console.error('Create reservation from template error:', err);
    res.status(500).json({ error: '从模板创建预约失败' });
  }
});

router.get('/:id/export', authenticateToken, (req, res) => {
  const { id } = req.params;

  const template = get(
    `SELECT t.*, rm.name as room_name
     FROM reservation_templates t
     JOIN rooms rm ON t.room_id = rm.id
     WHERE t.id = ?`,
    [id]
  );

  if (!template) {
    return res.status(404).json({ error: '模板不存在' });
  }

  if (req.user.role !== 'admin' && template.user_id !== req.user.id) {
    return res.status(403).json({ error: '无权导出此模板' });
  }

  const exportData = {
    _schema_version: '1.0',
    _exported_at: new Date().toISOString(),
    template: {
      name: template.name,
      tags: template.tags ? JSON.parse(template.tags) : [],
      room_name: template.room_name,
      room_id: template.room_id,
      start_time: template.start_time,
      end_time: template.end_time,
      day_of_week: template.day_of_week,
      purpose: template.purpose,
      attendees: template.attendees,
      config: template.config ? JSON.parse(template.config) : {}
    }
  };

  logAudit(req.user.id, ACTIONS.EXPORT_TEMPLATE, {
    details: {
      templateId: id,
      name: template.name
    }
  });

  const safeName = template.name.replace(/[^a-zA-Z0-9]/g, '_');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="template_${safeName}.json`);
  res.json(exportData);
});

router.post('/import', authenticateToken, (req, res) => {
  const data = req.body;

  if (!data || !data.template) {
    return res.status(400).json({ error: '导入数据格式无效，缺少 template 字段' });
  }

  const template = data.template;

  if (!template.name || !template.room_id || !template.start_time || !template.end_time) {
    return res.status(400).json({ error: '模板数据不完整，缺少必要字段' });
  }

  if (!validateTimeFormat(template.start_time) || !validateTimeFormat(template.end_time)) {
    return res.status(400).json({ error: '时间格式无效，请使用 HH:MM 格式' });
  }

  if (template.start_time >= template.end_time) {
    return res.status(400).json({ error: '开始时间必须早于结束时间' });
  }

  const room = get('SELECT * FROM rooms WHERE id = ? AND status = ?', [template.room_id, 'active']);
  if (!room) {
    if (template.room_name) {
      const roomByName = get('SELECT * FROM rooms WHERE name = ? AND status = ?', [template.room_name, 'active']);
      if (!roomByName) {
        return res.status(404).json({ 
          error: '模板关联的房间不存在，请先创建房间或修改模板',
          room_id: template.room_id,
          room_name: template.room_name
        });
      }
      template.room_id = roomByName.id;
    } else {
      return res.status(404).json({ 
        error: '模板关联的房间不存在，请先创建房间或修改模板',
        room_id: template.room_id
      });
    }
  }

  const existing = get('SELECT id FROM reservation_templates WHERE user_id = ? AND name = ?', [req.user.id, template.name]);
  if (existing) {
    return res.status(400).json({ error: '您已有同名模板，请修改名称后重新导入' });
  }

  const tagsStr = parseTags(template.tags);
  const configStr = template.config ? JSON.stringify(template.config) : null;

  const result = run(
    `INSERT INTO reservation_templates 
     (user_id, name, tags, room_id, start_time, end_time, day_of_week, purpose, attendees, config)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, template.name, tagsStr, template.room_id, template.start_time, template.end_time, 
     template.day_of_week !== undefined ? template.day_of_week : null, 
     template.purpose || null, template.attendees || null, configStr]
  );

  const imported = get(
    `SELECT t.*, rm.name as room_name, u.username as user_name
     FROM reservation_templates t
     JOIN rooms rm ON t.room_id = rm.id
     JOIN users u ON t.user_id = u.id
     WHERE t.id = ?`,
    [result.lastInsertRowid]
  );

  logAudit(req.user.id, ACTIONS.IMPORT_TEMPLATE, {
    details: {
      templateId: imported.id,
      name: template.name,
      schema_version: data._schema_version
    }
  });

  res.status(201).json(formatTemplate(imported));
});

module.exports = router;
