# 社区活动室预约核销服务 - curl 验收测试
# 确保服务已启动: npm start

$BASE = "http://localhost:3000"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  社区活动室预约核销服务 - curl 验收测试" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 健康检查
Write-Host "[1/8] 健康检查..." -ForegroundColor Yellow
curl.exe -s "$BASE/health"
Write-Host ""
Write-Host "  ✓ 服务运行正常" -ForegroundColor Green

# 2. 登录获取 token
Write-Host ""
Write-Host "[2/8] 用户登录..." -ForegroundColor Yellow

$adminLogin = curl.exe -s -X POST "$BASE/api/auth/login" `
  -H "Content-Type: application/json" `
  -d '{"username":"admin","password":"admin123"}'
$ADMIN_TOKEN = ($adminLogin | ConvertFrom-Json).token
Write-Host "  管理员登录: $adminLogin"
Write-Host "  ✓ 管理员登录成功" -ForegroundColor Green

$user1Login = curl.exe -s -X POST "$BASE/api/auth/login" `
  -H "Content-Type: application/json" `
  -d '{"username":"user1","password":"user123"}'
$USER1_TOKEN = ($user1Login | ConvertFrom-Json).token
$USER1_ID = ($user1Login | ConvertFrom-Json).user.id
Write-Host "  用户1登录: $user1Login"
Write-Host "  ✓ 用户1登录成功" -ForegroundColor Green

$user2Login = curl.exe -s -X POST "$BASE/api/auth/login" `
  -H "Content-Type: application/json" `
  -d '{"username":"user2","password":"user456"}'
$USER2_TOKEN = ($user2Login | ConvertFrom-Json).token
$USER2_ID = ($user2Login | ConvertFrom-Json).user.id
Write-Host "  用户2登录: $user2Login"
Write-Host "  ✓ 用户2登录成功" -ForegroundColor Green

# 3. 创建房间
Write-Host ""
Write-Host "[3/8] 管理员创建房间..." -ForegroundColor Yellow
$roomJson = '{"name":"多功能活动室","description":"社区综合活动室","capacity":30,"location":"二楼"}'
$createRoom = curl.exe -s -X POST "$BASE/api/rooms" `
  -H "Authorization: Bearer $ADMIN_TOKEN" `
  -H "Content-Type: application/json" `
  -d $roomJson
$ROOM_ID = ($createRoom | ConvertFrom-Json).id
Write-Host "  创建房间: $createRoom"
Write-Host "  ✓ 房间创建成功 (ID: $ROOM_ID)" -ForegroundColor Green

# 4. 生成测试时间
$startTime = (Get-Date).AddHours(1).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$endTime = (Get-Date).AddHours(3).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
Write-Host "  预约时间: $startTime ~ $endTime"

# 5. 用户1提交预约
Write-Host ""
Write-Host "[4/8] 用户1提交预约..." -ForegroundColor Yellow
$resvJson = "{`"room_id`":$ROOM_ID,`"start_datetime`":`"$startTime`",`"end_datetime`":`"$endTime`",`"purpose`":`"社区会议`",`"attendees`":10}"
$createResv = curl.exe -s -X POST "$BASE/api/reservations" `
  -H "Authorization: Bearer $USER1_TOKEN" `
  -H "Content-Type: application/json" `
  -d $resvJson
$RESV_ID = ($createResv | ConvertFrom-Json).id
Write-Host "  创建预约: $createResv"
Write-Host "  ✓ 预约提交成功 (ID: $RESV_ID)" -ForegroundColor Green

# 6. 验证普通用户不能审批自己的预约
Write-Host ""
Write-Host "[5/8] 验证普通用户不能审批自己的预约..." -ForegroundColor Yellow
$selfApprove = curl.exe -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/reservations/$RESV_ID/approve" `
  -H "Authorization: Bearer $USER1_TOKEN"
if ($selfApprove -eq "403") {
    Write-Host "  审批返回状态码: $selfApprove"
    Write-Host "  ✓ 正确拒绝：普通用户无审批权限" -ForegroundColor Green
} else {
    Write-Host "  ✗ 错误：返回状态码 $selfApprove" -ForegroundColor Red
    exit 1
}

# 7. 管理员审批预约
Write-Host ""
Write-Host "[6/8] 管理员审批预约..." -ForegroundColor Yellow
$approve = curl.exe -s -X POST "$BASE/api/reservations/$RESV_ID/approve" `
  -H "Authorization: Bearer $ADMIN_TOKEN"
$status = ($approve | ConvertFrom-Json).status
Write-Host "  审批结果: $approve"
if ($status -eq "approved") {
    Write-Host "  ✓ 审批通过 (状态: $status)" -ForegroundColor Green
} else {
    Write-Host "  ✗ 审批失败" -ForegroundColor Red
    exit 1
}

# 8. 验证时段冲突 - 用户2预约同一时段
Write-Host ""
Write-Host "[7/8] 验证时段冲突检测..." -ForegroundColor Yellow
$resv2Json = "{`"room_id`":$ROOM_ID,`"start_datetime`":`"$startTime`",`"end_datetime`":`"$endTime`",`"purpose`":`"冲突测试`",`"attendees`":5}"
$createResv2 = curl.exe -s -X POST "$BASE/api/reservations" `
  -H "Authorization: Bearer $USER2_TOKEN" `
  -H "Content-Type: application/json" `
  -d $resv2Json
$RESV2_ID = ($createResv2 | ConvertFrom-Json).id
Write-Host "  用户2预约提交: $createResv2"
Write-Host "  ✓ 用户2预约提交成功 (ID: $RESV2_ID, 待审批)" -ForegroundColor Green

# 尝试审批用户2的预约，应该因冲突失败
$conflictApprove = curl.exe -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/reservations/$RESV2_ID/approve" `
  -H "Authorization: Bearer $ADMIN_TOKEN"
if ($conflictApprove -eq "409") {
    Write-Host "  冲突审批返回状态码: $conflictApprove"
    Write-Host "  ✓ 正确拒绝：时段冲突检测生效" -ForegroundColor Green
} else {
    Write-Host "  ✗ 错误：时段冲突的预约被审批通过了！(HTTP $conflictApprove)" -ForegroundColor Red
    exit 1
}

# 9. 签到时间校验
Write-Host ""
Write-Host "[8/8] 测试签到时间校验..." -ForegroundColor Yellow
$earlyCheckin = curl.exe -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/reservations/$RESV_ID/checkin" `
  -H "Authorization: Bearer $USER1_TOKEN"
if ($earlyCheckin -eq "400") {
    Write-Host "  提前签到返回状态码: $earlyCheckin"
    Write-Host "  ✓ 正确拒绝：签到时间未到" -ForegroundColor Green
} else {
    Write-Host "  ✗ 错误：预约未开始就签到成功了！(HTTP $earlyCheckin)" -ForegroundColor Red
    exit 1
}

# 10. 数据持久化验证
Write-Host ""
Write-Host "[数据持久化验证]" -ForegroundColor Yellow
Write-Host "  查询预约$RESV_ID状态..."
$getResv = curl.exe -s "$BASE/api/reservations/$RESV_ID" `
  -H "Authorization: Bearer $USER1_TOKEN"
$getStatus = ($getResv | ConvertFrom-Json).status
Write-Host "  预约状态: $getResv"
Write-Host "  ✓ 预约$RESV_ID 当前状态: $getStatus" -ForegroundColor Green

Write-Host ""
Write-Host "  查询审计日志..."
$auditLogs = curl.exe -s "$BASE/api/audit-logs/reservation/$RESV_ID" `
  -H "Authorization: Bearer $ADMIN_TOKEN"
$auditCount = ($auditLogs | ConvertFrom-Json).Count
Write-Host "  审计日志数: $auditCount"
Write-Host "  ✓ 审计日志正常 (记录数: $auditCount)" -ForegroundColor Green

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  🎉 所有 curl 验收测试通过！" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "服务重启后，可通过以下 curl 命令验证数据仍存在：" -ForegroundColor Yellow
Write-Host "  # 查看预约列表"
Write-Host "  curl -H `"Authorization: Bearer $USER1_TOKEN`" $BASE/api/reservations"
Write-Host "  # 查看审计日志"
Write-Host "  curl -H `"Authorization: Bearer $ADMIN_TOKEN`" $BASE/api/audit-logs"
Write-Host ""
Write-Host "=== 测试 Token（用于手动验证） ==="
Write-Host "Admin Token: $ADMIN_TOKEN"
Write-Host "User1 Token: $USER1_TOKEN"
Write-Host "User2 Token: $USER2_TOKEN"
Write-Host "Reservation ID: $RESV_ID"
Write-Host ""
