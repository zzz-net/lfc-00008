# 社区活动室预约核销服务 - 验收测试脚本
# 确保服务已启动: npm start

$BASE_URL = "http://localhost:3000"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  社区活动室预约核销服务 - 验收测试" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 健康检查
Write-Host "[1/12] 健康检查..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$BASE_URL/health" -Method Get -UseBasicParsing
    if ($response.StatusCode -eq 200) {
        Write-Host "  ✓ 服务运行正常" -ForegroundColor Green
    } else {
        throw "服务异常"
    }
} catch {
    Write-Host "  ✗ 健康检查失败: $_" -ForegroundColor Red
    exit 1
}

# 2. 登录获取 token
Write-Host ""
Write-Host "[2/12] 用户登录..." -ForegroundColor Yellow

$adminBody = @{username="admin"; password="admin123"}
$adminJson = $adminBody | ConvertTo-Json
$adminResponse = Invoke-WebRequest -Uri "$BASE_URL/api/auth/login" -Method Post -Body $adminJson -ContentType "application/json" -UseBasicParsing
$adminData = $adminResponse.Content | ConvertFrom-Json
$adminToken = $adminData.token
Write-Host "  ✓ 管理员登录成功" -ForegroundColor Green

$user1Body = @{username="user1"; password="user123"}
$user1Json = $user1Body | ConvertTo-Json
$user1Response = Invoke-WebRequest -Uri "$BASE_URL/api/auth/login" -Method Post -Body $user1Json -ContentType "application/json" -UseBasicParsing
$user1Data = $user1Response.Content | ConvertFrom-Json
$user1Token = $user1Data.token
$user1Id = $user1Data.user.id
Write-Host "  ✓ 普通用户1登录成功" -ForegroundColor Green

$user2Body = @{username="user2"; password="user456"}
$user2Json = $user2Body | ConvertTo-Json
$user2Response = Invoke-WebRequest -Uri "$BASE_URL/api/auth/login" -Method Post -Body $user2Json -ContentType "application/json" -UseBasicParsing
$user2Data = $user2Response.Content | ConvertFrom-Json
$user2Token = $user2Data.token
$user2Id = $user2Data.user.id
Write-Host "  ✓ 普通用户2登录成功" -ForegroundColor Green

# 3. 管理员创建房间
Write-Host ""
Write-Host "[3/12] 管理员创建房间..." -ForegroundColor Yellow
$roomBody = @{
    name="多功能活动室"
    description="社区综合活动室"
    capacity=30
    location="社区服务中心二楼"
}
$roomJson = $roomBody | ConvertTo-Json
$roomResponse = Invoke-WebRequest -Uri "$BASE_URL/api/rooms" -Method Post -Body $roomJson -Headers @{"Authorization" = "Bearer $adminToken"} -ContentType "application/json" -UseBasicParsing
$roomData = $roomResponse.Content | ConvertFrom-Json
$roomId = $roomData.id
Write-Host "  ✓ 创建房间成功 (ID: $roomId)" -ForegroundColor Green

# 4. 生成测试时间
$startTime = (Get-Date).AddHours(1).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$endTime = (Get-Date).AddHours(3).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# 5. 用户1提交预约
Write-Host ""
Write-Host "[4/12] 用户1提交预约..." -ForegroundColor Yellow
$reservationBody = @{
    room_id=$roomId
    start_datetime=$startTime
    end_datetime=$endTime
    purpose="社区读书分享会"
    attendees=15
}
$reservationJson = $reservationBody | ConvertTo-Json
$reservationResponse = Invoke-WebRequest -Uri "$BASE_URL/api/reservations" -Method Post -Body $reservationJson -Headers @{"Authorization" = "Bearer $user1Token"} -ContentType "application/json" -UseBasicParsing
$reservationData = $reservationResponse.Content | ConvertFrom-Json
$reservationId = $reservationData.id
Write-Host "  ✓ 预约提交成功 (ID: $reservationId, 状态: $($reservationData.status)" -ForegroundColor Green

# 6. 普通用户尝试审批自己的预约
Write-Host ""
Write-Host "[5/12] 验证普通用户不能审批自己的预约..." -ForegroundColor Yellow
try {
    $null = Invoke-WebRequest -Uri "$BASE_URL/api/reservations/$reservationId/approve" -Method Post -Headers @{"Authorization" = "Bearer $user1Token"} -UseBasicParsing
    Write-Host "  ✗ 错误：普通用户审批自己的预约成功了！" -ForegroundColor Red
    exit 1
} catch {
    $errorDetails = $_.ErrorDetails.Message | ConvertFrom-Json
    if ($_.Exception.Response.StatusCode.value__ -eq 403) {
        Write-Host "  ✓ 正确拒绝：普通用户无审批权限" -ForegroundColor Green
    } else {
        Write-Host "  ✗ 错误：返回了意外的状态码 $($_.Exception.Response.StatusCode.value__), $($errorDetails.error)" -ForegroundColor Red
        exit 1
    }
}

# 7. 管理员审批预约
Write-Host ""
Write-Host "[6/12] 管理员审批预约..." -ForegroundColor Yellow
$approveResponse = Invoke-WebRequest -Uri "$BASE_URL/api/reservations/$reservationId/approve" -Method Post -Headers @{"Authorization" = "Bearer $adminToken"} -UseBasicParsing
$approveData = $approveResponse.Content | ConvertFrom-Json
Write-Host "  ✓ 审批通过 (状态: $($approveData.status))" -ForegroundColor Green

# 8. 验证时段冲突
Write-Host ""
Write-Host "[7/12] 验证时段冲突检测..." -ForegroundColor Yellow
$conflictBody = @{
    room_id=$roomId
    start_datetime=$startTime
    end_datetime=$endTime
    purpose="冲突测试"
    attendees=10
}
$conflictJson = $conflictBody | ConvertTo-Json
$reservation2Response = Invoke-WebRequest -Uri "$BASE_URL/api/reservations" -Method Post -Body $conflictJson -Headers @{"Authorization" = "Bearer $user2Token"} -ContentType "application/json" -UseBasicParsing
$reservation2Data = $reservation2Response.Content | ConvertFrom-Json
$reservation2Id = $reservation2Data.id
Write-Host "  ✓ 用户2预约提交成功 (待审批)" -ForegroundColor Green

try {
    $null = Invoke-WebRequest -Uri "$BASE_URL/api/reservations/$reservation2Id/approve" -Method Post -Headers @{"Authorization" = "Bearer $adminToken"} -UseBasicParsing
    Write-Host "  ✗ 错误：时段冲突的预约被审批通过了！" -ForegroundColor Red
    exit 1
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 409) {
        Write-Host "  ✓ 正确拒绝：时段冲突检测生效" -ForegroundColor Green
    } else {
        Write-Host "  ✗ 错误：返回了意外的状态码 $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
        exit 1
    }
}

# 9. 用户签到测试
Write-Host ""
Write-Host "[8/12] 测试签到时间校验..." -ForegroundColor Yellow
try {
    $null = Invoke-WebRequest -Uri "$BASE_URL/api/reservations/$reservationId/checkin" -Method Post -Headers @{"Authorization" = "Bearer $user1Token"} -UseBasicParsing
    Write-Host "  ✗ 错误：预约未开始就签到成功了！" -ForegroundColor Red
    exit 1
} catch {
    $errorDetails = $_.ErrorDetails.Message | ConvertFrom-Json
    if ($_.Exception.Response.StatusCode.value__ -eq 400 -and $errorDetails.error -like "*签到时间未到*") {
        Write-Host "  ✓ 正确拒绝：签到时间未到" -ForegroundColor Green
    } else {
        Write-Host "  ✗ 错误：返回了意外的状态码 $($_.Exception.Response.StatusCode.value__), $($errorDetails.error)" -ForegroundColor Red
        exit 1
    }
}

# 10. 黑名单测试
Write-Host ""
Write-Host "[9/12] 黑名单功能测试..." -ForegroundColor Yellow
$today = Get-Date -Format "yyyy-MM-dd"
$nextMonth = (Get-Date).AddMonths(1).ToString("yyyy-MM-dd")
$blacklistBody = @{
    user_id=$user2Id
    reason="测试黑名单"
    start_date=$today
    end_date=$nextMonth
    is_permanent=$false
}
$blacklistJson = $blacklistBody | ConvertTo-Json
$blacklistResponse = Invoke-WebRequest -Uri "$BASE_URL/api/blacklist" -Method Post -Body $blacklistJson -Headers @{"Authorization" = "Bearer $adminToken"} -ContentType "application/json" -UseBasicParsing
$blacklistData = $blacklistResponse.Content | ConvertFrom-Json
$blacklistId = $blacklistData.id
Write-Host "  ✓ 用户2已加入黑名单" -ForegroundColor Green

try {
    $null = Invoke-WebRequest -Uri "$BASE_URL/api/reservations" -Method Post -Body $conflictJson -Headers @{"Authorization" = "Bearer $user2Token"} -ContentType "application/json" -UseBasicParsing
    Write-Host "  ✗ 错误：黑名单用户预约成功了！" -ForegroundColor Red
    exit 1
} catch {
    $errorDetails = $_.ErrorDetails.Message | ConvertFrom-Json
    if ($_.Exception.Response.StatusCode.value__ -eq 403 -and $errorDetails.error -like "*黑名单*") {
        Write-Host "  ✓ 正确拒绝：黑名单用户无法预约" -ForegroundColor Green
    } else {
        Write-Host "  ✗ 错误：返回了意外的状态码 $($_.Exception.Response.StatusCode.value__), $($errorDetails.error)" -ForegroundColor Red
        exit 1
    }
}

$null = Invoke-WebRequest -Uri "$BASE_URL/api/blacklist/$blacklistId" -Method Delete -Headers @{"Authorization" = "Bearer $adminToken"} -UseBasicParsing
Write-Host "  ✓ 已从黑名单移除用户2" -ForegroundColor Green

# 11. 审计日志测试
Write-Host ""
Write-Host "[10/12] 审计日志测试..." -ForegroundColor Yellow
$auditResponse = Invoke-WebRequest -Uri "$BASE_URL/api/audit-logs/reservation/$reservationId" -Method Get -Headers @{"Authorization" = "Bearer $adminToken"} -UseBasicParsing
$auditData = $auditResponse.Content | ConvertFrom-Json
if ($auditData.Count -ge 2) {
    Write-Host "  ✓ 审计日志正常 (记录数: $($auditData.Count))" -ForegroundColor Green
    Write-Host "    操作记录:" -ForegroundColor Gray
    foreach ($log in $auditData) {
        Write-Host "      - $($log.action): $($log.old_status) -> $($log.new_status)" -ForegroundColor Gray
    }
} else {
    Write-Host "  ✗ 错误：审计日志记录不足" -ForegroundColor Red
    exit 1
}

# 12. 取消预约测试
Write-Host ""
Write-Host "[11/12] 取消预约测试..." -ForegroundColor Yellow
$cancelBody = @{reason="测试取消"}
$cancelJson = $cancelBody | ConvertTo-Json
$cancelResponse = Invoke-WebRequest -Uri "$BASE_URL/api/reservations/$reservation2Id/cancel" -Method Post -Body $cancelJson -Headers @{"Authorization" = "Bearer $user2Token"} -ContentType "application/json" -UseBasicParsing
$cancelData = $cancelResponse.Content | ConvertFrom-Json
if ($cancelData.status -eq "canceled") {
    Write-Host "  ✓ 预约取消成功 (状态: $($cancelData.status))" -ForegroundColor Green
} else {
    Write-Host "  ✗ 错误：预约取消失败" -ForegroundColor Red
    exit 1
}

# 13. 验证数据持久化
Write-Host ""
Write-Host "[12/12] 数据持久化验证..." -ForegroundColor Yellow
$getReservationResponse = Invoke-WebRequest -Uri "$BASE_URL/api/reservations/$reservationId" -Method Get -Headers @{"Authorization" = "Bearer $user1Token"} -UseBasicParsing
$getReservationData = $getReservationResponse.Content | ConvertFrom-Json
Write-Host "  ✓ 预约$reservationId 当前状态: $($getReservationData.status)" -ForegroundColor Green

$auditAllResponse = Invoke-WebRequest -Uri "$BASE_URL/api/audit-logs" -Method Get -Headers @{"Authorization" = "Bearer $adminToken"} -UseBasicParsing
$auditAllData = $auditAllResponse.Content | ConvertFrom-Json
Write-Host "  ✓ 总审计日志数: $($auditAllData.Count)" -ForegroundColor Green

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  🎉 所有验收测试通过！" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "服务重启后，可通过以下命令验证数据仍存在：" -ForegroundColor Yellow
Write-Host "  # 查看预约列表"
Write-Host "  curl -H 'Authorization: Bearer <token>' $BASE_URL/api/reservations"
Write-Host "  # 查看黑名单"
Write-Host "  curl -H 'Authorization: Bearer <admin_token>' $BASE_URL/api/blacklist"
Write-Host "  # 查看审计日志"
Write-Host "  curl -H 'Authorization: Bearer <admin_token>' $BASE_URL/api/audit-logs"
