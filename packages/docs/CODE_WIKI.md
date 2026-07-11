# ModuAgent Code Wiki

> `@pioneering/modu-agent` — 基于 LangGraph 的可进化、可观测、多模态 AI Agent 框架（TypeScript 版，从 Python 移植）

---

## 目录

1. [项目概览](#1-项目概览)
2. [整体架构](#2-整体架构)
3. [目录结构](#3-目录结构)
4. [模块详解](#4-模块详解)
   - 4.1 [core — 组件注册中心与基础接口](#41-core--组件注册中心与基础接口)
   - 4.2 [config — 运行时配置与数据校验](#42-config--运行时配置与数据校验)
   - 4.3 [graph — LangGraph 状态图编排](#43-graph--langgraph-状态图编排)
   - 4.4 [tools — 内置工具集](#44-tools--内置工具集)
   - 4.5 [memory — 记忆层](#45-memory--记忆层)
   - 4.6 [perception — 感知层](#46-perception--感知层)
   - 4.7 [reasoning — 推理层](#47-reasoning--推理层)
   - 4.8 [mcp — MCP 协议集成](#48-mcp--mcp-协议集成)
   - 4.9 [feedback — 反馈循环](#49-feedback--反馈循环)
   - 4.10 [evolution — 进化策略](#410-evolution--进化策略)
   - 4.11 [observability — 可观测性](#411-observability--可观测性)
   - 4.12 [orchestration — 编排层](#412-orchestration--编排层)
   - 4.13 [skills — Skills 子系统](#413-skills--skills-子系统)
5. [依赖关系](#5-依赖关系)
6. [项目运行方式](#6-项目运行方式)
7. [核心数据流](#7-核心数据流)
8. [设计约定与关键决策](#8-设计约定与关键决策)

---

## 1. 项目概览

### 1.1 项目定位

`@pioneering/modu-agent` 是一个模块化、可进化的 AI Agent 框架，核心理念是**用 LangGraph 状态图编排替代手写"上帝类"**，将原本 1047 行的 `Coordinator` 主流程拆解为独立的图节点函数。

### 1.2 核心特性

| 特性 | 说明 |
|------|------|
| **LangGraph 编排** | 基于 `StateGraph` 的节点化流程，支持 ReAct 循环、条件路由、递归限制 |
| **多 LLM 支持** | DeepSeek / GLM / GPT / Qwen，统一 OpenAI 兼容协议，原生 function calling |
| **感知层** | 文本/图像/音频多模态输入，预处理管道 + 深度语义解析 + 安全守卫 |
| **反馈进化闭环** | 响应质量评估 → 进化信号 → 参数调优/组件热替换/回滚 |
| **可观测性** | OpenTelemetry tracing + Prometheus metrics + 结构化日志 |
| **MCP 集成** | 接入外部 MCP Server 获取远程工具（Stdio / SSE 传输） |
| **多 Agent 协作** | Supervisor 任务拆分 + Send API 并行分发 + 共识聚合 |
| **Human-in-the-loop** | 敏感工具执行前 `interrupt` 暂停，等待人工审批后恢复 |
| **Skills 子系统** | 可插拔 Skill 单元，注册即工具就位，运行时对图透明 |
| **配置热更新** | `RuntimeConfig` 支持 dot-path 读写 + 变更回调 + 主动缓存失效 |

### 1.3 技术栈

- **语言**: TypeScript 5.5+（ESM，target ES2022）
- **编排引擎**: `@langchain/langgraph` 0.2 + `@langchain/core` 0.3
- **LLM 适配**: `@langchain/openai` 0.3（ChatOpenAI，兼容国产 LLM）
- **MCP**: `@modelcontextprotocol/sdk` 1.0
- **校验**: `zod` 3.23
- **测试**: `vitest` 2.0

---

## 2. 整体架构

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│                     Runner（运行入口）                         │
│         stream_response / run_sync / resume_sync             │
├─────────────────────────────────────────────────────────────┤
│                  Graph（LangGraph 状态图）                     │
│   perception → memory_query → agent ⇄ tools → response       │
│                    ↓                          ↓               │
│               feedback → memory_update → END                  │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│ Adapters │ Subgraph │  Nodes   │  State   │   Factory        │
├──────────┴──────────┴──────────┴──────────┴─────────────────┤
│                    Core（组件注册中心）                        │
│          ComponentRegistry · 11 类基础接口                    │
├────────┬────────┬──────────┬──────────┬────────┬────────────┤
│ Tools  │Memory  │Perception│Reasoning │  MCP   │  Skills     │
├────────┴────────┴──────────┴──────────┴────────┴────────────┤
│           Feedback · Evolution · Observability               │
├─────────────────────────────────────────────────────────────┤
│              Orchestration · Config                          │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 图结构（核心流程）

**基础模式**（HITL 关闭、多 Agent 关闭）：

```
START → perception → [routeAfterPerception]
                          ├─ memory_query → agent → [routeAfterAgent]
                          │                                    ├─ tools → tool_processor → agent (ReAct 循环)
                          │                                    └─ response → feedback → memory_update → END
                          └─ response → feedback → memory_update → END (熔断)
```

**多 Agent 模式**（`orchestration.multi_agent.enabled=true`）：

```
START → perception → [routeAfterPerception]
                          ├─ memory_query → [routeAfterMemoryQuery]
                          │                    ├─ supervisor → [routeFromSupervisor] (Send × N)
                          │                    │                ├─ subagent_run → consensus → response
                          │                    └─ agent (多 Agent 关闭时)
                          └─ response (熔断)
```

**HITL 模式**（`tools.human_in_loop.enabled=true`）：在 `agent → tools` 之间插入 `human_review` 节点，敏感工具调用触发 `interrupt` 暂停。

---

## 3. 目录结构

```
modu-agent/
├── package.json              # 包定义与依赖
├── tsconfig.json             # TypeScript 配置（baseUrl: src, paths: @/*）
├── tsconfig.build.json       # 构建配置（排除 tests）
├── vitest.config.ts          # 测试配置（含 .js→.ts 解析插件）
├── src/
│   ├── index.ts              # 顶层统一导出（12 个子模块）
│   ├── core/                 # 组件注册中心 + 11 类基础接口
│   │   ├── index.ts
│   │   ├── registry.ts
│   │   └── interfaces/       # action/feedback/memory/perception/reasoning/skill
│   ├── config/               # RuntimeConfig + schemas
│   ├── graph/                # LangGraph 状态图编排（核心）
│   │   ├── state.ts          # ModuAgentState + Annotation
│   │   ├── nodes.ts          # 图节点函数与路由函数
│   │   ├── graph.ts          # buildModuGraph + ModuGraph wrapper
│   │   ├── factory.ts        # create_agent 配置化工厂
│   │   ├── runner.ts         # 运行入口（stream/sync/resume）
│   │   ├── adapters/         # LLM/Tool/Store/EventBridge/MCP/Retry 适配器
│   │   └── subgraph/         # 多 Agent 协作子图（Supervisor + Subagent + Consensus）
│   ├── tools/                # 内置工具（Calculator/Search/CodeExecutor 等）
│   ├── memory/               # 短期记忆 + 长期记忆（Chroma）
│   ├── perception/           # 感知管道 + 融合 + text/vision/audio/security
│   ├── reasoning/            # LLM 推理器（DeepSeek/GLM/GPT/Qwen）+ 符号推理
│   ├── mcp/                  # MCP Client/Transport/Discovery/Lifecycle
│   ├── feedback/             # FeedbackLoop/QualityMonitor/EvolutionSignal
│   ├── evolution/            # Orchestrator/ParameterTune/ComponentSwap/Rollback
│   ├── observability/        # OTel tracing + Prometheus metrics + 结构化日志
│   ├── orchestration/        # EventBus/AG-UI/SSE/Consensus/Delegation
│   └── skills/               # SkillAdapter/SkillLoader/PromptAggregator
└── tests/                    # vitest 测试（对应 src 各模块）
```

---

## 4. 模块详解

### 4.1 core — 组件注册中心与基础接口

**职责**: 定义所有组件的抽象接口，提供全局组件注册中心，支持运行时热替换。

#### ComponentRegistry

[src/core/registry.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/registry.ts) — 单例注册中心，管理 **11 类组件**：

| 组件类型 | 注册方法 | 说明 |
|---------|---------|------|
| reasoning_engine | `registerReasoningEngine` | 推理引擎（首个注册自动成为活跃引擎） |
| reasoning_strategy | `registerReasoningStrategy` | 推理策略 |
| action_executor | `registerActionExecutor` | 行动执行器 |
| tool | `registerTool` | 工具（按 `tool.name()` 索引） |
| memory | `registerMemory` | 记忆实例 |
| storage_adapter | `registerStorageAdapter` | 存储适配器 |
| perception | `registerPerception` | 感知器 |
| sensor | `registerSensor` | 传感器 |
| feedback_loop | `registerFeedbackLoop` | 反馈循环 |
| evolution_signal | `registerEvolutionSignal` | 进化信号 |
| skill | `registerSkill` | Skill（注册时自动注册其内含工具） |

关键方法：
- `swapComponent(category, name, component)` — 热替换组件，供进化策略使用
- `registerSkill(skill)` — 注册 Skill 并自动注册其工具（经 `SkillToolWrapper` 包装实现执行隔离）
- `getActiveReasoningEngine()` — 返回显式指定的活跃引擎，回退首个注册引擎

全局单例管理：`getRegistry()` / `resetRegistry()` / `overrideRegistry()`（测试隔离）

#### 基础接口（6 个）

| 接口 | 文件 | 核心方法 |
|------|------|---------|
| `BaseTool` | [interfaces/action.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/action.ts) | `name()` / `description()` / `parametersSchema()` / `invoke()` + HITL 钩子 `requiresApproval()` / `onApprovalRejected()` |
| `BaseActionExecutor` | 同上 | `execute(actionName, params, context)` / `listActions()` |
| `BaseReasoningEngine` | [interfaces/reasoning.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/reasoning.ts) | `reason()` → `[content, usage, tool_calls]` / `stream()` AsyncGenerator |
| `BaseReasoningStrategy` | 同上 | `selectEngine(context)` / `shouldFallback(error)` |
| `BaseMemory` | [interfaces/memory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/memory.ts) | `query(userId, contextWindow, requiredFields)` / `update()` |
| `BaseStorageAdapter` | 同上 | `adapterType()` / `load(key)` / `save(key, data)` |
| `BasePerception` | [interfaces/perception.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/perception.ts) | `perceive(inputType, rawContent, language, sensitivityLevel)` |
| `BaseSensor` | 同上 | `sensorType()` / `capture(context)` |
| `BaseFeedbackLoop` | [interfaces/feedback.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/feedback.ts) | `evaluate(output, context)` / `shouldEvolve(metrics, threshold)` |
| `BaseEvolutionSignal` | 同上 | `signalType()` / `generate(source, metrics, context)` |
| `BaseSkill` | [interfaces/skill.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/skill.ts) | `name()` / `description()` / `version()` / `tools()` / `systemPromptFragment()` / `isAvailable()` |

**SkillToolWrapper 工厂注入**: 为避免 ESM 循环依赖，`skills/adapter` 模块加载时通过 `setSkillToolWrapperFactory()` 注入工厂，注册中心调用工厂包装工具；未注册时退化为原始工具。

---

### 4.2 config — 运行时配置与数据校验

**职责**: 提供线程安全的运行时配置（支持热更新 + 变更回调）与数据校验 schema。

#### RuntimeConfig

[src/config/runtime-config.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts)

- 基于 `EventEmitter` 实现变更回调（替代 Python 的回调列表）
- 支持 dot-path 读写：`get('llm.temperature', 0.7)` / `update('llm.temperature', 0.5)`
- `updateMany(updates)` — 批量原子更新，返回旧值
- `registerChangeCallback(callback)` — 注册变更监听，返回注销函数
- `fromFile(filePath)` / `fromEnv()` — 从 JSON 文件或环境变量构建
- 全局单例：`getConfig()` / `resetConfig()` / `overrideConfig()`

#### DEFAULT_CONFIG 关键配置项

```
llm:        default_provider=deepseek, temperature=0.7, max_reasoning_iterations=3
memory:     checkpointer_type=memory, store_type=chroma
tools:      default_timeout_ms=1800000, human_in_loop.enabled=false
perception: sensitivity_threshold=5, security.enable_guard=true
feedback:   evolution_threshold=0.6, enable_evolution=true
mcp:        enabled=false
skills:     enabled=false
orchestration.multi_agent: enabled=false, consensus_strategy=majority_vote
observability: tracing.enabled=false, metrics.enabled=false
```

#### Schemas

[src/config/schemas.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/config/schemas.ts) — 数据校验类（对应 Python dataclass）：
- `PerceptionInputSchema` / `PerceptionOutputSchema`
- `MemoryQuerySchema` / `MemoryUpdateSchema`
- `ToolCallSchema` / `ToolResultSchema`
- `LLMCallSchema` / `LLMResultSchema`
- `FeedbackSignalSchema`
- `ValueError` — 校验异常

---

### 4.3 graph — LangGraph 状态图编排

**职责**: 系统的核心编排层，将主流程构建为 LangGraph `StateGraph`。

#### State（状态定义）

[src/graph/state.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/state.ts)

`ModuAgentState` 接口 + `ModuAgentStateAnnotation`（Annotation.Root）定义图状态，包含：

| 字段类别 | 字段 |
|---------|------|
| 会话标识 | `user_id` / `session_id` / `trace_id` |
| 消息 | `messages`（LangGraph 内置 reducer 自动追加） |
| 感知 | `perception_result` / `cleaned_text` / `sensitivity_level` / `confidence` / `injection_detected` / `pii_detected` |
| 记忆 | `history` / `knowledge` |
| 工具 | `tool_results`（追加 reducer） |
| 反馈进化 | `evaluation` / `should_evolve` / `evolution_action` |
| HITL | `pending_tool_calls` / `approval_status` |
| 多 Agent | `subtasks` / `subtask_results`（`mergeSubtaskResults` reducer） / `consensus_result` |

`makeInitialState(userId, sessionId, traceId, inputData)` 构建图初始状态。

#### Nodes（节点函数）

[src/graph/nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts)

| 节点/函数 | 说明 |
|-----------|------|
| `perceptionNode` | 感知节点，调用 `runPerceptionPipelineAsync` 并行执行感知器链 |
| `memoryQueryNode` / `makeMemoryQueryNode(store)` | 记忆查询节点（有 Store 时查询长期记忆） |
| `makeAgentNode(boundLlm, systemPrompt)` | Agent 节点，注入系统提示/感知上下文/长期知识，低置信度时用保守温度 |
| `makeToolResultProcessor()` | 工具结果处理节点，提取 ToolMessage 为 `tool_results` |
| `responseNode` | 最终响应节点，提取 AIMessage 内容与 usage |
| `makeFeedbackNode(orchestrator)` | 反馈评估节点，调用 `orchestrator.evaluateAndEvolve()` |
| `makeMemoryUpdateNode(store)` | 记忆更新节点，将对话历史写入 Store |
| `makeHumanReviewNode()` | HITL 审批节点，敏感工具触发 `interrupt` |
| `makeSubagentNode(boundLlm)` | 子 Agent 节点，处理单个子任务 |
| `makeConsensusNode(strategy, judgeLlm)` | 共识聚合节点 |

路由函数：
- `routeAfterPerception` — 敏感度熔断 / 注入检测 / PII 阻断 → END
- `routeAfterAgent` — 有 tool_calls → tools，否则 → END
- `routeAfterHumanReview` — 拒绝 → response，通过 → tools
- `routeAfterMemoryQuery` — 多 Agent → supervisor，否则 → agent

#### Graph（图构建）

[src/graph/graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts)

`buildModuGraph(tools, llm, checkpointer, store, systemPrompt, recursionLimit, orchestrator, hitlEnabled, multiAgentEnabled, judgeLlm)` — 构建并编译 StateGraph。

- `recursionLimit` 默认 = `max_reasoning_iterations * 2 + 7`，HITL/多 Agent 各加预算
- `ModuGraph` 包装类 — 通过 Proxy 透明委托 `CompiledStateGraph` 的所有方法，同时显式持有 `orchestrator` 引用（替代 monkey-patch）

#### Factory（配置化工厂）

[src/graph/factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts)

`create_agent(config?, runtimeConfig?, systemPrompt?)` — **异步**，根据配置创建 ModuGraph 实例：

1. Skills 动态加载（gated by `skills.enabled`）
2. `build_chat_model()` 构建 LLM（支持 `configurable.llm_provider` 覆盖）
3. MCP 工具发现（gated by `mcp.enabled`）
4. `build_langchain_tools()` 构建工具列表
5. `llm.bindTools(tools)` + `apply_llm_retry()` 重试
6. `build_checkpointer()` + `build_store()` 构建持久化
7. `SkillPromptAggregator.aggregate()` 聚合 Skill 提示
8. `EvolutionOrchestrator` 进化编排器（gated by `feedback.enable_evolution`）
9. `buildModuGraph()` 编译图

辅助函数：
- `build_checkpointer(type)` — memory / sqlite / none
- `build_store(type)` — chroma / in_memory / none
- `_build_judge_llm()` — LLM-as-Judge 评估器（rule 模式返回 null）
- `_discover_and_register_mcp_tools()` — 从 MCP Server 发现并注册工具

#### Runner（运行入口）

[src/graph/runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts)

| 函数 | 说明 |
|------|------|
| `get_runner(engine?)` | 获取 ModuGraph 实例（缓存 + 配置 hash 检测 + 回调主动失效） |
| `stream_response(graph, userId, sessionId, inputData, traceId?)` | 流式调用，`AsyncGenerator` 产出事件 |
| `run_sync(graph, userId, sessionId, inputData, traceId?)` | 非流式调用，返回完整响应 |
| `resume_sync(graph, sessionId, approved, feedback)` | HITL 恢复（`Command({ resume })`） |
| `resume_stream(...)` | HITL 恢复（流式） |
| `get_interrupt_state(graph, sessionId)` | 查询 interrupt 暂停状态 |
| `reset_runner_cache()` | 重置缓存（测试隔离） |

**配置热更新传导**: `_ensureConfigCallbackRegistered()` 注册回调，`llm.*` / `tools.*` / `memory.*` 等配置变更时主动调用 `reset_runner_cache()`，下次 `get_runner()` 重建图。

#### Adapters（适配器层）

[src/graph/adapters/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/index.ts)

| 适配器 | 职责 |
|--------|------|
| `build_chat_model` | 构建 LangChain `ChatOpenAI`（GLM/DeepSeek/GPT/Qwen 均兼容 OpenAI 协议） |
| `build_langchain_tools` / `wrap_modu_tool` | ModuAgent `BaseTool` → LangChain `StructuredTool`（JSON Schema → Zod） |
| `ChromaStore` / `InMemoryStoreAdapter` | LangGraph `BaseStore` 实现 |
| `LangGraphEventBridge` | LangGraph stream 事件 → EventBus（保留订阅者不受重构影响） |
| `MCPToolAdapter` | MCP 工具 → ModuAgent `BaseTool` |
| `with_tool_retry` / `apply_llm_retry` | 指数退避重试（仅瞬时网络异常） |

**Provider 环境变量映射**:
- glm: `MODU_GLM_API_KEY` / `MODU_GLM_BASE_URL` / `MODU_GLM_MODEL`（默认 glm-4-flash）
- deepseek: `MODU_DEEPSEEK_API_KEY`（默认 deepseek-chat）
- gpt: `OPENAI_API_KEY`（默认 gpt-4o-mini）
- qwen: `MODU_QWEN_API_KEY`（默认 qwen-plus）

#### Subgraph（多 Agent 协作子图）

[src/graph/subgraph/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/index.ts)

| 组件 | 说明 |
|------|------|
| `SubAgentStateAnnotation` | 子 Agent 隔离状态（避免污染主 `messages`） |
| `build_subagent_subgraph` | 构建独立编译子图（mini ReAct 循环） |
| `decompose_task` | 任务拆分（按 task_types 为每类创建子任务，上限 `max_subagents`） |
| `make_supervisor_node` | Supervisor 节点（任务拆分 + Send API 并行分发） |
| `route_from_supervisor` | 通过 `Send("subagent_run", { current_subtask })` 并行分发 |

---

### 4.4 tools — 内置工具集

**职责**: 提供开箱即用的工具实现，均继承 `BaseTool`。

[src/tools/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/index.ts)

| 工具 | 文件 | 说明 |
|------|------|------|
| `CalculatorTool` | [calculator.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/calculator.ts) | 数学表达式计算（白名单字符 + 安全求值） |
| `SearchTool` | [search.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/search.ts) | 搜索引擎（默认 DuckDuckGo，可选 Tavily） |
| `SyncActionExecutor` | [synchronous-executor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/synchronous-executor.ts) | 同步行动执行器（通过 Registry 查找工具并调用） |
| `CodeExecutorTool` | [code-executor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/code-executor.ts) | 代码执行（白名单沙箱 + 子进程隔离，`requiresApproval()=true`） |
| `DateTimeTool` | [datetime-tool.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/datetime-tool.ts) | 日期时间工具 |
| `FileOpsTool` | [file-ops.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/file-ops.ts) | 文件操作工具 |
| `HttpRequestTool` | [http-request.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/http-request.ts) | HTTP 请求工具 |
| `SqlQueryTool` | [sql-query.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/sql-query.ts) | SQL 查询工具 |

> 注：`index.ts` 仅导出前 3 个核心工具，其余工具文件可按需直接导入或通过 Registry 注册。

---

### 4.5 memory — 记忆层

**职责**: 短期记忆与长期记忆实现。

[src/memory/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/index.ts)

| 实现 | 说明 |
|------|------|
| `InMemoryShortTermMemory` | [short-term-memory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/short-term-memory.ts) — 纯内存短期记忆，支持 `maxTurns` / `ttlSeconds` 淘汰，解析 context_window（如 `last_5_turns`） |
| `ChromaLongTermMemory` | [chroma.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/chroma.ts) — Chroma 向量存储长期记忆 |

**LangGraph 集成**: 短期记忆由 LangGraph `Checkpointer`（MemorySaver/SqliteSaver）按 `thread_id`（= session_id）自动持久化整个 State；长期记忆由 `BaseStore`（`ChromaStore` / `InMemoryStoreAdapter`）管理。

---

### 4.6 perception — 感知层

**职责**: 输入路由 + 感知器链 + 多路融合 + 安全守卫。

[src/perception/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/index.ts)

#### 核心组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `runPerceptionPipeline` / `runPerceptionPipelineAsync` | [pipeline.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/pipeline.ts) | 感知管线入口：路由配置获取感知器链 → 依次执行 → 多路融合。异步版并行执行独立感知器 |
| `PerceptionFusion` | [fusion.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/fusion.ts) | 多路融合（`weighted_average` / `max_confidence` / `voting`） |

#### 子模块

| 子模块 | 说明 |
|--------|------|
| `text/` | `RuleBasedParser`（规则解析）+ `LLMParser`（深度语义解析） |
| `vision/` | `Camera`（传感器）+ `ImageProcessor`（图像处理） |
| `audio/` | `ASRProcessor`（语音识别） |
| `security/` | `Guard`（安全守卫：注入检测 / PII 检测 / 敏感度评估） |

#### 公共工具函数

- `buildPerceptionEventMetadata(perceptionResult, inputType)` — 构建标准化事件 metadata（所有值为字符串）
- `extractPerceptionContext(perceptionResult)` — 提取需注入 LLM context 的语义字段

---

### 4.7 reasoning — 推理层

**职责**: LLM 推理引擎实现（直接调用 OpenAI 兼容 API）。

[src/reasoning/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/index.ts)

#### 类层次

```
BaseReasoningEngine (abstract)
  └── BaseLLMReasoner (base-llm.ts)  ← 使用原生 fetch 调用 /chat/completions
        ├── DeepSeekLLMReasoner
        ├── GLMLLMReasoner
        ├── GPTLLMReasoner
        └── QwenLLMReasoner
```

`BaseLLMReasoner`（[base-llm.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/base-llm.ts)）：
- 构造参数：`apiKey` / `baseUrl` / `defaultModel` / `timeout` / `systemPrompt`
- `reason(prompt, context, ...args)` → `[content, usage, tool_calls]`
- `stream(prompt, context)` → `AsyncGenerator<string>`
- temperature 优先级：显式 kwargs > RuntimeConfig > 0.7

#### 符号推理

`symbolic/rule-engine.ts` — 基于规则的符号推理引擎。

> **注意**: LangGraph 图中实际使用的是 `graph/adapters/llm-adapter.ts` 的 `build_chat_model()` 构建 LangChain `ChatOpenAI`（原生 function calling），而非 `reasoning/` 下的 `BaseLLMReasoner`。后者保留以支持双轨运行。

---

### 4.8 mcp — MCP 协议集成

**职责**: 接入外部 MCP Server 获取远程工具。

[src/mcp/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/index.ts)

| 组件 | 文件 | 说明 |
|------|------|------|
| `MCPClient` | [client.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/client.ts) | 多连接管理（一个实例管理多个 Server 连接），全局单例 `getMcpClient()` |
| `MCPSession` | 同上 | 单个 Server 会话封装（维护工具缓存和连接状态） |
| `Transport` / `StdioTransport` / `SSETransport` | [transport.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/transport.ts) | 传输层抽象 |
| `ToolDiscovery` / `ToolInfo` | [discovery.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/discovery.ts) | 工具发现 |
| `ServerLifecycleManager` | [lifecycle.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/lifecycle.ts) | 生命周期管理（自动重连） |
| `MCPError` 体系 | [errors.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/errors.ts) | `MCPConnectionError` / `MCPTimeoutError` / `MCPToolNotFoundError` / `MCPProtocolError` |

**典型用法**:
```typescript
const client = getMcpClient()
await client.start(config)           // 连接所有配置的 Server
const tools = await client.listAllTools()  // 发现所有工具
await client.callTool('github__search_repos', { query: '...' })
await client.stop()
```

---

### 4.9 feedback — 反馈循环

**职责**: 评估响应质量，产生进化信号。

[src/feedback/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/index.ts)

| 组件 | 说明 |
|------|------|
| `FeedbackLoop` | [loop-controller.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/loop-controller.ts) — 反馈循环控制器，评估维度：相关性/完整性/准确性/工具效用。累积指标达 `minSampleSize` 后判断是否触发进化 |
| `QualityMonitor` | [quality-monitor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/quality-monitor.ts) — 质量监控（支持 rule / llm / hybrid 模式，`evaluateAsync()`） |
| `EvolutionSignal` / `EvolutionSignalCollector` | [evolution-signal.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/evolution-signal.ts) — 进化信号与收集器 |
| `AccuracyMetrics` | [metrics/accuracy.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/metrics/accuracy.ts) — 准确性指标 |
| `EfficiencyMetrics` | [metrics/efficiency.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/metrics/efficiency.ts) — 效率指标 |

---

### 4.10 evolution — 进化策略

**职责**: 协调反馈评估与进化策略，实现 Agent 自我优化。

[src/evolution/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/index.ts)

| 组件 | 说明 |
|------|------|
| `EvolutionOrchestrator` | [evolution-orchestrator.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/evolution-orchestrator.ts) — 进化编排器，`evaluateAndEvolve(output, context, sessionId)` 返回 `{evaluation, should_evolve, evolution_action}`。被 `graph/factory.ts` 和 `graph/nodes.ts` 引用 |
| `ParameterTuneStrategy` | [parameter-tune.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/parameter-tune.ts) — 参数调优（低准确性→降 temperature，高迭代→降 max_iterations）。**返回 `config_overrides` 而非直接修改全局 config**，由调用方注入 `RunnableConfig.configurable` |
| `ComponentSwapStrategy` | [component-swap.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/component-swap.ts) — 组件热替换（调用 `registry.swapComponent()`） |
| `RollbackMechanism` | [rollback-mechanism.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/rollback-mechanism.ts) — 回滚机制（基于质量记录） |
| `VersionedComponentStore` | [versioned-store.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/versioned-store.ts) — 版本化组件存储 |

**进化机制映射**:
- 组件热替换 → 重新编译图（`create_agent(config=...)`）
- 参数调优 → `RunnableConfig.configurable` 动态注入（per-session 覆盖）
- 回滚 → LangGraph 检查点 `get_state_history()` + `update_state()`

---

### 4.11 observability — 可观测性

**职责**: 提供 OpenTelemetry tracing、Prometheus metrics、结构化日志能力。

[src/observability/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/index.ts)

| 组件 | 说明 |
|------|------|
| `OtelSpanManager` / `get_span_manager()` | [tracing.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/tracing.ts) — span 管理，返回 `SpanHandle`（支持 `using` 语法 `[Symbol.dispose]`）。tracing 未启用时退化为 `NoopSpanHandle` |
| `MetricsRegistry` / `get_metrics_registry()` | [metrics.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/metrics.ts) — Prometheus 指标（`record_request(status, latency)`） |
| `JsonFormatter` / `configure_structured_logging()` | [logging-config.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/logging-config.ts) — 结构化日志 |
| `inject_trace_context` / `extract_trace_context` | [trace-context.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/trace-context.ts) — 分布式追踪上下文注入/提取 |
| `configure_otlp_exporter` / `start_prometheus_server` | [exporters.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/exporters.ts) — OTLP 导出器 + Prometheus HTTP 端点 |

---

### 4.12 orchestration — 编排层

**职责**: 事件总线、通信协议、流式输出、多 Agent 协作模式。

[src/orchestration/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/index.ts)

#### 通信模块 (`communication/`)

| 组件 | 说明 |
|------|------|
| `EventBus` / `get_event_bus()` | [message-bus.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/message-bus.ts) — 事件总线，支持 domain/action/priority 过滤订阅。`PersistentEventLog` 持久化事件日志（带轮转） |
| `AgentEvent` + 枚举 | [protocol.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/protocol.ts) — 标准事件（`EventDomain`: perception/reasoning/memory/action/feedback/tool/nlp/vision；`EventAction`: query/analyze/execute/invoke/generate/stream/consensus_*/human_review_*；`ErrorCode`） |
| `AGUIStreamAdapter` / `AGUIStateMachine` | [agui-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/agui-adapter.ts) — AG-UI 协议适配 |
| `SSEEncoder` / `StreamPublisher` | [streaming.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/streaming.ts) — SSE 流式输出 |

#### 协作模式 (`patterns/`)

| 组件 | 说明 |
|------|------|
| `ConsensusPattern` / `ConsensusStrategy` | [consensus.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/consensus.ts) — 共识模式。策略：`MajorityVoteStrategy` / `WeightedAggregateStrategy` / `LLMJudgeStrategy`。`create_consensus_strategy(name, judgeLlm, taskDesc)` 工厂 |
| `DelegationPattern` | [delegation.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/delegation.ts) — 委托模式 |

#### 其他

- `SensorManager`（[sensor-manager.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/sensor-manager.ts)）— 传感器管理

---

### 4.13 skills — Skills 子系统

**职责**: 可插拔 Skill 单元，运行时对图透明（最终降解为 N 个工具 + 一段 system prompt 片段）。

[src/skills/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/index.ts)

| 组件 | 说明 |
|------|------|
| `SkillAdapter` | [adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/adapter.ts) — 把 `BaseSkill` 降解为工具名列表 + 提示片段（含 examples） |
| `SkillToolWrapper` | 同上 — 执行隔离包装，捕获 Skill 工具内部异常，返回标准化错误结构，避免 Skill 缺陷外泄到图 |
| `SkillLoader` | [loader.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/loader.ts) — 动态加载器。目录扫描（`<base>/<skill_name>/skill.{js,ts}`）+ 配置驱动（`skills.active` 白名单）。每个 Skill 导入失败均被隔离 |
| `SkillPromptAggregator` | [prompt-aggregator.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/prompt-aggregator.ts) — 合并多 Skill 提示片段 |
| `MathSkill` | [math-skill.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/math-skill.ts) — 示例 Skill |

**设计要点**: Skill 注册即工具就位（`registerSkill` 自动注册内含工具），graph / nodes / ToolNode / ReAct 循环均无需感知 Skill 存在。gated by `skills.enabled`（默认关闭，零侵入）。

---

## 5. 依赖关系

### 5.1 外部依赖

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@langchain/core` | ^0.3.0 | LangChain 核心（messages / tools / runnables） |
| `@langchain/langgraph` | ^0.2.0 | LangGraph 状态图编排引擎 |
| `@langchain/openai` | ^0.3.0 | ChatOpenAI（兼容国产 LLM） |
| `@modelcontextprotocol/sdk` | ^1.0.0 | MCP 协议 SDK |
| `zod` | ^3.23.0 | Schema 校验（DynamicStructuredTool） |

### 5.2 Peer Dependencies

- `@langchain/core` / `@langchain/langgraph` — 由宿主应用提供，避免版本冲突

### 5.3 开发依赖

- `typescript` ^5.5.0 / `vitest` ^2.0.0

### 5.4 模块间依赖（核心路径）

```
runner.ts → factory.ts → graph.ts → nodes.ts → state.ts
                │              │
                ├→ adapters/ (llm-adapter, tool-adapter, store-adapter, event-bridge, mcp-tool-adapter, retry)
                ├→ subgraph/ (supervisor, builder, states)
                ├→ core/registry.ts (ComponentRegistry)
                ├→ config/runtime-config.ts (RuntimeConfig)
                ├→ evolution/evolution-orchestrator.ts
                │      ├→ feedback/ (loop-controller, quality-monitor, evolution-signal)
                │      └→ evolution/parameter-tune.ts
                ├→ skills/ (loader, prompt-aggregator)
                └→ mcp/client.ts
nodes.ts → perception/pipeline.ts → perception/fusion.ts
        → orchestration/communication/ (message-bus, protocol)
        → orchestration/patterns/consensus.ts
```

### 5.5 可选依赖（动态导入）

- `@langchain/langgraph-checkpoint-sqlite` — SQLite 检查点（`build_checkpointer('sqlite')`）

---

## 6. 项目运行方式

### 6.1 构建

```bash
npm run build
# 或
pnpm build
```

执行 `tsc -p tsconfig.build.json`，输出到 `dist/`（含 declaration / sourceMap）。

### 6.2 测试

```bash
npm test
# 或
pnpm test
```

执行 `vitest run`，测试文件位于 `tests/` 目录，使用 `@/` 别名引用 `src/`。`vitest.config.ts` 内置 `.js → .ts` 解析插件，无需预先构建即可直接测试源码。

### 6.3 作为依赖使用

```typescript
import { create_agent, run_sync, stream_response, get_runner } from '@pioneering/modu-agent'

// 1. 获取 Agent 实例（缓存 + 配置热更新）
const graph = await get_runner()

// 2. 非流式调用
const result = await run_sync(graph, 'user1', 'session1', {
  input_type: 'text',
  prompt: '你好',
})
// => { status: 'success', data: { response, tool_results, trace_id } }

// 3. 流式调用
for await (const event of stream_response(graph, 'user1', 'session1', {
  input_type: 'text',
  prompt: '讲个故事',
})) {
  console.log(event)
}

// 4. 运行时覆盖配置
const graph2 = await create_agent({
  configurable: { llm_provider: 'deepseek', temperature: 0.5 }
})
```

### 6.4 环境变量配置

```bash
# LLM Provider（四选一，对应 default_provider）
MODU_LLM_PROVIDER=deepseek              # 或 glm / gpt / qwen
MODU_LLM_TEMPERATURE=0.7

# API Keys（按 provider 提供）
MODU_DEEPSEEK_API_KEY=sk-xxx
MODU_GLM_API_KEY=xxx
OPENAI_API_KEY=sk-xxx
MODU_QWEN_API_KEY=sk-xxx

# 可选：自定义 Base URL / Model
MODU_DEEPSEEK_BASE_URL=https://api.deepseek.com
MODU_DEEPSEEK_MODEL=deepseek-chat

# 配置文件路径（可选，覆盖默认配置）
MODU_CONFIG_PATH=/path/to/config.json

# Memory 策略
MODU_MEMORY_STRATEGY=cache
```

### 6.5 包导出（exports 字段）

```json
{
  ".": "./dist/index.js",           // 完整导出
  "./core": "./dist/core/index.js",
  "./graph": "./dist/graph/index.js",
  "./mcp": "./dist/mcp/index.js",
  "./skills": "./dist/skills/index.js"
}
```

---

## 7. 核心数据流

### 7.1 一次请求的完整生命周期

```
用户输入 (input_data: { input_type, prompt, ... })
    │
    ▼
[runner.run_sync / stream_response]
    │  _validateInputData() — PerceptionInputSchema 校验
    │  _loadPrevConfigOverrides() — 从 checkpointer 读取上次 config_overrides
    │  makeInitialState() — 构建初始状态
    ▼
[LangGraph astream]
    │
    ├─→ perception 节点
    │     runPerceptionPipelineAsync() → 融合结果
    │     提取 cleaned_text / sensitivity_level / injection_detected
    │
    ├─→ routeAfterPerception
    │     敏感度熔断 / 注入检测 / PII 阻断 → END
    │
    ├─→ memory_query 节点
    │     store.search([userId, 'knowledge'], { query: cleanedText })
    │
    ├─→ [routeAfterMemoryQuery] → supervisor (多 Agent) 或 agent
    │
    ├─→ agent 节点 (ReAct 循环起点)
    │     注入 systemPrompt + perception context + knowledge
    │     低置信度 → 保守温度
    │     boundLlm.invoke(messages) → AIMessage (含 tool_calls)
    │
    ├─→ routeAfterAgent
    │     有 tool_calls → [human_review →] tools → tool_processor → agent (循环)
    │     无 tool_calls → response
    │
    ├─→ response 节点
    │     提取 AIMessage.content + usage_metadata
    │
    ├─→ feedback 节点 (有 orchestrator 时)
    │     orchestrator.evaluateAndEvolve(output, context, sessionId)
    │     → { evaluation, should_evolve, evolution_action }
    │     → config_overrides 保存到 state（供下次请求注入）
    │
    └─→ memory_update 节点
          store.put([userId, 'history'], key, { content, session_id, ... })
          → END
```

### 7.2 EventBridge 事件映射

LangGraph stream 事件经 `LangGraphEventBridge` 桥接到 EventBus：

| LangGraph 节点 | AgentEvent 域 | 动作 |
|---------------|--------------|------|
| perception | PERCEPTION | ANALYZE |
| memory_query | MEMORY | QUERY |
| agent | REASONING | GENERATE |
| tools | TOOL | INVOKE / EXECUTE |

SSE 细粒度事件：`thinking` / `tool_call_start` / `tool_call_end` / `tool_result` / `response`

### 7.3 进化闭环

```
response 节点输出
    │
    ▼
feedback 节点 → EvolutionOrchestrator.evaluateAndEvolve()
    │
    ├─→ FeedbackLoop.evaluate() → QualityMonitor.evaluateAsync()
    │     (rule / llm / hybrid 模式)
    │
    ├─→ shouldEvolve(metrics, threshold)
    │
    └─→ ParameterTuneStrategy.analyzeAndAdjust(signals)
          → config_overrides (不修改全局 config)
          → 保存到 state.config_overrides
          → 下次请求 _loadPrevConfigOverrides() 读取并注入
```

---

## 8. 设计约定与关键决策

### 8.1 ESM 与 .js 扩展名

源码中所有相对导入使用 `.js` 扩展名（如 `import { X } from './foo.js'`），这是 ESM 规范要求。`vitest.config.ts` 内置 `tsJsResolution` 插件将 `.js` 解析为 `.ts` 源文件，测试无需预先构建。

### 8.2 全局单例模式

`ComponentRegistry` / `RuntimeConfig` / `MCPClient` / `EventBus` / `MetricsRegistry` / `SpanManager` 均采用全局单例 + `get` / `reset` / `override`（测试隔离）三件套模式。

### 8.3 异步优先

- `create_agent()` 为 async（MCP 工具发现 `listAllTools` 是异步的）
- `get_runner()` 为 async
- 感知管线提供 `runPerceptionPipelineAsync`（并行执行独立感知器）
- `QualityMonitor.evaluateAsync()` 支持 LLM-as-Judge

### 8.4 配置热更新传导

两级机制互补：
- **回调主动传导**: `_ensureConfigCallbackRegistered()` 注册回调，`llm.*` / `tools.*` 等配置变更时立即 `reset_runner_cache()`
- **hash 惰性重建**: `get_runner()` 每次计算配置 hash，变更时重建图（兜底机制）

### 8.5 进化策略的 per-session 隔离

`ParameterTuneStrategy` **不直接修改全局 RuntimeConfig**，而是返回 `config_overrides`，由 `feedback` 节点保存到 `state.config_overrides`，下次请求通过 `_loadPrevConfigOverrides()` 从 checkpointer 读取并注入 `RunnableConfig.configurable`。实现 per-session 参数调优隔离。

### 8.6 ModuGraph 包装器（非 monkey-patch）

`ModuGraph` 通过 `Proxy` 透明委托 `CompiledStateGraph` 的所有方法（astream / ainvoke / checkpointer / recursionLimit），同时以普通实例属性持有 `orchestrator`，替代在第三方对象上 monkey-patch `graph.orchestrator` 的做法。

### 8.7 Skill 对图透明

Skill 最终降解为 `(N 个 BaseTool) + (一段 system prompt 片段)`，graph / nodes / ToolNode / ReAct 循环均无需感知 Skill 存在。注册时工具经 `SkillToolWrapper` 包装实现执行隔离。

### 8.8 安全策略

- **感知层**: 敏感度熔断 / 注入检测 / PII 阻断（可配 `block_on_*`）
- **工具层**: `CodeExecutorTool` 白名单沙箱 + 子进程隔离 + `requiresApproval()=true`
- **HITL**: 敏感工具执行前 `interrupt` 暂停，等待 `Command({ resume: { approved, feedback } })` 恢复

### 8.9 与 Python 版的主要差异

| 方面 | Python | TypeScript |
|------|--------|-----------|
| 并发 | `threading.Lock` | Node 单线程无需锁 |
| 配置回调 | 回调列表 | `EventEmitter` |
| LLM 连接 | `httpx.Client` 连接池 | 原生 `fetch`（undici 自动管理 keep-alive） |
| 上下文管理器 | `@contextmanager` | `[Symbol.dispose]` + `using` 语法 |
| `create_agent` | 同步 | async（MCP 工具发现异步） |
| dataclass 校验 | `__post_init__` | 构造函数校验 |

---

> 本文档基于源码静态分析生成，对应 `@pioneering/modu-agent` v0.1.0。如需了解具体实现细节，请点击各文件链接查看源码。
