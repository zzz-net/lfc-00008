const http = require('http');

const BASE_URL = 'localhost';
const PORT = 3000;

function request(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: BASE_URL,
      port: PORT,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const response = body ? JSON.parse(body) : {};
          resolve({ status: res.statusCode, data: response });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runTests() {
  console.log('=========================================');
  console.log('  社区活动室预约核销服务 - 验收测试');
  console.log('=========================================');
  console.log('');

  let adminToken, user1Token, user2Token;
  let adminUserId, user1Id, user2Id;
  let roomId, reservationId, reservation2Id, blacklistId;

  try {
    // 1. 健康检查
    console.log('[1/12] 健康检查...');
    const health = await request('GET', '/health');
    if (health.status === 200 && health.data.status === 'ok') {
      console.log('  ✓ 服务运行正常');
    } else {
      throw new Error('服务异常');
    }

    // 2. 登录
    console.log('');
    console.log('[2/12] 用户登录...');
    
    const adminLogin = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    adminToken = adminLogin.data.token;
    adminUserId = adminLogin.data.user.id;
    console.log('  ✓ 管理员登录成功');

    const user1Login = await request('POST', '/api/auth/login', { username: 'user1', password: 'user123' });
    user1Token = user1Login.data.token;
    user1Id = user1Login.data.user.id;
    console.log('  ✓ 普通用户1登录成功');

    const user2Login = await request('POST', '/api/auth/login', { username: 'user2', password: 'user456' });
    user2Token = user2Login.data.token;
    user2Id = user2Login.data.user.id;
    console.log('  ✓ 普通用户2登录成功');

    // 3. 创建房间
    console.log('');
    console.log('[3/12] 管理员创建房间...');
    const room = await request('POST', '/api/rooms', {
      name: '多功能活动室',
      description: '社区综合活动室',
      capacity: 30,
      location: '社区服务中心二楼'
    }, adminToken);
    roomId = room.data.id;
    console.log(`  ✓ 创建房间成功 (ID: ${roomId})`);

    // 4. 生成测试时间
    const startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endTime = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    // 5. 用户1提交预约
    console.log('');
    console.log('[4/12] 用户1提交预约...');
    const reservation = await request('POST', '/api/reservations', {
      room_id: roomId,
      start_datetime: startTime,
      end_datetime: endTime,
      purpose: '社区读书分享会',
      attendees: 15
    }, user1Token);
    reservationId = reservation.data.id;
    console.log(`  ✓ 预约提交成功 (ID: ${reservationId}, 状态: ${reservation.data.status})`);

    // 6. 普通用户尝试审批自己的预约
    console.log('');
    console.log('[5/12] 验证普通用户不能审批自己的预约...');
    const selfApprove = await request('POST', `/api/reservations/${reservationId}/approve`, null, user1Token);
    if (selfApprove.status === 403) {
      console.log('  ✓ 正确拒绝：普通用户无审批权限');
    } else {
      throw new Error(`错误：普通用户审批自己的预约成功了！(HTTP ${selfApprove.status})`);
    }

    // 7. 管理员审批预约
    console.log('');
    console.log('[6/12] 管理员审批预约...');
    const approve = await request('POST', `/api/reservations/${reservationId}/approve`, null, adminToken);
    if (approve.status === 200 && approve.data.status === 'approved') {
      console.log(`  ✓ 审批通过 (状态: ${approve.data.status})`);
    } else {
      throw new Error(`审批失败: ${JSON.stringify(approve.data)}`);
    }

    // 8. 验证时段冲突
    console.log('');
    console.log('[7/12] 验证时段冲突检测...');
    const reservation2 = await request('POST', '/api/reservations', {
      room_id: roomId,
      start_datetime: startTime,
      end_datetime: endTime,
      purpose: '冲突测试',
      attendees: 10
    }, user2Token);
    if (reservation2.status !== 201 || !reservation2.data.id) {
      console.error('  预约创建失败:', reservation2.status, JSON.stringify(reservation2.data));
      throw new Error('用户2预约创建失败');
    }
    reservation2Id = reservation2.data.id;
    console.log(`  ✓ 用户2预约提交成功 (ID: ${reservation2Id}, 待审批)`);

    const conflictApprove = await request('POST', `/api/reservations/${reservation2Id}/approve`, null, adminToken);
    if (conflictApprove.status === 409) {
      console.log('  ✓ 正确拒绝：时段冲突检测生效');
    } else {
      throw new Error(`错误：时段冲突的预约被审批通过了！(HTTP ${conflictApprove.status})`);
    }

    // 9. 签到时间校验
    console.log('');
    console.log('[8/12] 测试签到时间校验...');
    const earlyCheckin = await request('POST', `/api/reservations/${reservationId}/checkin`, null, user1Token);
    if (earlyCheckin.status === 400 && earlyCheckin.data.error.includes('签到时间未到')) {
      console.log('  ✓ 正确拒绝：签到时间未到');
    } else {
      throw new Error(`错误：预约未开始就签到成功了！(HTTP ${earlyCheckin.status})`);
    }

    // 10. 黑名单测试
    console.log('');
    console.log('[9/12] 黑名单功能测试...');
    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const blacklist = await request('POST', '/api/blacklist', {
      user_id: user2Id,
      reason: '测试黑名单',
      start_date: today,
      end_date: nextMonth,
      is_permanent: false
    }, adminToken);
    blacklistId = blacklist.data.id;
    console.log('  ✓ 用户2已加入黑名单');

    const blacklistReservation = await request('POST', '/api/reservations', {
      room_id: roomId,
      start_datetime: startTime,
      end_datetime: endTime,
      purpose: '测试',
      attendees: 10
    }, user2Token);
    if (blacklistReservation.status === 403 && blacklistReservation.data.error.includes('黑名单')) {
      console.log('  ✓ 正确拒绝：黑名单用户无法预约');
    } else {
      throw new Error(`错误：黑名单用户预约成功了！(HTTP ${blacklistReservation.status})`);
    }

    await request('DELETE', `/api/blacklist/${blacklistId}`, null, adminToken);
    console.log('  ✓ 已从黑名单移除用户2');

    // 11. 审计日志测试
    console.log('');
    console.log('[10/12] 审计日志测试...');
    const auditLogs = await request('GET', `/api/audit-logs/reservation/${reservationId}`, null, adminToken);
    if (auditLogs.data.length >= 2) {
      console.log(`  ✓ 审计日志正常 (记录数: ${auditLogs.data.length})`);
      console.log('    操作记录:');
      auditLogs.data.forEach(log => {
        console.log(`      - ${log.action}: ${log.old_status} -> ${log.new_status}`);
      });
    } else {
      throw new Error(`错误：审计日志记录不足 (${auditLogs.data.length})`);
    }

    // 12. 取消预约测试
    console.log('');
    console.log('[11/12] 取消预约测试...');
    const cancel = await request('POST', `/api/reservations/${reservation2Id}/cancel`, {
      reason: '测试取消'
    }, user2Token);
    if (cancel.status === 200 && cancel.data.status === 'canceled') {
      console.log(`  ✓ 预约取消成功 (状态: ${cancel.data.status})`);
    } else {
      throw new Error(`取消失败: ${JSON.stringify(cancel.data)}`);
    }

    // 13. 数据持久化验证
    console.log('');
    console.log('[12/12] 数据持久化验证...');
    const getReservation = await request('GET', `/api/reservations/${reservationId}`, null, user1Token);
    console.log(`  ✓ 预约${reservationId} 当前状态: ${getReservation.data.status}`);

    const allAudit = await request('GET', '/api/audit-logs', null, adminToken);
    console.log(`  ✓ 总审计日志数: ${allAudit.data.length}`);

    console.log('');
    console.log('=========================================');
    console.log('  🎉 所有验收测试通过！');
    console.log('=========================================');
    console.log('');
    console.log('服务重启后，可通过以下命令验证数据仍存在：');
    console.log('  # 查看预约列表');
    console.log(`  curl -H "Authorization: Bearer <token>" http://${BASE_URL}:${PORT}/api/reservations`);
    console.log('  # 查看黑名单');
    console.log(`  curl -H "Authorization: Bearer <admin_token>" http://${BASE_URL}:${PORT}/api/blacklist`);
    console.log('  # 查看审计日志');
    console.log(`  curl -H "Authorization: Bearer <admin_token>" http://${BASE_URL}:${PORT}/api/audit-logs`);
    console.log('');
    
    // 保存 tokens 以便后续手动测试
    console.log('=== 测试 Token（用于手动验证持久化） ===');
    console.log('Admin Token:', adminToken);
    console.log('User1 Token:', user1Token);
    console.log('User2 Token:', user2Token);
    console.log('Reservation ID:', reservationId);
    console.log('');

  } catch (error) {
    console.log('  ✗ 测试失败:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runTests();
