module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'booking-secret-key-2024',
  JWT_EXPIRES_IN: '24h',
  CHECKIN_GRACE_MINUTES: 15,
  EXPIRE_AFTER_START_MINUTES: 30,
  MAX_RECURRING_OCCURRENCES: parseInt(process.env.MAX_RECURRING_OCCURRENCES) || 52,
  STATS_MAX_RANGE_DAYS: parseInt(process.env.STATS_MAX_RANGE_DAYS) || 365,
  STATS_EXPORT_FORMATS: ['json', 'csv'],
  STATS_DEFAULT_FORMAT: 'json'
};
