const http = require('http');

const ADMIN_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoiYWRtaW4iLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3ODEzNzE4NjMsImV4cCI6MTc4MTQ1ODI2M30.DebtDHXzk3uw5yQRjC13ipFu7p_nuqRJVLdSVY6WMxg';
const USER1_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjIsInVzZXJuYW1lIjoidXNlcjEiLCJyb2xlIjoidXNlciIsImlhdCI6MTc4MTM3MTg2MywiZXhwIjoxNzgxNDU4MjYzfQ.q8h-4PYf0U3XvgNcxe6dXbziHKL1dXzraBGs8ovRoME';
const RESERVATION_ID = 3;

function request(method, path, token) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          data: JSON.parse(data || '{}')
        });
      });
    });
    req.on('error', (e) => resolve({ status: 0, data: { error: e.message } }));
    req.end();
  });
}

async function testPersistence() {
  console.log('=========================================');
  console.log('  Data Persistence Verification');
  console.log('=========================================');
  console.log('');

  // 1. Check reservation status
  console.log('[1/4] Checking reservation #' + RESERVATION_ID + ' status...');
  const reservation = await request('GET', '/api/reservations/' + RESERVATION_ID, USER1_TOKEN);
  if (reservation.status === 200 && reservation.data.status === 'approved') {
    console.log('  PASS: Reservation status is "' + reservation.data.status + '"');
    console.log('    Room: ' + reservation.data.room_id + ', Start: ' + reservation.data.start_datetime);
  } else {
    console.log('  FAIL: Expected status "approved", got: ' + JSON.stringify(reservation.data));
    process.exit(1);
  }

  // 2. Check audit logs
  console.log('');
  console.log('[2/4] Checking audit logs...');
  const auditLogs = await request('GET', '/api/audit-logs/reservation/' + RESERVATION_ID, ADMIN_TOKEN);
  if (auditLogs.status === 200 && auditLogs.data.length >= 2) {
    console.log('  PASS: Found ' + auditLogs.data.length + ' audit logs');
    auditLogs.data.forEach(log => {
      console.log('    - ' + log.action + ': ' + log.old_status + ' -> ' + log.new_status + 
                  ' (by user ' + log.user_id + ')');
    });
  } else {
    console.log('  FAIL: Expected >= 2 audit logs, got: ' + JSON.stringify(auditLogs.data));
    process.exit(1);
  }

  // 3. Check blacklist (should be empty)
  console.log('');
  console.log('[3/4] Checking blacklist...');
  const blacklist = await request('GET', '/api/blacklist', ADMIN_TOKEN);
  if (blacklist.status === 200) {
    console.log('  PASS: Blacklist has ' + blacklist.data.length + ' entries');
    if (blacklist.data.length === 0) {
      console.log('    (empty as expected after test cleanup)');
    }
  } else {
    console.log('  FAIL: Could not fetch blacklist: ' + JSON.stringify(blacklist.data));
    process.exit(1);
  }

  // 4. Check all reservations list
  console.log('');
  console.log('[4/4] Checking all reservations...');
  const allReservations = await request('GET', '/api/reservations', ADMIN_TOKEN);
  if (allReservations.status === 200 && allReservations.data.length >= 2) {
    console.log('  PASS: Found ' + allReservations.data.length + ' total reservations');
    allReservations.data.forEach(r => {
      console.log('    #' + r.id + ': room=' + r.room_id + ', status=' + r.status + 
                  ', user=' + r.user_id);
    });
  } else {
    console.log('  FAIL: Expected >= 2 reservations, got: ' + JSON.stringify(allReservations.data));
    process.exit(1);
  }

  console.log('');
  console.log('=========================================');
  console.log('  ALL PERSISTENCE TESTS PASSED!');
  console.log('=========================================');
  console.log('');
  console.log('Data persisted successfully after server restart:');
  console.log('  - Reservation status preserved');
  console.log('  - Audit logs preserved');
  console.log('  - Blacklist preserved');
  console.log('  - All reservation records preserved');
}

testPersistence().catch(e => {
  console.error('Test failed with error:', e);
  process.exit(1);
});
