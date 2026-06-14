class AppError extends Error {
  constructor(message, statusCode = 400, data = null, code = 'BAD_REQUEST') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.data = data;
    this.isOperational = true;
  }
}

function validateBody(schema) {
  return (req, res, next) => {
    const errors = [];
    
    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];
      
      if (rules.required && (value === undefined || value === null || value === '')) {
        errors.push({ field, message: `${rules.label || field} 不能为空` });
        continue;
      }
      
      if (value === undefined || value === null) continue;
      
      if (rules.type && !checkType(value, rules.type)) {
        errors.push({ field, message: `${rules.label || field} 必须是 ${rules.type} 类型` });
        continue;
      }
      
      if (rules.type === 'integer' && !Number.isInteger(value)) {
        errors.push({ field, message: `${rules.label || field} 必须是整数` });
        continue;
      }
      
      if (rules.min !== undefined && value < rules.min) {
        errors.push({ field, message: `${rules.label || field} 不能小于 ${rules.min}` });
        continue;
      }
      
      if (rules.max !== undefined && value > rules.max) {
        errors.push({ field, message: `${rules.label || field} 不能大于 ${rules.max}` });
        continue;
      }
      
      if (rules.minLength !== undefined && value.length < rules.minLength) {
        errors.push({ field, message: `${rules.label || field} 长度不能小于 ${rules.minLength}` });
        continue;
      }
      
      if (rules.maxLength !== undefined && value.length > rules.maxLength) {
        errors.push({ field, message: `${rules.label || field} 长度不能大于 ${rules.maxLength}` });
        continue;
      }
      
      if (rules.pattern && !rules.pattern.test(value)) {
        errors.push({ field, message: rules.patternMessage || `${rules.label || field} 格式不正确` });
        continue;
      }
      
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push({ field, message: `${rules.label || field} 必须是 ${rules.enum.join(', ')} 之一` });
        continue;
      }
      
      if (rules.custom && typeof rules.custom === 'function') {
        const customError = rules.custom(value, req.body);
        if (customError) {
          errors.push({ field, message: customError });
        }
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({
        error: '参数验证失败',
        details: errors
      });
    }
    
    next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const errors = [];
    
    for (const [field, rules] of Object.entries(schema)) {
      const value = req.query[field];
      
      if (rules.required && (value === undefined || value === '')) {
        errors.push({ field, message: `${rules.label || field} 不能为空` });
        continue;
      }
      
      if (value === undefined) continue;
      
      if (rules.type === 'integer') {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed) || !Number.isInteger(parsed)) {
          errors.push({ field, message: `${rules.label || field} 必须是整数` });
          continue;
        }
        req.query[field] = parsed;
      }
      
      if (rules.type === 'number') {
        const parsed = parseFloat(value);
        if (isNaN(parsed)) {
          errors.push({ field, message: `${rules.label || field} 必须是数字` });
          continue;
        }
        req.query[field] = parsed;
      }
      
      const parsedValue = req.query[field];
      
      if (rules.min !== undefined && parsedValue < rules.min) {
        errors.push({ field, message: `${rules.label || field} 不能小于 ${rules.min}` });
        continue;
      }
      
      if (rules.max !== undefined && parsedValue > rules.max) {
        errors.push({ field, message: `${rules.label || field} 不能大于 ${rules.max}` });
        continue;
      }
      
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push({ field, message: `${rules.label || field} 必须是 ${rules.enum.join(', ')} 之一` });
        continue;
      }
      
      if (rules.pattern && !rules.pattern.test(value)) {
        errors.push({ field, message: rules.patternMessage || `${rules.label || field} 格式不正确` });
        continue;
      }
    }
    
    if (errors.length > 0) {
      return res.status(400).json({
        error: '参数验证失败',
        details: errors
      });
    }
    
    next();
  };
}

function checkType(value, type) {
  if (Array.isArray(type)) {
    return type.some(t => checkType(value, t));
  }
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'date':
      return value instanceof Date || !isNaN(Date.parse(value));
    default:
      return true;
  }
}

function validateTimeFormat(value) {
  const regex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
  return regex.test(value);
}

function validateDateFormat(value) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  return regex.test(value);
}

function validateISODateTime(value) {
  const date = new Date(value);
  return !isNaN(date.getTime()) && value.includes('T') && value.includes('Z');
}

module.exports = {
  AppError,
  validateBody,
  validateQuery,
  validateTimeFormat,
  validateDateFormat,
  validateISODateTime
};
