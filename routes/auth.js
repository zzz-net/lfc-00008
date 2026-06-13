const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { get } = require('../db');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config');
const { logAudit, ACTIONS } = require('../utils/audit');

const router = express.Router();

router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }

  const user = get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  logAudit(user.id, ACTIONS.LOGIN, { ipAddress: req.ip });

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role
    }
  });
});

module.exports = router;
