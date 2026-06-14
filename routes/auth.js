const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { validateBody, AppError } = require('../middleware/validate');
const { get } = require('../db');
const { JWT_SECRET, JWT_EXPIRES_IN } = require('../config');
const { logAudit, ACTIONS } = require('../utils/audit');

const router = express.Router();

const loginSchema = {
  username: { required: true, type: 'string', minLength: 1, label: '用户名' },
  password: { required: true, type: 'string', minLength: 1, label: '密码' }
};

router.post('/login', validateBody(loginSchema), (req, res) => {
  const { username, password } = req.body;

  const user = get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) {
    throw new AppError('用户名或密码错误', 401);
  }

  const isValid = bcrypt.compareSync(password, user.password_hash);
  if (!isValid) {
    throw new AppError('用户名或密码错误', 401);
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
