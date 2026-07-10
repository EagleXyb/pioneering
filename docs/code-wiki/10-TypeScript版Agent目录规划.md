# TypeScript 版 Agent 目录规划与迁移方案

> 本文档定义 Agent 以 TypeScript 重写并作为**共享包**在多个 app 间复用的目录归属、接入方式与迁移路线。
> 同时规划后端 API（`apps/backend/`）由 Python/FastAPI 迁移为 TypeScript/Fastify+Zod 的基础结构与多端适配方案。
> 关联文档：`02-ModuAgent核心框架.md`、`03-Skills能力实施方案.md`、`08-MCP能力扩展实施方案.md`。

---

## 1. 背景与决策

| 维度 | 决策 |
|------|------|
| 复用目标 | Agent 需被 `web` / `desktop` / `mobile` 等多个 app 复用；后端 API 需完整适配三端 |
| Agent 语言 | TypeScript（重写，非 Python 封装），放置于 `packages/modu-agent/` |
| 后端 API | TypeScript + Fastify + Zod，**保持原位置 `apps/backend/`** |
| 技术栈 | LangChain JS 全家桶（`@langchain/langgraph` + `@langchain/openai`），与原 Python `@langchain/langgraph` 行为对齐 |
| Python 命运 | 完全用 TS 替代；Python 版（`apps/backend/ModuAgent/`）标记 `@deprecated` 待删 |
| 迁移范围 | 完整迁移整个框架（core / components / modu_graph / mcp / skills / evolution 等） + 后端 API 业务层 |
| 多端共享 | 抽取 `packages/api-client/` 统一三端 API 客户端，消除当前 web/desktop 实现碎片化 |

---

## 2. 目录归属结论

**TS 版 Agent 放在 `packages/modu-agent/`**，作为可被多个 app 消费的 npm workspace 包。

对照三个候选位置：

| 位置 | 结论 | 原因 |
|------|------|------|
| `packages/modu-agent/` | ✅ **采用** | `packages/` 是 npm workspaces 的"共享库"预留位（根 `package.json` 已声明 `workspaces`），多 app 复用本就该在此 |
| `apps/agent/` | ❌ 不合适 | `apps/` 语义是"可独立部署的应用"，Agent SDK 是被消费的类库，放这里语义错位，且 app 间不好当依赖引用 |
| `pioneering/`（仓库根） | ❌ 不合适 | 根目录只放 monorepo 配置 / CI / 文档，不放业务代码 |

---

## 3. 接入方式（多 app 复用）

### 3.1 注册进根 workspaces

当前根 `package.json` 写死为 `["apps/web","apps/marketing"]`，需改为包含 `packages/`：

```json
{
  "name": "pioneering",
  "private": true,
  "workspaces": [
    "apps/web",
    "apps/marketing",
    "packages/*"
  ]
}
```

### 3.2 包名与产物

`packages/modu-agent/package.json` 建议：

```json
{
  "name": "@pioneering/modu-agent",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./core": "./dist/core/index.js",
    "./graph": "./dist/graph/index.js",
    "./mcp": "./dist/mcp/index.js",
    "./skills": "./dist/skills/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run"
  },
  "peerDependencies": {
    "@langchain/core": "*",
    "@langchain/langgraph": "*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

> 用 `@pioneering/` scope 避免与公网包名冲突；`workspace:*` 让本地 app 直接消费源码，无需发布。

### 3.3 各 app 引用

在 `apps/web/package.json`、`apps/desktop/package.json`、`apps/mobile/package.json` 中加入：

```json
{
  "dependencies": {
    "@pioneering/modu-agent": "workspace:*"
  }
}
```

消费方用法：

```ts
import { createAgent, ModuAgent } from "@pioneering/modu-agent";
```

---

## 4. 包内部结构（对齐 Python 版，便于迁移对照）

```
packages/modu-agent/
├── package.json              # 见 3.2
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── src/
│   ├── index.ts              # 统一导出入口
│   ├── core/                 # 抽象接口 + 组件注册中心（对应 Python core/）
│   │   ├── interfaces/       # action / skill / memory / perception / reasoning / feedback / evolution
│   │   └── registry.ts       # ComponentRegistry（单例）
│   ├── graph/                # 图编排（对应 Python modu_graph/）
│   │   ├── state.ts          # ModuAgentState（typed state）
│   │   ├── graph.ts          # buildModuGraph（StateGraph）
│   │   ├── nodes.ts          # agent / tools / perception 节点
│   │   ├── runner.ts         # runSync / streamResponse
│   │   └── factory.ts        # createAgent（配置化工厂）
│   ├── tools/                # 工具原语（对应 Python components/action/）
│   │   ├── base-tool.ts      # BaseTool 抽象（name/description/parametersSchema/invoke + HITL hooks）
│   │   └── calculator.ts     # 示例工具
│   ├── skills/               # Skill 子系统（对应 Python skills/）
│   │   ├── adapter.ts        # SkillAdapter + SkillToolWrapper（执行隔离）
│   │   ├── loader.ts         # SkillLoader（发现 / 加载隔离 / 幂等）
│   │   └── prompt-aggregator.ts
│   ├── mcp/                  # MCP 客户端（对应 Python mcp/，使用 @modelcontextprotocol/sdk）
│   │   ├── client.ts         # MCPClient 多连接管理
│   │   ├── discovery.ts      # ToolDiscovery + ToolInfo
│   │   ├── lifecycle.ts      # ServerLifecycleManager
│   │   ├── transport.ts      # StdioTransport / SSETransport
│   │   └── errors.ts         # 异常层级
│   ├── memory/               # 对应 components/memory/
│   ├── perception/           # 对应 components/perception/
│   ├── reasoning/            # 对应 components/reasoning/
│   ├── evolution/            # 对应 evolution/
│   ├── feedback/             # 对应 feedback/
│   ├── observability/        # 对应 observability/
│   ├── orchestration/        # 对应 orchestration/
│   └── config/               # 运行时配置（对应 config/runtime_config.py）
│       └── runtime-config.ts # 点分路径 get/set + deep merge + 变更回调
└── tests/
```

---

## 5. 过渡期共存

- 迁移期间 `apps/backend/ModuAgent/`（Python）与 `packages/modu-agent/`（TS）**并存**：
  - Python 版继续服务后端（API / 后端编排）。
  - TS 版供前端 app 直接 import，避免每个 app 各自调后端 Agent 接口、重复编写类型与编排逻辑。
- 待 TS 版能力对齐（接口 / 注册中心 / 图编排 / 工具 / Skills / MCP 全覆盖）后：
  1. 在 Python 模块顶部加 `@deprecated` 注释与运行时 `DeprecationWarning`。
  2. 由具体需求决定删除时机（建议保留至少一个发布周期）。

---

## 6. 迁移路线（分阶段，每阶段可独立验证）

| 阶段 | 内容 | 交付物 | 验证 |
|------|------|--------|------|
| P1 | 脚手架 + core | `packages/modu-agent` 脚手架、`core/interfaces/*`、`core/registry.ts` | vitest 单测 |
| P2 | 图编排 | `graph/{state,graph,nodes,runner,factory}.ts` | 最小图跑通 |
| P3 | 工具 + Skills | `tools/`、`skills/`（adapter/loader/prompt-aggregator） | 工具/技能单测 |
| P4 | MCP | `mcp/`（client/discovery/lifecycle/transport/errors） | MCP 单测 |
| P5 | 其余子系统 | `memory/perception/reasoning/evolution/feedback/observability/orchestration/config` | 子系统单测 |
| P6 | 接入 + 弃用 | 各 app 引入 `@pioneering/modu-agent`；Python 版标记 deprecated | 集成冒烟 |

> 每个阶段复用 Python 版同名文件作为对照基准，保证行为对齐；阶段间可独立回滚。

---

## 7. 关键约束

- **包必须 `type: module`**，统一 ESM。
- **peerDependencies** 暴露 `@langchain/core` / `@langchain/langgraph`，由各 app 提供具体版本，避免多副本冲突。
- **子路径 exports** 让 app 按需引入（如仅用 `mcp`），减小打包体积。
- 全程 **不修改 Python 版调用逻辑**：TS 版是平行新增，迁移完成后才处置 Python 版。

---

## 8. 当前 Python 后端架构深度分析（迁移基准）

> 本节作为迁移的对照基准，系统梳理 `apps/backend/` 现有架构，为 TS 迁移提供精确的"从何处迁、迁何处"依据。

### 8.1 整体架构：双层耦合结构

```
┌─────────────────────────────────────────────────────────────┐
│  apps/backend/                                               │
│                                                              │
│  ┌──────────────────────┐    agent_bridge.py    ┌─────────┐ │
│  │   app/ (FastAPI)     │ ─────────────────────▶│ ModuAgent│ │
│  │   ─ API 路由层        │   sys.path 注入        │ (框架)  │ │
│  │   ─ 业务 CRUD         │   单例注册             │         │ │
│  │   ─ 认证/会话持久化    │                       │ LangGraph│ │
│  │   ─ SSE 流式输出      │ ◀─────────────────────│ Agent 图│ │
│  └──────────────────────┘   AG-UI 事件流         └─────────┘ │
└─────────────────────────────────────────────────────────────┘
```

- **`app/`** — FastAPI 业务层：HTTP 路由、JWT 鉴权、PostgreSQL 持久化、文件上传、LLM 直连、SSE 流式输出
- **`ModuAgent/`** — Agent 框架层：基于 LangGraph 的可进化 Agent，含感知/推理/记忆/行动/反馈/进化/可观测性完整能力

### 8.2 模块划分与职责

#### A. FastAPI 业务层（`app/`）

| 模块 | 核心文件 | 职责 |
|------|---------|------|
| 入口 | [`app/main.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/main.py) | FastAPI 实例、CORS、统一响应包装中间件（`{code,data,message}`）、日志轮转、lifespan |
| 配置 | [`app/config.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/config.py) | `pydantic-settings` 环境变量配置（DB/JWT/LLM/CORS） |
| 数据库 | [`app/database.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/database.py) | SQLAlchemy async engine + `AsyncSession` 工厂 + `Base` 声明式基类 |
| 认证 | [`app/core/security.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/security.py)、[`app/api/deps.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/api/deps.py) | bcrypt 密码哈希、HS256 JWT 签发/校验、`HTTPBearer` 依赖注入 |
| Agent 桥接 | [`app/core/agent_bridge.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/agent_bridge.py) | 初始化 ModuAgent 组件到 Registry，调用 LangGraph 流式接口，收集 `StreamContext` 元数据 |
| LLM 直连 | [`app/core/llm.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/llm.py) | `LlmService`：httpx 直连 OpenAI 兼容 `/chat/completions`，产出 AG-UI SSE 事件 |
| 数据模型 | [`app/models/user.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/models/user.py) | 9 张表：User、RefreshToken、ChatSession、ChatMessage、File、TokenUsage、UserQuota、AiConfig、AgentToolExecution |
| 路由 | [`app/api/v1/`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/api/v1) | 6 个路由模块：auth、chat、user、system、upload、agent |

#### B. ModuAgent 框架层（`ModuAgent/`）

| 子系统 | 核心文件 | 职责 |
|--------|---------|------|
| 注册中心 | [`ModuAgent/core/registry.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/core/registry.py) | `ComponentRegistry` 单例：管理 11 类组件（reasoning/tool/memory/perception/sensor/skill/feedback/evolution…），支持 `swap_component` 热替换 |
| 接口契约 | `core/interfaces/` | 6 个 ABC：action/feedback/memory/perception/reasoning/skill |
| 运行时配置 | [`ModuAgent/config/runtime_config.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/config/runtime_config.py) | `RuntimeConfig`：线程安全、深拷贝默认值、`update_many` 原子更新、`register_change_callback` 热更新回调 |
| LangGraph 图 | [`ModuAgent/modu_graph/graph.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/graph.py) | `build_modu_graph`：StateGraph 编排 `perception→memory_query→agent→tools→response→feedback→memory_update`，支持 HITL 与多 Agent |
| 图工厂 | [`ModuAgent/modu_graph/factory.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/factory.py) | `create_agent`：构建 LLM+工具+checkpointer+store+orchestrator 并编译图，支持 `RunnableConfig.configurable` 运行时覆盖 |
| 运行器 | [`ModuAgent/modu_graph/runner.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/runner.py) | `stream_response`/`run_sync`：LangGraph `astream` + `EventBridge`，带图实例缓存与配置 hash 失效 |
| AG-UI 适配 | [`ModuAgent/orchestration/communication/agui_adapter.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/orchestration/communication/agui_adapter.py) | `AGUIStreamAdapter`+`AGUIStateMachine`：将 LangGraph 事件流转为 AG-UI SSE 协议（19 种事件类型） |
| 感知层 | `components/perception/` | text/vision/audio/security/fusion/pipeline，含 `SecurityGuard`（注入检测/PII/安全评分） |
| 进化闭环 | [`ModuAgent/evolution/evolution_orchestrator.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/evolution/evolution_orchestrator.py) | feedback 评估 → should_evolve → ParameterTune/Rollback |
| MCP 集成 | [`ModuAgent/mcp/client.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/mcp/client.py) | 多 Server 连接管理、工具发现、SSE/stdio 传输 |
| 可观测性 | `observability/` | OTel tracing、Prometheus metrics、结构化日志 |

### 8.3 依赖关系（关键耦合点）

```
FastAPI main ──depends on──▶ v1_router ──6 routers──▶ deps(get_current_user) + get_db
                                                                    │
agent.py路由 ──imports──▶ agent_bridge.stream_agent_completion
                                    │
                                    ▼
                        _init_moduagent() ──sys.path.insert──▶ ModuAgent/
                                    │
                                    ▼
                        create_agent() ──▶ build_modu_graph()
                                    │                        │
                                    ▼                        ▼
                        AGUIStreamAdapter         LangGraph StateGraph
                        .transform_langgraph_events              │
                                    │                            ▼
                                    ▼                  perception/agent/tools/
                        EventSourceResponse          memory/feedback 节点
```

**三层关键依赖**：

1. **桥接层耦合**：[`agent_bridge.py:18`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/agent_bridge.py#L18) 通过 `sys.path.insert` 注入 ModuAgent 目录，属于隐式路径耦合 — TS 版通过 `packages/modu-agent` workspace 包显式 import，消除此耦合
2. **单例耦合**：`get_registry()` / `get_config()` / `get_mcp_client()` 全局单例贯穿整个框架 — TS 版需保留单例模式但改用 ES Module 天然单例
3. **LangChain 生态耦合**：LLM 适配（`ChatOpenAI`）、工具适配（`StructuredTool`）、图编排（`StateGraph`）全部绑定 LangChain Python 生态 — TS 版对应 `@langchain/openai` / `@langchain/core/tools` / `@langchain/langgraph`，API 表面相近但需逐项验证

### 8.4 数据流向（Agent 对话主链路）

```
用户 POST /api/v1/agent/completions
  │
  ▼
[agent.py: agent_completion]
  ├─ 写入 ChatMessage(user) 到 PostgreSQL
  ├─ _load_session_history 从 DB 加载历史
  │
  ▼
[agent_bridge.stream_agent_completion]
  ├─ _init_moduagent() 注册组件到 Registry（幂等）
  ├─ create_agent() 构建 LangGraph（configurable 可覆盖 model）
  │
  ▼
[AGUIStreamAdapter.transform_langgraph_events]
  │  消费 stream_response() 的 LangGraph 事件
  ▼
[LangGraph astream]
  ├─ perception_node: SecurityGuard 检测 → 敏感度熔断
  ├─ memory_query_node: Chroma 向量检索
  ├─ agent_node: ChatOpenAI.bind_tools 原生 function calling
  ├─ tools (ToolNode): 执行工具 → tool_processor → 回到 agent（ReAct 循环）
  ├─ response_node: 提取最终响应
  ├─ feedback_node: EvolutionOrchestrator 评估质量
  └─ memory_update_node: 写入长期记忆
  │
  ▼ 每个事件转为 AG-UI SSE dict
EventSourceResponse 流式输出给前端
  │
  ▼ 流结束后
[agent.py: event_generator 收尾]
  ├─ 从 StreamContext 构建 ChatMessage(assistant)
  ├─ 持久化 AgentToolExecution 记录
  └─ db.commit()
```

### 8.5 核心业务逻辑特点

1. **双对话通道**：`/chat/completions`（直连 LLM，简单对话）与 `/agent/completions`（经 LangGraph ReAct，工具调用）并存
2. **AG-UI 协议统一**：19 种事件类型（RUN_STARTED/THINKING/TOOL_CALL/TEXT_MESSAGE…），前端按协议消费
3. **可进化架构**：`feedback→evolution` 闭环可动态调参（temperature/max_tokens）、热替换组件、版本回滚
4. **配置驱动**：`RuntimeConfig` 支持运行时热更新，`config_overrides` 可 per-session 持久化到 checkpointer
5. **统一响应包装**：[`main.py:74`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/main.py#L74) 的中间件对所有非 SSE 响应包装为 `{code, data, message}`，SSE 与文档路由跳过

---

## 9. TypeScript 迁移可行性评估

### 9.1 可行性结论：分层差异化对待

| 层级 | 可行性 | 说明 |
|------|--------|------|
| FastAPI 业务层 → TS | ✅ 高 | 路由/CRUD/鉴权模式成熟，Pydantic↔Zod 映射自然 |
| ModuAgent 框架 → TS | ⚠️ 中 | LangGraph JS 存在但生态弱于 Python；组件注册模式可移植 |
| 感知层 NLP → TS | ❌ 低 | spaCy/SnowNLP 等中文 NLP 库在 JS 生态缺失 |
| 进化/反馈闭环 → TS | ⚠️ 中 | 逻辑可移植，但依赖 LangGraph checkpointer 状态历史 |

### 9.2 关键风险点

#### 风险 1：LangGraph JS 生态成熟度不足（高风险）

- Python `langgraph` 有 `ToolNode`/`MemorySaver`/`SqliteSaver`/`Command(resume=...)` 等完整 API
- JS 版 `@langchain/langgraph` 功能滞后，`interrupt`/`Command` 等高级特性可能缺失或不稳定
- [`runner.py:633`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/modu_graph/runner.py#L633) 的 `resume_sync`（HITL 恢复）强依赖 `Command(resume=...)`，JS 版支持度需验证

#### 风险 2：中文 NLP 感知组件无等效替代（高风险）

- [`guard.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/components/perception/security/guard.py) 的注入检测正则可移植
- 但 `llm_parser.py` 依赖的 spaCy NER、SnowNLP 情感分析在 JS 生态无成熟替代（`compromise`/`wink-nlp` 中文支持弱）

#### 风险 3：ChromaDB JS 客户端功能差异（中风险）

- Python `chromadb` 支持 `PersistentClient`/`EmbeddingFunction` 完整 API
- JS `chromadb` 客户端 API 表面相近但 embedding 集成需重新验证

#### 风险 4：全局单例与热更新机制差异（中风险）

- Python 的模块级单例（`_registry`/`_config`）配合 `threading.RLock` 实现线程安全热更新
- Node.js 单线程模型简化了并发，但 `register_change_callback` 的异步语义需重新设计（改用 `EventEmitter`）

#### 风险 5：SQLAlchemy ORM 迁移成本（中风险）

- 9 张表的关系映射（`relationship`/`back_populates`/`ForeignKey`）需重写为 Prisma schema 或 Drizzle relations
- `AsyncSession` 的 `yield` 依赖注入模式需改为 TS 中间件/上下文模式

---

## 10. 后端 API 层框架选型：NestJS vs Fastify+Zod

> 本节针对 `apps/backend/app/`（FastAPI 业务层）的 TS 迁移，评估两种候选方案。

### 10.1 NestJS 适用性评估

#### 优势

1. **模块化架构天然匹配**：`ComponentRegistry` 的 11 类组件可映射为 NestJS Modules（PerceptionModule/ReasoningModule/MemoryModule…），每个 Module 封装 providers
2. **依赖注入容器成熟**：`@Injectable()` + 构造函数注入替代 Python 的 `get_registry()` 全局单例，更利于测试隔离
3. **装饰器模式一致**：FastAPI 的 `@router.get`/`Depends` → NestJS 的 `@Controller`/`@Get`/`@Inject` 心智模型平滑
4. **AuthGuard 原生支持**：`@UseGuards(JwtAuthGuard)` 替代 `get_current_user` 依赖，更声明式
5. **SSE 支持完善**：`@Sse()` 装饰器原生支持 Observable 流式输出

#### 劣势

1. **框架过重**：当前 FastAPI 业务层仅 6 个路由文件，NestJS 的 Module/Controller/Service/DTO 四层结构显著增加样板代码
2. **性能开销**：NestJS 基于 Express（可选 Fastify 适配），比原生 Fastify 慢 2-3x
3. **与 LangGraph JS 集成摩擦**：NestJS 的 DI 容器与 LangChain JS 的函数式风格存在范式冲突
4. **学习曲线**：Angular 风格对偏好函数式/最小化的团队是负担

### 10.2 Fastify + Zod 适用性评估

#### 优势

1. **性能最优**：Fastify 是 Node.js 最快框架之一，与 FastAPI 的"高性能"定位一致
2. **哲学一致**：FastAPI 的"最小化 + 类型提示"哲学与 Fastify+Zod 的"schema-first + 轻量"高度契合
3. **Zod ↔ Pydantic 映射自然**：
   - `BaseModel` → `z.object({...})`
   - `Field(..., description=...)` → `z.string().describe(...)`
   - `model_config = {"from_attributes": True}` → `z.parse(entity)` 显式转换
4. **路由结构低迁移成本**：FastAPI 的 `APIRouter` → Fastify 的 `fp(plugin)` 注册，结构相似
5. **SSE 与流式原生支持**：`reply.raw` 直接写入 SSE，与当前 `EventSourceResponse` 模式对应
6. **与 LangGraph JS 集成无摩擦**：函数式风格，无 DI 容器约束

#### 劣势

1. **无内置 DI**：需手动组织组件注册（可借鉴现有 `ComponentRegistry` 模式实现 TS 版单例容器）
2. **模块边界靠约定**：缺乏 NestJS 的强约束，团队需自律
3. **AuthGuard 需自定义**：通过 `preHandler` 钩子实现，不如 NestJS Guard 声明式

### 10.3 对比矩阵

| 维度 | NestJS | Fastify+Zod | 当前 FastAPI |
|------|--------|-------------|-------------|
| 性能 | 中（Express/Fastify适配） | **高** | 高 |
| 模块化强制度 | **高（Module/Provider）** | 低（约定式） | 中（APIRouter） |
| DI 容器 | **内置且成熟** | 需自建/手动 | Depends 函数式 |
| 类型安全 | 装饰器+DTO | **Zod schema 推导** | Pydantic |
| SSE 流式 | @Sse 装饰器 | reply.raw 手写 | EventSourceResponse |
| 学习曲线 | 陡（Angular风） | **平缓** | 平缓 |
| 与 LangGraph JS 契合 | 中（范式冲突） | **高（函数式）** | N/A |
| 迁移工作量 | 高（四层结构） | **中（结构相似）** | — |
| 生态成熟度 | **高** | 高 | 高 |

### 10.4 推荐结论：**Fastify + Zod**

**核心理由**：

1. **哲学一致性**：当前项目 FastAPI 层是"薄业务层 + 厚框架层（ModuAgent）"结构。Fastify 的最小化理念让业务层保持薄，把复杂度留给 `packages/modu-agent`（其架构思想通过 `ComponentRegistry` 自治，不依赖 Web 框架的 DI）
2. **迁移成本最低**：6 个路由文件可近乎 1:1 翻译，Zod schema 与 Pydantic 模型字段级对应
3. **LangGraph JS 友好**：函数式风格与 LangChain JS 的 `Runnable`/`Chain` 接口无范式冲突
4. **性能不退化**：FastAPI 本就选型为高性能，Fastify 是 TS 生态最接近的等价物
5. **用户偏好契合**：项目约定"模块化组件结构 + 清晰关注点分离"，Fastify 插件式架构 + 自建轻量 Registry 即可满足，无需 NestJS 的重框架约束

**NestJS 更适合的场景**（当前项目不满足）：团队已有 Angular 背景、需要强约束的大型团队、CRUD 占比高且业务规则复杂的传统后端服务。

---

## 11. 详细迁移实施计划与风险应对

> 本节细化第 6 节的 P1-P6 路线，补充每阶段的具体步骤、关键风险点与应对策略。
> 聚焦 **Fastify + Zod** 方案，覆盖 `app/` 业务层与 `packages/modu-agent/` 框架层两条迁移线。

### 11.1 阶段一：基础设施搭建（对应 P1）

**目标**：在 `apps/backend/` **原位置**建立 TS 项目骨架，迁移配置/数据库/认证

> **位置决策**：后端 API **保持原位置 `apps/backend/`**（不新建 `apps/backend-ts/`）。Python 源码（`app/`、`ModuAgent/`）在迁移完成、灰度验证通过后整体删除，由 TS 源码原地接管，避免路由位置漂移与 monorepo workspace 配置变动。

**步骤**：

1. 在 `apps/backend/` 内初始化 TS 工程骨架，采用 `tsx` + `tsc` + ESM 模块；Python 文件迁移期间保留于 `apps/backend/_legacy_py/`（仅只读对照，不再改动）
2. 依赖清单：
   - `fastify`、`@fastify/cors`、`@fastify/multipart`、`@fastify/static`
   - `zod`、`@asteasolutions/zod-to-openapi`
   - `prisma` + `@prisma/client`（替代 SQLAlchemy）
   - `bcryptjs`、`jsonwebtoken`（替代 passlib/python-jose）
   - `pino`（Fastify 内置日志，替代 logging.handlers）
3. 配置层迁移：`dotenv` + `z.object` 校验环境变量（对应 [`config.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/config.py)）
4. Prisma schema 编写：将 [`models/user.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/models/user.py) 的 9 张表翻译为 `schema.prisma`
5. 认证迁移：`hashPassword`/`verifyPassword`/`createAccessToken`/`decodeAccessToken` 函数式实现，Fastify `preHandler` 钩子替代 `get_current_user`
6. 将 `apps/backend` 纳入根 `package.json` 的 `workspaces`（当前缺失，见第 13.2 节）

**关键风险**：Prisma 与 SQLAlchemy 的 `relationship`/`back_populates` 语义差异
**应对**：Prisma 的 `include`/`select` 替代 eager loading，需逐一验证嵌套查询场景

### 11.2 阶段二：CRUD 路由迁移

**目标**：迁移 auth/user/system/upload/chat 的非 Agent 路由

**步骤**：

1. 按 [`api/v1/__init__.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/api/v1/__init__.py) 注册 6 个 Fastify 插件
2. 每个路由文件的 `@router.get/post` → `fastify.get/post`，`Depends(get_db)` → `fastify.decorate('prisma')`
3. Pydantic schema → Zod schema：
   - `Field(..., ge=1, le=100)` → `z.number().int().min(1).max(100)`
   - `alias="system_prompt"` → `z.string().optional()` + 手动映射
4. 统一响应包装中间件：对应 [`main.py:74`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/main.py#L74) 的 `response_wrapper`，用 Fastify `onSend` 钩子实现
5. 文件上传：`@fastify/multipart` 替代 `UploadFile`

**关键风险**：`response_wrapper` 中间件对 SSE 的跳过逻辑需在 Fastify `onSend` 中精确复刻
**应对**：检测 `content-type` 含 `text/event-stream` 时直接 return

### 11.3 阶段三：LLM 直连与 AG-UI 协议迁移

**目标**：迁移 [`core/llm.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/core/llm.py) 的 `LlmService.stream_agui`

**步骤**：

1. 用 `undici` 或 `fetch`（Node 18+）替代 `httpx.AsyncClient` 的流式 POST
2. AG-UI 事件编码器：将 [`agui_adapter.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/orchestration/communication/agui_adapter.py) 的 `AGUIEncoder`/`AGUIStateMachine` 翻译为 TS class
3. 19 种 `AGUIEventType` 枚举直接映射
4. SSE 输出：`reply.raw.write('data: ...\n\n')` + `reply.raw.flush()`

**关键风险**：Python 的 `async for line in response.aiter_lines()` 与 Node.js fetch 流的读取方式不同
**应对**：使用 `ReadableStream` + `TextDecoder` 逐行解析，或 `eventsource-parser` 库

### 11.4 阶段四：ModuAgent 框架核心迁移（对应 P2-P5，最高风险）

**目标**：迁移 Registry/Config/LangGraph 图/Runner（即 `packages/modu-agent/` 的核心）

**步骤**：

1. **Registry 层**（对应 P1 的 `core/registry.ts`）：TS class + interface 替代 ABC

   ```typescript
   interface BaseTool {
     name(): string;
     description(): string;
     parametersSchema(): object;
     invoke(params: object, ctx: object): Promise<object>;
   }
   class ComponentRegistry {
     private tools = new Map<string, BaseTool>();
     // ...11 类组件 Map
   }
   ```

2. **RuntimeConfig 层**（对应 P5 的 `config/runtime-config.ts`）：TS class + `EventEmitter` 替代 `register_change_callback`
3. **LangGraph 图**（对应 P2）：
   - 评估 `@langchain/langgraph` JS 版的 `StateGraph`/`ToolNode`/`MemorySaver` 成熟度
   - 若 JS 版 `interrupt`/`Command(resume=)` 不可用，则 HITL 功能需降级或自研
4. **LLM 适配**：`@langchain/openai` 的 `ChatOpenAI` 直接对应 Python 版
5. **Runner**：`graph.astream()` JS 版 API 与 Python 基本一致，但事件格式可能不同，需适配 `EventBridge`

**关键风险**（最高优先级）：

| 风险 ID | 描述 | 应对 |
|---------|------|------|
| R1 | LangGraph JS 的 `astream` 多 `stream_mode`（messages/updates/values 同时）支持度 | 最小可行验证：先跑通单 stream_mode，再逐步叠加 |
| R2 | `checkpointer` 的 `get_tuple`/`get_state_history` 在 JS 版的实现完整性 | 验证 `@langchain/langgraph-checkpoint-sqlite` JS 包；不可用则降级为 MemorySaver |
| R3 | `ToolNode` 对自定义 `StructuredTool` 的 `args_schema` 处理 | 用 `zod` schema 直接作为 `StructuredTool` 的 args，JS 版原生支持 |

**通用应对策略**：

- 先做**最小可行验证**：用 JS 版 LangGraph 复刻一个 `perception→agent→tools→response` 简化图，验证流式与工具调用
- 若关键 API 缺失，**降级方案**：保留 Python ModuAgent 作为子进程，TS 层通过 HTTP/SSE 调用（微服务化）

### 11.5 阶段五：感知层与安全组件迁移（对应 P5）

**目标**：迁移 SecurityGuard/TextPreprocessor/Pipeline

**步骤**：

1. `SecurityGuard`：正则模式库可直接移植（[`guard.py:25-69`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/components/perception/security/guard.py#L25)）
2. `TextPreprocessor`：基础清洗可移植
3. **LLM Parser**：用 LLM 调用替代 spaCy/SnowNLP（将 NER/情感分析改为 prompt 工程）
4. 视觉/音频：用 `sharp`/Web Audio API 等价物，但优先级低（当前代码多为空实现）

**关键风险**：中文 NLP 能力降级
**应对**：将 spaCy/SnowNLP 的本地推理改为 LLM-as-Judge 模式（项目已有 `quality_monitor_mode="llm"` 机制，呼应 [`runtime_config.py:133`](file:///d:/Administrator/Desktop/pioneering/apps/backend/ModuAgent/config/runtime_config.py#L133)）

### 11.6 阶段六：进化闭环与可观测性迁移（对应 P5）

**目标**：迁移 EvolutionOrchestrator/FeedbackLoop/MCP

**步骤**：

1. `FeedbackLoop`/`QualityMonitor`：纯逻辑，直接翻译
2. `ParameterTuneStrategy`：配置调优逻辑可移植
3. `RollbackMechanism`：依赖 LangGraph checkpointer 的状态历史，**与阶段四 R2 风险绑定**
4. MCP 客户端：JS 版 `@modelcontextprotocol/sdk` 官方支持，迁移成本低
5. 可观测性：`@opentelemetry/api` + `prom-client` 替代 Python OTel/Prometheus

### 11.7 阶段七：测试与灰度切换（对应 P6）

**步骤**：

1. 移植 [`tests/`](file:///d:/Administrator/Desktop/pioneering/apps/backend/tests) 的关键测试用例（用 `vitest` 替代 `pytest`）
2. 契约测试：对比 Python 与 TS 版的 SSE 输出字节级一致性
3. 灰度：Nginx 按路由分流（先切 `/auth`/`/user`/`/system`，后切 `/chat`，最后切 `/agent`）
4. 监控对比：TS 版上线后观察 P99 延迟、错误率

### 11.8 风险总览

| 风险 | 等级 | 阶段 | 应对 |
|------|------|------|------|
| LangGraph JS API 缺失/不稳定 | 🔴 高 | 阶段四 | 最小可行验证 + 降级为微服务调用 |
| 中文 NLP 能力降级（spaCy/SnowNLP） | 🔴 高 | 阶段五 | 改为 LLM-as-Judge 模式 |
| ChromaDB JS embedding 集成差异 | 🟡 中 | 阶段四 | 验证 `OpenAIEmbeddingFunction` JS 版 |
| HITL `interrupt`/`Command(resume)` 不可用 | 🟡 中 | 阶段四 | 降级为同步审批 + 重新发起请求 |
| SSE 字节级一致性 | 🟡 中 | 阶段三 | 契约测试，逐事件对比 |
| 全局单例热更新语义差异 | 🟡 中 | 阶段四 | `EventEmitter` + 显式 `notify` |
| Prisma 与 SQLAlchemy 关系映射差异 | 🟢 低 | 阶段一 | 逐表验证 `include` 查询 |
| AG-UI 19 种事件类型完整性 | 🟢 低 | 阶段三 | 枚举直接映射，逻辑明确 |

---

## 12. 后端 API 基础结构设计（Fastify + Zod）

> 本节定义 `apps/backend/` TS 版的**路由定义、请求/响应 Schema 验证、错误处理**三大基础结构。
> 对齐 Python 版 [`main.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/main.py) 的统一响应包装中间件与 Pydantic schema 校验模式，确保前端三端（web/desktop/mobile）消费契约不变。

### 12.1 设计原则

| 原则 | 说明 |
|------|------|
| **Schema-first** | 所有请求体 / 查询参数 / 响应体均以 Zod schema 定义，类型由 schema 推导（`z.infer<typeof Schema>`），杜绝手写 interface 与 schema 漂移 |
| **契约不变** | 路由路径、请求/响应字段、统一响应包装格式（`{code,data,message}`）、SSE 事件协议**与 Python 版完全一致**，前端三端零改动接入 |
| **插件化路由** | 每个路由模块封装为 Fastify 插件（`fp`），按 [`api/v1/__init__.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/api/v1/__init__.py) 的 6 个模块（auth/chat/user/system/upload/agent）组织 |
| **统一错误处理** | 全局 `setErrorHandler` 捕获所有异常，转为统一错误响应格式（含 `requestId`），对应 Python 版 [`main.py:110`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/main.py#L110) 的错误包装逻辑 |
| **SSE 透传** | 流式响应（`text/event-stream`）跳过统一包装中间件，直接写入 `reply.raw`，与 AG-UI 协议一致 |

### 12.2 路由定义结构

每个路由模块封装为 Fastify 插件，路由前缀与 Python 版对齐：

```typescript
// src/routes/agent.ts — 对应 Python app/api/v1/agent.py
import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { AgentChatSchema, CreateAgentSessionSchema } from '../schemas/agent'
import { authGuard } from '../plugins/auth'

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  // 对齐 Python: router = APIRouter(prefix="/agent", tags=["Agent"])
  fastify.register(async (app) => {
    app.addHook('preHandler', authGuard) // 对齐 Depends(get_current_user)

    // POST /agent/sessions — 对齐 Python @router.post("/sessions", status_code=201)
    app.post('/sessions', {
      schema: {
        body: CreateAgentSessionSchema,   // Zod schema 驱动校验
        response: { 201: AgentSessionResponseSchema }
      }
    }, async (req, reply) => {
      const dto = req.body            // 类型已由 Zod 推导，无需断言
      const session = await fastify.prisma.chatSession.create({ ... })
      reply.code(201).send(session)
    })

    // POST /agent/completions (SSE 流式)
    app.post('/completions', {
      schema: { body: AgentChatSchema }
    }, async (req, reply) => {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })
      // 调用 packages/modu-agent 的 streamResponse
      for await (const event of agentStream(req.body, req.user)) {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      reply.raw.end()
    })
  }, { prefix: '/agent' })
}
```

**6 个路由插件按 Python 版前缀对齐**：

| 插件文件 | 前缀 | 对应 Python 文件 |
|---------|------|-----------------|
| `routes/auth.ts` | `/auth` | [`api/v1/auth.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/api/v1/auth.py) |
| `routes/chat.ts` | `/chat` | [`api/v1/chat.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/api/v1/chat.py) |
| `routes/user.ts` | `/user` | [`api/v1/user.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/api/v1/user.py) |
| `routes/system.ts` | `/system` | [`api/v1/system.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/api/v1/system.py) |
| `routes/upload.ts` | `/upload` | [`api/v1/upload.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/api/v1/upload.py) |
| `routes/agent.ts` | `/agent` | [`api/v1/agent.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/api/v1/agent.py) |

### 12.3 请求/响应 Schema 验证（Zod ↔ Pydantic 映射）

**统一映射规则**（对应 [`schemas/`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/schemas) 目录）：

| Pydantic 写法 | Zod 等价 | 说明 |
|---------------|----------|------|
| `Field(None, alias="system_prompt")` | `z.string().optional()` + `.transform()` | 别名字段需 transform 映射 |
| `Field(..., ge=1, le=100)` | `z.number().int().min(1).max(100)` | 数值边界 |
| `Field(..., pattern="^(none\|like\|dislike)$")` | `z.enum(['none','like','dislike'])` | 枚举校验 |
| `model_config = {"from_attributes": True}` | `Schema.parse(entity)` 显式转换 | ORM 实体 → 响应 DTO |
| `model_config = {"populate_by_name": True}` | `z.object({...}).passthrough()` | 允许字段名与别名共存 |

**Schema 组织示例**（对应 [`schemas/agent.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/schemas/agent.py)）：

```typescript
// src/schemas/agent.ts
import { z } from 'zod'

// 对齐 Python: CreateAgentSessionRequest
export const CreateAgentSessionSchema = z.object({
  agentMode: z.enum(['react_agent', 'rag_agent']).default('react_agent'),
  title: z.string().optional(),
  model: z.string().default('gpt-4o'),
  systemPrompt: z.string().optional(),
  tools: z.array(z.string()).optional()
})
export type CreateAgentSessionRequest = z.infer<typeof CreateAgentSessionSchema>

// 对齐 Python: AgentChatRequest
export const AgentChatSchema = z.object({
  sessionId: z.string().optional(),
  message: z.string(),
  stream: z.boolean().default(true)
})
export type AgentChatRequest = z.infer<typeof AgentChatSchema>

// 对齐 Python: ErrorResponse（统一错误响应）
export const ErrorSchema = z.object({
  code: z.number(),
  message: z.string(),
  details: z.string().optional(),
  requestId: z.string().optional()
})
```

### 12.4 统一响应包装中间件

对齐 Python 版 [`main.py:74`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/main.py#L74) 的 `response_wrapper`，用 Fastify `onSend` 钩子实现：

```typescript
// src/plugins/response-wrapper.ts
import { FastifyInstance } from 'fastify'

const SKIP_PATHS = new Set(['/docs', '/redoc', '/openapi.json'])

export async function responseWrapperPlugin(fastify: FastifyInstance) {
  fastify.addHook('onSend', async (req, reply, payload) => {
    // 跳过文档路由
    if (SKIP_PATHS.has(req.url)) return payload

    // 跳过 SSE 流式响应（对齐 Python: "text/event-stream" in content_type）
    const contentType = reply.getHeader('content-type') as string ?? ''
    if (contentType.includes('text/event-stream') || contentType.includes('text/html')) {
      return payload
    }

    // 跳过 204 无内容
    if (reply.statusCode === 204) return payload

    // 跳过已包装的响应（避免双重包装）
    if (typeof payload === 'string') {
      try {
        const parsed = JSON.parse(payload)
        if (parsed && typeof parsed === 'object' && 'code' in parsed && 'data' in parsed) {
          return payload
        }
      } catch { /* 非 JSON，继续包装 */ }
    }

    // 构建包装内容（对齐 Python: { code, data, message }）
    const wrapped = {
      code: reply.statusCode,
      data: reply.statusCode < 400 ? safeJsonParse(payload) : null,
      message: reply.statusCode < 400 ? 'success' : undefined
    }

    return JSON.stringify(wrapped)
  })
}
```

### 12.5 统一错误处理

对齐 Python 版 [`main.py:109`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/main.py#L109) 的错误包装逻辑：

```typescript
// src/plugins/error-handler.ts
import { FastifyInstance, FastifyError } from 'fastify'
import { randomUUID } from 'crypto'
import { ZodError } from 'zod'

export async function errorHandlerPlugin(fastify: FastifyInstance) {
  fastify.setErrorHandler((error: FastifyError, req, reply) => {
    const requestId = reply.getHeader('x-request-id') as string ?? randomUUID()

    // Zod 校验错误 → 400
    if (error instanceof ZodError) {
      return reply.code(400).send({
        code: 400,
        message: '请求参数校验失败',
        details: error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
        requestId
      })
    }

    // JWT/认证错误 → 401（对齐 Python deps.py 的 HTTPException(401)）
    if (error.statusCode === 401) {
      return reply.code(401).send({
        code: 401,
        message: error.message || '未认证或 Token 已过期',
        requestId
      })
    }

    // 业务错误（带 statusCode）
    if (error.statusCode) {
      return reply.code(error.statusCode).send({
        code: error.statusCode,
        message: error.message,
        requestId
      })
    }

    // 未知错误 → 500
    req.log.error({ err: error, requestId }, '未处理异常')
    return reply.code(500).send({
      code: 500,
      message: '服务器内部错误',
      requestId
    })
  })
}
```

### 12.6 认证插件（替代 `get_current_user`）

对齐 Python 版 [`api/deps.py`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/api/deps.py) 的 `get_current_user` 依赖注入：

```typescript
// src/plugins/auth.ts
import { FastifyReply, FastifyRequest } from 'fastify'
import { decodeAccessToken } from '../core/security'

// 对齐 Python: async def get_current_user(credentials, db) -> User
export async function authGuard(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    return reply.code(401).send({ code: 401, message: '缺少认证令牌' })
  }

  const token = auth.slice(7)
  const payload = decodeAccessToken(token)
  if (!payload?.sub) {
    return reply.code(401).send({ code: 401, message: '认证令牌无效或已过期' })
  }

  const user = await req.server.prisma.user.findUnique({ where: { id: payload.sub } })
  if (!user) {
    return reply.code(401).send({ code: 401, message: '用户不存在' })
  }

  req.user = user // 装饰到 request 供路由使用
}

// 可选认证（对齐 Python: get_optional_user）
export async function optionalAuthGuard(req: FastifyRequest, reply: FastifyReply) {
  try { await authGuard(req, reply) } catch { /* 忽略 */ }
}
```

---

## 13. `apps/backend` TS 版内部目录结构

> 本节规划 `apps/backend/` 由 Python 迁移为 TS 后的内部目录组织，对齐第 4 节 `packages/modu-agent/` 的结构风格，保持模块化设计。

### 13.1 目录结构

```
apps/backend/
├── package.json              # 独立 workspace 包，依赖 @pioneering/modu-agent
├── tsconfig.json
├── tsconfig.build.json
├── prisma/
│   └── schema.prisma         # 9 张表（对应 app/models/user.py）
├── src/
│   ├── index.ts              # Fastify 启动入口（对应 app/main.py）
│   ├── app.ts                # Fastify 实例创建 + 插件注册编排
│   ├── config/
│   │   └── env.ts            # 环境变量校验（z.object，对应 app/config.py）
│   ├── core/
│   │   ├── security.ts       # hashPassword/verifyPassword/JWT 签发校验（对应 app/core/security.py）
│   │   ├── llm.ts            # LLM 直连服务（对应 app/core/llm.py）
│   │   └── agent-bridge.ts   # 调用 @pioneering/modu-agent 的桥接层（对应 app/core/agent_bridge.py）
│   ├── plugins/              # Fastify 插件（基础设施）
│   │   ├── prisma.ts         # Prisma Client 装饰器（fastify.decorate('prisma', ...)）
│   │   ├── auth.ts           # authGuard / optionalAuthGuard（对应 app/api/deps.py）
│   │   ├── response-wrapper.ts  # 统一响应包装（对应 main.py response_wrapper）
│   │   ├── error-handler.ts  # 统一错误处理
│   │   ├── cors.ts           # CORS 配置（对应 main.py CORSMiddleware）
│   │   └── static.ts         # 静态文件服务（对应 main.py StaticFiles）
│   ├── schemas/              # Zod schema 定义（对应 app/schemas/）
│   │   ├── auth.ts           # 对应 schemas/user.py 认证部分
│   │   ├── chat.ts           # 对应 schemas/chat.py
│   │   ├── agent.ts          # 对应 schemas/agent.py
│   │   └── common.ts         # 通用响应/分页 schema
│   ├── routes/               # 路由插件（对应 app/api/v1/）
│   │   ├── index.ts          # 汇总注册（对应 api/v1/__init__.py）
│   │   ├── auth.ts           # 对应 api/v1/auth.py
│   │   ├── chat.ts           # 对应 api/v1/chat.py
│   │   ├── user.ts           # 对应 api/v1/user.py
│   │   ├── system.ts         # 对应 api/v1/system.py
│   │   ├── upload.ts         # 对应 api/v1/upload.py
│   │   └── agent.ts          # 对应 api/v1/agent.py
│   ├── services/             # 业务逻辑层（从路由中抽离复杂业务）
│   │   ├── chat-service.ts   # 会话/消息 CRUD
│   │   ├── agent-service.ts  # Agent 会话管理 + 流式收尾持久化
│   │   └── quota-service.ts  # Token 用量/配额
│   └── utils/
│       ├── id.ts             # _genId（对应 agent.py 的 _gen_id）
│       └── logger.ts         # pino 日志配置（对应 main.py _setup_logging）
├── _legacy_py/               # 迁移期保留的 Python 源码（只读对照，迁移完成后删除）
└── tests/
    ├── routes/
    │   ├── auth.test.ts
    │   ├── chat.test.ts
    │   └── agent.test.ts
    └── plugins/
        └── response-wrapper.test.ts
```

### 13.2 纳入根 workspaces

当前根 [`package.json`](file:///d:/Administrator/Desktop/pioneering/package.json) 的 `workspaces` 仅为 `["apps/web","apps/marketing"]`，需补充 `apps/desktop`、`apps/backend`、`packages/*`：

```json
{
  "name": "pioneering",
  "private": true,
  "workspaces": [
    "apps/web",
    "apps/marketing",
    "apps/desktop",
    "apps/backend",
    "packages/*"
  ]
}
```

### 13.3 `apps/backend` 的 `package.json`

```json
{
  "name": "@pioneering/backend",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/index.js",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "test": "vitest run"
  },
  "dependencies": {
    "@pioneering/modu-agent": "workspace:*",
    "fastify": "^5.0.0",
    "@fastify/cors": "^10.0.0",
    "@fastify/multipart": "^9.0.0",
    "@fastify/static": "^8.0.0",
    "zod": "^3.23.0",
    "@prisma/client": "^5.20.0",
    "bcryptjs": "^2.4.3",
    "jsonwebtoken": "^9.0.2",
    "pino": "^9.0.0"
  },
  "devDependencies": {
    "prisma": "^5.20.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

### 13.4 启动入口（对应 `app/main.py`）

```typescript
// src/index.ts — 对应 Python app/main.py
import { buildApp } from './app'

const app = await buildApp()

try {
  await app.listen({ port: 9000, host: '0.0.0.0' })
  app.log.info('后端服务启动成功 (TypeScript / Fastify) :9000')
} catch (err) {
  app.log.error({ err }, '启动失败')
  process.exit(1)
}
```

```typescript
// src/app.ts — Fastify 实例 + 插件编排
import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import staticPlugin from '@fastify/static'
import { env } from './config/env'
import { prismaPlugin } from './plugins/prisma'
import { responseWrapperPlugin } from './plugins/response-wrapper'
import { errorHandlerPlugin } from './plugins/error-handler'
import { registerRoutes } from './routes'

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: 'info', transport: { target: 'pino-pretty' } },
    genReqId: () => randomUUID()
  })

  // 基础设施插件
  await app.register(cors, {
    origin: env.CORS_ORIGINS.split(','),
    credentials: true
  })
  await app.register(prismaPlugin)
  await app.register(responseWrapperPlugin)
  await app.register(errorHandlerPlugin)
  await app.register(staticPlugin, { root: env.UPLOAD_DIR, prefix: '/uploads' })

  // 路由（对齐 Python: app.include_router(v1_router)）
  await app.register(registerRoutes, { prefix: '' })

  return app
}
```

---

## 14. 后端 API 多端适配方案（web / desktop / mobile）

> 本节解决用户核心诉求：**后端 API 需完整适配 web、desktop、mobile 三个 app**。
> 基于当前 web（fetch + Vite proxy）与 desktop（axios + env baseURL）客户端实现不统一的现状，规划统一的多端适配架构。

### 14.1 现状分析：三端 API 消费差异

| 维度 | web（当前） | desktop（当前） | mobile（规划） |
|------|------------|----------------|---------------|
| HTTP 客户端 | 原生 `fetch`（[`api/client.ts`](file:///d:/Administrator/Desktop/pioneering/apps/web/src/api/client.ts)） | `axios`（[`services/api/client.ts`](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/services/api/client.ts)） | 待定 |
| baseURL 来源 | Vite proxy `/api` → `:9000`（[`vite.config.ts`](file:///d:/Administrator/Desktop/pioneering/apps/web/vite.config.ts#L13)） | `VITE_API_BASE_URL` env，默认 `http://localhost:9000` | 待定 |
| Token 存储 | `localStorage` | 内存 + `onTokenChange` 回调 | 待定（Keychain/SecureStorage） |
| 401 刷新 | ❌ 直接清 token，无刷新 | ✅ single-flight 自动刷新（[`client.ts:96`](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/services/api/client.ts#L96)） | 待定 |
| SSE 流式 | ❌ web 当前未实现 Agent 流式 | ✅ `streamAgui` fetch 流（[`agui.ts`](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/services/api/agui.ts)） | 待定 |
| 响应解包 | 手动解 `{code,data,message}` | 拦截器自动解 `res.data.data` | 待定 |

**核心问题**：三端 API 客户端实现碎片化，Token 刷新、SSE 流式、错误处理逻辑重复且不一致。

### 14.2 多端适配架构

```
┌──────────────────────────────────────────────────────────────┐
│  apps/backend (Fastify + Zod)                                 │
│  ─ 统一响应契约 {code,data,message}                            │
│  ─ 统一 SSE (AG-UI 协议)                                      │
│  ─ CORS 允许 web/desktop/mobile 三端 origin                   │
│  ─ JWT Bearer 认证 + refresh token                            │
└──────────────────────────┬───────────────────────────────────┘
                           │ HTTP / SSE
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ apps/web     │  │ apps/desktop │  │ apps/mobile  │
│              │  │              │  │ (规划)        │
│ 共享 API 包  │  │ 共享 API 包  │  │ 共享 API 包  │
│ @pioneering/ │  │ @pioneering/ │  │ @pioneering/ │
│  api-client  │  │  api-client  │  │  api-client  │
└──────────────┘  └──────────────┘  └──────────────┘
```

### 14.3 关键决策：抽取共享 API Client 包

**问题**：当前 web 和 desktop 各自维护 API 客户端，逻辑重复且行为不一致（Token 刷新、SSE、错误处理）。

**方案**：抽取 `packages/api-client/` 共享包，三端复用，解决碎片化。

```
packages/api-client/
├── package.json
├── src/
│   ├── index.ts              # 统一导出
│   ├── client.ts             # ApiClient 核心类（基于 desktop 的 axios 实现升级）
│   ├── stream.ts             # SSE 流式封装（基于 desktop 的 streamAgui）
│   ├── auth.ts               # Token 管理 + single-flight 刷新
│   ├── types.ts              # ApiResponse / AuthTokens / SSEChunk 等共享类型
│   ├── services/             # 按后端路由对齐的 service 封装
│   │   ├── auth.ts           # 对齐 /auth 路由
│   │   ├── chat.ts           # 对齐 /chat 路由
│   │   ├── agent.ts          # 对齐 /agent 路由
│   │   ├── user.ts           # 对齐 /user 路由
│   │   └── system.ts         # 对齐 /system 路由
│   └── adapters/             # 平台适配层（Token 存储等差异）
│       ├── web.ts            # localStorage 适配
│       ├── desktop.ts        # 内存 + IPC 持久化适配
│       └── mobile.ts         # SecureStorage 适配（React Native / Capacitor）
└── tests/
```

**核心设计**：`ApiClient` 接受 `StorageAdapter` 接口，三端注入各自的 Token 存储实现：

```typescript
// packages/api-client/src/client.ts
export interface StorageAdapter {
  getAccessToken(): string | null
  getRefreshToken(): string | null
  setTokens(tokens: AuthTokens | null): void
  onTokensChange?(cb: (tokens: AuthTokens | null) => void): void
}

export class ApiClient {
  constructor(
    baseURL: string,
    storage: StorageAdapter  // 三端注入不同实现
  ) { ... }

  // 统一的 single-flight token 刷新（迁移自 desktop 实现）
  // 统一的 SSE stream() 方法（迁移自 desktop streamAgui）
  // 统一的响应解包（res.data.data）
}
```

### 14.4 三端接入方式

#### web 端接入

```typescript
// apps/web/src/api/client.ts — 替换当前简陋的 fetch 实现
import { ApiClient, WebStorageAdapter } from '@pioneering/api-client'

export const apiClient = new ApiClient(
  import.meta.env.VITE_API_BASE_URL ?? '/api',  // Vite proxy 或直连
  new WebStorageAdapter()                        // localStorage 适配
)
```

> Vite proxy 配置保持不变（[`vite.config.ts`](file:///d:/Administrator/Desktop/pioneering/apps/web/vite.config.ts#L13)），`/api` 前缀由 proxy 重写去除，后端路由无需感知前端代理。

#### desktop 端接入

```typescript
// apps/desktop/src/renderer/src/services/api/client.ts — 替换当前实现
import { ApiClient, DesktopStorageAdapter } from '@pioneering/api-client'

export const apiClient = new ApiClient(
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:9000',
  new DesktopStorageAdapter()  // 内存 + IPC 持久化（通过 preload bridge 写主进程）
)
```

> desktop 当前实现已是三端中最完整的（single-flight 刷新、SSE 流式），`packages/api-client/` 以此为基准抽取，desktop 迁移成本最低。

#### mobile 端接入（规划）

```typescript
// apps/mobile/src/api/client.ts（未来）
import { ApiClient, MobileStorageAdapter } from '@pioneering/api-client'

export const apiClient = new ApiClient(
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://api.example.com',
  new MobileStorageAdapter()  // expo-secure-store / Capacitor Preferences
)
```

> mobile app 尚未创建（当前 `apps/` 下仅有 web/desktop/marketing），本方案为其预留接入路径。mobile 采用 React Native（Expo）或 Capacitor 时，仅需实现 `MobileStorageAdapter`，其余 API 调用逻辑与 web/desktop 完全一致。

### 14.5 后端 CORS 多端配置

后端需允许三端的 origin 访问。对齐 Python 版 [`main.py:63`](file:///d:/Administrator/Desktop/pioneering/apps/backend/app/main.py#L63) 的 CORS 配置，TS 版通过环境变量配置多 origin：

```typescript
// src/config/env.ts
import { z } from 'zod'

export const env = z.object({
  // 三端 origin + 开发环境 localhost
  CORS_ORIGINS: z.string().default(
    'http://localhost:5173,http://localhost:5174,http://localhost:3000,http://localhost:8080'
  ),
  // ...其他配置
}).parse(process.env)
```

```typescript
// src/plugins/cors.ts
await app.register(cors, {
  origin: env.CORS_ORIGINS.split(',').map(s => s.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id']
})
```

### 14.6 SSE 多端兼容性保证

后端 SSE 输出需兼容三端不同运行时的流式读取：

| 端 | SSE 消费方式 | 兼容性要点 |
|----|-------------|-----------|
| web | 浏览器 `fetch` + `ReadableStream` + `TextDecoder` | 需 `reply.raw.flushHeaders()` 立即发送头 |
| desktop | Electron `fetch`（Chromium 内核，同 web） | 同 web，但跨域需 CORS |
| mobile | React Native `fetch`（polyfill）或 `EventSource` | RN 的 fetch 流式支持需验证，降级用 `EventSource` |

**后端 SSE 输出规范**（对齐 AG-UI 协议）：

```typescript
// 所有 SSE 响应统一头
reply.raw.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',  // no-transform 防代理缓冲
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no'                    // 禁用 Nginx 缓冲
})

// 每个事件格式：data: <JSON>\n\n
reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
```

### 14.7 `packages/api-client` 的 `package.json`

```json
{
  "name": "@pioneering/api-client",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./adapters/web": "./dist/adapters/web.js",
    "./adapters/desktop": "./dist/adapters/desktop.js",
    "./adapters/mobile": "./dist/adapters/mobile.js"
  },
  "dependencies": {
    "axios": "^1.7.0",
    "zod": "^3.23.0"
  },
  "peerDependencies": {
    "@pioneering/modu-agent": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

### 14.8 多端适配迁移步骤

| 步骤 | 内容 | 关联阶段 |
|------|------|---------|
| 1 | 创建 `packages/api-client/`，以 desktop 现有 [`client.ts`](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/services/api/client.ts) 为基准抽取 | 阶段一同步 |
| 2 | 实现 `WebStorageAdapter`（localStorage）+ `DesktopStorageAdapter`（IPC） | 阶段一同步 |
| 3 | web 端替换 [`api/client.ts`](file:///d:/Administrator/Desktop/pioneering/apps/web/src/api/client.ts) 为 `@pioneering/api-client` | 阶段二（CRUD 路由迁移后） |
| 4 | desktop 端替换为 `@pioneering/api-client` | 阶段三（SSE 迁移后） |
| 5 | 为 mobile 预留 `MobileStorageAdapter` 接口（mobile app 创建时实现） | 阶段七 |

---

## 15. 最终建议

1. **采用 Fastify + Zod 作为 TS 后端 API 层框架**，与当前 FastAPI 哲学一致，迁移成本最低
2. **后端 API 保持原位置 `apps/backend/`**，Python 源码迁移期只读保留于 `_legacy_py/`，迁移完成后删除
3. **分层迁移，先业务后框架**：阶段一~三（业务层）风险可控，阶段四（`packages/modu-agent` 框架）是成败关键
4. **阶段四前设置"验证门"**：先用 JS LangGraph 跑通最小 ReAct 图，确认 API 完整性后再全面迁移
5. **感知层 NLP 降级为 LLM 推理**：避免强依赖 Python NLP 库，反而提升跨语言一致性
6. **抽取 `packages/api-client/` 共享包**，统一三端（web/desktop/mobile）的 API 客户端，消除当前 web/desktop 实现碎片化，为 mobile 预留接入路径
7. **后端 API 契约保持不变**：路由路径、统一响应包装（`{code,data,message}`）、SSE 事件协议与 Python 版完全一致，前端三端零改动接入 TS 后端
8. **与第 6 节 P1-P6 路线的关系**：本节第 11.1~11.7 节是 P1-P6 的细化实施，阶段名对应关系如下：
   - 11.1 ↔ P1（脚手架 + core）
   - 11.2~11.3 ↔ 业务层细化（穿插在 P1-P6 间）
   - 11.4 ↔ P2-P5（图编排 + 工具 + MCP + 子系统）
   - 11.5~11.6 ↔ P5（其余子系统）
   - 11.7 ↔ P6（接入 + 弃用）
   - 12~14 节 ↔ 后端 API 基础结构与多端适配（贯穿阶段一~七）
