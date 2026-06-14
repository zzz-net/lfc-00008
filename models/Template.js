const { run, get, all } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');

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

class Template {
  static create(data, userId) {
    const { name, tags, room_id, start_time, end_time, day_of_week, purpose, attendees, config } = data;
    
    const tagsStr = parseTags(tags);
    const configStr = config ? JSON.stringify(config) : null;
    
    const result = run(
      `INSERT INTO reservation_templates 
       (user_id, name, tags, room_id, start_time, end_time, day_of_week, purpose, attendees, config)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, name, tagsStr, room_id, start_time, end_time, day_of_week || null, purpose || null, attendees || null, configStr]
    );

    const template = this.findById(result.lastInsertRowid);
    
    logAudit(userId, ACTIONS.CREATE_TEMPLATE, {
      details: {
        templateId: template.id,
        name,
        room_id,
        start_time,
        end_time
      }
    });

    return formatTemplate(template);
  }

  static findById(id) {
    return get(
      `SELECT t.*, 
              rm.name as room_name,
              u.username as user_name
       FROM reservation_templates t
       JOIN rooms rm ON t.room_id = rm.id
       JOIN users u ON t.user_id = u.id
       WHERE t.id = ?`,
      [id]
    );
  }

  static findAll(filters = {}, user = null) {
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

    if (user && user.role !== 'admin') {
      sql += ' AND t.user_id = ?';
      params.push(user.id);
    }

    if (filters.room_id) {
      sql += ' AND t.room_id = ?';
      params.push(filters.room_id);
    }

    sql += ' ORDER BY t.updated_at DESC';
    let templates = all(sql, params);

    if (filters.tag) {
      templates = templates.filter(t => {
        if (!t.tags) return false;
        try {
          const tags = JSON.parse(t.tags);
          return tags.includes(filters.tag);
        } catch {
          return false;
        }
      });
    }

    return templates.map(formatTemplate);
  }

  static findByUserAndName(userId, name, excludeId = null) {
    if (excludeId) {
      return get('SELECT id FROM reservation_templates WHERE user_id = ? AND name = ? AND id != ?', [userId, name, excludeId]);
    }
    return get('SELECT id FROM reservation_templates WHERE user_id = ? AND name = ?', [userId, name]);
  }

  static update(id, updates, userId) {
    const template = get('SELECT * FROM reservation_templates WHERE id = ?', [id]);
    
    const tagsStr = updates.tags !== undefined ? parseTags(updates.tags) : template.tags;
    const configStr = updates.config !== undefined ? JSON.stringify(updates.config) : template.config;
    
    let dayOfWeekSql = 'day_of_week = day_of_week';
    let dayOfWeekValue = null;
    if (updates.day_of_week !== undefined) {
      dayOfWeekSql = 'day_of_week = ?';
      dayOfWeekValue = updates.day_of_week;
    }

    const params = [updates.name, tagsStr, updates.room_id, updates.start_time, updates.end_time];
    if (updates.day_of_week !== undefined) {
      params.push(dayOfWeekValue);
    }
    params.push(updates.purpose, updates.attendees, configStr, id);

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

    logAudit(userId, ACTIONS.UPDATE_TEMPLATE, {
      details: {
        templateId: id,
        changes: updates
      }
    });

    return formatTemplate(this.findById(id));
  }

  static delete(id, userId) {
    const template = this.findById(id);
    
    run('DELETE FROM reservation_templates WHERE id = ?', [id]);
    
    logAudit(userId, ACTIONS.DELETE_TEMPLATE, {
      details: {
        templateId: id,
        name: template.name
      }
    });
  }

  static format(data) {
    return formatTemplate(data);
  }
}

module.exports = Template;
