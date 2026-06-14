module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'booking-secret-key-2024',
  JWT_EXPIRES_IN: '24h',
  CHECKIN_GRACE_MINUTES: 15,
  EXPIRE_AFTER_START_MINUTES: 30,
  MAX_RECURRING_OCCURRENCES: parseInt(process.env.MAX_RECURRING_OCCURRENCES) || 52,
  STATS_MAX_RANGE_DAYS: parseInt(process.env.STATS_MAX_RANGE_DAYS) || 365,
  STATS_EXPORT_FORMATS: ['json', 'csv'],
  STATS_DEFAULT_FORMAT: 'json',

  ICS_DEFAULT_TIMEZONE: process.env.ICS_DEFAULT_TIMEZONE || 'Asia/Shanghai',
  ICS_PRODUCT_ID: process.env.ICS_PRODUCT_ID || '-//CommunityRoomBooking//CN',
  ICS_CAL_NAME: process.env.ICS_CAL_NAME || '社区活动室预约',
  ICS_REFRESH_INTERVAL_HOURS: parseInt(process.env.ICS_REFRESH_INTERVAL_HOURS) || 4,
  ICS_FIELD_MAPPING: {
    summary: 'purpose',
    location: 'room_name',
    description: ['purpose', 'room_name', 'user_name', 'status'],
    dtstart: 'start_datetime',
    dtend: 'end_datetime',
    uid: 'id',
    organizer: 'user_name'
  }
};
