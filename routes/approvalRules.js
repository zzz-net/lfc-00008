const express = require('express');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { run, get, all } = require('../db');
const { logAudit, ACTIONS } = require('../utils/audit');

const router = express.Router();

router.get('/', authenticateToken, requireAdmin, (req, res) => {
  const rules = all('SELECT * FROM approval_rules ORDER BY created_at DESC');
  res.json(rules.map(r => ({
    ...r,
    config: r.config ? JSON.parse(r.config) : null
  })));
});

router.get('/:id', authenticateToken, requireAdmin, (req, res) => {
  const rule = get('SELECT * FROM approval_rules WHERE id = ?', [req.params.id]);
  if (!rule) {
    return res.status(404).json({ error: '规则不存在' });
  }
  res.json({
    ...rule,
    config: rule.config ? JSON.parse(rule.config) : null
  });
});

router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const { rule_name, rule_type, config, is_enabled = true } = req.body;

  if (!rule_name || !rule_type) {
    return res.status(400).json({ error: '规则名称和类型不能为空' });
  }

  const existing = get('SELECT id FROM approval_rules WHERE rule_name = ?', [rule_name]);
  if (existing) {
    return res.status(400).json({ error: '规则名称已存在' });
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

  res.status(201).json({
    ...rule,
    config: rule.config ? JSON.parse(rule.config) : null
  });
});

router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;
  const { rule_name, rule_type, config, is_enabled } = req.body;

  const rule = get('SELECT * FROM approval_rules WHERE id = ?', [id]);
  if (!rule) {
    return res.status(404).json({ error: '规则不存在' });
  }

  if (rule_name && rule_name !== rule.rule_name) {
    const existing = get('SELECT id FROM approval_rules WHERE rule_name = ? AND id != ?', [rule_name, id]);
    if (existing) {
      return res.status(400).json({ error: '规则名称已存在' });
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

  res.json({
    ...updated,
    config: updated.config ? JSON.parse(updated.config) : null
  });
});

router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { id } = req.params;

  const rule = get('SELECT * FROM approval_rules WHERE id = ?', [id]);
  if (!rule) {
    return res.status(404).json({ error: '规则不存在' });
  }

  run('DELETE FROM approval_rules WHERE id = ?', [id]);
  res.json({ message: '删除成功' });
});

module.exports = router;
