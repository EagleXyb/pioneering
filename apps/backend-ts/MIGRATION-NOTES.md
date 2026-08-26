# 后端 Python → TypeScript 迁移说明

## 迁移范围

将 `apps/backend/app/` 下的 Python FastAPI 后端 1:1 等价迁移至 `apps/backend-ts/`（Fastify + Zod + Prisma）。

**排除范围**：`apps/backend/ModuAgent/` 模块不纳入本次迁移。

---

## 已迁移端点（34 个）

### auth（7 个）— `routes/auth.ts`
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /auth/register | 注册 |
| POST | /auth/login | 登录 |
| POST | /auth/wechat/miniprogram | 微信小程序登录 |
| POST | /auth/wechat/web | 微信网页登录 |
| POST | /auth/refresh | 刷新令牌 |
| GET | /auth/profile | 获取当前用户信息 |
| PUT | /auth/profile | 更新当前用户信息 |

### user（5 个）— `routes/user.ts`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /user/list | 用户列表（分页+搜索） |
| GET | /user/profile | 获取当前用户信息 |
| PUT | /user/profile | 更新当前用户信息 |
| GET | /user/quota | 获取当前用户配额 |
| GET | /user/quota/usage | 获取当前用户 Token 用量 |

### chat（11 个）— `routes/chat.ts`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /chat/sessions | 会话列表（分页） |
| POST | /chat/sessions | 创建会话 |
| GET | /chat/sessions/:sessionId | 获取会话详情 |
| PUT | /chat/sessions/:sessionId | 更新会话 |
| DELETE | /chat/sessions/:sessionId | 删除/归档会话 |
| GET | /chat/sessions/:sessionId/messages | 消息列表（游标分页） |
| PUT | /chat/sessions/:sessionId/messages/:messageId | 编辑消息 |
| POST | /chat/completions | 对话补全（流式 SSE + 非流式） |
| POST | /chat/completions/stop | 停止生成 |
| POST | /chat/messages/:messageId/feedback | 消息反馈 |
| POST | /chat/messages/:messageId/regenerate | 重新生成 |

### agent（7 个，其中 1 个暂未迁移）— `routes/agent.ts`
| 方法 | 路径 | 说明 | 状态 |
|------|------|------|------|
| POST | /agent/sessions | 创建 Agent 会话 | ✅ 已迁移 |
| GET | /agent/sessions/:sessionId | 获取会话详情 | ✅ 已迁移 |
| GET | /agent/sessions/:sessionId/messages | 获取消息列表 | ✅ 已迁移 |
| **POST** | **/agent/completions** | **Agent 对话（流式）** | **❌ 返回 501** |
| GET | /agent/messages/:messageId/executions | 查询工具执行记录 | ✅ 已迁移 |
| GET | /agent/executions/:executionId/result | 查询执行结果 | ✅ 已迁移 |
| POST | /agent/messages/:messageId/feedback | 提交消息反馈 | ✅ 已迁移 |

### system（3 个）— `routes/system.ts`
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /system/models | 获取支持的模型列表 |
| GET | /system/config | 获取系统配置 |
| GET | /health | 健康检查 |

### upload（2 个）— `routes/upload.ts`
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /upload | 上传文件 |
| DELETE | /upload/:fileId | 删除文件 |

---

## 未迁移功能

### `POST /agent/completions` — Agent 流式对话端点

**状态**：返回 `501 Not Implemented`

**原因**：该端点的核心逻辑（LangGraph ReAct 循环 + AG-UI 事件适配 + 工具调用 + 记忆检索）位于 `apps/backend/ModuAgent/` 模块内部，依赖以下组件：

- `modu_graph.factory.create_agent` — 构建 LangGraph StateGraph 图
- `modu_graph.runner.stream_response` — 驱动图执行 + 事件桥接
- `orchestration.communication.agui_adapter.AGUIStreamAdapter` — 19 种 AG-UI 事件状态机
- `perception` / `memory` / `tools` / `feedback` 等图节点

ModuAgent 被明确排除在本次迁移范围外，因此该端点暂不可用。

**待办**：后续在 `packages/modu-agent`（TS 版 Agent 框架）就绪后，实现 `src/core/agent-bridge.ts` 并接入该端点。届时需翻译的核心逻辑包括：

1. LangGraph ReAct 循环的 TS 等价实现
2. AG-UI 事件状态机（`AGUIStreamAdapter` 的 19 种事件）
3. 工具调用编排与 `AgentToolExecution` 持久化
4. 会话上下文加载与历史记忆检索
5. `StreamContext` 元数据收集（思考/工具/文本分类）

---

## 已补齐短板

### 1. 日志文件持久化

对应 Python `main.py` 的 `TimedRotatingFileHandler`。TS 版使用 `pino-roll` 按日轮转：

- 日志目录：`logs/backend/`（自动创建）
- 文件名：`agent.log`（按日追加日期后缀）
- 轮转频率：每日
- 保留份数：30 份
- 同时输出到控制台（pino-pretty 彩色格式）

配置位置：[app.ts](file:///Users/ybxue/Desktop/pioneering/apps/backend-ts/src/app.ts) 的 `buildLoggerConfig()`

### 2. OpenAPI 文档（Swagger UI）

对应 FastAPI 的自动文档生成。TS 版使用 `@fastify/swagger` + `@fastify/swagger-ui`：

- 访问地址：`http://localhost:9001/docs`
- OpenAPI JSON：`http://localhost:9001/docs/json`
- 所有 33 个端点均配置了 tags / summary / security
- 请求体 schema 通过 `zod-to-json-schema` 从 Zod schema 自动转换
- 运行时校验仍由 `Schema.parse()` 执行（Zod），Fastify schema 仅做文档展示（`attachValidation: true` 不自动拒绝）

### 3. `/chat/completions/stop` 请求体验证

修复了之前直接返回 `{ message: "stopped" }` 不校验请求体的问题。现在使用 `StopGenerationRequestSchema.parse(req.body)` 校验 sessionId + messageId，与 Python 版完全对齐。

---

## 数据库约定

TS 版与 Python 版共用同一个 PostgreSQL 数据库，表结构由 Python 版 `init_db()` 创建和维护。

- Prisma schema（`prisma/schema.prisma`）通过 `@@map` / `@map` 精确对齐现有 9 张表的表名和列名
- **只执行 `prisma generate`**（生成 Client），**绝不执行 `prisma migrate` 或 `db push`**
- 字段名映射：Prisma 用 camelCase（`passwordHash`、`createdAt`），数据库列名为 snake_case（`password_hash`、`created_at`）

### 表结构变更流程（不使用 prisma migrate / db push）

新字段的添加统一收敛在 Python 侧 [database.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/database.py) 的 `_IDEMPOTENT_COLUMNS` 幂等 ALTER 清单中（`ADD COLUMN IF NOT EXISTS`，可重复执行），Prisma schema 仅同步镜像定义后重新 `generate`。需要手动在 psql / PowerShell 执行时，用同样的语句即可。

**变更记录：**

| 日期 | 表 | 变更 | 手动 SQL（等价幂等 ALTER） |
|------|-----|------|--------------------------|
| 2026-08-26 | chat_sessions | 新增 `runtime` 列（云边双模阶段 0：会话归属运行时，`cloud`=云端默认 / `local`=桌面本地） | `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS runtime VARCHAR(20) NOT NULL DEFAULT 'cloud';` |

镜像同步：`schema.prisma` 的 `ChatSession.runtime` 已同步（`@default("cloud") @db.VarChar(20)`），执行 `npm run db:generate --workspace @pioneering/backend` 重新生成 Client 即可，全程不触碰数据库。

---

## 技术栈对照

| 层 | Python 版 | TS 版 |
|----|----------|-------|
| Web 框架 | FastAPI | Fastify 5 |
| 数据校验 | Pydantic | Zod |
| ORM | SQLAlchemy | Prisma Client |
| 数据库 | PostgreSQL | PostgreSQL（共用） |
| 认证 | python-jose + passlib | jsonwebtoken + bcryptjs |
| LLM 流式 | httpx + AG-UI 生成器 | fetch ReadableStream + AG-UI 生成器 |
| 日志 | logging + TimedRotatingFileHandler | pino + pino-roll（按日轮转，保留 30 天） |
| API 文档 | FastAPI 自动 OpenAPI | @fastify/swagger + @fastify/swagger-ui |
| 静态文件 | StaticFiles | @fastify/static |
| 文件上传 | python-multipart | @fastify/multipart |
| CORS | CORSMiddleware | @fastify/cors |

---

## 启动方式

```bash
# 1. 安装依赖
npm install --workspace @pioneering/backend

# 2. 生成 Prisma Client（不碰数据库）
npx prisma generate --schema=apps/backend-ts/prisma/schema.prisma

# 3. 复制环境变量
cp apps/backend-ts/.env.example apps/backend-ts/.env
# 编辑 .env 填入 DATABASE_URL / JWT_SECRET / LLM_API_KEY

# 4. 开发模式启动（热重载）
npm run dev --workspace @pioneering/backend

# 5. 生产构建
npm run build --workspace @pioneering/backend
npm run start --workspace @pioneering/backend
```

---

## 目录结构

```
apps/backend-ts/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── .env.example
├── prisma/
│   └── schema.prisma          # 对齐现有 9 张表（只读，不 migrate）
└── src/
    ├── index.ts                # 启动入口
    ├── app.ts                  # Fastify 实例 + 插件编排
    ├── config/
    │   └── env.ts              # 环境变量校验（Zod）
    ├── core/
    │   ├── security.ts         # bcrypt + JWT
    │   └── llm.ts              # AG-UI 流式 LLM 服务
    ├── plugins/
    │   ├── prisma.ts           # Prisma Client 装饰
    │   ├── auth.ts             # 认证守卫
    │   ├── response-wrapper.ts # 统一响应包装
    │   ├── error-handler.ts    # 错误处理
    │   ├── cors.ts             # CORS
    │   └── static.ts           # 静态文件
    ├── schemas/
    │   ├── common.ts
    │   ├── user.ts
    │   ├── chat.ts
    │   └── agent.ts
    ├── routes/
    │   ├── index.ts            # 路由注册
    │   ├── auth.ts
    │   ├── chat.ts
    │   ├── user.ts
    │   ├── system.ts
    │   ├── upload.ts
    │   └── agent.ts
    ├── types/
    │   └── fastify.d.ts        # Fastify 类型扩展
    └── utils/
        └── id.ts               # ID 生成
```
