# 社区活动室预约核销服务

基于 Express + SQLite 的本地社区活动室预约核销系统，提供 JSON API 服务。

## 功能特性

- 🏠 **房间管理**：管理员可配置房间信息
- ⏰ **时段配置**：为房间设置可预约时段
- 📅 **预约管理**：用户提交预约，支持时段冲突检测
- ✅ **审批流程**：管理员审批预约，禁止审批自己的预约
- ✍️ **签到核销**：仅在有效时间内可签到
- ⚫ **黑名单管理**：管理员可将用户加入黑名单
- 📋 **审计日志**：完整的状态流转审计
- ⏳ **自动超时失效**：预约开始后超时未签到自动失效
- 📝 **预约模板**：保存常用预约配置为模板，一键创建预约，支持导入导出
- 💾 **SQLite持久化**：服务重启数据不丢失

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务

```bash
npm start
```

服务运行在 http://localhost:3000

### 默认账号

| 用户名 | 密码 | 角色 |
|---------|------|------|
| admin | admin123 | 管理员 |
| user1 | user123 | 普通用户 |
| user2 | user456 | 普通用户 |

## API 接口

### 认证

```bash
# 登录
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### 房间管理

```bash
# 获取房间列表
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/rooms

# 创建房间（管理员）
curl -X POST http://localhost:3000/api/rooms \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"多功能厅","description":"社区多功能活动室","capacity":50,"location":"一楼"}'
```

### 预约管理

```bash
# 创建预约
curl -X POST http://localhost:3000/api/reservations \
  -H "Authorization: Bearer <user_token>" \
  -H "Content-Type: application/json" \
  -d '{"room_id":1,"start_datetime":"2025-01-15T10:00:00","end_datetime":"2025-01-15T12:00:00","purpose":"社区会议","attendees":20}'

# 审批通过（管理员，不能审批自己的预约）
curl -X POST http://localhost:3000/api/reservations/1/approve \
  -H "Authorization: Bearer <admin_token>"

# 审批拒绝（管理员）
curl -X POST http://localhost:3000/api/reservations/1/reject \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"时段已被占用"}'

# 签到
curl -X POST http://localhost:3000/api/reservations/1/checkin \
  -H "Authorization: Bearer <user_token>"

# 取消预约
curl -X POST http://localhost:3000/api/reservations/1/cancel \
  -H "Authorization: Bearer <user_token>"

# 待我处理列表（普通用户）
# 返回可取消、可签到的预约
curl -H "Authorization: Bearer <user_token>" http://localhost:3000/api/reservations/todo

# 待我处理列表（管理员）
# 返回待审批、可拒绝、超时未处理的预约
curl -H "Authorization: Bearer <admin_token>" http://localhost:3000/api/reservations/todo

# 管理员按房间过滤
curl -H "Authorization: Bearer <admin_token>" "http://localhost:3000/api/reservations/todo?room_id=1"

# 管理员按状态过滤（pending / approved）
curl -H "Authorization: Bearer <admin_token>" "http://localhost:3000/api/reservations/todo?status=pending"
```

### 黑名单管理

```bash
# 添加黑名单（管理员）
curl -X POST http://localhost:3000/api/blacklist \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"user_id":2,"reason":"多次违约","start_date":"2025-01-01","end_date":"2025-12-31","is_permanent":false}'

# 移除黑名单（管理员）
curl -X DELETE http://localhost:3000/api/blacklist/1 \
  -H "Authorization: Bearer <admin_token>"
```

### 预约模板

用户可将常用预约配置保存为模板，以后只需选日期即可快速创建预约。模板按用户隔离，管理员可查看所有用户的模板。

```bash
# 创建模板
# day_of_week: 0=周日, 1=周一, ..., 6=周六，不传或null表示不限星期
# tags: 标签数组，用于分类筛选
# config: 自定义配置对象（如设备需求等）
curl -X POST http://localhost:3000/api/templates \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "周例会模板",
    "tags": ["会议", "每周", "团队"],
    "room_id": 1,
    "start_time": "09:00",
    "end_time": "10:00",
    "day_of_week": 1,
    "purpose": "团队周例会",
    "attendees": 8,
    "config": {"needsProjector": true}
  }'

# 查询模板列表（普通用户只看自己的，管理员看全部）
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/templates

# 按标签筛选
curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/templates?tag=会议"

# 按房间筛选
curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/templates?room_id=1"

# 获取单个模板详情
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/templates/1

# 更新模板（不传 day_of_week 时保留原值，传 null 清除星期限制）
curl -X PUT http://localhost:3000/api/templates/1 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"purpose": "团队周例会 - 更新", "attendees": 10, "tags": ["会议", "每周", "核心团队"]}'

# 删除模板
curl -X DELETE http://localhost:3000/api/templates/1 \
  -H "Authorization: Bearer <token>"

# 从模板创建预约（只需提供日期，时间从模板自动填充）
# 冲突时返回 409 和详细冲突信息；星期不匹配时返回 400
curl -X POST http://localhost:3000/api/templates/1/create-reservation \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"date": "2025-01-20"}'

# 从模板创建预约（可覆盖 purpose 和 attendees）
curl -X POST http://localhost:3000/api/templates/1/create-reservation \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"date": "2025-01-20", "purpose": "特别会议", "attendees": 15}'

# 导出模板为 JSON 文件
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/templates/1/export -o template.json

# 从 JSON 导入模板（导入的模板归当前用户，room_id 不存在时按 room_name 匹配）
curl -X POST http://localhost:3000/api/templates/import \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d @template.json
```

### 审计日志

```bash
# 查看所有审计日志（管理员）
curl -H "Authorization: Bearer <admin_token>" http://localhost:3000/api/audit-logs

# 查看指定预约的审计日志
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/audit-logs/reservation/1
```

## 预约状态流转

```
pending (待审批)
    ├──> approved (已批准)
    │       ├──> checked_in (已签到) ──> completed (已完成)
    │       ├──> canceled (已取消)
    │       └──> expired (已过期)
    ├──> rejected (已拒绝)
    └──> canceled (已取消)
```

## 核心规则

1. **时段冲突**：同一房间重叠时段只能有一个已批准的预约
2. **自审批禁止**：管理员不能审批自己提交的预约
3. **签到时间窗口**：预约开始前15分钟至开始后30分钟内可签到
4. **自动失效**：预约开始30分钟后未签到自动标记为过期
5. **黑名单限制**：黑名单用户无法提交预约
6. **模板隔离**：普通用户只能查看和操作自己的模板，管理员可查看所有
7. **模板预约校验**：从模板创建预约时执行完整的冲突检测和星期校验，冲突时返回详细冲突信息
8. **数据持久化**：所有数据存储在 SQLite 数据库中，服务重启不丢失

## 验收测试

运行 `bash test.sh` 进行完整的验收测试。

模板功能测试：

```bash
# 运行模板全流程测试（创建、查询、更新、删除、从模板预约、导入导出、权限隔离）
node template_test.js

# 重启后验证模板数据持久性
node template_test.js persistence <模板ID>
```
