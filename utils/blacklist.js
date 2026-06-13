const { get } = require('../db');

function isBlacklisted(userId) {
  const now = new Date().toISOString().split('T')[0];
  const record = get(
    `SELECT * FROM blacklist 
     WHERE user_id = ? 
       AND (is_permanent = 1 OR (start_date <= ? AND (end_date IS NULL OR end_date >= ?)))
     ORDER BY created_at DESC LIMIT 1`,
    [userId, now, now]
  );
  return record ? record : null;
}

module.exports = {
  isBlacklisted
};
