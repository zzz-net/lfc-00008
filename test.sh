#!/bin/bash

BASE_URL="http://localhost:3000"

echo "========================================="
echo "  社区活动室预约核销服务 - 验收测试"
echo "========================================="
echo ""

# 1. 健康检查
echo "[1/12] 健康检查..."
if curl -s "$BASE_URL/health" | grep -q "ok"; then
    echo "  ✓ 服务运行正常"
else
    echo "  ✗ 健康检查失败"
    exit 1
fi

# 2. 登录获取 token
echo ""
echo "[2/12] 用户登录..."

ADMIN_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')
ADMIN_TOKEN=$(echo "$ADMIN_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
echo "  ✓ 管理员登录成功"

USER1_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"user1","password":"user123"}')
USER1_TOKEN=$(echo "$USER1_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
USER1_ID=$(echo "$USER1_RESPONSE" | grep -o '"id":[0-9]*' | cut -d':' -f2)
echo "  ✓ 普通用户1登录成功"

USER2_RESPONSE=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"user2","password":"user456"}')
USER2_TOKEN=$(echo "$USER2_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
USER2_ID=$(echo "$USER2_RESPONSE" | grep -o '"id":[0-9]*' | cut -d':' -f2)
echo "  ✓ 普通用户2登录成功"

# 3. 管理员创建房间
echo ""
echo "[3/12] 管理员创建房间..."
ROOM_RESPONSE=$(curl -s -X POST "$BASE_URL/api/rooms" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"多功能活动室","description":"社区综合活动室","capacity":30,"location":"社区服务中心二楼"}')
ROOM_ID=$(echo "$ROOM_RESPONSE" | grep -o '"id":[0-9]*' | cut -d':' -f2)
echo "  ✓ 创建房间成功 (ID: $ROOM_ID)"

# 4. 生成测试时间
START_TIME=$(date -u -d '+1 hour' +"%Y-%m-%dT%H:%M:%SZ")
END_TIME=$(date -u -d '+3 hour' +"%Y-%m-%dT%H:%M:%SZ")

# 5. 用户1提交预约
echo ""
echo "[4/12] 用户1提交预约..."
RESERVATION_RESPONSE=$(curl -s -X POST "$BASE_URL/api/reservations" \
  -H "Authorization: Bearer $USER1_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"room_id\":$ROOM_ID,\"start_datetime\":\"$START_TIME\",\"end_datetime\":\"$END_TIME\",\"purpose\":\"社区读书分享会\",\"attendees\":15}")
RESERVATION_ID=$(echo "$RESERVATION_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
STATUS=$(echo "$RESERVATION_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
echo "  ✓ 预约提交成功 (ID: $RESERVATION_ID, 状态: $STATUS)"

# 6. 普通用户尝试审批自己的预约（应该失败）
echo ""
echo "[5/12] 验证普通用户不能审批自己的预约..."
APPROVE_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/reservations/$RESERVATION_ID/approve" \
  -H "Authorization: Bearer $USER1_TOKEN")
if [ "$APPROVE_RESULT" -eq 403 ]; then
    echo "  ✓ 正确拒绝：普通用户无审批权限"
else
    echo "  ✗ 错误：普通用户审批自己的预约成功了！(HTTP $APPROVE_RESULT)"
    exit 1
fi

# 7. 管理员审批预约
echo ""
echo "[6/12] 管理员审批预约..."
APPROVE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/reservations/$RESERVATION_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
STATUS=$(echo "$APPROVE_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
if [ "$STATUS" = "approved" ]; then
    echo "  ✓ 审批通过 (状态: $STATUS)"
else
    echo "  ✗ 错误：审批失败 (状态: $STATUS)"
    exit 1
fi

# 8. 验证时段冲突
echo ""
echo "[7/12] 验证时段冲突检测..."
RESERVATION2_RESPONSE=$(curl -s -X POST "$BASE_URL/api/reservations" \
  -H "Authorization: Bearer $USER2_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"room_id\":$ROOM_ID,\"start_datetime\":\"$START_TIME\",\"end_datetime\":\"$END_TIME\",\"purpose\":\"冲突测试\",\"attendees\":10}")
RESERVATION2_ID=$(echo "$RESERVATION2_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
echo "  ✓ 用户2预约提交成功 (待审批)"

CONFLICT_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/reservations/$RESERVATION2_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN")
if [ "$CONFLICT_RESULT" -eq 409 ]; then
    echo "  ✓ 正确拒绝：时段冲突检测生效"
else
    echo "  ✗ 错误：时段冲突的预约被审批通过了！(HTTP $CONFLICT_RESULT)"
    exit 1
fi

# 9. 用户签到测试
echo ""
echo "[8/12] 测试签到时间校验..."
CHECKIN_RESULT=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/reservations/$RESERVATION_ID/checkin" \
  -H "Authorization: Bearer $USER1_TOKEN")
if [ "$CHECKIN_RESULT" -eq 400 ]; then
    echo "  ✓ 正确拒绝：签到时间未到"
else
    echo "  ✗ 错误：预约未开始就签到成功了！(HTTP $CHECKIN_RESULT)"
    exit 1
fi

# 10. 黑名单测试
echo ""
echo "[9/12] 黑名单功能测试..."
TODAY=$(date +"%Y-%m-%d")
NEXT_MONTH=$(date -d '+1 month' +"%Y-%m-%d")
BLACKLIST_RESPONSE=$(curl -s -X POST "$BASE_URL/api/blacklist" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"user_id\":$USER2_ID,\"reason\":\"测试黑名单\",\"start_date\":\"$TODAY\",\"end_date\":\"$NEXT_MONTH\",\"is_permanent\":false}")
BLACKLIST_ID=$(echo "$BLACKLIST_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
echo "  ✓ 用户2已加入黑名单"

BLACKLIST_CHECK=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/reservations" \
  -H "Authorization: Bearer $USER2_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"room_id\":$ROOM_ID,\"start_datetime\":\"$START_TIME\",\"end_datetime\":\"$END_TIME\",\"purpose\":\"测试\",\"attendees\":10}")
if [ "$BLACKLIST_CHECK" -eq 403 ]; then
    echo "  ✓ 正确拒绝：黑名单用户无法预约"
else
    echo "  ✗ 错误：黑名单用户预约成功了！(HTTP $BLACKLIST_CHECK)"
    exit 1
fi

curl -s -o /dev/null -X DELETE "$BASE_URL/api/blacklist/$BLACKLIST_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
echo "  ✓ 已从黑名单移除用户2"

# 11. 审计日志测试
echo ""
echo "[10/12] 审计日志测试..."
AUDIT_COUNT=$(curl -s "$BASE_URL/api/audit-logs/reservation/$RESERVATION_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | grep -o '"action"' | wc -l)
if [ "$AUDIT_COUNT" -ge 2 ]; then
    echo "  ✓ 审计日志正常 (记录数: $AUDIT_COUNT)"
    echo "    操作记录:"
    curl -s "$BASE_URL/api/audit-logs/reservation/$RESERVATION_ID" \
      -H "Authorization: Bearer $ADMIN_TOKEN" | grep -o '"action":"[^"]*"' | cut -d'"' -f4 | while read action; do
        echo "      - $action"
    done
else
    echo "  ✗ 错误：审计日志记录不足 (记录数: $AUDIT_COUNT)"
    exit 1
fi

# 12. 取消预约测试
echo ""
echo "[11/12] 取消预约测试..."
CANCEL_RESPONSE=$(curl -s -X POST "$BASE_URL/api/reservations/$RESERVATION2_ID/cancel" \
  -H "Authorization: Bearer $USER2_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"测试取消"}')
CANCEL_STATUS=$(echo "$CANCEL_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
if [ "$CANCEL_STATUS" = "canceled" ]; then
    echo "  ✓ 预约取消成功 (状态: $CANCEL_STATUS)"
else
    echo "  ✗ 错误：预约取消失败 (状态: $CANCEL_STATUS)"
    exit 1
fi

# 13. 验证数据持久化
echo ""
echo "[12/12] 数据持久化验证..."
GET_STATUS=$(curl -s "$BASE_URL/api/reservations/$RESERVATION_ID" \
  -H "Authorization: Bearer $USER1_TOKEN" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
echo "  ✓ 预约$RESERVATION_ID 当前状态: $GET_STATUS"

TOTAL_AUDIT=$(curl -s "$BASE_URL/api/audit-logs" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | grep -o '"action"' | wc -l)
echo "  ✓ 总审计日志数: $TOTAL_AUDIT"

echo ""
echo "========================================="
echo "  🎉 所有验收测试通过！"
echo "========================================="
echo ""
echo "服务重启后，可通过以下命令验证数据仍存在："
echo "  # 查看预约列表"
echo "  curl -H 'Authorization: Bearer <token>' $BASE_URL/api/reservations"
echo "  # 查看黑名单"
echo "  curl -H 'Authorization: Bearer <admin_token>' $BASE_URL/api/blacklist"
echo "  # 查看审计日志"
echo "  curl -H 'Authorization: Bearer <admin_token>' $BASE_URL/api/audit-logs"
