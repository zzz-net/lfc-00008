function up(db) {
  const ruleCount = db.prepare('SELECT COUNT(*) as count FROM approval_rules').get().count;
  if (ruleCount === 0) {
    db.prepare(`INSERT INTO approval_rules (rule_name, rule_type, config) VALUES (?, ?, ?)`).run(
      'default_auto_approval',
      'auto_approval',
      JSON.stringify({ enabled: false, max_hours: 2 })
    );
    console.log('Seeded default approval rules');
  }
}

module.exports = { up };
