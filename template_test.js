const http = require('http');

const BASE_URL = 'http://localhost:3000';

function request(method, path, token = null, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const url = new URL(path, BASE_URL);
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = {
            status: res.statusCode,
            data: data ? JSON.parse(data) : null
          };
          resolve(response);
        } catch (e) {
          resolve({ status: res.statusCode, data, raw: true });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function login(username, password) {
  const res = await request('POST', '/api/auth/login', null, { username, password });
  if (res.status !== 200) {
    throw new Error(`登录失败: ${JSON.stringify(res.data)}`);
  }
  return res.data.token;
}

function getNextWeekday(dayOfWeek, weeksAhead) {
  weeksAhead = weeksAhead || (8 + Math.floor(Math.random() * 20));
  const now = new Date();
  const currentDay = now.getDay();
  let daysToAdd = dayOfWeek - currentDay + weeksAhead * 7;
  if (daysToAdd <= 0) {
    daysToAdd += 7;
  }
  now.setDate(now.getDate() + daysToAdd);
  return now.toISOString().split('T')[0];
}

function getNextDay(daysAhead) {
  daysAhead = daysAhead || (60 + Math.floor(Math.random() * 60));
  const now = new Date();
  now.setDate(now.getDate() + daysAhead);
  return now.toISOString().split('T')[0];
}

let passed = 0;
let failed = 0;

function test(description, fn) {
  return async () => {
    try {
      console.log(`\n=== 测试: ${description} ===`);
      await fn();
      console.log(`✅ PASS: ${description}`);
      passed++;
    } catch (e) {
      console.log(`❌ FAIL: ${description}`);
      console.log(`   错误: ${e.message}`);
      failed++;
    }
  };
}

async function main() {
  console.log('========================================');
  console.log('  预约模板功能测试');
  console.log('========================================');

  const user1Token = await login('user1', 'user123');
  const user2Token = await login('user2', 'user456');
  const adminToken = await login('admin', 'admin123');

  console.log('\n✅ 登录成功');

  let roomId = 1;
  try {
    const roomsRes = await request('GET', '/api/rooms', user1Token);
    if (roomsRes.data && roomsRes.data.length > 0) {
      roomId = roomsRes.data[0].id;
      console.log(`使用房间: ${roomsRes.data[0].name} (ID: ${roomId})`);
    } else {
      const createRoomRes = await request('POST', '/api/rooms', adminToken, {
        name: '测试会议室',
        description: '用于测试的会议室',
        capacity: 10,
        location: '1楼'
      });
      roomId = createRoomRes.data.id;
      console.log(`创建房间: ${createRoomRes.data.name} (ID: ${roomId})`);
    }
  } catch (e) {
    const createRoomRes = await request('POST', '/api/rooms', adminToken, {
      name: '测试会议室',
      description: '用于测试的会议室',
      capacity: 10,
      location: '1楼'
    });
    roomId = createRoomRes.data.id;
    console.log(`创建房间: ${createRoomRes.data.name} (ID: ${roomId})`);
  }

  const timestamp = Date.now();
  let templateId = null;
  let exportedTemplate = null;

  const existingTemplates = await request('GET', '/api/templates', user1Token);
  if (existingTemplates.data && existingTemplates.data.length > 0) {
    for (const t of existingTemplates.data) {
      await request('DELETE', `/api/templates/${t.id}`, user1Token);
    }
    console.log('  清理了旧模板数据');
  }

  await test('创建模板 - 基本信息', async () => {
    const res = await request('POST', '/api/templates', user1Token, {
      name: `周例会模板_${timestamp}`,
      tags: ['会议', '每周', '团队'],
      room_id: roomId,
      start_time: '09:00',
      end_time: '10:00',
      day_of_week: 1,
      purpose: '团队周例会',
      attendees: 8,
      config: { needsProjector: true }
    });

    if (res.status !== 201) {
      throw new Error(`创建失败: ${res.status} - ${JSON.stringify(res.data)}`);
    }

    templateId = res.data.id;
    console.log(`  模板ID: ${templateId}`);
    console.log(`  模板名称: ${res.data.name}`);
    console.log(`  标签: ${JSON.stringify(res.data.tags)}`);

    if (res.data.name !== `周例会模板_${timestamp}`) {
      throw new Error('模板名称不正确');
    }
    if (!Array.isArray(res.data.tags) || res.data.tags.length !== 3) {
      throw new Error('标签解析不正确');
    }
  })();

  await test('查询模板列表 - 用户1只能看到自己的', async () => {
    const res = await request('GET', '/api/templates', user1Token);

    if (res.status !== 200) {
      throw new Error(`查询失败: ${res.status}`);
    }

    console.log(`  返回模板数量: ${res.data.length}`);

    const hasTemplate = res.data.some(t => t.id === templateId);
    if (!hasTemplate) {
      throw new Error('列表中没有刚创建的模板');
    }
  })();

  await test('查询模板列表 - 用户2看不到用户1的模板', async () => {
    const res = await request('GET', '/api/templates', user2Token);

    if (res.status !== 200) {
      throw new Error(`查询失败: ${res.status}`);
    }

    console.log(`  用户2看到的模板数量: ${res.data.length}`);

    const hasTemplate = res.data.some(t => t.id === templateId);
    if (hasTemplate) {
      throw new Error('用户2不应该看到用户1的模板');
    }
  })();

  await test('查询模板列表 - 管理员能看到所有模板', async () => {
    const res = await request('GET', '/api/templates', adminToken);

    if (res.status !== 200) {
      throw new Error(`查询失败: ${res.status}`);
    }

    console.log(`  管理员看到的模板数量: ${res.data.length}`);

    const hasTemplate = res.data.some(t => t.id === templateId);
    if (!hasTemplate) {
      throw new Error('管理员应该能看到所有模板');
    }
  })();

  await test('按标签筛选模板', async () => {
    const res = await request('GET', '/api/templates?tag=会议', user1Token);

    if (res.status !== 200) {
      throw new Error(`查询失败: ${res.status}`);
    }

    console.log(`  带"会议"标签的模板数量: ${res.data.length}`);

    if (res.data.length === 0) {
      throw new Error('应该能筛选出带"会议"标签的模板');
    }
  })();

  await test('获取单个模板详情', async () => {
    const res = await request('GET', `/api/templates/${templateId}`, user1Token);

    if (res.status !== 200) {
      throw new Error(`查询失败: ${res.status}`);
    }

    console.log(`  模板名称: ${res.data.name}`);
    console.log(`  房间: ${res.data.room_name}`);
    console.log(`  时间: ${res.data.start_time} - ${res.data.end_time}`);

    if (res.data.id !== templateId) {
      throw new Error('返回的模板ID不正确');
    }
  })();

  await test('用户2不能查看用户1的模板详情', async () => {
    const res = await request('GET', `/api/templates/${templateId}`, user2Token);

    if (res.status !== 403) {
      throw new Error(`应该返回403，实际返回: ${res.status}`);
    }

    console.log(`  正确拒绝，返回: ${res.status}`);
  })();

  await test('更新模板', async () => {
    const res = await request('PUT', `/api/templates/${templateId}`, user1Token, {
      purpose: '团队周例会 - 更新',
      attendees: 10,
      tags: ['会议', '每周', '核心团队']
    });

    if (res.status !== 200) {
      throw new Error(`更新失败: ${res.status} - ${JSON.stringify(res.data)}`);
    }

    console.log(`  更新后的用途: ${res.data.purpose}`);
    console.log(`  更新后的人数: ${res.data.attendees}`);
    console.log(`  更新后的标签: ${JSON.stringify(res.data.tags)}`);

    if (res.data.attendees !== 10) {
      throw new Error('更新人数失败');
    }
    if (res.data.tags.length !== 3 || !res.data.tags.includes('核心团队')) {
      throw new Error('更新标签失败');
    }
  })();

  await test('用户2不能修改用户1的模板', async () => {
    const res = await request('PUT', `/api/templates/${templateId}`, user2Token, {
      purpose: '恶意修改'
    });

    if (res.status !== 403) {
      throw new Error(`应该返回403，实际返回: ${res.status}`);
    }

    console.log(`  正确拒绝，返回: ${res.status}`);
  })();

  let successDate = null;

  await test('从模板创建预约 - 成功场景', async () => {
    successDate = getNextWeekday(1);
    console.log(`  预约日期: ${successDate} (周一)`);

    const res = await request('POST', `/api/templates/${templateId}/create-reservation`, user1Token, {
      date: successDate
    });

    if (res.status !== 201) {
      throw new Error(`创建预约失败: ${res.status} - ${JSON.stringify(res.data)}`);
    }

    console.log(`  预约ID: ${res.data.id}`);
    console.log(`  房间: ${res.data.room_name}`);
    console.log(`  时间: ${res.data.start_datetime} - ${res.data.end_datetime}`);
    console.log(`  来自模板: ${res.data.from_template}`);
    console.log(`  模板名称: ${res.data.template_name}`);

    if (String(res.data.from_template) !== String(templateId)) {
      throw new Error('没有正确标记模板来源');
    }
  })();

  await test('从模板创建预约 - 冲突场景（同一时段再约一次）', async () => {
    console.log(`  预约日期: ${successDate} (周一) - 与上一个预约冲突`);

    const res = await request('POST', `/api/templates/${templateId}/create-reservation`, user1Token, {
      date: successDate
    });

    if (res.status !== 409) {
      throw new Error(`应该返回409冲突，实际返回: ${res.status} - ${JSON.stringify(res.data)}`);
    }

    console.log(`  正确检测到冲突，返回: ${res.status}`);
    console.log(`  冲突信息: ${res.data.error}`);
    if (res.data.conflicts && res.data.conflicts.length > 0) {
      console.log(`  冲突预约: ${res.data.conflicts[0].user_name} - ${res.data.conflicts[0].start_datetime}`);
    }
  })();

  await test('从模板创建预约 - 星期不匹配', async () => {
    const date = getNextWeekday(2);
    console.log(`  预约日期: ${date} (周二) - 模板限定周一`);

    const res = await request('POST', `/api/templates/${templateId}/create-reservation`, user1Token, {
      date: date
    });

    if (res.status !== 400) {
      throw new Error(`应该返回400，实际返回: ${res.status} - ${JSON.stringify(res.data)}`);
    }

    console.log(`  正确检测到星期不匹配，返回: ${res.status}`);
    console.log(`  错误信息: ${res.data.error}`);
  })();

  let template2Id = null;
  await test('创建不限星期的模板', async () => {
    const res = await request('POST', '/api/templates', user1Token, {
      name: `临时会议模板_${timestamp}`,
      tags: ['会议', '临时'],
      room_id: roomId,
      start_time: '14:00',
      end_time: '15:00',
      purpose: '临时会议'
    });

    if (res.status !== 201) {
      throw new Error(`创建失败: ${res.status} - ${JSON.stringify(res.data)}`);
    }

    template2Id = res.data.id;
    console.log(`  模板ID: ${template2Id}`);
  })();

  await test('从不限星期的模板创建预约 - 任意日期都可以', async () => {
    const date = getNextDay();
    console.log(`  预约日期: ${date}`);

    const res = await request('POST', `/api/templates/${template2Id}/create-reservation`, user1Token, {
      date: date,
      purpose: '临时讨论 - 覆盖用途'
    });

    if (res.status !== 201) {
      throw new Error(`创建预约失败: ${res.status} - ${JSON.stringify(res.data)}`);
    }

    console.log(`  预约ID: ${res.data.id}`);
    console.log(`  用途: ${res.data.purpose}`);
  })();

  await test('导出模板为JSON', async () => {
    const res = await request('GET', `/api/templates/${templateId}/export`, user1Token);

    if (res.status !== 200) {
      throw new Error(`导出失败: ${res.status}`);
    }

    exportedTemplate = res.data;
    console.log(`  导出格式版本: ${exportedTemplate._schema_version}`);
    console.log(`  导出时间: ${exportedTemplate._exported_at}`);
    console.log(`  模板名称: ${exportedTemplate.template.name}`);
    console.log(`  模板标签: ${JSON.stringify(exportedTemplate.template.tags)}`);

    if (!exportedTemplate.template || exportedTemplate.template.name !== `周例会模板_${timestamp}`) {
      throw new Error('导出数据格式不正确');
    }
  })();

  await test('导入模板 - 修改名称后导入', async () => {
    const importData = {
      ...exportedTemplate,
      template: {
        ...exportedTemplate.template,
        name: `周例会模板_${timestamp}_副本`
      }
    };

    const res = await request('POST', '/api/templates/import', user1Token, importData);

    if (res.status !== 201) {
      throw new Error(`导入失败: ${res.status} - ${JSON.stringify(res.data)}`);
    }

    console.log(`  导入的模板ID: ${res.data.id}`);
    console.log(`  导入的模板名称: ${res.data.name}`);

    if (res.data.name !== `周例会模板_${timestamp}_副本`) {
      throw new Error('导入的模板名称不正确');
    }

    await request('DELETE', `/api/templates/${res.data.id}`, user1Token);
  })();

  await test('导入模板 - 用户2导入用户1导出的模板', async () => {
    const importData = {
      ...exportedTemplate,
      template: {
        ...exportedTemplate.template,
        name: `用户2的周例会_${timestamp}`
      }
    };

    const res = await request('POST', '/api/templates/import', user2Token, importData);

    if (res.status !== 201) {
      throw new Error(`导入失败: ${res.status} - ${JSON.stringify(res.data)}`);
    }

    console.log(`  用户2导入的模板ID: ${res.data.id}`);
    console.log(`  模板创建者: ${res.data.user_name}`);

    if (res.data.user_id === user1Token.userId || res.data.user_name !== 'user2') {
      throw new Error('导入的模板应该属于用户2');
    }

    await request('DELETE', `/api/templates/${res.data.id}`, user2Token);
  })();

  await test('查看audit_log - 模板相关操作', async () => {
    const res = await request('GET', '/api/audit-logs?limit=20', adminToken);

    if (res.status !== 200) {
      throw new Error(`查询日志失败: ${res.status}`);
    }

    const templateActions = [
      'create_template',
      'update_template',
      'create_reservation_from_template',
      'export_template',
      'import_template'
    ];

    const foundActions = [];
    for (const log of res.data) {
      if (templateActions.includes(log.action)) {
        if (!foundActions.includes(log.action)) {
          foundActions.push(log.action);
          console.log(`  找到日志: ${log.action} - 用户: ${log.user_id}`);
          
          if (log.action === 'create_reservation_from_template' && log.details) {
            try {
              const details = JSON.parse(log.details);
              console.log(`    模板ID: ${details.templateId}, 模板名称: ${details.templateName}`);
            } catch (e) {}
          }
        }
      }
    }

    console.log(`  找到的模板相关操作: ${foundActions.join(', ')}`);

    if (foundActions.length < 3) {
      throw new Error('应该有至少3种模板相关的audit log');
    }
  })();

  console.log('\n========================================');
  console.log('  测试服务端持久性（重启后数据不丢）');
  console.log('========================================');
  console.log('请重启服务器后，重新运行 persistence 模式验证。');
  console.log('运行: node template_test.js persistence');
  console.log('模板ID: ' + templateId);

  console.log('\n========================================');
  console.log(`  测试结果: ${passed} 通过, ${failed} 失败`);
  console.log('========================================');

  if (failed > 0) {
    process.exit(1);
  }
}

async function persistenceTest() {
  console.log('========================================');
  console.log('  持久性验证测试');
  console.log('========================================');

  const user1Token = await login('user1', 'user123');
  const user2Token = await login('user2', 'user456');
  const adminToken = await login('admin', 'admin123');

  const templateId = process.argv[3] || 1;

  await test('重启后查询模板 - 数据仍然存在', async () => {
    const res = await request('GET', `/api/templates/${templateId}`, user1Token);

    if (res.status !== 200) {
      throw new Error(`查询失败: ${res.status} - 模板可能在重启后丢失了`);
    }

    console.log(`  模板存在，名称: ${res.data.name}`);
    console.log(`  创建时间: ${res.data.created_at}`);
    console.log(`  更新时间: ${res.data.updated_at}`);
  })();

  await test('重启后从模板创建预约仍然正常', async () => {
    const date = getNextWeekday(1);
    
    const res = await request('POST', `/api/templates/${templateId}/create-reservation`, user1Token, {
      date: date
    });

    if (res.status !== 201 && res.status !== 409) {
      throw new Error(`创建预约失败: ${res.status} - ${JSON.stringify(res.data)}`);
    }

    if (res.status === 201) {
      console.log(`  成功创建预约: ${res.data.id}`);
    } else {
      console.log(`  时段冲突（预期行为）: ${res.data.error}`);
    }
  })();

  console.log('\n========================================');
  console.log(`  测试结果: ${passed} 通过, ${failed} 失败`);
  console.log('========================================');

  if (failed > 0) {
    process.exit(1);
  }
}

if (process.argv[2] === 'persistence') {
  persistenceTest();
} else {
  main();
}
