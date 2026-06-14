const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { validateBody, AppError } = require('../middleware/validate');
const { run, get, all } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');

const router = express.Router();

const createSchema = {
  rule_name: { required: true, type: 'string', minLength: 1, label: '规则名称' },
  rule_type: { required: true, type: 'string', minLength: 1, label: '规则类型' },
  config: { type: 'object', label: '配置' },
  is_enabled: { type: 'boolean', label: '是否启用' }
};

const updateSchema = {
  rule_name: { type: 'string', minLength: 1, label: '规则名称' },
  rule_type: { type: 'string', minLength: 1, label: '规则类型' },
  config: { type: 'object', label: '配置' },
  is_enabled: { type: 'boolean', label: '是否启用' }
};

function parseConfig(rule) {
  if (!rule) return null;
  return {
    ...rule,
    config: rule.config ? JSON.parse(rule.config) : null
  };
}

router.get('/', authenticateToken, requireAdmin, (req, res) => {
  const rules = all('SELECT * FROM approval_rules ORDER BY created_at DESC');
  res.json(rules.map(parseConfig));
});

router.get('/:id', authenticateToken, requireAdmin, (req, res) => {
  const rule = get('SELECT * FROM approval_rules WHERE id = ?', [req.params.id]);
  if (!rule) {
    throw new AppError('规则不存在', 404);
  }
  res.json(parseConfig(rule));
});

router.post('/', authenticateToken, requireAdmin, validateBody(createSchema), (req, res) => {
  const { rule_name, rule_type, config, is_enabled = true } = req.body;

  const existing = get('SELECT id FROM approval_rules WHERE rule_name = ?', [rule_name]);
  if (existing) {
    throw new AppError('规则名称已存在', 400);
  }

  const configStr = config ? JSON.stringify(config) : null;

  const result = run(
    `INSERT INTO approval_rules (rule_name, rule_type, config, is_enabled)
     VALUES (?, ?, ?, ?)`,
    [rule_name, rule_type, configStr, is_enabled ? 1 : 0]
  );

  const rule = get('SELECT * FROM approval_rules WHERE id = ?', [result.lastInsertRowid]);
  
  logAudit(req.user.id, ACTIONS.UPDATE_APPROVAL_RULE, {
    details: { ruleId: rule.id, rule_name, rule_type, config }
  });

  res.status(201).json(parseConfig(rule));
});

router.put('/:id', authenticateToken, requireAdmin, validateBody(updateSchema), (req, res) => {
  const { id } = req.params;
  const { rule_name, rule_type, config, is_enabled } = req.body;

  const rule = get('SELECT * FROM approval_rules WHERE id = ?', [id]);
  if (!rule) {
    throw new AppError('规则不存在', 404);
  }

  if (rule_name && rule_name !== rule.rule_name) {
    const existing = get('SELECT id FROM approval_rules WHERE rule_name = ? AND id != ?', [rule_name, id]);
    if (existing) {
      throw new AppError('规则名称已存在', 400);
    }
  }

  const configStr = config !== undefined ? (config ? JSON.stringify(config) : null) : undefined;

  run(
    `UPDATE approval_rules 
     SET rule_name = COALESCE(?, rule_name),
         rule_type = COALESCE(?, rule_type),
         config = COALESCE(?, config),
         is_enabled = COALESCE(?, is_enabled)
     WHERE id = ?`,
    [rule_name, rule_type, configStr, is_enabled !== undefined ? (is_enabled ? 1 : 0) : null, id]
  );

  const updated = get('SELECT * FROM approval_rules WHERE id = ?', [id]);
  
  logAudit(req.user.id, ACTIONS.UPDATE_APPROVAL_RULE, {
    details: { ruleId: id, changes: req.body }
  });

  res.json(parseConfig(updated));
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;

  const rule = get('SELECT * FROM approval_rules WHERE id = ?', [id]);
  if (!rule) {
    throw new AppError('规则不存在', 404);
  }

  run('DELETE FROM approval_rules WHERE id = ?', [id]);
  res.json({ message: '删除成功' });
});

module.exports = router;
