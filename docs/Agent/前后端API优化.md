# 前后端数据库字段与接口配置优化方案

> 基于 frontend/、python-backend/（含 ModuAgent/）全部代码的深度阅读与分析
> 日期：2026-06-03

---

## 一、现有数据库表结构总览

> 所有模型定义在 [app/models/user.py](../../python-backend/app/models/user.py)

| 表名 | 模型类 | 用途 | 当前状态 |
|------|--------|------|----------|
| `users` | User | 用户账户 | 已有 |
| `refresh_tokens` | RefreshToken | JWT 刷新令牌 | 已有 |
| `chat_sessions` | ChatSession | 对话会话 | 已有 |
| `chat_messages` | ChatMessage | 对话消息 | **字段不足** |
| `files` | File | 文件上传 | 已有 |
| `token_usage` | TokenUsage | Token 用量记录 | 已有 |
| `user_quotas` | UserQuota | 用户配额 | 已有 |
| `ai_configs` | AiConfig | AI 配置 | **无对应 API** |

---

## 二、现有接口清单

### 2.1 已实现接口（[app/api/v1/](../../python-backend/app/api/v1/)）

| 方法 | 路径 | 模块 | 说明 |
|------|------|------|------|
| POST | `/auth/login` | auth.py | 用户名密码登录 |
| POST | `/auth/wechat/miniprogram` | auth.py | 微信小程序登录(模拟) |
| POST | `/auth/wechat/web` | auth.py | 微信网页登录(模拟) |
| POST | `/auth/refresh` | auth.py | 刷新 Token |
| GET | `/auth/profile` | auth.py | 获取当前用户信息 |
| PUT | `/auth/profile` | auth.py | 更新当前用户信息 |
| GET | `/chat/sessions` | chat.py | 会话列表 |
| POST | `/chat/sessions` | chat.py | 创建会话 |
| GET | `/chat/sessions/{id}` | chat.py | 获取会话 |
| PUT | `/chat/sessions/{id}` | chat.py | 更新会话 |
| DELETE | `/chat/sessions/{id}` | chat.py | 删除/归档会话 |
| GET | `/chat/sessions/{id}/messages` | chat.py | 获取消息列表 |
| PUT | `/chat/sessions/{id}/messages/{mid}` | chat.py | 编辑消息 |
| POST | `/chat/completions` | chat.py | 对话补全（SSE 流式） |
| POST | `/chat/completions/stop` | chat.py | 停止生成(空壳) |
| POST | `/chat/messages/{mid}/feedback` | chat.py | 消息反馈 |
| POST | `/chat/messages/{mid}/regenerate` | chat.py | 重新生成 |
| GET | `/user/list` | user.py | 用户列表(管理) |
| GET | `/user/profile` | user.py | 用户信息 |
| PUT | `/user/profile` | user.py | 更新用户信息 |
| GET | `/user/quota` | user.py | 配额查询 |
| GET | `/user/quota/usage` | user.py | 用量记录 |
| GET | `/system/models` | system.py | 模型列表 |
| GET | `/system/config` | system.py | 系统配置 |
| GET | `/health` | system.py | 健康检查 |
| POST | `/upload` | upload.py | 文件上传 |
| DELETE | `/upload/{id}` | upload.py | 文件删除 |

### 2.2 前端期望但后端缺失的接口

> 来自 [shared/api/endpoints.ts](../../shared/api/endpoints.ts)

| 方法 | 路径 | 说明 | 优先级 |
|------|------|------|--------|
| GET | `/ai-config/latest` | 获取最新 AI 配置 | **高** |
| POST | `/ai-config/test` | 测试 AI 连接 | **高** |
| POST | `/ai-config/save` | 保存 AI 配置 | **高** |
| GET | `/ai-config/{id}` | 获取单个配置 | 中 |
| CRUD | `/api/global-prompt/*` | 全局 Prompt 管理 | **高** |
| GET | `/user/profile/{id}` | 按 ID 获取用户 | 中 |

---

## 三、核心问题分析

### 3.1 ChatMessage 字段不足以支撑 Agent 业务

当前 `ChatMessage` 模型仅有 `content` + `content_blocks(JSON)`，但前端 `useAgentChat.ts` 期望返回以下字段：

```
thinkingContent  -> 思考过程内容
answerContent    -> 最终回答内容
toolCalls        -> 工具调用记录
```

Agent 流式响应中，[agent_bridge.py](../../python-backend/app/core/agent_bridge.py) 的 `stream_chat_completion` 已通过 `__metadata__` 事件传递了 `thinkingContent`、`answerContent`、`toolCalls`，但这些数据**并未持久化到数据库**。当前仅将 `full_content` 存入 `ChatMessage.content` 字段，丢失了结构化信息。

### 3.2 AiConfig 表有模型无 API

[ai_configs 表](../../python-backend/app/models/user.py#L155) 已在模型中定义，但**没有任何 API 路由**操作该表。前端 admin 页面（[ModelManagement.tsx](../../frontend/pages/admin/ModelManagement.tsx)）依赖 localStorage 兜底，无法持久化。

### 3.3 Global Prompt 表缺失

前端 admin 有完整的 Global Prompt 管理模块（[globalPrompt/](../../frontend/pages/admin/globalPrompt/)），包含 CRUD、上线/下线、审批等操作，但后端**完全没有对应的表模型和 API**。

### 3.4 ModuAgent 内存持久化问题

- `InMemoryShortTermMemory`（[redis_adapter.py](../../python-backend/ModuAgent/components/memory/cache/redis_adapter.py)）是纯内存存储，服务重启即丢失
- `Coordinator` 的 `stream_request` 方法中，Agent 推理步骤（思考 -> 工具调用 -> 结果 -> 最终回答）**均未写入数据库**
- 前端 `useAgentChat.ts` 的 `loadSession` 方法尝试从数据库重建 `AgentStep[]`，但数据库**没有存储这些步骤**

### 3.5 接口字段命名不一致

| 后端字段 | 前端期望 | 位置 |
|----------|----------|------|
| `model_config` | `model_params` | ChatSession |
| `message_count` | `messageCount` | SessionResponse |
| `created_at` | `createdAt` | 多处 |
| `updated_at` | `updatedAt` | 多处 |
| `last_message_id` | `lastMessageId` | SessionResponse |
| `extra_metadata` | `metadata` | ChatMessage |

前端 `useAgentChat.ts` 的 `fetchSessions` 已做了兼容映射（`s.message_count ?? s.messageCount`），但 `loadSession` 中直接使用 `m.session_id` 等 snake_case，说明前后端未统一。

---

## 四、优化方案

### 4.1 数据库字段优化

#### A. ChatMessage 表增加字段

在 `ChatMessage` 模型中新增以下字段：

```python
thinking_content = Column("thinking_content", Text, nullable=True)       # Agent 思考过程
answer_content = Column("answer_content", Text, nullable=True)           # Agent 最终回答
tool_calls_data = Column("tool_calls_data", JSON, nullable=True)         # 工具调用记录
agent_steps = Column("agent_steps", JSON, nullable=True)                 # Agent 步骤历史
```

**理由**：`content` 存原始完整文本，`thinking_content`/`answer_content` 分离存储便于前端渲染思考过程折叠面板，`tool_calls_data` 存储结构化的工具调用链，`agent_steps` 存储完整的 Agent 步骤历史（ThinkingStep、ToolCallStep、ToolResultStep、TextStreamStep）。

#### B. ChatSession 表增加字段

在 `ChatSession` 模型中新增以下字段：

```python
agent_type = Column("agent_type", String(50), default="chat")            # 对话类型：chat/incubation/assessment
incubation_stage = Column("incubation_stage", String(50), nullable=True) # 孵化阶段
assessment_result = Column("assessment_result", JSON, nullable=True)     # 评估结果
```

**理由**：前端有 Assessment、Incubation、Training 等业务页面，需要区分会话类型并关联业务数据。

#### C. 新增 GlobalPrompt 表

```python
class GlobalPrompt(Base):
    __tablename__ = "global_prompts"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(200), unique=True, nullable=False)
    module = Column(String(50), nullable=False)  # perception/retrieval/generation/evaluation
    content = Column(Text, nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), default="draft")  # draft/online/offline
    version = Column(Integer, default=1)
    created_by = Column(String(64), ForeignKey("users.id"), nullable=True)
    approved_by = Column(String(64), ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
```

#### D. 新增 AgentTrace 表（Agent 执行追踪）

```python
class AgentTrace(Base):
    __tablename__ = "agent_traces"

    id = Column(String(64), primary_key=True, default=lambda: gen_id("trace_"))
    session_id = Column(String(64), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    message_id = Column(String(64), ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=True)
    trace_id = Column(String(64), nullable=False)
    step_type = Column(String(50), nullable=False)  # thinking/tool_call/tool_result/text_stream/error
    step_data = Column(JSON, nullable=False)
    step_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
```

### 4.2 接口优化

#### A. 新增 AI Config API（高优先级）

在 `app/api/v1/` 下新建 `ai_config.py`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/ai-config/latest` | 获取最新配置 |
| GET | `/ai-config/{id}` | 获取指定配置 |
| POST | `/ai-config/save` | 保存配置（upsert） |
| POST | `/ai-config/test` | 测试 LLM 连接 |

#### B. 新增 Global Prompt API（高优先级）

在 `app/api/v1/` 下新建 `global_prompt.py`：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/global-prompt` | 列表（按 module 筛选） |
| GET | `/api/global-prompt/{id}` | 获取详情 |
| POST | `/api/global-prompt` | 创建 |
| PUT | `/api/global-prompt/{id}` | 更新 |
| DELETE | `/api/global-prompt/{id}` | 删除 |
| PUT | `/api/global-prompt/{id}/status` | 上线/下线 |
| GET | `/api/global-prompt/online` | 获取所有在线 Prompt |

#### C. Agent 消息持久化改造

在 [chat.py](../../python-backend/app/api/v1/chat.py) 的 `chat_completion` 接口中，完成流式响应后，将结构化字段写入 `ChatMessage`：

```python
# 在 SSE 流结束后，保存 assistant_msg 时追加写入：
assistant_msg.thinking_content = thinking_content
assistant_msg.answer_content = answer_content
assistant_msg.tool_calls_data = tool_calls
assistant_msg.agent_steps = agent_steps  # 需要收集所有步骤
```

前端 `MessageResponse` 增加字段：

```python
class MessageResponse(BaseModel):
    # ... 已有字段
    thinking_content: str | None = None
    answer_content: str | None = None
    tool_calls: list | None = None
    agent_steps: list | None = None
    
    model_config = {"from_attributes": True}
```

#### D. 接口返回字段统一

`SessionResponse` 增加：

```python
class SessionResponse(BaseModel):
    # ... 已有字段
    model_params: dict | None = Field(None, alias="model_config")  # 支持别名映射
    last_message_id: str | None = None
    agent_type: str = "chat"
    
    model_config = {"from_attributes": True, "populate_by_name": True}
```

### 4.3 ModuAgent 与数据库集成

#### A. 持久化会话上下文

修改 [Coordinator.stream_request](../../python-backend/ModuAgent/orchestration/coordinator.py)（约 L400-L700），在每轮对话结束后：

1. 将 `perception_result`、`memory_result`、`tool_results` 写入 `AgentTrace` 表
2. 将完整对话上下文同步到 `ChatMessage.content_blocks`（JSON）

#### B. 内存 -> 数据库记忆桥接

当前 `InMemoryShortTermMemory` 每次重启丢失历史。优化方案：

- **短期**：`StorageAdapter.query_all()` 增加从 `ChatMessage` 表读取最近 N 条消息作为历史
- **中期**：接入 Redis 作为短期记忆缓存
- **长期**：向量化存储历史对话到 Chroma/FAISS

#### C. 工具调用结果入库

在 `Coordinator.stream_request` 的工具调用循环中（约 L460-L530），每次工具调用完成后，通过 `AgentTrace` 表记录：

- 工具名称、参数、结果
- 执行耗时
- 错误信息（如有）

### 4.4 配置统一

在 [app/config.py](../../python-backend/app/config.py) 中增加 ModuAgent 相关配置：

```python
# ModuAgent 配置
modu_config_path: str = ""                           # ModuAgent 配置文件路径
modu_memory_strategy: str = "cache"                  # 记忆策略
modu_max_reasoning_iterations: int = 3               # 最大推理迭代
modu_default_perception: str = "text_preprocessor"   # 默认感知器
modu_context_window: str = "last_5_turns"            # 上下文窗口
```

---

## 五、实施优先级建议

| 优先级 | 任务 | 影响范围 | 文件 |
|--------|------|----------|------|
| P0 | ChatMessage 增加 thinking_content/answer_content/tool_calls_data 字段 | 前端对话展示、历史加载 | [models/user.py](../../python-backend/app/models/user.py) |
| P0 | AiConfig API 实现（latest/test/save） | Admin 模型管理页面 | 新建 `api/v1/ai_config.py` |
| P0 | GlobalPrompt 表 + API 实现 | Admin Prompt 管理 | 新建模型 + `api/v1/global_prompt.py` |
| P1 | AgentTrace 表 + Agent 步骤持久化 | 对话历史完整回放 | 新建模型 + 改造 `agent_bridge.py` |
| P1 | 接口字段命名统一（snake_case/camelCase） | 前后端数据一致性 | 多处 |
| P1 | coordinator 内存 -> 数据库记忆桥接 | 服务重启不丢上下文 | [coordinator.py](../../python-backend/ModuAgent/orchestration/coordinator.py) |
| P2 | ChatSession 增加 agent_type/incubation_stage | 业务页面关联 | [models/user.py](../../python-backend/app/models/user.py) |
| P2 | ModuAgent 配置统一到 settings | 配置管理 | [config.py](../../python-backend/app/config.py) |
| P3 | Redis 缓存接入 | 性能优化 | [redis_adapter.py](../../python-backend/ModuAgent/components/memory/cache/redis_adapter.py) |
| P3 | 向量化长期记忆（Chroma/FAISS） | 知识检索增强 | [vector/](../../python-backend/ModuAgent/components/memory/vector/) |

---

## 六、依赖关系说明

```
P0（AiConfig API）
  └── P1（字段命名统一）—— 依赖 P0 的 MessageResponse 改造
P0（GlobalPrompt 表 + API）
P0（ChatMessage 字段扩展）
  └── P1（Agent 步骤持久化）—— 依赖 ChatMessage 新增字段
      └── P1（记忆桥接）—— 依赖 AgentTrace 表
          └── P3（Redis 缓存）—— 基于记忆桥接方案
P2（ChatSession 业务扩展）—— 独立，可并行
P3（向量化记忆）—— 独立，可并行
```

建议分 **3 个 Sprint** 执行：

- **Sprint 1**：完成 P0 全部任务（AiConfig API、GlobalPrompt 表+API、ChatMessage 字段扩展）
- **Sprint 2**：完成 P1 任务（Agent 步骤持久化、字段命名统一、记忆桥接）
- **Sprint 3**：完成 P2/P3 任务（业务扩展、Redis、向量化）

---

## 七、Agent 核心业务流程详解：黑盒推理 → 白盒轨迹

> 本章聚焦 **Agent 对话补全（POST /chat/completions）** 的完整数据链路，
> 涵盖从后端 Coordinator 内部推理到前端 StepRenderer 可视化渲染的全过程。
> **AiConfig、GlobalPrompt 等独立管理类接口不在本章范围内，归入下一版本迭代。**

### 7.1 业务全景架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              前端 (Frontend)                                 │
│  ┌─────────────────────┐    ┌──────────────────────┐                        │
│  │ useAgentChat.ts     │───▶│ StepRenderer.tsx      │                        │
│  │  - handleSend()     │    │  - ThinkingStepView   │                        │
│  │  - applyStreamEvent │    │  - ToolCallStepView   │                        │
│  │  - loadSession()    │    │  - ToolResultStepView │                        │
│  │  - fetchSessions()  │    │  - TextStreamStepView │                        │
│  └─────────┬───────────┘    └──────────────────────┘                        │
│            │ SSE 流式读取                                                     │
│            │ POST /chat/completions                                          │
│            │ GET  /chat/sessions/{id}/messages                               │
│            │ GET  /chat/sessions                                             │
└────────────┼────────────────────────────────────────────────────────────────┘
             │
┌────────────┼────────────────────────────────────────────────────────────────┐
│            ▼                      后端 (Python Backend)                       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  app/api/v1/chat.py          — HTTP 接口层                            │   │
│  │  chat_completion()           — 创建 session/user_msg → SSE 流 →       │   │
│  │                                assistant_msg 持久化                    │   │
│  └──────────────────────────────┬───────────────────────────────────────┘   │
│                                 │                                            │
│  ┌──────────────────────────────▼───────────────────────────────────────┐   │
│  │  app/core/agent_bridge.py    — 桥接层（Frame → Frontend Event）        │   │
│  │  stream_chat_completion()    — 初始化 ModuAgent 组件                   │   │
│  │  _coordinator_frame_to_      — 将 Coordinator 的 {event, data} frame  │   │
│  │    frontend_event()           转换为前端 {type, content, ...} event    │   │
│  │                              — 收集 thinkingContent/answerContent/     │   │
│  │                                toolCalls → __metadata__ 事件           │   │
│  └──────────────────────────────┬───────────────────────────────────────┘   │
│                                 │                                            │
│  ┌──────────────────────────────▼───────────────────────────────────────┐   │
│  │  ModuAgent/orchestration/    — Agent 推理引擎（"黑盒" 内部）           │   │
│  │    coordinator.py                                                      │   │
│  │  Coordinator.stream_request()                                         │   │
│  │    ├─ Phase 1: Perception    (TextPreprocessor)                       │   │
│  │    ├─ Phase 2: Memory        (InMemoryShortTermMemory)                │   │
│  │    ├─ Phase 3: Thinking      (BaseLLMReasoner.generate)               │   │
│  │    ├─ Phase 4: Tool Calling  (ReAct 循环: parse→invoke→observe)       │   │
│  │    └─ Phase 5: Final Answer  (LLM streaming token by token)           │   │
│  │                                                                        │   │
│  │  通过 SSEEncoder 将每一步编码为 SSE frame:                              │   │
│  │    encode_status() / encode_thinking() / encode_tool_call_start() /   │   │
│  │    encode_tool_result() / encode_token() / encode_done()              │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  app/models/user.py          — 数据持久化层                            │   │
│  │  ChatSession / ChatMessage   — 会话与消息存储                           │   │
│  │  AgentTrace（待新增）         — Agent 步骤追踪表                         │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 核心业务流程：一次对话的完整生命周期

#### 时序图

```
前端 useAgentChat              后端 chat.py           agent_bridge           Coordinator           SSEEncoder            DB
     │                              │                      │                      │                    │                  │
     │ 1. POST /chat/completions    │                      │                      │                    │                  │
     │  {message, sessionId?}       │                      │                      │                    │                  │
     │─────────────────────────────▶│                      │                      │                    │                  │
     │                              │ 2. 无sessionId则创建  │                      │                    │                  │
     │                              │─────────────────────────────────────────────────────────────────────────────────▶│
     │                              │ 3. 插入user_msg       │                      │                    │                  │
     │                              │─────────────────────────────────────────────────────────────────────────────────▶│
     │                              │                      │                      │                    │                  │
     │                              │ 4. stream_chat_      │                      │                    │                  │
     │                              │    completion()      │                      │                    │                  │
     │                              │─────────────────────▶│                      │                    │                  │
     │                              │                      │ 5. 初始化ModuAgent    │                    │                  │
     │                              │                      │─────────────────────▶│                    │                  │
     │                              │                      │                      │                    │                  │
     │                              │                      │ 6. coordinator.      │                    │                  │
     │                              │                      │    stream_request()  │                    │                  │
     │                              │                      │─────────────────────▶│                    │                  │
     │                              │                      │                      │                    │                  │
     │                              │                      │                      │ 7. Perception      │                  │
     │                              │                      │                      │    (encode_status) │                  │
     │                              │                      │                      │───────────────────▶│                  │
     │                              │                      │                      │                    │                  │
     │                              │                      │                      │ 8. Memory          │                  │
     │                              │                      │                      │    (encode_status) │                  │
     │                              │                      │                      │───────────────────▶│                  │
     │                              │                      │                      │                    │                  │
     │                              │                      │                      │ 9. Thinking        │                  │
     │                              │                      │                      │    (encode_thinking)│                 │
     │                              │                      │──────────────────────▶│                    │                  │
     │                              │                      │                      │                    │                  │
     │                              │                      │                      │ 10. ReAct循环      │                  │
     │                              │                      │                      │  encode_tool_call_  │                  │
     │                              │                      │                      │  start/result/end   │                  │
     │                              │                      │                      │───────────────────▶│                  │
     │                              │                      │                      │                    │                  │
     │                              │                      │                      │ 11. Final Answer   │                  │
     │                              │                      │                      │  encode_token()*N  │                  │
     │                              │                      │                      │  encode_done()     │                  │
     │                              │                      │                      │───────────────────▶│                  │
     │                              │                      │                      │                    │                  │
     │                              │                      │ 12. frame → frontend │                    │                  │
     │                              │                      │    event             │                    │                  │
     │                              │◀─────────────────────│                      │                    │                  │
     │                              │                      │                      │                    │                  │
     │ 13. SSE: data:{type:...}    │                      │                      │                    │                  │
     │◀────────────────────────────│                      │                      │                    │                  │
     │                              │                      │                      │                    │                  │
     │ 14. applyStreamEvent()      │                      │                      │                    │                  │
     │     更新AgentStep[]         │                      │                      │                    │                  │
     │     触发StepRenderer渲染    │                      │                      │                    │                  │
     │                              │                      │                      │                    │                  │
     │                              │ 15. __metadata__     │                      │                    │                  │
     │◀────────────────────────────│  thinkingContent/    │                      │                    │                  │
     │                              │  answerContent/     │                      │                    │                  │
     │                              │  toolCalls汇总       │                      │                    │                  │
     │                              │                      │                      │                    │                  │
     │                              │ 16. 插入assistant_msg│                      │                    │                  │
     │                              │    (⚠️当前未写入     │                      │                    │                  │
     │                              │     结构化字段)      │                      │                    │                  │
     │                              │─────────────────────────────────────────────────────────────────────────────────▶│
     │                              │                      │                      │                    │                  │
     │ 17. 前端侧同步完成           │                      │                      │                    │                  │
     │     setMessages更新status   │                      │                      │                    │                  │
     │                              │                      │                      │                    │                  │
```

#### 18. 历史会话加载（loadSession）

```
前端 loadSession(sessionId)          后端 GET /chat/sessions/{id}/messages           DB
     │                                         │                                    │
     │────────────────────────────────────────▶│                                    │
     │                                         │ SELECT * FROM chat_messages         │
     │                                         │ WHERE session_id = ?                │
     │                                         │───────────────────────────────────▶│
     │                                         │◀───────────────────────────────────│
     │                                         │                                    │
     │◀── MessageResponse[] ──────────────────│                                    │
     │    (id, role, content,                                                  │
     │     thinking_content?,  ← ⚠️ 字段缺失，恒为 null                         │
     │     answer_content?,    ← ⚠️ 字段缺失，恒为 null                         │
     │     tool_calls_data?)   ← ⚠️ 字段缺失，恒为 null                         │
     │                                                                              │
     │ 前端重建逻辑（useAgentChat.ts loadSession L102-L180）:                         │
     │   1. thinkingContent → ThinkingStep                                          │
     │   2. toolCalls[]     → ToolCallStep + ToolResultStep                         │
     │   3. answerContent   → TextStreamStep                                        │
     │                                                                              │
     │ ⚠️ 当前因DB无结构化数据，loadSession 重建的 AgentStep[] 始终为空，              │
     │    前端仅显示 content 原始文本，无法展示白盒轨迹。                              │
```

### 7.3 SSE 流式协议规范（核心接口）

#### 接口：POST /chat/completions

**请求体：**

```json
{
  "session_id": "sess_abc123...",
  "message": "计算 15 * 23 + 100",
  "model": "deepseek-v4-flash",
  "system_prompt": "",
  "temperature": 0.7,
  "max_tokens": 4096,
  "stream": true,
  "parent_message_id": null,
  "deep_think": false,
  "net_search": false
}
```

**响应（SSE 流）：Content-Type: text/event-stream**

每条消息格式为 `event: {event_name}\ndata: {json}\n\n`。event 字段由 [SSEEncoder.to_sse_message](../../python-backend/ModuAgent/orchestration/communication/streaming.py) 编码。

| 序号 | event | data.type | 说明 | 触发位置 |
|------|-------|-----------|------|----------|
| 1 | `status` | `status` | 阶段状态：perception / memory | [coordinator.py L405/L436](../../python-backend/ModuAgent/orchestration/coordinator.py) |
| 2 | `thinking` | `thinking_delta` | 思考内容（整个思考块的文本） | [agent_bridge.py L81-L86](../../python-backend/app/core/agent_bridge.py) |
| 3 | `thinking` | `thinking_done` | 思考阶段结束标记 | [agent_bridge.py L81-L86](../../python-backend/app/core/agent_bridge.py) |
| 4 | `reasoning_iteration` | `reasoning_iteration` | 推理迭代信息：{iterationIndex, maxIterations} | [agent_bridge.py L88-L93](../../python-backend/app/core/agent_bridge.py) |
| 5 | `tool_call_start` | `tool_call_start` | 工具调用开始：{id, name, arguments} | [agent_bridge.py L95-L101](../../python-backend/app/core/agent_bridge.py) |
| 6 | `tool_call_end` | `tool_call_end` | 工具调用结束：{id, name, arguments} | [agent_bridge.py L103-L108](../../python-backend/app/core/agent_bridge.py) |
| 7 | `tool_result` | `tool_result_end` | 工具调用结果：{id, name, result, status} | [agent_bridge.py L110-L117](../../python-backend/app/core/agent_bridge.py) |
| 8 | `token` | `answer_delta` | 回答文本增量（逐 token 推送） | [agent_bridge.py L119-L124](../../python-backend/app/core/agent_bridge.py) |
| 9 | `done` | `answer_done` | 回答完成标记 | [agent_bridge.py L128-L129](../../python-backend/app/core/agent_bridge.py) |
| 10 | `error` | `error` | 错误事件：{errorCode, message} | [agent_bridge.py L131-L135](../../python-backend/app/core/agent_bridge.py) |
| 11 | `message` | `__metadata__` | 汇总元数据（流结束后一次性推送） | [agent_bridge.py L224-L234](../../python-backend/app/core/agent_bridge.py) |

**序号 11 `__metadata__` 结构（当前仅通过SSE传递，未持久化）：**

```json
{
  "type": "__metadata__",
  "payload": {
    "thinkingContent": "用户要求计算 15*23+100...",
    "answerContent": "15 × 23 + 100 = 345 + 100 = 445",
    "toolCalls": [
      {
        "id": "uuid-1",
        "name": "calculator",
        "arguments": "{\"expression\":\"15*23+100\"}"
      }
    ],
    "toolResults": [
      {
        "id": "uuid-1",
        "name": "calculator",
        "result": "{\"result\":445}",
        "status": "success"
      }
    ],
    "hasError": false,
    "errorInfo": {}
  }
}
```

#### 前端 SSE 解析流程

见 [useAgentChat.ts handleSend L475-L530](../../frontend/pages/agent/hooks/useAgentChat.ts)：

1. 使用 `ReadableStream` 逐行读取 SSE
2. 以 `data: ` 前缀识别数据行
3. `JSON.parse` 解析为 `StreamEvent` 对象
4. 调用 `applyStreamEvent(event)` 实时更新 `AgentStep[]`
5. 流结束后，`setMessages` 将 assistant 消息状态置为 `success`

#### applyStreamEvent 状态机

见 [useAgentChat.ts applyStreamEvent L203-L470](../../frontend/pages/agent/hooks/useAgentChat.ts)：

| event.type | 操作 | Step 类型 | 状态 |
|------------|------|-----------|------|
| `thinking_delta` | 新增/追加思考内容 | `ThinkingStep` | streaming |
| `thinking_done` | 标记思考完成 | `ThinkingStep` | success |
| `tool_call_start` | 新增工具调用步骤 | `ToolCallStep` | streaming |
| `tool_call_end` | 标记工具调用完成 | `ToolCallStep` | success |
| `tool_result_end` | 新增工具结果步骤 | `ToolResultStep` | success/error |
| `answer_delta` | 新增/追加回答文本 | `TextStreamStep` | streaming |
| `answer_done` | 标记回答完成 | `TextStreamStep` | success |
| `reasoning_iteration` | 新增迭代标记 | `ReasoningIterationStep` | success |
| `error` | 新增错误步骤 | `ErrorStep` | error |

### 7.4 数据库表优化方案（核心业务相关）

> 仅涉及 Agent 执行流程所需的表变更。AiConfig、GlobalPrompt 等独立管理类表不在本章范围内。

#### 7.4.1 ChatMessage 表新增字段（P0 优先级）

当前 [ChatMessage 模型](../../python-backend/app/models/user.py#L100-L120) 只有 `content` + `content_blocks(JSON)`，无法支撑白盒轨迹回放。

```python
# app/models/user.py — ChatMessage 类内新增以下字段：

thinking_content = Column("thinking_content", Text, nullable=True)
# Agent 思考过程文本，如 "用户要求计算 15*23+100，我需要使用calculator工具..."

answer_content = Column("answer_content", Text, nullable=True)
# Agent 最终回答文本，与 content 分离存储

tool_calls_data = Column("tool_calls_data", JSON, nullable=True)
# 工具调用记录，结构：
# [{"id":"uuid","name":"calculator","arguments":"{...}"}, ...]

agent_steps = Column("agent_steps", JSON, nullable=True)
# 完整的 Agent 步骤历史，结构与前端 AgentStep[] 对应：
# [
#   {"id":"step_1","type":"thinking","content":"...","status":"success","startTime":...,"endTime":...},
#   {"id":"step_2","type":"tool_call","toolName":"calculator","arguments":"...","status":"success",...},
#   {"id":"step_3","type":"tool_result","toolCallId":"step_2","result":"...","status":"success",...},
#   {"id":"step_4","type":"text_stream","content":"...","status":"success",...}
# ]
```

**前后端数据对应关系：**

| 前端 ChatMessage 字段 | 后端 ChatMessage 字段 | 说明 |
|------------------------|----------------------|------|
| `thinkingContent` | `thinking_content` | 思考过程文本 |
| `answerContent` | `answer_content` | 最终回答文本 |
| `toolCalls` | `tool_calls_data` | 工具调用列表 |
| `steps` (AgentStep[]) | `agent_steps` | 完整步骤历史 |
| `content` | `content` | 原始完整文本（保留兼容） |
| `role` | `role` | user / assistant |
| `status` | （前端计算） | 根据 steps 状态推断 |

#### 7.4.2 AgentTrace 表（P1 优先级，新增）

用于记录每一次 Agent 推理的完整步骤链，支持历史回放与失败追溯。

```python
# app/models/user.py — 新增模型

class AgentTrace(Base):
    __tablename__ = "agent_traces"

    id = Column(String(64), primary_key=True, default=lambda: gen_id("trace_"))
    trace_id = Column(String(64), nullable=False, index=True)
    session_id = Column(String(64), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    message_id = Column(String(64), ForeignKey("chat_messages.id", ondelete="CASCADE"), nullable=True, index=True)
    step_type = Column(String(50), nullable=False)
    # 步骤类型：thinking / tool_call / tool_result / text_stream / error
    step_data = Column(JSON, nullable=False)
    # 步骤完整数据，结构与 agent_steps 中单项一致
    step_order = Column(Integer, default=0)
    # 步骤序号，保证顺序
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
```

**AgentTrace 与 ChatMessage.agent_steps 的关系：**

- `agent_steps` 是消息维度的聚合快照，一条 assistant 消息对应一个 `AgentStep[]` 数组
- `agent_traces` 是步骤维度的详细日志，每个推理步骤一条记录，带 trace_id 支持多轮关联
- 前端历史回放优先使用 `agent_steps`（一次查询即可重建完整轨迹）
- 审计/调试场景使用 `agent_traces`（可按 trace_id 追溯单次推理全链路）

#### 7.4.3 ChatSession 表新增字段（P2 优先级）

```python
# app/models/user.py — ChatSession 类内新增：

agent_type = Column("agent_type", String(50), default="chat")
# 会话类型：chat（普通对话）/ incubation（孵化）/ assessment（评估）
```

### 7.5 接口改造方案（核心业务相关）

#### 7.5.1 POST /chat/completions — 流结束后持久化改造

当前 [chat.py chat_completion](../../python-backend/app/api/v1/chat.py#L290-L370) 在 SSE 流结束后执行以下伪代码：

```python
# 当前实现（L360-L370）：
assistant_msg = ChatMessage(
    id=_gen_id("msg_"),
    session_id=session_id,
    user_id=current_user.id,
    role=MessageRole.assistant,
    content=full_content or thinking_content or answer_content,  # ← 仅存文本
    parent_message_id=user_msg.id,
)
db.add(assistant_msg)
```

**改造后（在插入 assistant_msg 前追加）：**

```python
# 解析 __metadata__ 后获取结构化数据
assistant_msg = ChatMessage(
    id=_gen_id("msg_"),
    session_id=session_id,
    user_id=current_user.id,
    role=MessageRole.assistant,
    content=full_content,                           # 保留完整文本
    thinking_content=thinking_content,              # 新增：思考过程
    answer_content=answer_content,                  # 新增：最终回答
    tool_calls_data=tool_calls_data,                # 新增：工具调用
    agent_steps=agent_steps,                        # 新增：完整步骤
    parent_message_id=user_msg.id,
)
db.add(assistant_msg)

# 批量写入 AgentTrace（如有）
for i, step in enumerate(agent_steps or []):
    db.add(AgentTrace(
        id=_gen_id("trace_"),
        trace_id=trace_id,
        session_id=session_id,
        message_id=assistant_msg.id,
        step_type=step.get("type", ""),
        step_data=step,
        step_order=i,
    ))
```

**注意**：当前 `agent_bridge.py` 中 `stream_chat_completion` 未收集 `agent_steps`。需要在 `agent_bridge.py` 中收集每一步事件，构建完整的 `AgentStep[]` 数组，然后通过 `__metadata__` 传递给 `chat.py`。

#### 7.5.2 MessageResponse — 增加返回字段

```python
# app/schemas/chat.py — MessageResponse 新增字段：

class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    content_blocks: list | None = None
    token_count: int | None = None
    feedback: str = "none"
    metadata: dict | None = None
    parent_message_id: str | None = None

    # === 以下为新增字段 ===
    thinking_content: str | None = None       # ← 新增
    answer_content: str | None = None         # ← 新增
    tool_calls_data: list | None = None       # ← 新增
    agent_steps: list | None = None           # ← 新增

    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
```

#### 7.5.3 GET /chat/sessions/{id}/messages — 改造适配

当前 [get_messages](../../python-backend/app/api/v1/chat.py#L216-L245) 已通过 `MessageResponse.model_validate(m)` 返回，只需 `ChatMessage` 模型新增字段后，前端即可自动获取 `thinking_content` 等字段。

前端 [loadSession](../../frontend/pages/agent/hooks/useAgentChat.ts#L95-L180) 已做好兼容映射：

```typescript
// 前端已预留的兼容逻辑（L105-L112）
thinkingContent: (m.thinking_content ?? m.thinkingContent ?? '') as string,
answerContent: (m.answer_content ?? m.answerContent ?? '') as string,
toolCalls: (m.tool_calls ?? m.toolCalls ?? []) as Array<{...}>,
```

一旦后端返回 `thinking_content` / `answer_content` / `tool_calls`，前端的 `loadSession` 重建逻辑即可生效，无需前端改动。

#### 7.5.4 字段命名统一方案

前后端字段命名不一致问题贯穿整个项目。方案：后端统一输出 **snake_case**，前端通过兼容映射读取，不做全局重命名。

```typescript
// 前端统一兼容映射模式（已在 useAgentChat.ts 中采用）
const mapped = raw.map((s: Record<string, unknown>) => ({
  id: s.id,
  title: s.title,
  messageCount: (s.message_count ?? s.messageCount ?? 0),
  createdAt: (s.created_at ?? s.createdAt ?? ''),
  updatedAt: (s.updated_at ?? s.updatedAt ?? ''),
}))
```

### 7.6 核心接口清单汇总

#### 7.6.1 当前版本已实现（核心业务相关）

| 方法 | 路径 | 说明 | 所属模块 |
|------|------|------|----------|
| POST | `/chat/completions` | Agent 对话补全（SSE 流式） | [chat.py](../../python-backend/app/api/v1/chat.py) |
| POST | `/chat/completions/stop` | 停止生成（空壳，待实现） | [chat.py](../../python-backend/app/api/v1/chat.py) |
| GET | `/chat/sessions` | 获取会话列表 | [chat.py](../../python-backend/app/api/v1/chat.py) |
| POST | `/chat/sessions` | 创建新会话 | [chat.py](../../python-backend/app/api/v1/chat.py) |
| GET | `/chat/sessions/{id}` | 获取单个会话 | [chat.py](../../python-backend/app/api/v1/chat.py) |
| PUT | `/chat/sessions/{id}` | 更新会话（标题/模型/参数） | [chat.py](../../python-backend/app/api/v1/chat.py) |
| DELETE | `/chat/sessions/{id}` | 删除/归档会话 | [chat.py](../../python-backend/app/api/v1/chat.py) |
| GET | `/chat/sessions/{id}/messages` | 获取会话消息列表 | [chat.py](../../python-backend/app/api/v1/chat.py) |
| PUT | `/chat/sessions/{id}/messages/{mid}` | 编辑消息内容 | [chat.py](../../python-backend/app/api/v1/chat.py) |
| POST | `/chat/messages/{mid}/feedback` | 消息反馈（like/dislike） | [chat.py](../../python-backend/app/api/v1/chat.py) |
| POST | `/chat/messages/{mid}/regenerate` | 重新生成回复 | [chat.py](../../python-backend/app/api/v1/chat.py) |

#### 7.6.2 待新增字段的核心接口改造

| 接口 | 改造点 | 优先级 |
|------|--------|--------|
| `GET /chat/sessions/{id}/messages` | MessageResponse 增加 thinking_content/answer_content/tool_calls_data/agent_steps | P0 |
| `POST /chat/completions` | 流结束后将 __metadata__ 结构化字段写入 ChatMessage | P0 |
| `POST /chat/completions` | agent_bridge.py 收集完整 agent_steps 步骤历史 | P1 |
| `POST /chat/completions` | 流结束后批量写入 AgentTrace 表 | P1 |

### 7.7 ModuAgent 内部推理流程详解

以下是 [Coordinator.stream_request](../../python-backend/ModuAgent/orchestration/coordinator.py#L370-L656) 的完整推理管线：

```
输入: {input_type: "text", prompt: "用户消息"}

Phase 1 — Perception（感知）
├─ 组件: TextPreprocessor
├─ 功能: 预处理文本，敏感度检测
├─ SSE输出: encode_status("perception", trace_id)
└─ 结果: cleaned_text（清洗后文本）

Phase 2 — Memory（记忆）
├─ 组件: InMemoryShortTermMemory / StorageAdapter.query_all()
├─ 功能: 加载历史对话 + 知识检索
├─ SSE输出: encode_status("memory", trace_id)
└─ 结果: context.history[], context.knowledge[]

Phase 3 — Thinking（思考）
├─ 组件: BaseLLMReasoner.generate(prompt, context)
├─ 功能: LLM 生成初始推理响应
├─ SSE输出: encode_thinking(response, trace_id)
│   由 agent_bridge 转换为 thinking_delta + thinking_done
└─ 结果: response（可能包含工具调用指令）

Phase 4 — Tool Calling（工具调用）ReAct 循环
├─ 最大迭代: llm.max_reasoning_iterations（默认3）
├─ 每轮迭代:
│   ├─ encode_reasoning_iteration(iteration_num, max)
│   ├─ _parse_tool_calls_with_errors(response) → tool_calls[]
│   │   └─ 解析正则: ```tool_call\n{"tool":"xxx","parameters":{...}}\n```
│   ├─ 对每个 tool_call:
│   │   ├─ encode_tool_call_start(tool_id, name, args)
│   │   ├─ tool_adapter.invoke_tool(name, params) → 执行工具
│   │   ├─ encode_tool_call_end(tool_id)
│   │   └─ encode_tool_result(tool_id, name, result, status)
│   ├─ 构建 observation（工具结果摘要）
│   └─ LLM generate(continuation_prompt) → 继续推理或给出最终答案
└─ 退出条件: 无工具调用 / 无解析错误 / 达到最大迭代次数

Phase 5 — Final Answer（最终回答）
├─ 组件: BaseLLMReasoner.stream(prompt, context)
├─ 功能: 逐 token 流式输出最终答案
├─ SSE输出: encode_token(token) × N → encode_done()
│   由 agent_bridge 转换为 answer_delta × N + answer_done
└─ 结果: full_response（完整回答文本）
```

### 7.8 agent_bridge.py 的 Frame → Frontend Event 映射

[agent_bridge.py](../../python-backend/app/core/agent_bridge.py) 是整个"黑盒→白盒"转化的关键桥接层。Coordinator 输出的原始 frame 格式：

```python
# Coordinator 输出的 frame（"黑盒"格式）
{
  "event": "thinking",          # SSEEncoder 编码的 event 名
  "data": '{"content": "...", "trace_id": "..."}'   # JSON 字符串
}
```

`_coordinator_frame_to_frontend_event` 将其转换为前端可消费的 event：

```python
# 前端消费的 event（"白盒"格式）
{"type": "thinking_delta", "stepId": "...", "content": "..."}
```

完整映射表：

| Coordinator frame.event | frame.data 内容 | 前端 event.type | 额外字段 |
|------------------------|-----------------|-----------------|----------|
| `status` | phase="perception"\|"memory" | 不发送（返回 None） | - |
| `status` | phase 为其他值 | `status` | status=phase |
| `thinking` | {content} | `thinking_delta` + `thinking_done` | stepId, content |
| `reasoning_iteration` | {index, max} | `reasoning_iteration` | iterationIndex, maxIterations |
| `tool_call_start` | {id, name, arguments} | `tool_call_start` | id, name, arguments |
| `tool_call_end` | {id, name, arguments} | `tool_call_end` | id, name, arguments |
| `tool_result` | {id, name, result, status} | `tool_result_end` | id, name, result, status |
| `token` | {token} | `answer_delta` | stepId, content |
| `error` | {error_code, message} | `error` | errorCode, message |
| `done` | {trace_id, tool_results} | `answer_done` | stepId |

`agent_bridge.py` 同时还负责收集汇总数据，在流结束后通过 `__metadata__` 事件一次性推送：

```python
# agent_bridge.py L224-L234
metadata = {
    "thinkingContent": thinking_content,   # 累加所有 thinking_delta 内容
    "answerContent": answer_content,       # 累加所有 answer_delta 内容
    "toolCalls": tool_calls,               # 汇总所有工具调用
    "toolResults": tool_results_data,      # 汇总所有工具结果
    "hasError": has_error,
    "errorInfo": error_info,
}
yield f"data: {json.dumps({'type': '__metadata__', 'payload': metadata})}\n\n"
```

### 7.9 当前"黑盒"问题与"白盒"改造路径

#### 问题现状

```
┌─────────────────────────────────────────────────────────────────┐
│  一次对话的当前数据流                                              │
│                                                                   │
│  前端 ← SSE流 ← agent_bridge ← Coordinator                       │
│   ✅ 实时渲染白盒轨迹（ThinkingStep/ToolCallStep/...）             │
│                                                                   │
│  前端 ← GET /messages ← DB                                       │
│   ❌ 历史加载仅获得 content 纯文本                                 │
│   ❌ thinkingContent / answerContent / toolCalls 全为 null         │
│   ❌ loadSession 重建逻辑有代码但无数据                            │
└─────────────────────────────────────────────────────────────────┘
```

#### 改造路径

| 步骤 | 改造内容 | 涉及文件 | 实现方式 |
|------|---------|----------|---------|
| 1 | ChatMessage 新增 4 个字段 | [user.py](../../python-backend/app/models/user.py) | 添加 Column 定义 + 数据库迁移 |
| 2 | agent_bridge 收集 agent_steps | [agent_bridge.py](../../python-backend/app/core/agent_bridge.py) | 在流处理循环中累加步骤数据 |
| 3 | chat.py 持久化结构化字段 | [chat.py](../../python-backend/app/api/v1/chat.py) | SSE 流结束后从 __metadata__ 解析写入 |
| 4 | MessageResponse 增加字段 | [chat.py](../../python-backend/app/schemas/chat.py) | 添加 thinking_content 等字段 |
| 5 | AgentTrace 表 + 批量写入 | [user.py](../../python-backend/app/models/user.py) | 新增模型 + chat.py 批量插入 |
| 6 | 验证前端 loadSession 重建 | 无需改动 | 字段到位后自动生效 |

**改造完成后的数据流：**

```
┌─────────────────────────────────────────────────────────────────┐
│  改造后的一次对话数据流                                            │
│                                                                   │
│  实时流（不变）：                                                  │
│  前端 ← SSE流 ← agent_bridge ← Coordinator                       │
│   ✅ 实时渲染白盒轨迹                                             │
│                                                                   │
│  历史加载（改造后）：                                              │
│  前端 ← GET /messages ← DB                                       │
│   ✅ thinking_content → ThinkingStep                             │
│   ✅ answer_content → TextStreamStep                             │
│   ✅ tool_calls_data → ToolCallStep + ToolResultStep             │
│   ✅ agent_steps → 完整 AgentStep[]                              │
│   ✅ 历史对话也可展示完整白盒轨迹                                  │
│                                                                   │
│  审计追溯（改造后）：                                              │
│  后端 ← AgentTrace 表 ← 每次推理自动写入                          │
│   ✅ 按 trace_id 追溯单次推理全链路                                │
│   ✅ 支持失败分析、性能诊断                                        │
└─────────────────────────────────────────────────────────────────┘
```

### 7.10 关键源码索引

| 层级 | 文件 | 核心内容 | 行号 |
|------|------|---------|------|
| 推理引擎 | [coordinator.py](../../python-backend/ModuAgent/orchestration/coordinator.py) | `stream_request()` — 5阶段推理管线 | L370-L656 |
| SSE编码 | [streaming.py](../../python-backend/ModuAgent/orchestration/communication/streaming.py) | `SSEEncoder` — frame编码器 | L14-L99 |
| 桥接层 | [agent_bridge.py](../../python-backend/app/core/agent_bridge.py) | `stream_chat_completion()` + frame转换 | L30-L234 |
| HTTP API | [chat.py](../../python-backend/app/api/v1/chat.py) | `chat_completion()` — SSE入口 | L290-L370 |
| HTTP API | [chat.py](../../python-backend/app/api/v1/chat.py) | `get_messages()` — 历史消息查询 | L216-L245 |
| 数据模型 | [user.py](../../python-backend/app/models/user.py) | `ChatMessage` / `ChatSession` | L86-L120 |
| Schema | [chat.py](../../python-backend/app/schemas/chat.py) | `MessageResponse` / `ChatCompletionRequest` | L1-L95 |
| 前端Hook | [useAgentChat.ts](../../frontend/pages/agent/hooks/useAgentChat.ts) | `handleSend()` — SSE读取+发送 | L475-L530 |
| 前端Hook | [useAgentChat.ts](../../frontend/pages/agent/hooks/useAgentChat.ts) | `applyStreamEvent()` — 步骤状态机 | L203-L470 |
| 前端Hook | [useAgentChat.ts](../../frontend/pages/agent/hooks/useAgentChat.ts) | `loadSession()` — 历史重建 | L95-L180 |
| 前端类型 | [types.ts](../../frontend/pages/agent/types.ts) | `AgentStep` / `StreamEvent` 类型定义 | L1-L175 |
| 前端渲染 | [StepRenderer.tsx](../../frontend/pages/agent/components/StepRenderer.tsx) | 步骤可视化渲染组件 | L1-L200 |
| 共享端点 | [endpoints.ts](../../shared/api/endpoints.ts) | API 端点常量定义 | L1-L61 |

---

## 八、前端 UI 复用 + 后端接口分离方案

> 基于 `docs/Interface Document/Agent (ReAct 模式) API.yaml` 接口文档与当前代码的深度差异分析
> 日期：2026-06-10

### 8.1 方案核心思想

**前端聊天窗口组件复用，后端接口独立分离**。发送消息时根据用户选择的模式（普通模式 vs 专业模式/Agent）动态切换请求地址，前端 SSE 解析器与消息渲染组件完全复用。

```
const apiUrl = mode === 'agent'
  ? '/v1/agent/completions'
  : '/v1/chat/completions';
```

### 8.2 当前代码复用能力分析

#### 8.2.1 可直接复用的前端模块

| 模块 | 文件 | 复用理由 |
|------|------|----------|
| `ChatSidebar.tsx` | `frontend/pages/agent/components/ChatSidebar.tsx` | 会话列表不区分模式，只需按 `agentMode` 过滤/标记 |
| `ChatInput.tsx` | `frontend/pages/agent/components/ChatInput.tsx` | 输入框在两种模式下完全一致 |
| `WelcomePage.tsx` | `frontend/pages/agent/components/WelcomePage.tsx` | 欢迎页无需区分模式 |
| `ChatMessage.tsx` | `frontend/pages/agent/components/ChatMessage.tsx` | 已支持根据 `steps` 数组动态渲染（有 steps 渲染复杂步骤，纯 text 渲染文本） |
| `useSmartScroll.ts` | `frontend/pages/agent/hooks/useSmartScroll.ts` | 滚动逻辑通用 |
| `useResizablePanel.ts` | `frontend/pages/agent/hooks/useResizablePanel.ts` | 面板拖拽通用 |
| `useSessionManager.ts` | `frontend/pages/agent/hooks/useSessionManager.ts` | 会话 CRUD 通用，只需 session 创建时区分 `agentMode` |

#### 8.2.2 `ChatMessage.tsx` 的天然适配能力

当前组件渲染逻辑（[ChatMessage.tsx L63-L80](file:///d:/Administrator/Desktop/pioneering/frontend/pages/agent/components/ChatMessage.tsx#L63-L80)）：

```typescript
// 从 steps 中提取 text_stream 类型的步骤
const textStreamSteps = message.steps.filter(s => s.type === TEXT_STREAM)
const throttledContent = textStreamSteps.map(s => s.content).join('')
```

- **普通模式**：后端只发 `answer_delta` → `useStreamParser` 只创建 `TEXT_STREAM` step → 组件只渲染纯文本 Markdown
- **Agent 模式**：后端发 `thinking_delta` + `tool_call_start` + `answer_delta` 等 → `useStreamParser` 创建混合 steps → 组件渲染完整执行轨迹

`useStreamParser` 已包含所有事件类型的处理函数，两种模式共享同一份解析器实例，**无需改动**。

### 8.3 代码实现差异总览

| 维度 | 接口文档要求 (`/agent/*`) | 当前实现 (`/chat/*`) | 差异等级 |
|------|--------------------------|----------------------|----------|
| 会话创建入参 | agentMode, tools, systemPrompt | title, model, system_prompt | **P0** |
| 会话类型字段 | `chat_sessions.agent_mode` | 不存在 | **P0** |
| SSE 事件 | thinking → tool_call → tool_result → text → done | 细粒度~12种事件（已覆盖） | **P1** |
| 流结束写入 | content_blocks + agent_tool_executions | 仅 content + content_blocks | **P0** |
| 工具执行明细表 | `agent_tool_executions` | 不存在 | **P0** |
| 可观测性字段 | prompt_tokens, completion_tokens, latency_ms | 不存在 | **P1** |
| 深度反馈 | rating (1-5) + feedbackText | 仅 like/dislike | **P2** |
| 执行结果懒加载 | `GET /agent/executions/{id}/result` | 不存在 | **P2** |

### 8.4 后端实施方案

#### 8.4.1 Phase 1：新建 `/agent/completions` 端点（P0）

**文件**: `python-backend/app/api/v1/agent.py`（新建）

与 `/chat/completions` 的差异：

| 维度 | `/chat/completions`（普通模式） | `/agent/completions`（Agent 模式） |
|------|-------------------------------|-----------------------------------|
| 入参 | `ChatCompletionRequest`（含 model, deep_think, net_search） | `AgentChatRequest`（sessionId, message, stream） |
| SSE 事件 | 纯 `answer_delta` + `answer_done` | 完整 ReAct 轨迹（thinking → tool_call → tool_result → answer_delta） |
| 流结束后 | 仅保存 assistant 消息 content | 保存 content + content_blocks + 写入 agent_tool_executions 表 |
| 可观测性 | 无 | 记录 prompt_tokens / completion_tokens / latency_ms |

核心伪代码：

```python
# app/api/v1/agent.py

@router.post("/completions")
async def agent_completion(
    dto: AgentChatRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = await get_session(db, dto.session_id)
    user_msg = ChatMessage(session_id=session.id, role="user", content=dto.message)
    db.add(user_msg)
    await db.commit()

    async def event_stream():
        tool_executions = []
        thinking_content, answer_content = "", ""
        prompt_tokens = completion_tokens = 0
        start_time = datetime.now(timezone.utc)

        # 1. 调用 ModuAgent stream_request()
        async for frame in coord.stream_request(...):
            event = _coordinator_frame_to_frontend_event(frame)
            yield f"data: {json.dumps(event)}\n\n"

            # 2. 收集工具执行数据
            if event["type"] == "tool_call_start":
                tool_executions.append({...})
            elif event["type"] == "tool_result_end":
                # 更新对应的 execution 记录
                pass

        # 3. 流结束后持久化
        latency = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
        assistant_msg = ChatMessage(
            session_id=session.id, role="assistant",
            content=answer_content or thinking_content,
            thinking_content=thinking_content,
            answer_content=answer_content,
            tool_calls_data=tool_executions,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=int(latency),
        )
        db.add(assistant_msg)
        # 批量写入 agent_tool_executions 表
        for exec in tool_executions:
            db.add(AgentToolExecution(**exec))
        await db.commit()

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

#### 8.4.2 Phase 1：普通模式 `/chat/completions` 简化（P0）

当前 `/chat/completions` 实际走了 ModuAgent 的 ReAct 循环（通过 `stream_chat_completion`）。普通模式下应跳过 ReAct 循环，直接调用 LLM 流式输出。

**文件**: `python-backend/app/core/agent_bridge.py`

新增 `stream_normal_chat()`：

```python
async def stream_normal_chat(message, history, model_config, ...):
    """普通对话模式：纯 LLM 流式输出，无 ReAct 循环"""
    llm = get_llm_adapter()
    async for token in llm.stream(prompt=message, context=history):
        yield {"data": json.dumps({"type": "answer_delta", "content": token})}
    yield {"data": json.dumps({"type": "answer_done"})}
```

#### 8.4.3 Phase 1：数据模型新增字段（P0）

**文件**: `python-backend/app/models/user.py`

```python
# ChatSession 新增
agent_mode = Column("agent_mode", String(50), nullable=True)
# NULL = 普通对话, "react_agent" = Agent 专业模式

# ChatMessage 新增
prompt_tokens = Column("prompt_tokens", Integer, nullable=True)
completion_tokens = Column("completion_tokens", Integer, nullable=True)
latency_ms = Column("latency_ms", Integer, nullable=True)
user_rating = Column("user_rating", SmallInteger, nullable=True)    # 1-5
user_feedback = Column("user_feedback", Text, nullable=True)

# 新增 AgentToolExecution 模型
class AgentToolExecution(Base):
    __tablename__ = "agent_tool_executions"
    id = Column(String(64), primary_key=True)
    session_id = Column(String(64), ForeignKey("chat_sessions.id"), nullable=False, index=True)
    message_id = Column(String(64), ForeignKey("chat_messages.id"), nullable=False, index=True)
    tool_name = Column(String(100), nullable=False)
    execution_order = Column(Integer, default=0)
    input_arguments = Column(JSON, nullable=True)
    output_summary = Column(Text, nullable=True)    # 前端展示用
    output_result = Column(JSON, nullable=True)     # 原始大 Payload，懒加载
    status = Column(String(20), default="pending")
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
```

#### 8.4.4 Phase 2：新建 Agent 会话管理端点（P1）

```python
# app/api/v1/agent.py 中新增

@router.post("/sessions")
async def create_agent_session(dto: CreateAgentSessionRequest, ...):
    """创建 Agent 会话，支持 agentMode, tools, systemPrompt"""
    session = ChatSession(
        title=dto.title or "新对话",
        agent_mode="react_agent",
        system_prompt=dto.systemPrompt,
        model_config={...},
        user_id=current_user.id,
    )
    db.add(session)
    await db.commit()
    return SessionResponse.model_validate(session)

@router.get("/sessions/{session_id}")
async def get_agent_session(session_id: str, ...):
    """获取 Agent 会话详情（含 agentMode, modelConfig, systemPrompt）"""
    ...

@router.get("/messages/{message_id}/executions")
async def get_message_executions(message_id: str, ...):
    """查询某条消息的工具执行明细列表"""
    ...

@router.get("/executions/{execution_id}/result")
async def get_execution_result(execution_id: str, ...):
    """懒加载原始大 Payload（output_result 字段）"""
    ...

@router.post("/messages/{message_id}/feedback")
async def submit_agent_feedback(message_id: str, dto: AgentFeedbackRequest, ...):
    """深度反馈：评分(1-5) + 文本纠错"""
    ...
```

#### 8.4.5 Phase 3：深度反馈 + 执行懒加载（P2）

深度反馈端点：

```python
class AgentFeedbackRequest(BaseModel):
    rating: int = Field(..., ge=1, le=5)        # 1-5 星评分
    feedback_text: str | None = None            # 可选的文本纠错

@router.post("/messages/{message_id}/feedback")
async def submit_agent_feedback(...):
    msg = await db.get(ChatMessage, message_id)
    msg.user_rating = dto.rating
    msg.user_feedback = dto.feedback_text
    await db.commit()
    return {"status": "ok"}
```

### 8.5 前端实施方案

#### 8.5.1 Phase 1：mode 状态 + 动态路由（P0）

**文件**: `frontend/pages/agent/hooks/useAgentChat.ts`

```typescript
// 新增 mode 状态
const [chatMode, setChatMode] = useState<'chat' | 'agent'>('chat')

// handleSend 中动态选择 endpoint 和 body
const endpoint = chatMode === 'agent'
  ? API_ENDPOINTS.AGENT.COMPLETIONS
  : API_ENDPOINTS.CHAT.COMPLETIONS

const body = chatMode === 'agent'
  ? { sessionId, message, stream: true }
  : { sessionId, message, model, stream: true, deepThinking, webSearch }
```

SSE 解析层 (`useStreamParser`) **完全不需要改动** — 它已按 `event.type` switch 处理，普通模式只收到 `answer_delta` / `answer_done` 事件，自动就是纯文本渲染。

#### 8.5.2 Phase 1：新增 AGENT 路由常量（P0）

**文件**: `shared/api/endpoints.ts`

```typescript
AGENT: {
  SESSIONS: '/agent/sessions',
  SESSION_BY_ID: (id: string) => `/agent/sessions/${id}`,
  COMPLETIONS: '/agent/completions',
  MESSAGES: (sessionId: string) => `/agent/sessions/${sessionId}/messages`,
  EXECUTIONS: (messageId: string) => `/agent/messages/${messageId}/executions`,
  EXECUTION_RESULT: (executionId: string) => `/agent/executions/${executionId}/result`,
  FEEDBACK: (messageId: string) => `/agent/messages/${messageId}/feedback`,
},
```

**文件**: `frontend/pages/agent/api/agentApi.ts`

```typescript
// 新增 API 函数
export const createAgentRequest = (data: AgentChatRequest) => {...}
export const fetchToolExecutions = (messageId: string) => {...}
export const fetchExecutionResult = (executionId: string) => {...}
export const submitAgentFeedback = (messageId: string, rating: number, text?: string) => {...}
```

#### 8.5.3 Phase 1：会话创建时传入 agentMode（P0）

**文件**: `frontend/pages/agent/hooks/useSessionManager.ts`

```typescript
const createNewSession = async (mode: 'chat' | 'agent') => {
  const endpoint = mode === 'agent'
    ? API_ENDPOINTS.AGENT.SESSIONS
    : API_ENDPOINTS.CHAT.SESSIONS
  const body = mode === 'agent'
    ? { title: '新对话', agentMode: 'react_agent', tools: [...], systemPrompt: '...' }
    : { title: '新对话' }
  ...
}
```

#### 8.5.4 Phase 2：mode 切换 UI（P1）

**位置**: `ChatInput.tsx` 或 `ChatHeader.tsx` 中新增 Toggle/Segment 控件

```
[ 普通模式 ] [ Agent 模式 ]
```

- 切换时清除当前消息（或提示用户新建会话）
- Agent 模式下隐藏 `deepThinking` / `webSearch` 开关
- Agent 模式下右侧 `AgentStepsPanel` 展示，普通模式下自动折叠

#### 8.5.5 Phase 2：消息历史加载适配（P1）

**文件**: `frontend/pages/agent/api/agentApi.ts` 的 `fetchSessionMessages`

Agent 模式下后端返回 `content_blocks`（`AgentContentBlock[]`），前端直接映射到 `steps`。需要区分两种数据来源：

```typescript
// 普通模式：当前逻辑（只有 text content）
// Agent 模式：从 content_blocks 解析构建 steps
if (mode === 'agent' && msg.content_blocks) {
  steps = msg.content_blocks.map(block => convertBlockToStep(block))
}
```

#### 8.5.6 Phase 3：深度反馈 UI（P2）

**文件**: `frontend/pages/agent/components/ChatMessage.tsx`

在 feedback action 中增加五星评分 + 文本纠错输入框，调用 `POST /agent/messages/{mid}/feedback`：

```tsx
// 新增反馈弹窗
<Rate onChange={(value) => setRating(value)} />
<TextArea placeholder="如果有误，请纠正..." />
<Button onClick={submitFeedback}>提交反馈</Button>
```

#### 8.5.7 Phase 3：工具执行详情面板（P2）

**文件**: `frontend/pages/agent/components/ExecutionCard.tsx`

点击 `ExecutionCard` 时调用 `GET /agent/executions/{id}/result` 获取原始大文本，在弹窗或侧边栏中展示。

### 8.6 SSE 事件兼容性保证

前端 `useStreamParser` 按 `event.type` 分发，天然兼容两种模式：

| 前端 event.type | 普通模式 | Agent 模式 | 渲染结果 |
|----------------|----------|------------|----------|
| `answer_delta` | ✅ 有 | ✅ 有 | `TEXT_STREAM` step → Markdown 渲染 |
| `answer_done` | ✅ 有 | ✅ 有 | 标记完成 |
| `thinking_delta` | ❌ 无 | ✅ 有 | `ThinkingStep` → 思考中折叠面板 |
| `tool_call_start` | ❌ 无 | ✅ 有 | `ToolCallStep` → 工具调用卡片 |
| `tool_result_end` | ❌ 无 | ✅ 有 | `ToolResultStep` → 工具结果卡片 |
| `reasoning_iteration` | ❌ 无 | ✅ 有 | 迭代序号标记 |

**核心结论**：`useStreamParser` 和 `ChatMessage` **均无需改动**，它们天然兼容两种模式。只需在 `useAgentChat` 中根据 mode 切换请求地址即可。

### 8.7 兼容性保证

1. **`agent_mode = NULL` 表示普通对话**，向下兼容现有 `/chat/*` 路由
2. **`agent_tool_executions.output_result`** 独立懒加载，不在消息列表接口中返回
3. **会话列表通用**：`agentMode` 字段为 `NULL` 时为普通会话，为 `react_agent` 时为 Agent 会话，列表渲染时可按 mode 过滤
4. **后端不破坏现有 `/chat/*` 路由**，新建独立的 `/agent/*` 路由模块并行运行

### 8.8 实施优先级总览

| 阶段 | 主要内容 | 改动文件数 | 工作量 |
|------|---------|-----------|--------|
| **Phase 1 (P0)** | 后: ChatMessage 模型新增字段 + AgentToolExecution 表 + `/agent/completions` 端点 + 简化普通模式<br>前: mode 状态 + 动态路由 + 路由常量 + 会话创建传参 | ~6 个文件 | ~350 行 |
| **Phase 2 (P1)** | 后: Agent 会话管理端点 (sessions CRUD)<br>前: mode 切换 UI + 消息历史适配 | ~5 个文件 | ~250 行 |
| **Phase 3 (P2)** | 后: 工具执行明细/结果懒加载/深度反馈端点<br>前: 深度反馈 UI + 执行详情面板 | ~5 个文件 | ~300 行 |

#### Phase 1 详细任务分解

| 序号 | 任务 | 文件 | 预估行数 |
|------|------|------|---------|
| 1.1 | ChatSession 新增 `agent_mode` 字段 | `python-backend/app/models/user.py` | ~5 |
| 1.2 | ChatMessage 新增可观测性 + 反馈字段 | `python-backend/app/models/user.py` | ~10 |
| 1.3 | 新建 AgentToolExecution 模型 | `python-backend/app/models/user.py` | ~30 |
| 1.4 | 新建 `/agent` 路由模块 + `/agent/completions` | `python-backend/app/api/v1/agent.py` (新建) | ~120 |
| 1.5 | 简化 `/chat/completions` 为纯 LLM 模式 | `python-backend/app/core/agent_bridge.py` | ~40 |
| 1.6 | 注册 `/agent` 路由 | `python-backend/app/api/v1/__init__.py` | ~5 |
| 1.7 | 新增 AGENT 路由常量 | `shared/api/endpoints.ts` | ~15 |
| 1.8 | useAgentChat 新增 mode 状态 + 动态路由 | `frontend/pages/agent/hooks/useAgentChat.ts` | ~40 |
| 1.9 | agentApi.ts 新增 agent 专属 API 函数 | `frontend/pages/agent/api/agentApi.ts` | ~40 |
| 1.10 | useSessionManager 会话创建传参 | `frontend/pages/agent/hooks/useSessionManager.ts` | ~20 |

#### Phase 2 详细任务分解

| 序号 | 任务 | 文件 | 预估行数 |
|------|------|------|---------|
| 2.1 | Agent 会话 CRUD 端点 | `python-backend/app/api/v1/agent.py` | ~80 |
| 2.2 | Agent 相关 Schema 定义 | `python-backend/app/schemas/chat.py` | ~40 |
| 2.3 | mode 切换 UI (Toggle/Segment) | `frontend/pages/agent/components/ChatInput.tsx` | ~50 |
| 2.4 | 消息历史加载适配 | `frontend/pages/agent/api/agentApi.ts` | ~30 |
| 2.5 | AgentMode 类型定义 | `frontend/pages/agent/types/session.ts` | ~10 |

#### Phase 3 详细任务分解

| 序号 | 任务 | 文件 | 预估行数 |
|------|------|------|---------|
| 3.1 | 工具执行明细/结果懒加载/反馈端点 | `python-backend/app/api/v1/agent.py` | ~80 |
| 3.2 | AgentFeedbackRequest Schema | `python-backend/app/schemas/chat.py` | ~10 |
| 3.3 | 深度反馈 UI | `frontend/pages/agent/components/ChatMessage.tsx` | ~60 |
| 3.4 | 执行详情面板 | `frontend/pages/agent/components/ExecutionCard.tsx` | ~50 |
| 3.5 | 新增前端类型定义 | `frontend/pages/agent/types/` | ~30 |

### 8.9 关键风险与注意事项

1. **数据库迁移风险**：ChatMessage 表已有生产数据，新增字段需用 `ALTER TABLE ADD COLUMN ... DEFAULT NULL`，不可用 NOT NULL
2. **SSE 事件格式一致性**：确保 `/agent/completions` 发出的 SSE 事件 key 与前端 `useStreamParser` 中定义的事件类型完全匹配
3. **工具执行结果大小**：`output_result` 可能极大（如网页源码），需在前端 `ExecutionCard` 中展示 `output_summary`，点击后才请求原始 `output_result`
4. **普通模式与 Agent 模式的切换时机**：建议切换 mode 时自动新建会话，避免同一会话中混合两种模式的请求