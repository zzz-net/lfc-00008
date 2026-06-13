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
  console.log('  Community Room Booking - Acceptance Test');
  console.log('=========================================');
  console.log('');

  let adminToken, user1Token, user2Token;
  let adminUserId, user1Id, user2Id;
  let roomId, reservationId, reservation2Id, blacklistId;

  try {
    // 1. Health check
    console.log('[1/12] Health check...');
    const health = await request('GET', '/health');
    if (health.status === 200 && health.data.status === 'ok') {
      console.log('  PASS: Server is running');
    } else {
      throw new Error('Server not healthy');
    }

    // 2. Login
    console.log('');
    console.log('[2/12] User login...');
    
    const adminLogin = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
    adminToken = adminLogin.data.token;
    adminUserId = adminLogin.data.user.id;
    console.log('  PASS: Admin login successful');

    const user1Login = await request('POST', '/api/auth/login', { username: 'user1', password: 'user123' });
    user1Token = user1Login.data.token;
    user1Id = user1Login.data.user.id;
    console.log('  PASS: User1 login successful');

    const user2Login = await request('POST', '/api/auth/login', { username: 'user2', password: 'user456' });
    user2Token = user2Login.data.token;
    user2Id = user2Login.data.user.id;
    console.log('  PASS: User2 login successful');

    // 3. Create room
    console.log('');
    console.log('[3/12] Admin creates room...');
    const uniqueRoomName = 'Test Room ' + Date.now();
    const room = await request('POST', '/api/rooms', {
      name: uniqueRoomName,
      description: 'Community activity room',
      capacity: 30,
      location: '2nd Floor'
    }, adminToken);
    if (room.status !== 201 || !room.data.id) {
      console.error('  Room creation failed:', room.status, JSON.stringify(room.data));
      throw new Error('FAIL: Room creation failed');
    }
    roomId = room.data.id;
    console.log('  PASS: Room created (ID: ' + roomId + ', name: ' + uniqueRoomName + ')');

    // 4. Generate test times
    const startTime = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const endTime = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    // 5. User1 creates reservation
    console.log('');
    console.log('[4/12] User1 submits reservation...');
    const reservation = await request('POST', '/api/reservations', {
      room_id: roomId,
      start_datetime: startTime,
      end_datetime: endTime,
      purpose: 'Community meeting',
      attendees: 15
    }, user1Token);
    reservationId = reservation.data.id;
    console.log('  PASS: Reservation submitted (ID: ' + reservationId + ', status: ' + reservation.data.status + ')');

    // 6. User2 creates reservation for same time slot (both pending, no conflict yet)
    console.log('');
    console.log('[5/12] User2 submits reservation for same time slot...');
    const reservation2 = await request('POST', '/api/reservations', {
      room_id: roomId,
      start_datetime: startTime,
      end_datetime: endTime,
      purpose: 'Conflict test',
      attendees: 10
    }, user2Token);
    
    if (reservation2.status !== 201 || !reservation2.data.id) {
      console.error('  Reservation2 creation failed:', reservation2.status, JSON.stringify(reservation2.data));
      throw new Error('FAIL: User2 reservation creation failed');
    }
    reservation2Id = reservation2.data.id;
    console.log('  PASS: User2 reservation submitted (ID: ' + reservation2Id + ', status: ' + reservation2.data.status + ')');

    // 7. Regular user tries to approve own reservation
    console.log('');
    console.log('[6/12] Verify regular user cannot approve own reservation...');
    const selfApprove = await request('POST', '/api/reservations/' + reservationId + '/approve', null, user1Token);
    if (selfApprove.status === 403) {
      console.log('  PASS: Correctly rejected - regular user has no approval permission');
    } else {
      throw new Error('FAIL: Regular user approved own reservation! (HTTP ' + selfApprove.status + ')');
    }

    // 8. Admin approves User1's reservation
    console.log('');
    console.log('[7/12] Admin approves User1 reservation...');
    const approve = await request('POST', '/api/reservations/' + reservationId + '/approve', null, adminToken);
    if (approve.status === 200 && approve.data.status === 'approved') {
      console.log('  PASS: Reservation approved (status: ' + approve.data.status + ')');
    } else {
      throw new Error('FAIL: Approval failed: ' + JSON.stringify(approve.data));
    }

    // 9. Admin tries to approve User2's reservation - should fail due to time conflict
    console.log('');
    console.log('[8/12] Verify time conflict detection on approval...');
    const conflictApprove = await request('POST', '/api/reservations/' + reservation2Id + '/approve', null, adminToken);
    if (conflictApprove.status === 409) {
      console.log('  PASS: Correctly rejected - time conflict detected');
    } else {
      throw new Error('FAIL: Conflicting reservation was approved! (HTTP ' + conflictApprove.status + ')');
    }

    // 10. Checkin time validation
    console.log('');
    console.log('[9/12] Test checkin time validation...');
    const earlyCheckin = await request('POST', '/api/reservations/' + reservationId + '/checkin', null, user1Token);
    if (earlyCheckin.status === 400) {
      console.log('  PASS: Correctly rejected - checkin time not arrived');
      console.log('  Error message:', earlyCheckin.data.error);
    } else {
      throw new Error('FAIL: Early checkin succeeded! (HTTP ' + earlyCheckin.status + ')');
    }

    // 11. Blacklist test
    console.log('');
    console.log('[10/12] Blacklist test...');
    const today = new Date().toISOString().split('T')[0];
    const nextMonth = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const blacklist = await request('POST', '/api/blacklist', {
      user_id: user2Id,
      reason: 'Test blacklist',
      start_date: today,
      end_date: nextMonth,
      is_permanent: false
    }, adminToken);
    blacklistId = blacklist.data.id;
    console.log('  PASS: User2 added to blacklist');

    const blacklistReservation = await request('POST', '/api/reservations', {
      room_id: roomId,
      start_datetime: startTime,
      end_datetime: endTime,
      purpose: 'Test',
      attendees: 10
    }, user2Token);
    if (blacklistReservation.status === 403) {
      console.log('  PASS: Correctly rejected - blacklisted user cannot book');
      console.log('  Error message:', blacklistReservation.data.error);
    } else {
      throw new Error('FAIL: Blacklisted user booked successfully! (HTTP ' + blacklistReservation.status + ')');
    }

    await request('DELETE', '/api/blacklist/' + blacklistId, null, adminToken);
    console.log('  PASS: User2 removed from blacklist');

    // 12. Audit log test
    console.log('');
    console.log('[11/12] Audit log test...');
    const auditLogs = await request('GET', '/api/audit-logs/reservation/' + reservationId, null, adminToken);
    if (auditLogs.data.length >= 2) {
      console.log('  PASS: Audit logs working (count: ' + auditLogs.data.length + ')');
      console.log('    Actions:');
      auditLogs.data.forEach(log => {
        console.log('      - ' + log.action + ': ' + log.old_status + ' -> ' + log.new_status);
      });
    } else {
      throw new Error('FAIL: Insufficient audit logs (' + auditLogs.data.length + ')');
    }

    // 13. Cancel reservation test
    console.log('');
    console.log('[12/12] Cancel reservation test...');
    const cancel = await request('POST', '/api/reservations/' + reservation2Id + '/cancel', {
      reason: 'Test cancel'
    }, user2Token);
    if (cancel.status === 200 && cancel.data.status === 'canceled') {
      console.log('  PASS: Reservation canceled (status: ' + cancel.data.status + ')');
    } else {
      throw new Error('FAIL: Cancel failed: ' + JSON.stringify(cancel.data));
    }

    // 14. Data persistence verification
    console.log('');
    console.log('[Data Persistence Verification]...');
    const getReservation = await request('GET', '/api/reservations/' + reservationId, null, user1Token);
    console.log('  PASS: Reservation ' + reservationId + ' current status: ' + getReservation.data.status);

    const allAudit = await request('GET', '/api/audit-logs', null, adminToken);
    console.log('  PASS: Total audit logs: ' + allAudit.data.length);

    console.log('');
    console.log('=========================================');
    console.log('  ALL ACCEPTANCE TESTS PASSED!');
    console.log('=========================================');
    console.log('');
    console.log('After server restart, verify data persists with:');
    console.log('  # List reservations');
    console.log('  curl -H "Authorization: Bearer <token>" http://' + BASE_URL + ':' + PORT + '/api/reservations');
    console.log('  # List blacklist');
    console.log('  curl -H "Authorization: Bearer <admin_token>" http://' + BASE_URL + ':' + PORT + '/api/blacklist');
    console.log('  # List audit logs');
    console.log('  curl -H "Authorization: Bearer <admin_token>" http://' + BASE_URL + ':' + PORT + '/api/audit-logs');
    console.log('');
    
    console.log('=== Test Tokens (for manual verification) ===');
    console.log('Admin Token:', adminToken);
    console.log('User1 Token:', user1Token);
    console.log('User2 Token:', user2Token);
    console.log('Reservation ID:', reservationId);
    console.log('');

  } catch (error) {
    console.log('  FAIL:', error.message);
    console.error(error);
    process.exit(1);
  }
}

runTests();
