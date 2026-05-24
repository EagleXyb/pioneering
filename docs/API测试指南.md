# 后端 API 测试指南

## 服务信息

- **地址**: http://localhost:3000
- **数据库**: PostgreSQL (postgresql://postgres:root@localhost:5432/pioneering)

---

## 一、不需要认证的公开接口

### 1. 健康检查

```bash
curl http://localhost:3000/health
```

### 2. 获取可用的模型列表

```bash
curl http://localhost:3000/system/models
```

### 3. 获取系统配置

```bash
curl http://localhost:3000/system/config
```

### 4. 登录（获取 Token）

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "your_username",
    "password": "your_password"
  }'
```

**响应示例**：

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "rt_xxx",
  "user": {
    "id": "user_xxx",
    "username": "admin",
    "nickname": "管理员",
    "avatar": null,
    "email": null,
    "phone": null,
    "createdAt": "2026-05-23T11:20:00.000Z",
    "updatedAt": "2026-05-23T11:20:00.000Z"
  },
  "expiresIn": 7200
}
```

### 5. 微信小程序登录

```bash
curl -X POST http://localhost:3000/auth/wechat/miniprogram \
  -H "Content-Type: application/json" \
  -d '{"code": "wx_code_here"}'
```

### 6. 微信网页登录

```bash
curl -X POST http://localhost:3000/auth/wechat/web \
  -H "Content-Type: application/json" \
  -d '{"code": "wx_code_here"}'
```

### 7. Token 刷新

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "rt_xxx..."}'
```

---

## 二、需要认证的接口

需要把登录拿到的 `token` 放到请求头的 `Authorization` 字段中，格式为 `Bearer <token>`。建议先保存到变量方便后面使用：

```bash
# 登录后拿到 token 保存到变量
TOKEN="eyJhbGciOiJIUzI1NiIs..."
```

### 1. 用户模块

**获取个人资料**

```bash
curl http://localhost:3000/user/profile \
  -H "Authorization: Bearer $TOKEN"
```

**更新个人资料**

```bash
curl -X PUT http://localhost:3000/user/profile \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nickname": "新昵称"}'
```

**获取配额**

```bash
curl http://localhost:3000/user/quota \
  -H "Authorization: Bearer $TOKEN"
```

**获取使用记录**

```bash
curl "http://localhost:3000/user/quota/usage?page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN"
```

### 2. 会话管理

**创建会话**

```bash
curl -X POST http://localhost:3000/chat/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "测试会话",
    "model": "gpt-4o-mini"
  }'
```

**查询会话列表**

```bash
curl "http://localhost:3000/chat/sessions?page=1&pageSize=10" \
  -H "Authorization: Bearer $TOKEN"
```

**获取某个会话详情**

```bash
curl http://localhost:3000/chat/sessions/{sessionId} \
  -H "Authorization: Bearer $TOKEN"
```

**更新会话**

```bash
curl -X PUT http://localhost:3000/chat/sessions/{sessionId} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "修改后的标题"}'
```

**删除会话（支持归档）**

```bash
curl -X DELETE http://localhost:3000/chat/sessions/{sessionId} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"archive": true}'
```

### 3. 消息与对话

**获取会话消息列表**

```bash
curl "http://localhost:3000/chat/sessions/{sessionId}/messages?limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**发送对话（非流式）**

```bash
curl -X POST http://localhost:3000/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "你好，介绍一下你自己",
    "sessionId": "{sessionId}",
    "stream": false
  }'
```

**发送对话（流式，SSE）**

```bash
curl -X POST http://localhost:3000/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "你好，介绍一下你自己",
    "sessionId": "{sessionId}",
    "stream": true
  }' \
  --no-buffer
```

**编辑消息**

```bash
curl -X PUT http://localhost:3000/chat/sessions/{sessionId}/messages/{messageId} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content": "修改后的内容", "regenerate": true}'
```

**给消息反馈**

```bash
curl -X POST http://localhost:3000/chat/messages/{messageId}/feedback \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"messageId": "{messageId}", "feedback": "like"}'
```

`feedback` 可选值：`like` | `dislike` | `none`

**重新生成回复**

```bash
curl -X POST http://localhost:3000/chat/messages/{messageId}/regenerate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o-mini"}'
```

**停止生成**

```bash
curl -X POST http://localhost:3000/chat/completions/stop \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "{sessionId}", "messageId": "{messageId}"}'
```

### 4. 文件上传

**上传文件（10MB 以内）**

```bash
curl -X POST http://localhost:3000/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/your/file.jpg" \
  -F "type=image"
```

**删除文件**

```bash
curl -X DELETE http://localhost:3000/upload/{fileId} \
  -H "Authorization: Bearer $TOKEN"
```

---

## 三、完整测试流程（推荐顺序）

```bash
# 1. 先验证服务正常
curl http://localhost:3000/health

# 2. 登录获取 token
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

echo "Token: $TOKEN"

# 3. 获取用户信息
curl http://localhost:3000/user/profile -H "Authorization: Bearer $TOKEN"

# 4. 创建会话
SESSION_ID=$(curl -s -X POST http://localhost:3000/chat/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title": "测试会话"}' | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

echo "Session ID: $SESSION_ID"

# 5. 发送对话（非流式）
curl -X POST http://localhost:3000/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"你好\", \"sessionId\": \"$SESSION_ID\", \"stream\": false}"
```

---

## 四、接口总览

| 模块 | 方法 | 路由 | 认证 |
|------|------|------|------|
| Health | GET | `/health` | 否 |
| System | GET | `/system/models` | 否 |
| System | GET | `/system/config` | 否 |
| Auth | POST | `/auth/login` | 否 |
| Auth | POST | `/auth/wechat/miniprogram` | 否 |
| Auth | POST | `/auth/wechat/web` | 否 |
| Auth | POST | `/auth/refresh` | 否 |
| User | GET | `/user/profile` | 是 |
| User | PUT | `/user/profile` | 是 |
| User | GET | `/user/quota` | 是 |
| User | GET | `/user/quota/usage` | 是 |
| Chat | GET | `/chat/sessions` | 是 |
| Chat | POST | `/chat/sessions` | 是 |
| Chat | GET | `/chat/sessions/:sessionId` | 是 |
| Chat | PUT | `/chat/sessions/:sessionId` | 是 |
| Chat | DELETE | `/chat/sessions/:sessionId` | 是 |
| Chat | GET | `/chat/sessions/:sessionId/messages` | 是 |
| Chat | PUT | `/chat/sessions/:sessionId/messages/:messageId` | 是 |
| Chat | POST | `/chat/completions` | 是 |
| Chat | POST | `/chat/completions/stop` | 是 |
| Chat | POST | `/chat/messages/:messageId/feedback` | 是 |
| Chat | POST | `/chat/messages/:messageId/regenerate` | 是 |
| Upload | POST | `/upload` | 是 |
| Upload | DELETE | `/upload/:fileId` | 是 |