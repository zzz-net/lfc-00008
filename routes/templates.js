const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { validateBody, validateQuery, AppError } = require('../middleware/validate');
const { run, get, all, transaction } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');
const { isBlacklisted } = require('../utils/blacklist');
const { RESERVATION_STATUSES } = require('../utils/approvalUtils');
const {
  hasTimeConflict,
  getConflictingReservations,
  calculateExpireAt,
  validateTimeFormat,
  validateDateFormat,
  buildDateTime,
  getLocalDayOfWeek,
  isFutureDateTime
} = require('../utils/timeUtils');

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

function canViewTemplate(template, user) {
  if (!template) return { allowed: false, error: '模板不存在', status: 404 };
  if (user.role !== 'admin' && template.user_id !== user.id) {
    return { allowed: false, error: '无权查看此模板', status: 403 };
  }
  return { allowed: true };
}

function canModifyTemplate(template, user) {
  if (!template) return { allowed: false, error: '模板不存在', status: 404 };
  if (user.role !== 'admin' && template.user_id !== user.id) {
    return { allowed: false, error: '无权修改此模板', status: 403 };
  }
  return { allowed: true };
}

const listQuerySchema = {
  tag: { type: 'string', label: '标签' },
  room_id: { type: 'integer', label: '房间ID' }
};

const createSchema = {
  name: { required: true, type: 'string', minLength: 1, label: '模板名称' },
  tags: { type: ['string', 'array'], label: '标签' },
  room_id: { required: true, type: 'integer', label: '房间ID' },
  start_time: { required: true, type: 'string', custom: (v) => validateTimeFormat(v) ? null : '时间格式无效，请使用 HH:MM 格式', label: '开始时间' },
  end_time: { required: true, type: 'string', custom: (v) => validateTimeFormat(v) ? null : '时间格式无效，请使用 HH:MM 格式', label: '结束时间' },
  day_of_week: { type: 'integer', min: 0, max: 6, label: '星期几' },
  purpose: { type: 'string', label: '用途' },
  attendees: { type: 'integer', min: 1, label: '参会人数' },
  config: { type: 'object', label: '配置' }
};

const updateSchema = {
  name: { type: 'string', minLength: 1, label: '模板名称' },
  tags: { type: ['string', 'array'], label: '标签' },
  room_id: { type: 'integer', label: '房间ID' },
  start_time: { type: 'string', custom: (v) => v === undefined || validateTimeFormat(v) ? null : '时间格式无效，请使用 HH:MM 格式', label: '开始时间' },
  end_time: { type: 'string', custom: (v) => v === undefined || validateTimeFormat(v) ? null : '时间格式无效，请使用 HH:MM 格式', label: '结束时间' },
  day_of_week: { type: 'integer', min: 0, max: 6, label: '星期几' },
  purpose: { type: 'string', label: '用途' },
  attendees: { type: 'integer', min: 1, label: '参会人数' },
  config: { type: 'object', label: '配置' }
};

const createReservationSchema = {
  date: { required: true, type: 'string', custom: (v) => validateDateFormat(v) ? null : '日期格式无效，请使用 YYYY-MM-DD 格式', label: '预约日期' },
  purpose: { type: 'string', label: '用途' },
  attendees: { type: 'integer', min: 1, label: '参会人数' }
};

const importSchema = {
  template: { required: true, type: 'object', label: '模板数据' }
};

router.get('/', authenticateToken, validateQuery(listQuerySchema), (req, res) => {
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
  const params = [];

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

  const viewCheck = canViewTemplate(template, req.user);
  if (!viewCheck.allowed) {
    throw new AppError(viewCheck.error, viewCheck.status);
  }

  res.json(formatTemplate(template));
});

router.post('/', authenticateToken, validateBody(createSchema), (req, res) => {
  const { name, tags, room_id, start_time, end_time, day_of_week, purpose, attendees, config } = req.body;

  if (start_time >= end_time) {
    throw new AppError('开始时间必须早于结束时间', 400);
  }

  const room = get('SELECT * FROM rooms WHERE id = ? AND status = ?', [room_id, 'active']);
  if (!room) {
    throw new AppError('房间不存在或未启用', 404);
  }

  const existing = get('SELECT id FROM reservation_templates WHERE user_id = ? AND name = ?', [req.user.id, name]);
  if (existing) {
    throw new AppError('您已有同名模板', 400);
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

router.put('/:id', authenticateToken, validateBody(updateSchema), (req, res) => {
  const { id } = req.params;
  const template = get('SELECT * FROM reservation_templates WHERE id = ?', [id]);

  const modifyCheck = canModifyTemplate(template, req.user);
  if (!modifyCheck.allowed) {
    throw new AppError(modifyCheck.error, modifyCheck.status);
  }

  const newStartTime = req.body.start_time || template.start_time;
  const newEndTime = req.body.end_time || template.end_time;

  if (newStartTime >= newEndTime) {
    throw new AppError('开始时间必须早于结束时间', 400);
  }

  if (req.body.room_id) {
    const room = get('SELECT * FROM rooms WHERE id = ? AND status = ?', [req.body.room_id, 'active']);
    if (!room) {
      throw new AppError('房间不存在或未启用', 404);
    }
  }

  if (req.body.name && req.body.name !== template.name) {
    const existing = get('SELECT id FROM reservation_templates WHERE user_id = ? AND name = ? AND id != ?', [template.user_id, req.body.name, id]);
    if (existing) {
      throw new AppError('您已有同名模板', 400);
    }
  }

  const tagsStr = req.body.tags !== undefined ? parseTags(req.body.tags) : template.tags;
  const configStr = req.body.config !== undefined ? JSON.stringify(req.body.config) : template.config;

  let dayOfWeekSql = 'day_of_week = day_of_week';
  let dayOfWeekValue = null;
  if (req.body.day_of_week !== undefined) {
    dayOfWeekSql = 'day_of_week = ?';
    dayOfWeekValue = req.body.day_of_week;
  }

  const params = [req.body.name, tagsStr, req.body.room_id, req.body.start_time, req.body.end_time];
  if (req.body.day_of_week !== undefined) {
    params.push(dayOfWeekValue);
  }
  params.push(req.body.purpose, req.body.attendees, configStr, id);

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

  const modifyCheck = canModifyTemplate(template, req.user);
  if (!modifyCheck.allowed) {
    throw new AppError(modifyCheck.error, modifyCheck.status);
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

router.post('/:id/create-reservation', authenticateToken, validateBody(createReservationSchema), (req, res) => {
  const { id } = req.params;
  const { date, purpose, attendees } = req.body;

  const template = get('SELECT * FROM reservation_templates WHERE id = ?', [id]);
  if (!template) {
    throw new AppError('模板不存在', 404);
  }

  const viewCheck = canViewTemplate(template, req.user);
  if (!viewCheck.allowed) {
    throw new AppError(viewCheck.error, viewCheck.status);
  }

  const room = get('SELECT * FROM rooms WHERE id = ? AND status = ?', [template.room_id, 'active']);
  if (!room) {
    throw new AppError('模板关联的房间不存在或未启用', 404);
  }

  if (template.day_of_week !== null && template.day_of_week !== undefined) {
    const requestedDay = getLocalDayOfWeek(date);
    if (requestedDay !== template.day_of_week) {
      const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      throw new AppError(`模板限定为${dayNames[template.day_of_week]}，选择的日期是${dayNames[requestedDay]}`, 400, {
        expected_day_of_week: template.day_of_week,
        actual_day_of_week: requestedDay
      });
    }
  }

  const start_datetime = buildDateTime(date, template.start_time);
  const end_datetime = buildDateTime(date, template.end_time);

  if (!isFutureDateTime(start_datetime)) {
    throw new AppError('预约开始时间必须晚于当前时间', 400);
  }

  const blacklistRecord = isBlacklisted(req.user.id);
  if (blacklistRecord) {
    throw new AppError('您已被列入黑名单，无法预约', 403, {
      reason: blacklistRecord.reason,
      end_date: blacklistRecord.end_date
    });
  }

  if (hasTimeConflict(template.room_id, start_datetime, end_datetime)) {
    const conflictingReservations = getConflictingReservations(template.room_id, start_datetime, end_datetime);
    throw new AppError('该时段已被其他预约占用', 409, {
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

  const viewCheck = canViewTemplate(template, req.user);
  if (!viewCheck.allowed) {
    throw new AppError(viewCheck.error, viewCheck.status);
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
  res.setHeader('Content-Disposition', `attachment; filename="template_${safeName}.json"`);
  res.json(exportData);
});

router.post('/import', authenticateToken, validateBody(importSchema), (req, res) => {
  const data = req.body;
  const template = data.template;

  if (!template.name || !template.room_id || !template.start_time || !template.end_time) {
    throw new AppError('模板数据不完整，缺少必要字段', 400);
  }

  if (!validateTimeFormat(template.start_time) || !validateTimeFormat(template.end_time)) {
    throw new AppError('时间格式无效，请使用 HH:MM 格式', 400);
  }

  if (template.start_time >= template.end_time) {
    throw new AppError('开始时间必须早于结束时间', 400);
  }

  let room = get('SELECT * FROM rooms WHERE id = ? AND status = ?', [template.room_id, 'active']);
  if (!room) {
    if (template.room_name) {
      const roomByName = get('SELECT * FROM rooms WHERE name = ? AND status = ?', [template.room_name, 'active']);
      if (!roomByName) {
        throw new AppError('模板关联的房间不存在，请先创建房间或修改模板', 404, {
          room_id: template.room_id,
          room_name: template.room_name
        });
      }
      template.room_id = roomByName.id;
    } else {
      throw new AppError('模板关联的房间不存在，请先创建房间或修改模板', 404, {
        room_id: template.room_id
      });
    }
  }

  const existing = get('SELECT id FROM reservation_templates WHERE user_id = ? AND name = ?', [req.user.id, template.name]);
  if (existing) {
    throw new AppError('您已有同名模板，请修改名称后重新导入', 400);
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
