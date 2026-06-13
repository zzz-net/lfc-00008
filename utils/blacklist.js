const { get } = require('../db');

function getLocalDateStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isBlacklisted(userId) {
  const today = getLocalDateStr();
  const record = get(
    `SELECT * FROM blacklist 
     WHERE user_id = ? 
       AND (is_permanent = 1 OR (start_date <= ? AND (end_date IS NULL OR end_date >= ?)))
     ORDER BY created_at DESC LIMIT 1`,
    [userId, today, today]
  );
  return record ? record : null;
}

module.exports = {
  isBlacklisted,
  getLocalDateStr
};
