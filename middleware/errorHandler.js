function errorHandler(err, req, res, next) {
  console.error(`${new Date().toISOString()} Error:`, err);

  if (err.isOperational) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      ...err.data
    });
  }

  if (err.message && err.message.startsWith('CONFLICT:')) {
    return res.status(409).json({ 
      error: err.message.replace('CONFLICT:', '') 
    });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ error: '认证失败，请重新登录' });
  }

  if (err.name === 'ForbiddenError') {
    return res.status(403).json({ error: '权限不足' });
  }

  if (err.name === 'NotFoundError') {
    return res.status(404).json({ error: '资源不存在' });
  }

  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => ({
      field: e.path,
      message: e.message
    }));
    return res.status(400).json({
      error: '参数验证失败',
      details: errors
    });
  }

  if (err.code === 'SQLITE_CONSTRAINT') {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: '数据已存在，违反唯一约束' });
    }
    if (err.message.includes('FOREIGN KEY constraint failed')) {
      return res.status(400).json({ error: '关联数据不存在' });
    }
  }

  if (err.code === 'SQLITE_ERROR') {
    console.error('SQL Error:', err.message);
    return res.status(500).json({ error: '数据库操作失败' });
  }

  res.status(500).json({
    error: '服务器内部错误',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
}

function notFoundHandler(req, res, next) {
  res.status(404).json({ error: '接口不存在' });
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler
};
