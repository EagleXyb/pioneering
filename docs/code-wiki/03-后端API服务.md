# 后端 API 服务

后端 FastAPI 应用位于 [apps/backend/app](file:///d:/Administrator/Desktop/pioneering/apps/backend/app)。

## 目录结构

```
app/
├── api/
│   └── v1/               # API v1 路由
│       ├── agent.py      # Agent 流式对话接口
│       ├── auth.py       # 认证接口
│       ├── chat.py       # 基础聊天接口
│       ├── system.py     # 系统接口
│       ├── upload.py     # 文件上传接口
│       └── user.py       # 用户接口
├── core/
│   ├── agent_bridge.py   # ModuAgent 桥接层
│   ├── llm.py            # LLM 服务
│   └── security.py       # 安全工具
├── models/
│   └── user.py           # 用户模型
├── schemas/
│   ├── agent.py          # Agent 相关 Pydantic 模式
│   ├── chat.py           # 聊天相关模式
│   └── user.py           # 用户相关模式
├── config.py             # 应用配置
├── database.py           # 数据库连接
└── main.py               # FastAPI 入口
```

## 应用入口 (main.py)

[main.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/main.py) 是 FastAPI 应用入口。

### 关键特性

1. **生命周期管理**：`lifespan` 上下文管理器初始化数据库连接
2. **CORS 中间件**：配置允许的跨域来源
3. **响应拦截器**：统一包装所有非SSE响应为 `{code, data, message}` 格式
4. **日志配置**：按日轮转日志，保留30天，存储于 `logs/backend/agent.log`
5. **静态文件**：`/uploads` 挂载上传目录

### 响应包装格式

```json
{
  "code": 200,
  "data": { ... },
  "message": "success"
}
```

错误响应：
```json
{
  "code": 400,
  "message": "错误描述",
  "details": "...",
  "requestId": "uuid"
}
```

跳过包装的路径：
- `/docs`, `/redoc`, `/openapi.json`（FastAPI文档）
- SSE流式响应（`text/event-stream`）
- 204无内容响应

## 配置 (config.py)

[Settings](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/config.py#L4-L24) 使用 Pydantic Settings 管理配置，支持 `.env` 文件和环境变量。

| 配置项 | 环境变量 | 默认值 | 说明 |
|--------|----------|--------|------|
| `database_url` | DATABASE_URL | `postgresql+asyncpg://postgres:root@localhost:5432/pioneering` | PostgreSQL连接串 |
| `jwt_secret` | JWT_SECRET | `default-secret-change-in-production` | JWT密钥 |
| `jwt_expiration_hours` | JWT_EXPIRATION_HOURS | `2` | Access Token过期时间（小时） |
| `refresh_token_expiration_days` | REFRESH_TOKEN_EXPIRATION_DAYS | `30` | Refresh Token过期时间（天） |
| `llm_api_key` | LLM_API_KEY | `""` | LLM API Key |
| `llm_base_url` | LLM_BASE_URL | `https://api.deepseek.com/v1` | LLM API地址 |
| `llm_default_model` | LLM_DEFAULT_MODEL | `deepseek-v4-flash` | 默认模型 |
| `host` | HOST | `0.0.0.0` | 监听地址 |
| `port` | PORT | `9000` | 监听端口 |
| `cors_origins` | CORS_ORIGINS | `http://localhost:5173,http://localhost:3000` | CORS允许来源 |
| `upload_dir` | UPLOAD_DIR | `./uploads` | 上传目录 |
| `max_upload_size` | MAX_UPLOAD_SIZE | `10485760` (10MB) | 最大上传大小 |

## Agent Bridge (core/agent_bridge.py)

[agent_bridge.py](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/agent_bridge.py) 是 API 层与 ModuAgent 核心的桥梁。

### StreamContext

[StreamContext](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/agent_bridge.py#L24-L39) 用于在流式传输过程中收集元数据：

| 字段 | 类型 | 说明 |
|------|------|------|
| `answer_content` | `str` | 完整响应文本 |
| `content_blocks` | `List[Dict]` | 内容块（thinking/tool_call/text_stream） |
| `tool_executions` | `List[Dict]` | 工具执行记录 |
| `prompt_tokens` | `int` | 输入token数 |
| `completion_tokens` | `int` | 输出token数 |
| `latency_ms` | `int` | 请求耗时（毫秒） |
| `has_error` | `bool` | 是否出错 |
| `error_info` | `Dict` | 错误信息 |

### 核心函数

#### `stream_agent_completion()`

```python
async def stream_agent_completion(
    message: str,
    session_id: str,
    user_id: str,
    ctx: StreamContext,
    model: Optional[str] = None,
    system_prompt: Optional[str] = None,
    history: Optional[List[Dict[str, str]]] = None,
) -> AsyncGenerator[Dict[str, str], None]:
```

Agent ReAct 流式对话，输出 AG-UI 标准 SSE 事件：

1. 初始化 ModuAgent 组件（首次调用时注册）
2. 创建 LangGraph 实例（支持模型覆盖）
3. 通过 AGUIStreamAdapter 转换事件格式
4. 收集元数据到 StreamContext

### 组件初始化

[_init_moduagent()](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/agent_bridge.py#L45-L82) 注册默认组件：

```python
# 推理引擎
BaseLLMReasoner(api_key, base_url, default_model)

# 感知器
TextPreprocessor()

# 记忆
InMemoryShortTermMemory()
ChromaLongTermMemory()

# 工具
CalculatorTool()
SearchTool()

# 执行器
SyncActionExecutor()
```

## API 路由

### 认证接口 (`/api/v1/auth`)

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/login` | 用户登录 |
| POST | `/auth/register` | 用户注册 |
| POST | `/auth/refresh` | 刷新Token |

### Agent 接口 (`/api/v1/agent`)

核心流式对话接口，使用 AG-UI 协议通过 SSE 推送事件。

**主要事件类型：**

| 事件 | 说明 |
|------|------|
| `THINKING_START` / `THINKING_END` | 思考过程开始/结束 |
| `THINKING_TEXT_MESSAGE_CONTENT` | 思考内容增量 |
| `TEXT_MESSAGE_CONTENT` | 响应文本增量 |
| `TEXT_MESSAGE_END` | 响应结束 |
| `TOOL_CALL_START` | 工具调用开始 |
| `TOOL_CALL_RESULT` | 工具调用结果 |
| `RUN_ERROR` | 运行错误 |

### 聊天接口 (`/api/v1/chat`)

基础聊天接口，提供简单的对话能力。

### 用户接口 (`/api/v1/user`)

用户信息管理接口。

### 系统接口 (`/api/v1/system`)

系统状态、配置查询接口。

### 上传接口 (`/api/v1/upload`)

文件上传接口，支持图片、文档等附件。

## API 文档

启动后端服务后，访问：
- Swagger UI: http://localhost:9000/docs
- ReDoc: http://localhost:9000/redoc
- OpenAPI JSON: http://localhost:9000/openapi.json

## 依赖关系

```
app/main.py
├── app.config.Settings
├── app.database.init_db
└── app.api.v1 (router)
    ├── auth.py → app.core.security, app.models.user, app.schemas.user
    ├── chat.py → app.core.llm, app.schemas.chat
    ├── agent.py → app.core.agent_bridge (ModuAgent)
    ├── user.py → app.models.user, app.schemas.user
    ├── system.py
    └── upload.py → app.config.settings
```

### ModuAgent 依赖链

```
app.core.agent_bridge
└── modu_graph.factory.create_agent
    ├── config.runtime_config.get_config
    ├── modu_graph.adapters.llm_adapter.build_chat_model
    ├── modu_graph.adapters.tool_adapter.build_langchain_tools
    ├── modu_graph.adapters.store_adapter
    ├── modu_graph.graph.build_modu_graph
    └── evolution.evolution_orchestrator.EvolutionOrchestrator
        ├── feedback.loop_controller.FeedbackLoop
        └── evolution.strategy.parameter_tune.ParameterTuneStrategy
```
