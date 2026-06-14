const { run, get, all } = require('../db');

class ApprovalRule {
  static create(data) {
    const { rule_name, rule_type, config, is_enabled = true } = data;
    const configStr = config ? JSON.stringify(config) : null;
    const result = run(
      'INSERT INTO approval_rules (rule_name, rule_type, config, is_enabled) VALUES (?, ?, ?, ?)',
      [rule_name, rule_type, configStr, is_enabled ? 1 : 0]
    );
    return this.findById(result.lastInsertRowid);
  }

  static findById(id) {
    const rule = get('SELECT * FROM approval_rules WHERE id = ?', [id]);
    if (rule && rule.config) {
      try {
        rule.config = JSON.parse(rule.config);
      } catch {
        rule.config = {};
      }
    }
    return rule;
  }

  static findAll(filters = {}) {
    let sql = 'SELECT * FROM approval_rules WHERE 1=1';
    const params = [];

    if (filters.rule_type) {
      sql += ' AND rule_type = ?';
      params.push(filters.rule_type);
    }
    if (filters.is_enabled !== undefined) {
      sql += ' AND is_enabled = ?';
      params.push(filters.is_enabled ? 1 : 0);
    }

    sql += ' ORDER BY created_at DESC';
    const rules = all(sql, params);
    
    return rules.map(rule => {
      if (rule.config) {
        try {
          rule.config = JSON.parse(rule.config);
        } catch {
          rule.config = {};
        }
      }
      return rule;
    });
  }

  static findByType(ruleType) {
    return this.findAll({ rule_type, is_enabled: true });
  }

  static update(id, updates) {
    const configStr = updates.config !== undefined ? JSON.stringify(updates.config) : undefined;
    
    run(
      `UPDATE approval_rules 
       SET rule_name = COALESCE(?, rule_name),
           rule_type = COALESCE(?, rule_type),
           config = COALESCE(?, config),
           is_enabled = COALESCE(?, is_enabled)
       WHERE id = ?`,
      [updates.rule_name, updates.rule_type, configStr, updates.is_enabled !== undefined ? (updates.is_enabled ? 1 : 0) : undefined, id]
    );
    return this.findById(id);
  }

  static delete(id) {
    return run('DELETE FROM approval_rules WHERE id = ?', [id]);
  }
}

module.exports = ApprovalRule;
