const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { all } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');
const { STATS_MAX_RANGE_DAYS, STATS_EXPORT_FORMATS, STATS_DEFAULT_FORMAT } = require('../config');

const router = express.Router();

if (!ACTIONS.EXPORT_STATS) {
  ACTIONS.EXPORT_STATS = 'export_stats';
}

function getIpAddress(req) {
  return req.ip || req.connection.remoteAddress || null;
}

function validateDateRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: '日期格式无效，请使用 YYYY-MM-DD 格式' };
  }

  if (start > end) {
    return { valid: false, error: '开始日期不能晚于结束日期' };
  }

  const diffDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays > STATS_MAX_RANGE_DAYS) {
    return { valid: false, error: `统计范围不能超过 ${STATS_MAX_RANGE_DAYS} 天` };
  }

  return { valid: true, start, end };
}

function validateFormat(format) {
  const fmt = (format || STATS_DEFAULT_FORMAT).toLowerCase();
  if (!STATS_EXPORT_FORMATS.includes(fmt)) {
    return { valid: false, error: `不支持的导出格式，支持的格式: ${STATS_EXPORT_FORMATS.join(', ')}` };
  }
  return { valid: true, format: fmt };
}

function jsonToCsv(data, columns) {
  const header = columns.map(c => c.label).join(',');
  const rows = data.map(row =>
    columns.map(col => {
      let val = row[col.key] !== undefined ? row[col.key] : '';
      val = String(val);
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

function sendResponse(res, format, data, columns, filename) {
  if (format === 'csv') {
    const csv = jsonToCsv(data, columns);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
    res.send('\uFEFF' + csv);
  } else {
    res.json({ data });
  }
}

function buildUserFilter(user, sqlParts, params) {
  if (user.role !== 'admin') {
    sqlParts.push('r.user_id = ?');
    params.push(user.id);
  }
}

router.get('/rooms', authenticateToken, (req, res) => {
  const { start_date, end_date, group_by = 'month', format } = req.query;

  const formatCheck = validateFormat(format);
  if (!formatCheck.valid) {
    return res.status(400).json({ error: formatCheck.error });
  }

  const start = start_date ? start_date : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const end = end_date ? end_date : new Date().toISOString().split('T')[0];

  const dateCheck = validateDateRange(start, end);
  if (!dateCheck.valid) {
    return res.status(400).json({ error: dateCheck.error });
  }

  if (!['month', 'week', 'day'].includes(group_by)) {
    return res.status(400).json({ error: 'group_by 必须是 month、week 或 day' });
  }

  const sqlParts = [
    "r.status IN ('approved', 'checked_in', 'completed')",
    'DATE(r.start_datetime) >= ?',
    'DATE(r.start_datetime) <= ?'
  ];
  const params = [start, end];

  buildUserFilter(req.user, sqlParts, params);

  let dateFormat;
  switch (group_by) {
    case 'month':
      dateFormat = "strftime('%Y-%m', r.start_datetime)";
      break;
    case 'week':
      dateFormat = "strftime('%Y-W%W', r.start_datetime)";
      break;
    case 'day':
    default:
      dateFormat = "strftime('%Y-%m-%d', r.start_datetime)";
      break;
  }

  const sql = `
    SELECT 
      rm.id as room_id,
      rm.name as room_name,
      ${dateFormat} as period,
      COUNT(r.id) as reservation_count,
      ROUND(SUM((julianday(r.end_datetime) - julianday(r.start_datetime)) * 24 * 60), 2) as total_duration_minutes
    FROM reservations r
    JOIN rooms rm ON r.room_id = rm.id
    WHERE ${sqlParts.join(' AND ')}
    GROUP BY rm.id, rm.name, period
    ORDER BY period ASC, room_name ASC
  `;

  const results = all(sql, params);

  const data = results.map(r => ({
    room_id: r.room_id,
    room_name: r.room_name,
    period: r.period,
    reservation_count: r.reservation_count,
    total_duration_minutes: r.total_duration_minutes,
    total_duration_hours: Math.round(r.total_duration_minutes / 60 * 100) / 100
  }));

  logAudit(req.user.id, ACTIONS.EXPORT_STATS, {
    details: {
      report_type: 'room_usage',
      start_date: start,
      end_date: end,
      group_by,
      format: formatCheck.format,
      record_count: data.length,
      is_admin: req.user.role === 'admin'
    },
    ipAddress: getIpAddress(req)
  });

  const columns = [
    { key: 'room_id', label: '房间ID' },
    { key: 'room_name', label: '房间名称' },
    { key: 'period', label: '统计周期' },
    { key: 'reservation_count', label: '预约次数' },
    { key: 'total_duration_minutes', label: '总时长(分钟)' },
    { key: 'total_duration_hours', label: '总时长(小时)' }
  ];

  sendResponse(res, formatCheck.format, data, columns, `room_usage_${start}_${end}`);
});

router.get('/users', authenticateToken, (req, res) => {
  const { start_date, end_date, format } = req.query;

  const formatCheck = validateFormat(format);
  if (!formatCheck.valid) {
    return res.status(400).json({ error: formatCheck.error });
  }

  const start = start_date ? start_date : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const end = end_date ? end_date : new Date().toISOString().split('T')[0];

  const dateCheck = validateDateRange(start, end);
  if (!dateCheck.valid) {
    return res.status(400).json({ error: dateCheck.error });
  }

  const joinConditions = [
    'u.id = r.user_id',
    'DATE(r.created_at) >= ?',
    'DATE(r.created_at) <= ?'
  ];
  const params = [start, end];

  const whereConditions = [];
  if (req.user.role !== 'admin') {
    whereConditions.push('u.id = ?');
    params.push(req.user.id);
  }

  const whereSql = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

  const sql = `
    SELECT 
      u.id as user_id,
      u.username as user_name,
      u.role,
      COUNT(r.id) as total_reservations,
      SUM(CASE WHEN r.status = 'canceled' THEN 1 ELSE 0 END) as canceled_count,
      SUM(CASE WHEN r.status = 'checked_in' OR r.status = 'completed' THEN 1 ELSE 0 END) as checked_in_count,
      SUM(CASE WHEN r.status IN ('approved', 'checked_in', 'completed') THEN 1 ELSE 0 END) as approved_count
    FROM users u
    LEFT JOIN reservations r ON ${joinConditions.join(' AND ')}
    ${whereSql}
    GROUP BY u.id, u.username, u.role
    ORDER BY total_reservations DESC
  `;

  const results = all(sql, params);

  const data = results.map(r => {
    const total = r.total_reservations || 0;
    const approved = r.approved_count || 0;
    const canceled = r.canceled_count || 0;
    const checkedIn = r.checked_in_count || 0;

    return {
      user_id: r.user_id,
      user_name: r.user_name,
      role: r.role,
      total_reservations: total,
      canceled_count: canceled,
      checked_in_count: checkedIn,
      approved_count: approved,
      cancel_rate: total > 0 ? Math.round((canceled / total) * 10000) / 100 : 0,
      checkin_rate: approved > 0 ? Math.round((checkedIn / approved) * 10000) / 100 : 0
    };
  });

  logAudit(req.user.id, ACTIONS.EXPORT_STATS, {
    details: {
      report_type: 'user_behavior',
      start_date: start,
      end_date: end,
      format: formatCheck.format,
      record_count: data.length,
      is_admin: req.user.role === 'admin'
    },
    ipAddress: getIpAddress(req)
  });

  const columns = [
    { key: 'user_id', label: '用户ID' },
    { key: 'user_name', label: '用户名' },
    { key: 'role', label: '角色' },
    { key: 'total_reservations', label: '预约总数' },
    { key: 'approved_count', label: '已通过数' },
    { key: 'canceled_count', label: '已取消数' },
    { key: 'checked_in_count', label: '已签到数' },
    { key: 'cancel_rate', label: '取消率(%)' },
    { key: 'checkin_rate', label: '签到率(%)' }
  ];

  sendResponse(res, formatCheck.format, data, columns, `user_behavior_${start}_${end}`);
});

router.get('/heatmap', authenticateToken, (req, res) => {
  const { start_date, end_date, format } = req.query;

  const formatCheck = validateFormat(format);
  if (!formatCheck.valid) {
    return res.status(400).json({ error: formatCheck.error });
  }

  const start = start_date ? start_date : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const end = end_date ? end_date : new Date().toISOString().split('T')[0];

  const dateCheck = validateDateRange(start, end);
  if (!dateCheck.valid) {
    return res.status(400).json({ error: dateCheck.error });
  }

  const sqlParts = [
    "r.status IN ('approved', 'checked_in', 'completed')",
    'DATE(r.start_datetime) >= ?',
    'DATE(r.start_datetime) <= ?'
  ];
  const params = [start, end];

  buildUserFilter(req.user, sqlParts, params);

  const sql = `
    SELECT 
      CAST(strftime('%H', r.start_datetime) AS INTEGER) as hour,
      COUNT(r.id) as reservation_count,
      ROUND(SUM((julianday(r.end_datetime) - julianday(r.start_datetime)) * 24 * 60), 2) as total_duration_minutes
    FROM reservations r
    WHERE ${sqlParts.join(' AND ')}
    GROUP BY hour
    ORDER BY hour ASC
  `;

  const results = all(sql, params);

  const hourMap = {};
  results.forEach(r => {
    hourMap[r.hour] = {
      reservation_count: r.reservation_count,
      total_duration_minutes: r.total_duration_minutes,
      total_duration_hours: Math.round(r.total_duration_minutes / 60 * 100) / 100
    };
  });

  const data = [];
  for (let h = 0; h < 24; h++) {
    data.push({
      hour: h,
      hour_label: `${h.toString().padStart(2, '0')}:00`,
      reservation_count: hourMap[h]?.reservation_count || 0,
      total_duration_minutes: hourMap[h]?.total_duration_minutes || 0,
      total_duration_hours: hourMap[h]?.total_duration_hours || 0
    });
  }

  logAudit(req.user.id, ACTIONS.EXPORT_STATS, {
    details: {
      report_type: 'heatmap',
      start_date: start,
      end_date: end,
      format: formatCheck.format,
      record_count: data.length,
      is_admin: req.user.role === 'admin'
    },
    ipAddress: getIpAddress(req)
  });

  const columns = [
    { key: 'hour', label: '小时' },
    { key: 'hour_label', label: '时段' },
    { key: 'reservation_count', label: '预约次数' },
    { key: 'total_duration_minutes', label: '总时长(分钟)' },
    { key: 'total_duration_hours', label: '总时长(小时)' }
  ];

  sendResponse(res, formatCheck.format, data, columns, `heatmap_${start}_${end}`);
});

module.exports = router;
