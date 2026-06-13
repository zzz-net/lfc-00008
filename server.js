const express = require('express');
const { initDatabase } = require('./db');
const { PORT } = require('./config');
const { startExpireScheduler } = require('./utils/expire');

const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const timeSlotRoutes = require('./routes/timeSlots');
const reservationRoutes = require('./routes/reservations');
const approvalRoutes = require('./routes/approvals');
const blacklistRoutes = require('./routes/blacklist');
const approvalRuleRoutes = require('./routes/approvalRules');
const auditLogRoutes = require('./routes/auditLogs');

const app = express();

app.use(express.json());

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/time-slots', timeSlotRoutes);
app.use('/api/reservations', reservationRoutes);
app.use('/api/reservations', approvalRoutes);
app.use('/api/blacklist', blacklistRoutes);
app.use('/api/approval-rules', approvalRuleRoutes);
app.use('/api/audit-logs', auditLogRoutes);

app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: '服务器内部错误', message: err.message });
});

app.use((req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

initDatabase();

let scheduler;
try {
  scheduler = startExpireScheduler(60000);
} catch (err) {
  console.error('Failed to start expire scheduler:', err);
}

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  if (scheduler) clearInterval(scheduler);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  if (scheduler) clearInterval(scheduler);
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Default accounts:');
  console.log('  admin / admin123 (admin)');
  console.log('  user1 / user123 (user)');
  console.log('  user2 / user456 (user)');
});
