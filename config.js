module.exports = {
  PORT: process.env.PORT || 3000,
  JWT_SECRET: process.env.JWT_SECRET || 'booking-secret-key-2024',
  JWT_EXPIRES_IN: '24h',
  CHECKIN_GRACE_MINUTES: 15,
  EXPIRE_AFTER_START_MINUTES: 30
};
