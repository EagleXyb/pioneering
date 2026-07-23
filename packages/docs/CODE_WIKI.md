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
9. [优化建议](#9-优化建议)

---

## 1. 项目概览

### 1.1 项目定位

`@pioneering/modu-agent` 是一个模块化、可进化的 AI Agent 框架，核心理念是**用 LangGraph 状态图编排替代手写"上帝类"**，将原本 1047 行的 `Coordinator` 主流程拆解为独立的图节点函数。

### 1.2 核心特性

| 特性 | 说明 |
|------|------|
| **LangGraph 编排** | 基于 `StateGraph` 的节点化流程，支持 ReAct 循环、条件路由、递归限制 |
| **三种执行模式（互斥）** | 默认 ReAct / 多 Agent 协作（Supervisor + Send API）/ Plan-and-Execute（Planner + Dispatcher） |
| **多 LLM 支持** | DeepSeek / GLM / GPT / Qwen，统一 OpenAI 兼容协议，原生 function calling |
| **感知层** | 文本/图像/音频多模态输入，预处理管道 + 深度语义解析 + 安全守卫 |
| **反馈进化闭环** | 响应质量评估 → 进化信号 → 参数调优 / 组件热替换 / 回滚 |
| **可观测性** | OpenTelemetry tracing + Prometheus metrics + 结构化日志 |
| **MCP 集成** | 接入外部 MCP Server 获取远程工具（Stdio / SSE 传输） |
| **多 Agent 协作** | Supervisor 任务拆分 + Send API 并行分发 + 共识聚合 |
| **Human-in-the-loop** | 敏感工具执行前 `interrupt` 暂停，等待人工审批后恢复 |
| **Skills 子系统** | 可插拔 Skill 单元，注册即工具就位，运行时对图透明 |
| **配置热更新** | `RuntimeConfig` 支持 dot-path 读写 + 变更回调 + 主动缓存失效 |
| **AG-UI 协议** | 20 种事件类型 + 状态机适配，支持 LangGraph 事件流到 AG-UI SSE 的双向转换 |

### 1.3 技术栈

- **语言**: TypeScript 5.5+（ESM，target ES2022，`moduleResolution: Bundler`）
- **编排引擎**: `@langchain/langgraph` 0.2 + `@langchain/core` 0.3
- **LLM 适配**: `@langchain/openai` 0.3（ChatOpenAI，兼容国产 LLM）
- **MCP**: `@modelcontextprotocol/sdk` 1.0
- **校验**: `zod` 3.23
- **测试**: `vitest` 2.0
- **可选依赖（动态导入）**: `@opentelemetry/*` / `prom-client` / `better-sqlite3` / `chromadb`

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
│ Adapters │ Subgraph │   Nodes  │  State   │  Plan-Execute    │
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

`memory_query` 节点之后通过 `routeAfterMemoryQuery` 进行**四路分流**，三种执行模式互斥（`multi_agent` 优先级最高，`plan_execute` 次之，默认 ReAct 兜底）。

**默认 ReAct 模式**（HITL 关闭、多 Agent 关闭、Plan-Execute 关闭）：

```
START → perception → [routeAfterPerception]
                          ├─ memory_query → agent → [routeAfterAgent]
                          │                                    ├─ tools → tool_processor → agent (ReAct 循环)
                          │                                    └─ finalize_response → feedback → memory_update → END
                          └─ finalize_response → feedback → memory_update → END (熔断)
```

**多 Agent 模式**（`orchestration.multi_agent.enabled=true`）：

```
START → perception → [routeAfterPerception]
                          ├─ memory_query → [routeAfterMemoryQuery]
                          │                    ├─ supervisor → [route_from_supervisor] (Send × N)
                          │                    │                ├─ subagent_run → consensus → finalize_response
                          │                    └─ (其他模式分支)
                          └─ finalize_response (熔断)
```

**Plan-and-Execute 模式**（`plan_execute.enabled=true` 或 per-request `configurable.plan_execute_enabled=true`）：

```
START → perception → [routeAfterPerception]
                          ├─ memory_query → [routeAfterMemoryQuery]
                          │                    ├─ planner → [routeAfterPlan]
                          │                    │              ├─ step_dispatch → [stepDispatch]
                          │                    │              │                ├─ agent → [routeAfterAgent]
                          │                    │              │                │              ├─ step_finalize → step_dispatch (推进游标)
                          │                    │              │                │              └─ tools → tool_processor → agent
                          │                    │              │                ├─ planner (重规划)
                          │                    │              │                └─ finalize_response (全部完成/重规划耗尽)
                          │                    │              └─ finalize_response (空 plan 降级直答)
                          │                    └─ (其他模式分支)
                          └─ finalize_response (熔断)
```

**HITL 模式**（`tools.human_in_loop.enabled=true`）：在 `agent → tools` 之间插入 `human_review` 节点，敏感工具调用触发 `interrupt` 暂停，等待 `Command({ resume: { approved, feedback } })` 恢复。

---

## 3. 目录结构

```
modu-agent/
├── package.json              # 包定义与依赖
├── tsconfig.json             # TypeScript 配置（baseUrl: src, paths: @/*）
├── tsconfig.build.json       # 构建配置（排除 tests）
├── vitest.config.ts          # 测试配置（含 .js→.ts 解析插件 + @/ 别名）
├── src/
│   ├── index.ts              # 顶层统一导出（13 个子模块）
│   ├── core/                 # 组件注册中心 + 11 类基础接口
│   │   ├── index.ts          # 导出 17 个符号
│   │   ├── registry.ts       # ComponentRegistry 单例
│   │   └── interfaces/       # action/feedback/memory/perception/reasoning/skill
│   ├── config/               # RuntimeConfig + schemas（9 个 Schema + ValueError）
│   ├── graph/                # LangGraph 状态图编排（核心）
│   │   ├── state.ts          # ModuAgentState + Annotation（含 Plan-Execute 字段）
│   │   ├── nodes.ts          # 21 个图节点函数与路由函数
│   │   ├── graph.ts          # buildModuGraph + ModuGraph wrapper（Proxy 委托）
│   │   ├── factory.ts        # create_agent 异步配置化工厂
│   │   ├── runner.ts         # 运行入口（stream/sync/resume + 缓存 + 热更新）
│   │   ├── adapters/         # LLM/Tool/Store/EventBridge/MCP/Retry 适配器
│   │   ├── subgraph/         # 多 Agent 协作子图（Supervisor + Subagent）
│   │   └── plan-execute/     # Plan-and-Execute 子系统（P4，planner/dispatcher/context）
│   ├── tools/                # 内置工具（8 个，4 个 requiresApproval=true）
│   ├── memory/               # 短期记忆 + 长期记忆（Chroma）
│   ├── perception/           # 感知管道 + 融合 + text/vision/audio/security
│   ├── reasoning/            # LLM 推理器（DeepSeek/GLM/GPT/Qwen）+ symbolic（空实现）
│   ├── mcp/                  # MCP Client/Transport/Discovery/Lifecycle（15 个导出）
│   ├── feedback/             # FeedbackLoop/QualityMonitor/EvolutionSignal/Metrics
│   ├── evolution/            # Orchestrator/ParameterTune/ComponentSwap/Rollback/VersionedStore
│   ├── observability/        # OTel tracing + Prometheus metrics + 结构化日志
│   ├── orchestration/        # EventBus/AG-UI/SSE/Consensus/Delegation/SensorManager
│   └── skills/               # SkillAdapter/SkillToolWrapper/SkillLoader/PromptAggregator
└── tests/                    # vitest 测试（对应 src 各模块）
```

---

## 4. 模块详解

### 4.1 core — 组件注册中心与基础接口

**职责**: 定义所有组件的抽象接口，提供全局组件注册中心，支持运行时热替换。

[index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/index.ts) 导出 **17 个符号**：11 个接口抽象基类 + `ComponentRegistry` + `getRegistry` / `resetRegistry` / `overrideRegistry` + `setSkillToolWrapperFactory`。

#### ComponentRegistry

[registry.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts) — 单例注册中心，管理 **11 类组件**（每类一个 `Map<string, T>`）：

| 组件类别 | 注册方法 | 查询方法 |
|---------|---------|---------|
| reasoning_engine | `registerReasoningEngine(name, engine)` | `getReasoningEngine(name)` / `getActiveReasoningEngine()` |
| reasoning_strategy | `registerReasoningStrategy(name, strategy)` | `getReasoningStrategy(name)` |
| action_executor | `registerActionExecutor(name, executor)` | `getActionExecutor(name)` |
| tool | `registerTool(tool)`（按 `tool.name()` 索引） | `getTool(name)` / `listTools()` |
| memory | `registerMemory(name, memory)` | `getMemory(name)` |
| storage_adapter | `registerStorageAdapter(name, adapter)` | `getStorageAdapter(name)` |
| perception | `registerPerception(name, perception)` | `getPerception(name)` |
| sensor | `registerSensor(name, sensor)` | `getSensor(name)` |
| feedback_loop | `registerFeedbackLoop(name, loop)` | `getFeedbackLoop(name)` |
| evolution_signal | `registerEvolutionSignal(name, signal)` | `getEvolutionSignal(name)` |
| skill | `registerSkill(skill)`（按 `skill.name()` 索引） | `getSkill(name)` / `listSkills()` / `unregisterSkill(name)` |

关键方法：
- `registerReasoningEngine(name, engine)` — 首个注册自动成为活跃引擎（P2-8：`_activeReasoningEngineName` 显式追踪）
- `setActiveReasoningEngine(name)` — 显式指定活跃引擎（不依赖 Map 插入顺序）
- `getActiveReasoningEngine()` — 返回 `_activeReasoningEngineName` 指向引擎，回退首个注册引擎，无则 null
- `registerSkill(skill)` — `isAvailable()=false` 时跳过；否则注册 Skill 并经 `SkillToolWrapper` 包装其内含工具（工具名冲突时跳过该工具，包装异常时退回原始工具）
- `swapComponent(category, name, component)` — 热替换组件（供 `RollbackMechanism.rollbackToVersion` 使用），未知 category 返回 false
- `listAll()` — 返回 11 类组件名称快照

全局单例管理：`getRegistry(override?)` / `resetRegistry()` / `overrideRegistry(registry)`（返回 `{ restore }`，支持 `using` 语法，测试隔离）

#### SkillToolWrapper 工厂注入

为避免 ESM 循环依赖，[skills/adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/skills/adapter.ts) 模块加载时通过 `setSkillToolWrapperFactory((tool, skillName) => new SkillToolWrapper(tool, skillName))` 注入工厂。`registerSkill` 调用工厂包装工具；未注册时退化为原始工具；包装异常时 catch 退回原始工具（三级降级）。

#### 基础接口（11 个抽象基类）

| 接口 | 文件 | 核心方法 |
|------|------|---------|
| `BaseTool` | [interfaces/action.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/action.ts) | `name()` / `description()` / `parametersSchema()` / `invoke(params, context)` + HITL 钩子 `requiresApproval()`（默认 false）/ `onApprovalRejected(params)`（默认返回 `TOOL_APPROVAL_REJECTED` 标准错误） |
| `BaseActionExecutor` | 同上 | `execute(actionName, params, context)` / `listActions()` |
| `BaseReasoningEngine` | [interfaces/reasoning.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/reasoning.ts) | `reason(prompt, context, ...args)` → `[content, usage, tool_calls]` / `stream(prompt, context)` AsyncGenerator |
| `BaseReasoningStrategy` | 同上 | `name()` / `selectEngine(context)` / `shouldFallback(error)` |
| `BaseMemory` | [interfaces/memory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/memory.ts) | `query(userId, contextWindow, requiredFields)` / `update(userId, newData, metadata)` |
| `BaseStorageAdapter` | 同上 | `adapterType()` / `load(key)` / `save(key, data)` |
| `BasePerception` | [interfaces/perception.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/perception.ts) | `perceive(inputType, rawContent, language?, sensitivityLevel?)` |
| `BaseSensor` | 同上 | `sensorType()` / `capture(context)` |
| `BaseFeedbackLoop` | [interfaces/feedback.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/feedback.ts) | `evaluate(output, context)` / `shouldEvolve(metrics, threshold)` |
| `BaseEvolutionSignal` | 同上 | `signalType()` / `generate(source, metrics, context)` |
| `BaseSkill` | [interfaces/skill.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/skill.ts) | 身份：`name()` / `description()` / `version()`；元数据：`tags()` / `examples()` / `preconditions()` / `requiredScopes()`；封装：`tools()` / `systemPromptFragment()`；生命周期：`isAvailable()` / `setup()` / `teardown()` |

---

### 4.2 config — 运行时配置与数据校验

**职责**: 提供线程安全的运行时配置（支持热更新 + 变更回调）与数据校验 schema。

#### RuntimeConfig

[runtime-config.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts)

- 基于 Node.js `EventEmitter` 实现变更回调（替代 Python 的回调列表），Node 单线程无需锁
- 构造函数深拷贝 `DEFAULT_CONFIG`（`structuredClone`）避免多实例共享嵌套 dict
- 支持 dot-path 读写：`get('llm.temperature', 0.7)` / `set('llm.temperature', 0.5)`（set 是 update 别名）/ `update(keyPath, value)`（返回 oldValue）
- `updateMany(updates)` — 批量原子更新，先写入所有 keys 收集 oldValues，再统一广播回调
- `registerChangeCallback(callback)` — 注册变更监听（回调异常被 try/catch 隔离），返回注销函数
- `asDict()` — 返回深拷贝（`structuredClone`）防止外部篡改
- `static fromFile(filePath)` / `static fromEnv()` — 从 JSON 文件或环境变量构建
- 全局单例：`getConfig(override?)` / `resetConfig()` / `overrideConfig(config)`（返回 `{ restore }`，测试隔离）

`getConfig()` 读取 `process.env.MODU_CONFIG_PATH`：非空走 `fromFile`，否则走 `fromEnv`。

#### DEFAULT_CONFIG 完整结构

```
llm:        default_provider=deepseek, temperature=0.7, max_tokens=512,
            max_reasoning_iterations=3, max_format_retries=2, retry.max_attempts=2
memory:     default_strategy=cache, context_window=last_5_turns,
            checkpointer_type=memory, store_type=chroma, chroma_persist_path=null
orchestration: engine=langgraph
            multi_agent: { enabled=false, max_subagents=5, consensus_strategy=majority_vote,
                          consensus_quorum=2, subgraph_timeout_ms=30000,
                          consensus_failure_as_evolution_signal=true }
plan_execute: { enabled=false, max_steps=10, max_replans=2, planner_temperature=0.2,
                continue_on_failure=false, compact_completed_steps=false,
                step_summary_max_chars=500 }      # P4，与 multi_agent 互斥
tools:      default_timeout_ms=1800000, retry={max_attempts=3, base_delay=0.5, max_delay=5.0}
            human_in_loop: { enabled=false, approval_timeout_seconds=300,
                            auto_reject_on_timeout=true,
                            sensitive_tools=['code_executor','sql_query','file_ops_write'] }
skills:     enabled=false, auto_discover_dirs=[], active=[]
streaming:  chunk_size=4
event_bus:  max_log_size=1000
perception: sensitivity_threshold=5, max_length=2048,
            routing.{text|image|audio}.pipeline=[...],
            fusion: { strategy=weighted_average, weights={text:0.5,image:0.3,audio:0.2} },
            security: { enable_guard=true, block_on_injection=false, block_on_pii=false },
            deep_parsing: { enable=true, enable_intent=true, ... },
            evolution_report_interval=100, enable_context_reduction=true
feedback:   evolution_threshold=0.6, enable_evolution=true, min_sample_size=10,
            quality_monitor_mode=rule, quality_monitor_llm_timeout=10.0,
            quality_monitor_llm_temperature=0.0, quality_monitor_llm_max_tokens=256
observability:
            tracing: { enabled=false, service_name=modu-agent, sampling_rate=0.1 }
            metrics: { enabled=false, prometheus_port=9090, path=/metrics }
            logging: { structured=false, level=INFO }
mcp:        enabled=false, default_timeout=30.0, servers=[]
```

#### Schemas（9 个）

[schemas.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/schemas.ts) — 数据校验类（对应 Python dataclass，构造函数校验，校验失败抛 `ValueError`）：

| Schema | 关键字段 / 校验 |
|--------|----------------|
| `PerceptionInputSchema` | `inputType` ∈ {text,image,audio}；`sensitivityLevel` ∈ [0,5]；`REQUIRED_FIELDS = {input_type, raw_content}`；`toDict()`/`fromDict()` |
| `PerceptionOutputSchema` | 含 P0 语义字段：intent / entities / sentiment / qualityScore / languageMixed / languageDistribution / securityScore |
| `MemoryQuerySchema` | `contextWindow` 须通过 `isValidContextWindow`；`requiredFields` 必须显式声明 |
| `MemoryUpdateSchema` | `mode` ∈ {incremental, overwrite} |
| `ToolCallSchema` | `toolName` 必填；`timeoutMs` 默认 1800000 |
| `ToolResultSchema` | `status` 默认 success；`isSuccess()` 方法 |
| `LLMCallSchema` | `temperature` ∈ [0,2]；`maxTokens` > 0 |
| `LLMResultSchema` | content / model / tokensUsed / finishReason |
| `FeedbackSignalSchema` | source / metricName / value / threshold / triggered |

附加常量与函数：`VALID_CONTEXT_WINDOWS`（白名单 + `last_N_turns` 正则解析）、`isValidContextWindow(value)`、`ValueError`（继承 Error，`name='ValueError'`）

---

### 4.3 graph — LangGraph 状态图编排

**职责**: 系统的核心编排层，将主流程构建为 LangGraph `StateGraph`。

[index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/index.ts) 导出：state（4）/ nodes（21）/ graph（2: `ModuGraph` + `buildModuGraph`）/ factory（5）/ runner（9）+ 子包 `adapters` / `subgraph` / `plan-execute`。

#### State（状态定义）

[state.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/state.ts)

`ModuAgentState` 接口 + `ModuAgentStateAnnotation`（`Annotation.Root`）定义图状态：

| 字段类别 | 字段 |
|---------|------|
| 会话标识 | `user_id` / `session_id` / `trace_id` |
| 消息 | `messages`（`messagesStateReducer` 自动追加） |
| 原始输入 | `input_data` |
| 感知 | `perception_result` / `cleaned_text` / `detected_language` / `sensitivity_level` / `confidence` / `injection_detected` / `pii_detected` |
| 记忆 | `history` / `knowledge` |
| 工具 | `tool_results`（自定义追加 reducer，按 `tool_call_id` 去重） |
| 元数据 | `iteration` |
| 最终响应 | `response` / `error_code` / `error_message` / `usage` |
| 记忆更新状态 | `memory_update_status` / `memory_update_key` / `memory_update_error` |
| 反馈进化 | `evaluation` / `should_evolve` / `evolution_action` |
| per-session 配置覆盖 | `config_overrides` |
| HITL | `pending_tool_calls` / `tool_requires_approval` / `approval_status` / `approval_feedback` |
| 多 Agent | `subtasks` / `subtask_results`（`mergeSubtaskResults` reducer，right wins）/ `consensus_result` / `consensus_failed` / `current_subtask`（transient） |
| Plan-and-Execute（P4） | `plan` / `current_step_index` / `step_results`（空数组清空语义 reducer）/ `replan_count` / `plan_phase` / `current_step`（transient）/ `step_msg_baseline`（transient）/ `plan_delta`（transient，供 SSE） |

reducer 三类：`messagesStateReducer`（messages）、`mergeSubtaskResults`（subtask_results，right wins）、自定义追加 reducer（tool_results / step_results）；其余字段用 `_lw()` 工厂生成的 last-write-wins reducer。

`makeInitialState(userId, sessionId, traceId, inputData)` 构建图初始状态（不读取 checkpointer 中的 config_overrides，那由 runner 层注入）。

#### Nodes（节点函数）

[nodes.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) — 21 个导出符号：

| 节点/函数 | 说明 |
|-----------|------|
| `perceptionNode` | 异步感知节点，调用 `runPerceptionPipelineAsync` 并行执行感知器链 |
| `perceptionNodeSync` | 同步回退版本，使用串行 `runPerceptionPipeline` |
| `memoryQueryNode` | 无 Store 版本，直接返回 `{ knowledge: [] }` |
| `makeMemoryQueryNode(store)` | 带 Store 工厂，`store.search([userId,'knowledge'], {query, limit:5})` |
| `memoryUpdateNode` | 无 Store 版本，返回 `skipped_no_store` |
| `makeMemoryUpdateNode(store)` | 带 Store 工厂；熔断/无消息时跳过；按 HumanMessage/AIMessage/ToolMessage 分类拼接 historyText，`store.put([userId,'history'], key, {...})` |
| `makeAgentNode(boundLlm, systemPrompt, confidenceThreshold=0.5, conservativeTemperature=0.3, planContextInjector=null)` | Agent 节点；注入 systemPrompt + 感知上下文 + 长期知识；P4 planContextInjector 注入当前步骤上下文；`config_overrides.temperature` 优先；低置信度用保守温度 |
| `makeToolResultProcessor()` | 工具结果处理，提取 ToolMessage 为 `tool_results`（按 `tool_call_id` 去重） |
| `responseNode` | 最终响应节点，提取 AIMessage content + usage_metadata |
| `makeFeedbackNode(orchestrator)` | 反馈评估节点，调用 `orchestrator.evaluateAndEvolve()`；从 `evolution_action['adjusted']` 提取 `config_overrides` 保存到 state |
| `makeHumanReviewNode(registry, config)` | HITL 审批节点，敏感工具触发 `interrupt({tool_calls, ...})`；resume payload 解析 `{approved, feedback}`；rejected 时调用每个被拒工具的 `onApprovalRejected` 并 push ToolMessage |
| `makeSubagentNode(boundLlm, systemPrompt)` | 子 Agent 节点，处理单个子任务，仅返回 `subtask_results`（避免并行写冲突） |
| `makeConsensusNode(strategy, judgeLlm, eventBus)` | 共识聚合节点；quorum 校验；未达 quorum 时可发布 FEEDBACK 事件 + 降级取最佳结果 |
| `publishPerceptionEvent` / `publishMemoryEvent` / `publishActionEvent` / `publishToolEvents` | 事件发布辅助函数 |

路由函数：
- `routeAfterPerception` — 敏感度熔断（`sensitivity_level >= threshold`） / 注入检测（`block_on_injection`） / PII 阻断（`block_on_pii`） → END
- `routeAfterAgent` — 有 tool_calls → tools；P4 `plan_phase==='executing'` → step_finalize；否则 → END
- `routeAfterHumanReview` — rejected/error → finalize_response；其他 → tools
- `routeAfterMemoryQuery(state, config?)` — 四路分流：multi_agent → supervisor；`configurable.plan_execute_enabled===true` → planner；`plan_execute.enabled` → planner；否则 → agent（第二参数 `RunnableConfig` 支持 per-request 注入）

#### Graph（图构建）

[graph.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts)

```ts
buildModuGraph(
  tools, llm, checkpointer=null, store=null, systemPrompt=null,
  recursionLimit=null, orchestrator=null, hitlEnabled=null,
  multiAgentEnabled=null, judgeLlm=null,
  planExecuteEnabled=null, rawLlm=null,    // P4 新增
): CompiledStateGraph
```

- 参数为 null 时从 RuntimeConfig 回填；`multiAgentEnabled && planExecuteEnabled` 时强制 `planExecuteEnabled=false`（multi_agent 优先，warning）
- 节点工厂：plan_execute 模式下 agent 注入 `makePlanContextInjector()`；planner 使用 `rawLlm ?? boundLlm`（未绑定工具的原始 LLM）
- 边：`START → perception`；`perception` 条件路由；三种 memory_query 后路由分支（multi_agent / plan_execute / 默认）；HITL 时 `agent → human_review → tools`；`tools → tool_processor → agent`（ReAct 循环）；`finalize_response → feedback(若有) → memory_update → END`

**recursionLimit 计算公式**：
```
baseLimit = max_reasoning_iterations * 2 + 7        // 默认 3*2+7 = 13
if (humanReviewNode)      baseLimit += 2
if (supervisorNode)       baseLimit += 4
if (planExecuteEnabled)   baseLimit += max_steps * (max_iterations * 3 + 2) + (max_replans + 1) * 2 + 2
```

**ModuGraph wrapper 类** — 通过 `Proxy` 透明委托 `CompiledStateGraph` 的所有方法（`astream` / `ainvoke` / `checkpointer` / `recursionLimit` / `getState` 等），同时以普通实例属性持有 `orchestrator` 引用（供 runner 读取 `evolutionCollector`）。`get` / `has` trap 实现：自身属性走 `Reflect.get`，否则委托 `target._compiled[prop]`（函数则 `bind(compiled)`）。

#### Factory（配置化工厂）

[factory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts)

```ts
async create_agent(config?, runtimeConfig?, systemPrompt?): Promise<ModuGraph>
```

异步创建流程（按顺序）：
1. runtimeConfig 兜底（未传入则 `getConfig()`）
2. 解析 `config.configurable`（LLM provider/temperature/max_tokens/model/tools/checkpointer_type/store_type/system_prompt 等）
3. Skills 动态加载（gated by `skills.enabled`）
4. `build_chat_model()` 构建 LLM
5. MCP 工具发现（gated by `mcp.enabled`）
6. `build_langchain_tools()` 构建工具列表
7. `llm.bindTools(tools)` + `apply_llm_retry()`（先绑定工具再应用重试）
8. `build_checkpointer()` + `build_store()`
9. 解析 systemPrompt + SkillPromptAggregator 聚合
10. EvolutionOrchestrator（gated by `feedback.enable_evolution`）+ `_build_judge_llm()`
11. 共识策略 judge LLM 注入
12. `buildModuGraph()` 编译图（传入 `planExecuteEnabled` + `rawLlm`）
13. `new ModuGraph(compiled, orchestrator)` 包装

辅助函数：
- `build_checkpointer(type='memory')` — memory → `MemorySaver`；sqlite → 动态 `import('@langchain/langgraph-checkpoint-sqlite')` 取 `SqliteSaver.fromConnString('checkpoints.db')`，失败降级 MemorySaver；none → null
- `build_store(type='chroma')` — chroma → `new ChromaStore(...)`，失败降级 InMemoryStoreAdapter；in_memory → `new InMemoryStoreAdapter()`；none → null
- `_build_judge_llm(runtimeConfig, configurable)` — 仅 `quality_monitor_mode` 为 llm/hybrid 时构造；provider 优先级：`configurable.llm_provider > feedback.quality_monitor_llm_provider > llm.default_provider`；rule 模式返回 null
- `_discover_and_register_mcp_tools(runtimeConfig)` — 从 MCP Server 发现工具并注册（幂等检查）

#### Runner（运行入口）

[runner.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts)

| 函数 | 说明 |
|------|------|
| `get_runner(engine?)` | 获取 ModuGraph 实例（缓存 + 配置 hash SHA256 检测 + 回调主动失效） |
| `stream_response(graph, userId, sessionId, inputData, traceId?, eventBridge?, extraConfigurable?)` | 流式调用，`AsyncGenerator` 产出事件；`_validateInputData` + `_loadPrevConfigOverrides` + makeInitialState + `_buildConfigWithOverrides` + eventBridge 自动创建 + `_normalizeLangGraphStream` |
| `run_sync(graph, userId, sessionId, inputData, traceId?, eventBridge?)` | 非流式调用，取最后的 values 事件作为 finalState；astream 失败直接报错 `LLM_GENERATION_FAILED`；熔断检测返回 `PERCEPTION_SENSITIVITY_REJECTED` |
| `resume_sync(graph, sessionId, approved, feedback='', traceId?)` | HITL 恢复（`new Command({ resume: resumePayload })`） |
| `resume_stream(graph, sessionId, approved, feedback='', traceId?)` | HITL 恢复（流式，streamMode `['messages','updates','values']`） |
| `get_interrupt_state(graph, sessionId)` | 查询 interrupt 暂停状态（检查 `state.next` 是否含 'human_review'） |
| `reset_runner_cache()` | 重置缓存（测试隔离） |
| `process_request_compat(runner, ...)` / `stream_request_compat(runner, ...)` | 统一调用接口，检测 `runner.stream`/`runner.invoke` 委托 |

**配置热更新传导**：`_ensureConfigCallbackRegistered()` 注册回调（首次调用），`_onConfigChange(keyPath, ...)` 检查 keyPath 是否以 `_GRAPH_REBUILD_PREFIXES`（`['llm.', 'tools.', 'memory.', 'orchestration.', 'streaming.', 'plan_execute.']`）任一前缀开头，命中则 `reset_runner_cache()`。与 hash 惰性重建互补。

#### Adapters（适配器层）

[adapters/index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/index.ts) 导出 7 项：`LangGraphEventBridge` / `build_chat_model` + `build_conservative_chat_model` / `MCPToolAdapter` / `with_tool_retry` + `apply_llm_retry` / `ChromaStore` + `InMemoryStoreAdapter` / `wrap_modu_tool` + `build_langchain_tools`。

| 适配器 | 文件 | 职责 |
|--------|------|------|
| `build_chat_model(provider?, config?, temperature?, maxTokens?, model?)` | [llm-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/llm-adapter.ts) | 构建 `ChatOpenAI`（`streaming: true`），支持 4 provider，未知降级 glm |
| `build_conservative_chat_model(provider, config)` | 同上 | 调用 `build_chat_model(provider, config, 0.3)`（低温度） |
| `wrap_modu_tool(moduTool, config?)` / `build_langchain_tools(registry?, toolNames?, config?)` | [tool-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-adapter.ts) | ModuAgent `BaseTool` → LangChain `StructuredTool`（`_schema_to_zod` 将 JSON Schema 转 Zod；非 required 字段 `.optional()`） |
| `ChromaStore` / `InMemoryStoreAdapter` | [store-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/store-adapter.ts) | 均继承 LangGraph `BaseStore`；ChromaStore 包装 `ChromaLongTermMemory` |
| `LangGraphEventBridge` | [event-bridge.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/event-bridge.ts) | LangGraph stream 事件 → EventBus + SSE 细粒度事件 |
| `MCPToolAdapter` | [mcp-tool-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/mcp-tool-adapter.ts) | MCP 工具 → ModuAgent `BaseTool`（`name()` 返回 `qualifiedName`，`description()` 带 `[MCP:server]` 前缀） |
| `with_tool_retry(func, toolName, config)` / `apply_llm_retry(llm, config)` | [retry.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/retry.ts) | 指数退避重试（`isRetryableException` 判定 HTTP 429/5xx、Node 错误码、timeout 等） |

**Provider 环境变量映射**（`_PROVIDER_CONFIG`）：

| provider | api_key env | base_url env | model env | default_base_url | default_model |
|----------|-------------|--------------|-----------|------------------|--------------|
| glm | `MODU_GLM_API_KEY` | `MODU_GLM_BASE_URL` | `MODU_GLM_MODEL` | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| deepseek | `MODU_DEEPSEEK_API_KEY` | `MODU_DEEPSEEK_BASE_URL` | `MODU_DEEPSEEK_MODEL` | `https://api.deepseek.com` | `deepseek-chat` |
| gpt | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | `OPENAI_MODEL` | `https://api.openai.com/v1` | `gpt-4o-mini` |
| qwen | `MODU_QWEN_API_KEY` | `MODU_QWEN_BASE_URL` | `MODU_QWEN_MODEL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |

apiKey 解析优先级：`process.env[pcfg.api_key] || process.env.LLM_API_KEY || ''`

**LangGraphEventBridge 节点 → 事件映射**：
- `_NODE_DOMAIN_MAP`：`perception→PERCEPTION`、`memory_query→MEMORY`、`agent→REASONING`、`tools→TOOL`、`planner→PLAN`、`step_finalize→PLAN`
- `_NODE_ACTION_MAP`：`perception→ANALYZE`、`memory_query→QUERY`、`agent→GENERATE`、`tools→INVOKE`、`planner→PLAN_CREATED`、`step_finalize→STEP_COMPLETED`
- SSE 细粒度事件类型：`['thinking', 'tool_call_start', 'tool_call_end', 'tool_result', 'response', 'plan_created', 'step_update']`
- messages stream 每 10 个 token 发布一次 `REASONING.STREAM`（phase: 'progress', token_count）

#### Subgraph（多 Agent 协作子图）

[subgraph/](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/index.ts)

| 组件 | 说明 |
|------|------|
| `SubAgentStateAnnotation` | 子 Agent 隔离状态（task_id / task_type / task_input / messages / task_output / trace_id / parent_session_id / error），避免污染主 `messages` |
| `build_subagent_subgraph(llm, tools?, systemPrompt?, taskType='default', recursionLimit=10)` | 构建独立编译子图（mini ReAct 循环：sub_agent → sub_tools → sub_agent → sub_finalize → END） |
| `decompose_task(state, maxSubagents=5, taskTypes?)` | 任务拆分（按 task_types 为每类创建子任务，上限 max_subagents，task_id 形如 `${taskType}_${uuid前8位}`） |
| `make_supervisor_node(maxSubagents?, taskTypes?)` | Supervisor 节点（任务拆分 + 重置 subtask_results） |
| `route_from_supervisor(state)` | 通过 `Send('subagent_run', { current_subtask: task })` 并行分发；`current_subtask` 为 transient 字段（节点不返回，避免并行写冲突） |

任务类型模板（`_SYSTEM_PROMPT_TEMPLATES`）：research / coding / review / default。

#### Plan-Execute（Plan-and-Execute 子系统，P4 新增）

[plan-execute/](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/index.ts) 导出：types（`PlanStep` / `PlanStepSchema` / `PlanSchema` / `StepResult` / `PlanStateDelta`）、prompts（`buildToolCatalogText` / `buildPlannerSystemPrompt` / `buildReplanContext`）、planner（`makePlannerNode` / `routeAfterPlan`）、dispatcher（`makeStepDispatchNode` / `stepDispatch` / `makeStepFinalizeNode`）、context（`makePlanContextInjector`）。

**核心类型**：
- `PlanStep`：`{ step_id, title, description, depends_on?, status: 'pending'|'running'|'done'|'failed'|'skipped' }`
- `PlanSchema`（zod）：`{ goal: string, steps: PlanStepSchema[].min(1).max(20) }`
- `StepResult`：`{ step_id, status: 'done'|'failed', output, tool_refs, error?, started_at?, finished_at? }`
- `PlanStateDelta`（SSE STATE_DELTA payload）：`{ phase: 'plan'|'execute'|'finalize', plan?, step_update? }`

**Planner 节点**（`makePlannerNode(llm, registry)`）：
1. 读取 `max_steps` / `planner_temperature` 配置
2. `buildToolCatalogText(registry.listTools())` 构建工具清单
3. 重规划时 `buildReplanContext(failed_steps)`
4. `buildPlannerSystemPrompt(toolCatalog, maxSteps, replanContext)` —— 要求 LLM 输出 STRICT JSON
5. 容错策略：最多调用 LLM 2 次（首次用 planner_temperature，失败降温至 0 重试）；`_parsePlan` 先直接 JSON.parse 失败后定位 `{`...`}` 子串解析；`PlanSchema.safeParse` 校验；规整化 step_id 为 `step_${i+1}`
6. 成功返回 `{ plan, plan_phase: 'executing', current_step_index: 0, step_results: [], replan_count, plan_delta: { phase:'plan', plan } }`；失败返回空 plan 触发 routeAfterPlan 降级直答

**Dispatcher 节点**（`makeStepDispatchNode()`）：
- 定位 `plan[current_step_index]`，标记 running，记录 `step_msg_baseline`
- 返回 `{ plan: updatedPlan, current_step, step_msg_baseline, plan_delta: { phase:'execute', step_update: {id, status:'running', started_at} } }`

**stepDispatch 路由**（条件边，返回 targets key）：
- `plan.length===0 || idx>=plan.length` → `'response'`（全部完成）
- 本代际最后一步 failed 时：`continue_on_failure=false` 且 `replan_count<max_replans` → `'planner'`（重规划）；否则 → `'response'`
- 其他 → `'agent'`（执行当前步）

**Step Finalize 节点**（`makeStepFinalizeNode()`）：
- 以 `step_msg_baseline` 为基线截取本步新增消息
- 失败判定：`!lastAiContent && toolRefs.length===0`
- 返回 `{ plan: updatedPlan, step_results: [stepResult], current_step_index: idx+1, current_step: {}, plan_phase, plan_delta: { phase:'execute', step_update:{id, status, result, finished_at} } }`

**Context Injector**（`makePlanContextInjector()`）：
- 检查 `plan_phase==='executing'` 且 `current_step`/`plan` 非空
- 构造 `Current step ${idx+1}/${plan.length} (${stepId}): ${title}\n${description}`
- 前序步骤摘要（仅本代际，按 `replan_count` 过滤，maxChars 截断）

**与 multi_agent 互斥**：`buildModuGraph` 中 `multiAgentEnabled && planExecuteEnabled` 时强制 `planExecuteEnabled=false`（multi_agent 优先）。原因：两者都消费 `memory_query → 推理入口` 边。

**运行时路由优先级**（`routeAfterMemoryQuery`）：multi_agent.enabled → supervisor；`configurable.plan_execute_enabled===true` → planner（per-request）；`plan_execute.enabled` → planner（全局）；否则 → agent。

---

### 4.4 tools — 内置工具集

**职责**: 提供开箱即用的工具实现，均继承 `BaseTool`（`SyncActionExecutor` 例外，继承 `BaseActionExecutor`）。

[index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/index.ts) **仅导出 3 个核心符号**：`SyncActionExecutor` / `CalculatorTool` / `SearchTool`。其余 5 个工具需直接 import 文件路径。

| 工具 | 文件 | name() | requiresApproval | 说明 |
|------|------|--------|------------------|------|
| `CalculatorTool` | [calculator.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/calculator.ts) | `calculator` | false | 数学表达式求值；三层防御：正则白名单 `^[0-9+\-*/\s().]+$` + 字符集合二次校验 + 手写递归下降解析器 `_MathParser`（非 eval）；除零抛 `'division by zero'` |
| `SearchTool` | [search.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/search.ts) | `search_engine` | false | 搜索引擎；优先 Tavily（`TAVILY_API_KEY`），失败 fallback DuckDuckGo |
| `SyncActionExecutor` | [synchronous-executor.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/synchronous-executor.ts) | N/A（继承 BaseActionExecutor） | N/A | 同步行动执行器；`execute(actionName, params, context)` 通过 `registry.getTool` 查找调用；`listActions()` 返回 `Object.keys(registry.listTools())` |
| `CodeExecutorTool` | [code-executor.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/code-executor.ts) | `code_executor` | **true** | Python 代码执行；多层防御：源码白名单（`_FORBIDDEN_NAMES` + `_FORBIDDEN_ATTRS` 正则检测）+ 子进程隔离（`execFileAsync` + `-I` 模式）+ 超时 10s + stdout/stderr 截断 4KB；跨平台 `_resolvePythonCommand`（Windows: python/py/python3） |
| `DateTimeTool` | [datetime-tool.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/datetime-tool.ts) | `datetime` | false | 日期时间工具（now/format/parse/convert）；`_TIMEZONE_OFFSETS` 表（UTC/GMT/CST/EST/PST/JST/IST/BST/CET/EET）；`_strftime` 支持 `%Y %m %d %H %M %S %A` |
| `FileOpsTool` | [file-ops.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/file-ops.ts) | `file_ops` | **true** | 文件操作（read/write/list/delete）；`_validatePath` 拒绝绝对路径/Windows 盘符/`..` 穿越/symlink 越界；read 截断 256KB |
| `HttpRequestTool` | [http-request.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/http-request.ts) | `http_request` | **true** | HTTP 请求（GET/POST/PUT/DELETE/HEAD/PATCH）；SSRF 防护（`_PRIVATE_CIDRS` 含 127/10/172.16/192.168/169.254/0/100.64 + IPv6 简化检测）；`redirect: 'manual'` 禁用重定向；DNS 解析后检查所有结果；域名白名单 |
| `SqlQueryTool` | [sql-query.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/sql-query.ts) | `sql_query` | **true** | 只读 SQL 查询；`_validateQuery`：必须 SELECT 开头、禁止 DROP/DELETE/INSERT/UPDATE 等关键词、禁止分号多语句、禁止注释 `--`/`/*`、表名白名单；`db.pragma('query_only = ON')` 强制只读；动态 `import('better-sqlite3')` |

4 个高危工具（code_executor / file_ops / http_request / sql_query）均 `requiresApproval()=true` 并实现 `onApprovalRejected(params)` 返回 `TOOL_APPROVAL_REJECTED` 标准错误。

---

### 4.5 memory — 记忆层

**职责**: 短期记忆与长期记忆实现。

[index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/memory/index.ts) 导出：`InMemoryShortTermMemory` / `ChromaLongTermMemory`。

| 实现 | 文件 | 说明 |
|------|------|------|
| `InMemoryShortTermMemory` | [short-term-memory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/memory/short-term-memory.ts) | 纯内存短期记忆；`constructor(maxTurns=5, ttlSeconds=3600)`；`query` 基于 `_timestamp` 过滤超期条目 + `_parseContextWindow` 解析 `last_5_turns`；`update` 淘汰 `entries.length > maxTurns*2`（对话成对保留） |
| `ChromaLongTermMemory` | [chroma.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/memory/chroma.ts) | Chroma 向量存储长期记忆；`constructor(collectionPrefix='modu_memory', topK=5, persistPath?)`；persistPath 解析优先级：显式 > `MODU_CHROMA_IN_MEMORY=1`(内存) > `MODU_CHROMA_PATH` > `./chroma_data`；嵌入三级降级（SentenceTransformer→ONNX→`_simpleHashEmbedding` SHA-256 dim=384）；`setEmbeddingFunction(fn, dim)` 外部注入语义嵌入 |

**LangGraph 集成**：
- **短期记忆**由 LangGraph `Checkpointer`（MemorySaver/SqliteSaver）按 `thread_id`（= session_id）自动持久化整个 State，`InMemoryShortTermMemory` 是独立实现不直接集成
- **长期记忆**由 `BaseStore`（[ChromaStore](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/store-adapter.ts) / `InMemoryStoreAdapter`）管理；`ChromaStore` 包装 `ChromaLongTermMemory`，namespace 映射：`(user_id, "knowledge")` → `user_id` 作为 collection 后缀

---

### 4.6 perception — 感知层

**职责**: 输入路由 + 感知器链 + 多路融合 + 安全守卫。

[index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/index.ts) **仅导出 2 个工具函数**（非 barrel，不重导出 pipeline/fusion/子模块类）：
- `buildPerceptionEventMetadata(perceptionResult, inputType)` — 构建标准化事件 metadata（所有值为字符串）
- `extractPerceptionContext(perceptionResult)` — 提取需注入 LLM context 的语义字段

#### 核心组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `runPerceptionPipeline` / `runPerceptionPipelineAsync` | [pipeline.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/pipeline.ts) | 感知管线入口；`_resolvePipeline` 从 `perception.routing.{inputType}.pipeline` 读取感知器链；串行版依次执行，异步版首个串行 + 后续 `Promise.all` 并行；`_fuseResults` 多路融合 |
| `PerceptionFusion` | [fusion.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/fusion.ts) | `constructor(strategy='weighted_average', weights?)`；默认权重 `{text:0.5, image:0.3, audio:0.2}`；策略：`weighted_average`（加权平均 confidence/quality_score/security_score，取最高 sensitivity_level，合并文本/实体/metadata，`_mergeIntent`/`_mergeSentiment`）/ `max_confidence`（取最高 confidence）/ `voting`（sensitivity_level 多数投票） |

#### 子模块

| 子模块 | 导出 | 说明 |
|--------|------|------|
| `text/` | `TextPreprocessor`（[rule-based.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/text/rule-based.ts)）、`LLMParser` + `LLMAdapter` 接口（[llm-parser.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/text/llm-parser.ts)） | 无 barrel index.ts |
| `vision/` | `CameraSensor` / `TimerSensor` / `MicrophoneSensor`（[camera.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/vision/camera.ts)）、`ImageProcessor`（[image-processor.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/vision/image-processor.ts)） | 无 barrel index.ts |
| `audio/` | `AudioProcessor`（[asr-processor.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/audio/asr-processor.ts)） | 有 index.ts |
| `security/` | `SecurityGuard`（[guard.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/security/guard.ts)） | 有 index.ts |

**TextPreprocessor**（7 步流程）：`_decodeAndTruncate`（UTF-8 + NFKC + 句子边界感知截断）→ `_sanitizeText`（控制字符/零宽/双向控制过滤 + 重复压缩 + 大写检测）→ `_detectLanguageRobust`（扩展 Unicode 区间 + 概率分布）→ `_detectSensitivity`（0-5 级分级，白名单短语优先）→ `SecurityGuard.detectAll` → `_assessQuality` → `_computeConfidence`（加权：lang 0.25 + security 0.30 + quality 0.25 + sensitivity 0.10 + decoding 0.10）。敏感度分级 `SENSITIVITY_LEVELS`：0=safe / 1=notice / 2=sensitive / 3=high_risk / 4=review / 5=block。

**LLMParser**：基于 LLM 的深度文本解析；P1 优先级策略（spaCy→LLM 增强 / SnowNLP→LLM / 仅 LLM）；TS 版降级 `_SPACY_AVAILABLE=false`、`_SNOWNLP_AVAILABLE=false`；`setLlmAdapter` 动态注入避免循环依赖。

**SecurityGuard**：
- `detectInjection(text)` — 14 条正则覆盖中英文越狱攻击；`risk_level` 0-3
- `detectPii(text)` — 5 种类型（phone_cn / id_card_cn / bank_card / email / ipv4），脱敏保留前 3 位 + `***`
- `detectInjectionRisk(text)` — html_tag / sql_keyword / shell_meta 标记
- `computeSecurityScore(...)` — 权重：Injection 40% + PII 25% + 注入风险 20% + 敏感词 15%
- `detectAll(text, sensitivityLevel=0)` / `sanitize(text)`（仅标记不修改）

---

### 4.7 reasoning — 推理层

**职责**: LLM 推理引擎实现（直接调用 OpenAI 兼容 API，基于原生 `fetch`）。

[index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/index.ts) 导出：`BaseLLMReasoner` / `DeepSeekLLMReasoner` / `GLMLLMReasoner` / `GPTLLMReasoner` / `QwenLLMReasoner`（**不导出 symbolic 模块**）。

#### 类层次

```
BaseReasoningEngine (abstract, core/interfaces/reasoning.ts)
  └── BaseLLMReasoner (base-llm.ts)  ← 使用原生 fetch 调用 /chat/completions
        ├── DeepSeekLLMReasoner
        ├── GLMLLMReasoner
        ├── GPTLLMReasoner
        └── QwenLLMReasoner
```

`BaseLLMReasoner`（[base-llm.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/base-llm.ts)）：
- 构造：`constructor(apiKey, baseUrl, defaultModel, timeout=120.0, systemPrompt?)`（baseUrl 末尾 `/` 去除）
- `reason(prompt, context, kwargs={})` → `[content, usage, parsedToolCalls]`；`_buildMessages` 按 system_prompt → memory_context → tool_descriptions → history → user prompt 顺序构造；POST `${baseUrl}/chat/completions`，`stream: false`，`AbortSignal.timeout`
- `stream(prompt, context, kwargs={})` → `AsyncGenerator`（SSE 流式解析 `data: {...}` 行，`[DONE]` 终止）；逐 chunk `yield` 增量内容；`areason`/`astream` 委托 `reason`/`stream`
- `_parseToolCalls(responseJson)` —— 提取 `tool_calls[].function.{name, arguments}`（JSON.parse 容错）
- `close()` 空实现（Node undici 自动管理连接池，对应 Python 关闭 httpx.Client）

#### 子类（仅构造函数解析 env）

| 子类 | 文件 | 默认 baseUrl | 默认 model | 环境变量优先级 |
|------|------|--------------|------------|----------------|
| `DeepSeekLLMReasoner` | [deepseek.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/deepseek.ts) | `https://api.deepseek.com` | `deepseek-chat` | 显式参数 > `MODU_DEEPSEEK_*` > `LLM_*` 通用 > 默认值 |
| `GLMLLMReasoner` | [glm.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/glm.ts) | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` | `MODU_GLM_*` > `LLM_*` |
| `GPTLLMReasoner` | [gpt.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/gpt.ts) | `https://api.openai.com/v1` | `gpt-4o-mini` | `OPENAI_*` > `LLM_*` |
| `QwenLLMReasoner` | [qwen.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/qwen.ts) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | `MODU_QWEN_*` > `LLM_*` |

#### Symbolic 推理（占位）

[symbolic/rule-engine.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/symbolic/rule-engine.ts) —— **空文件**，仅含文件头注释，无任何导出。与 Python 源保持等价（Python 版同样为空）。后续如需符号推理可在该文件补充。`reasoning/index.ts` **不导出 symbolic 模块**。

#### 与 LangGraph 的解耦关系

`reasoning/` 模块**不直接接入** LangGraph 图节点；图内的 LLM 调用由 [graph/adapters/llm-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/llm-adapter.ts) 的 `build_chat_model()` 构建 `ChatOpenAI`（LangChain 抽象，仍走 OpenAI 兼容协议）。`reasoning/` 模块主要供：
- 直接代码层调用（不通过 LangGraph 的场景）
- `perception/text/llm-parser.ts` 的 `LLMParser` 通过 `setLlmAdapter` 注入（解耦）
- 测试与对照基准

---

### 4.8 mcp — MCP 协议集成

**职责**: 接入外部 MCP（Model Context Protocol）Server 获取远程工具，提供 Client 连接管理、传输层抽象、工具发现与生命周期管理。

[index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/mcp/index.ts) 导出 4 组：

| 类别 | 导出 | 说明 |
|------|------|------|
| Client | `MCPClient` / `MCPSession` / `getMcpClient()` / `resetMcpClient()` | `getMcpClient` 单例工厂；`resetMcpClient` 测试隔离 |
| Discovery | `ToolInfo` / `ToolDiscovery` | 工具发现与元数据封装 |
| Transport | `Transport`（abstract）/ `StdioTransport` / `SSETransport` | 传输层抽象，对应 MCP 协议两种传输 |
| Lifecycle | `ServerLifecycleManager` | MCP Server 启停/健康检查 |
| Errors | `MCPError`（基类）/ `MCPConnectionError` / `MCPTimeoutError` / `MCPToolNotFoundError` / `MCPProtocolError` | 错误码 `MCP_000`~`MCP_004` |

#### 关键组件

**MCPClient**（[client.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/mcp/client.ts)）：
- 多 Server 连接管理（`connect(name, config)` / `disconnect(name)` / `disconnectAll()`）
- `MCPSession` 封装单连接（持有 transport + client 实例），提供 `listTools()` / `callTool(name, args)` / `close()`
- 配置驱动：`mcp.servers` 配置项定义 Server 列表

**Transport**（[transport.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/mcp/transport.ts)）：
- `StdioTransport` —— 子进程 stdio 传输（`command` / `args` / `env`），基于 `@modelcontextprotocol/sdk` 的 `StdioClientTransport`
- `SSETransport` —— Server-Sent Events 传输（`url`），基于 `SSEClientTransport`
- 均实现 `connect()` / `close()` 抽象方法

**ToolDiscovery**（[discovery.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/mcp/discovery.ts)）：
- `ToolInfo` —— `{ qualifiedName, name, description, inputSchema, serverName }`
- **qualifiedName 命名约定**：`${serverName}__${toolName}`（双下划线分隔），避免跨 Server 工具名冲突
- `discover(client)` —— 遍历所有已连接 Server，调用 `listTools()` 聚合为 ToolInfo 列表

**ServerLifecycleManager**（[lifecycle.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/mcp/lifecycle.ts)）：
- 启停 Server（按配置顺序启动，反向顺序停止）
- 健康检查（ping）与自动重连

**MCPToolAdapter**（位于 [graph/adapters/mcp-tool-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/mcp-tool-adapter.ts)，归属 graph 模块）：
- 将 MCP `ToolInfo` 转换为 ModuAgent `BaseTool`
- `name()` 返回 `qualifiedName`，`description()` 带 `[MCP:serverName]` 前缀，便于用户/LLM 识别来源
- `execute()` 委托 `MCPSession.callTool()`

#### 工厂集成路径

`create_agent()` 流程中（gated by `mcp.enabled`）：
1. `getMcpClient()` 取单例
2. 按 `mcp.servers` 配置 `connect()` 各 Server
3. `ToolDiscovery.discover(client)` 收集工具
4. `MCPToolAdapter` 包装为 `BaseTool`
5. `registry.registerTool()` 注册（幂等检查）
6. 与内置工具一同 `build_langchain_tools()` 注入 LLM

---

### 4.9 feedback — 反馈循环

**职责**: 响应质量评估 + 进化信号收集 + 多维度量，作为进化闭环的入口。

[index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/feedback/index.ts) 导出：`FeedbackLoop` / `QualityMonitor` / `EvolutionSignal` / `EvolutionSignalCollector` / `AccuracyMetrics` / `EfficiencyMetrics`。

#### 核心组件

**QualityMonitor**（[quality-monitor.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/feedback/quality-monitor.ts)）：
- 三种评估模式（`quality_monitor_mode`）：
  - `rule` —— 基于规则的启发式评估（长度/重复/格式/关键词等），无需 LLM
  - `llm` —— 调用 LLM Judge（使用 `_build_judge_llm` 构造的独立 judge LLM，温度 0）
  - `hybrid` —— rule 优先，rule 置信度低时回退 llm
- 输出 `QualityScore`：`{ overall, accuracy, efficiency, coherence, safety, confidence, reasoning? }`
- `evaluate(response, context, query)` —— 主评估入口

**FeedbackLoop**（[loop-controller.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/feedback/loop-controller.ts)）：
- 编排流程：`评估 → 收集信号 → 触发进化`
- `process(response, context, query)` —— 调用 `QualityMonitor.evaluate` → `EvolutionSignalCollector.collect` → 触发 `EvolutionOrchestrator.evaluateAndEvolve`
- 与 LangGraph 集成：在 `graph/nodes.ts` 的 `finalize_response` 节点后异步执行（不阻塞主流程）

**EvolutionSignal**（[evolution-signal.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/feedback/evolution-signal.ts)）：
- `EvolutionSignal` —— 单次进化信号（`{ type, severity, payload, timestamp, sessionId }`）
- `EvolutionSignalCollector` —— 信号聚合器，按窗口统计信号趋势（滑动窗口）

#### 度量指标

| 指标 | 文件 | 说明 |
|------|------|------|
| `AccuracyMetrics` | [metrics/accuracy.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/feedback/metrics/accuracy.ts) | 准确性度量（事实一致性、答案完整性、工具调用正确性） |
| `EfficiencyMetrics` | [metrics/efficiency.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/feedback/metrics/efficiency.ts) | 效率度量（token 使用、延迟、工具调用次数、重试次数） |

---

### 4.10 evolution — 进化策略

**职责**: 接收 `EvolutionSignal`，执行参数调优 / 组件热替换 / 回滚三类进化动作。是"可进化 Agent"特性的核心。

[index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/evolution/index.ts) 导出：`EvolutionOrchestrator` / `ParameterTuneStrategy` / `ComponentSwapStrategy` / `RollbackMechanism` / `VersionedComponentStore` / `QualityRecord`（type）。

#### EvolutionOrchestrator

[evolution-orchestrator.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/evolution/evolution-orchestrator.ts)：

```ts
async evaluateAndEvolve(signal: EvolutionSignal, context): Promise<EvolutionResult>
```

- **策略注册表**：维护 `Strategy[]`，按优先级排序
- **门控**：`feedback.enable_evolution` 配置项控制是否启用
- **per-session 隔离**：返回 `config_overrides`（写入 `RunnableConfig.configurable`），**不直接修改全局 RuntimeConfig**（P0-2 关键修复，避免跨会话污染）
- **回滚触发**：质量连续下降超阈值时调用 `RollbackMechanism.rollback`

#### 三类策略

| 策略 | 文件 | 输入 → 输出 | 说明 |
|------|------|-------------|------|
| `ParameterTuneStrategy` | [parameter-tune.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/evolution/parameter-tune.ts) | `EvolutionSignal` → `config_overrides`（如 `{ temperature: 0.5, max_tokens: 2000 }`） | 调整 LLM 超参、提示词等运行时参数；返回的 overrides 经 Runner 注入 `RunnableConfig.configurable`，仅影响当前会话 |
| `ComponentSwapStrategy` | [component-swap.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/evolution/component-swap.ts) | `EvolutionSignal` → swap 操作 | 调用 `registry.swapComponent(type, newImpl)` 热替换组件实例；触发 `VersionedComponentStore` 保存旧版本 |
| `RollbackMechanism` | [rollback-mechanism.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/evolution/rollback-mechanism.ts) | `QualityRecord` 趋势 → rollback | 质量退化时从 `VersionedComponentStore` 取上一版本调用 `registry.swapComponent` 回滚；记录 `QualityRecord` |

#### VersionedComponentStore

[versioned-store.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/evolution/versioned-store.ts)：
- 组件版本存储（`save(type, impl, metadata)` / `listVersions(type)` / `getVersion(type, versionId)`）
- 每次热替换前保存当前版本，支持回滚
- 内部维护版本链表（最新 → 最早）

---

### 4.11 observability — 可观测性

**职责**: OpenTelemetry tracing + Prometheus metrics + 结构化日志，三大支柱完整覆盖。所有依赖均为 `optionalDependencies`，通过动态 `import()` 加载，缺失时降级为 no-op。

[index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/observability/index.ts) 导出 5 组：

| 类别 | 导出 | 说明 |
|------|------|------|
| tracing | `OtelSpanManager` / `SpanHandle`（type）/ `get_span_manager()` / `reset_span_manager()` / `is_tracing_enabled()` | OTel Span 管理；`get_span_manager` 单例 |
| metrics | `MetricsRegistry` / `get_metrics_registry()` / `is_metrics_enabled()` / `reset_metrics_registry()` | Prometheus 指标注册 |
| logging | `JsonFormatter` / `LogLevel` / `LogLevelConst` / `LogEntry`（type）/ `configure_structured_logging()` / `get_current_log_level()` / `is_structured_logging_enabled()` / `get_log_level_int()` | 结构化 JSON 日志 |
| trace_context | `TraceContext`（type）/ `inject_trace_context()` / `extract_trace_context()` / `attach_otel_context()` / `detach_otel_context()` | W3C TraceContext 传播 |
| exporters | `configure_otlp_exporter()` / `start_prometheus_server()` / `stop_prometheus_server()` / `reset_exporters()` | OTLP / Prometheus 导出器配置 |

#### OtelSpanManager

[tracing.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/observability/tracing.ts)：
- `startSpan(name, attributes?)` → `SpanHandle`；`SpanHandle.end(attributes?)` 结束
- 实现 `Symbol.dispose`（ES2022 显式资源管理），支持 `using span = mgr.startSpan(...)` 语法
- `withSpan(name, fn, attrs?)` —— 自动开始/结束 span，返回 `fn` 的结果
- 动态 `import('@opentelemetry/api')`；缺失时所有方法 no-op

#### MetricsRegistry

[metrics.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/observability/metrics.ts)：
- Counter / Gauge / Histogram 三种指标类型
- 动态 `import('prom-client')`；缺失时降级为内存计数器（无导出）
- `start_prometheus_server(port)` —— 启动 Prometheus HTTP exporter

#### JsonFormatter

[logging-config.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/observability/logging-config.ts)：
- 结构化 JSON 日志（`{ timestamp, level, logger, message, ...context }`）
- `configure_structured_logging({ level, enabled })` —— 全局配置
- 日志级别：`DEBUG < INFO < WARNING < ERROR < CRITICAL`

---

### 4.12 orchestration — 编排层

**职责**: 多 Agent 通信总线 + AG-UI 协议适配 + SSE 流式编码 + 共识/委派模式 + 传感器管理。是上层应用（Web/API）与 Agent 内部事件的桥梁。

[index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/index.ts) 导出 6 组：

| 类别 | 导出 | 说明 |
|------|------|------|
| 通信总线 | `EventBus` / `PersistentEventLog` / `get_event_bus()` / `reset_event_bus()` / `override_event_bus()` / `EventHandler`（type） | 进程内事件总线 + 持久化日志 |
| 协议 | `AgentEvent` / `EventDomain` / `EventAction` / `EventPriority` / `ErrorCode` / `LLMRequest` / `LLMResponse` / `MemoryQueryRequest` / `MemoryQueryResponse` / `PerceptionInput` / `ToolCallRequest` / `ToolCallResponse` | 事件协议定义 |
| AG-UI | `AGUIStreamAdapter` / `AGUIStateMachine` / `AGUIEventType` / `AGUIEncoder` | AG-UI 协议适配（20 种事件类型） |
| 流式 | `SSEEncoder` / `StreamPublisher` | SSE 流式编码与发布 |
| 模式 | `ConsensusPattern` / `ConsensusStrategy` / `MajorityVoteStrategy` / `WeightedAggregateStrategy` / `LLMJudgeStrategy` / `create_consensus_strategy()` / `DelegationPattern` | 共识与委派协作模式 |
| 传感器 | `SensorManager` | 传感器注册与调度 |

#### EventBus

[communication/message-bus.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/message-bus.ts)：
- 同步发布 / 异步订阅（`publish(event)` / `subscribe(domain, handler)`）
- `PersistentEventLog` —— 持久化事件日志（基于 better-sqlite3 动态加载；缺失降级为内存数组）
- `get_event_bus()` 单例；`override_event_bus(bus)` 测试注入

#### AgentEvent 协议

[communication/protocol.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/protocol.ts)：
- `EventDomain`：`PERCEPTION` / `MEMORY` / `REASONING` / `TOOL` / `PLAN` / `EVOLUTION` / `SYSTEM` / `ORCHESTRATION`
- `EventAction`：`ANALYZE` / `QUERY` / `GENERATE` / `INVOKE` / `PLAN_CREATED` / `STEP_COMPLETED` / `STREAM` / `ERROR` 等
- `ErrorCode`：标准化错误码枚举（如 `LLM_GENERATION_FAILED` / `TOOL_APPROVAL_REJECTED` / `PERCEPTION_SENSITIVITY_REJECTED`）
- `EventPriority`：`LOW` / `NORMAL` / `HIGH` / `CRITICAL`

#### AGUIStreamAdapter

[communication/agui-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/agui-adapter.ts)：
- **20 种 AG-UI 事件类型**（`AGUIEventType` 枚举，[agui-adapter.ts#L16-L37](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/agui-adapter.ts#L16-L37)）：
  - 运行生命周期：`RUN_STARTED` / `RUN_FINISHED` / `RUN_ERROR`
  - 文本消息：`TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` / `TEXT_MESSAGE_CHUNK`
  - 思考（thinking）：`THINKING_START` / `THINKING_END` / `THINKING_TEXT_MESSAGE_START` / `THINKING_TEXT_MESSAGE_CONTENT` / `THINKING_TEXT_MESSAGE_END`
  - 工具调用：`TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` / `TOOL_CALL_CHUNK` / `TOOL_CALL_RESULT`
  - 状态：`STATE_SNAPSHOT` / `STATE_DELTA` / `MESSAGES_SNAPSHOT`
- `AGUIStateMachine`（[agui-adapter.ts#L303](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/agui-adapter.ts#L303)）—— 状态机式事件编排器，封装 `_emit()` 维护当前阶段，按需发出 START/CONTENT/END 序列；提供 `start_run` / `finish_run` / `error` / `thinking` / `text_message` / `tool_call` / `tool_result` / `state_delta` 等方法
- `AGUIStreamAdapter`（[agui-adapter.ts#L531](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/agui-adapter.ts#L531)）—— 将 `EventBus` 的 `AgentEvent` 适配为 AG-UI 事件流

#### SSEEncoder

[communication/streaming.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/streaming.ts)：
- `SSEEncoder` —— 编码为 SSE 格式（`event: xxx\ndata: {...}\n\n`）
- `StreamPublisher` —— SSE 流发布器（管理客户端连接、心跳、断线重连）

#### 协作模式

[patterns/consensus.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/consensus.ts)：
- `ConsensusStrategy`（abstract）/ `MajorityVoteStrategy` / `WeightedAggregateStrategy` / `LLMJudgeStrategy`
- `create_consensus_strategy(type)` —— 工厂方法
- `ConsensusPattern` —— 多 Agent 共识协作封装（多 Agent 并行执行 → 策略聚合 → 单一结果）

[patterns/delegation.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/delegation.ts)：
- `DelegationPattern` —— 任务委派模式（主 Agent 识别专业边界，将子任务委派给专门 Agent）

#### SensorManager

[sensor-manager.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/sensor-manager.ts)：
- 传感器注册中心（`registerSensor` / `unregisterSensor`）
- 周期性调度传感器（如 `CameraSensor` / `TimerSensor`）

---

### 4.13 skills — Skills 子系统

**职责**: 将外部 Skill 模块（用户自定义能力包）动态加载并融合为 Agent 工具与提示词片段。

[index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/skills/index.ts) 导出 4 个符号（3 条 export 语句）：`SkillAdapter` / `SkillToolWrapper` / `SkillLoader` / `SkillPromptAggregator`。

#### SkillAdapter

[adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/skills/adapter.ts)：
- `SkillAdapter` —— Skill 元数据降解：将 Skill 的工具定义转为 ModuAgent `BaseTool`，将 Skill 的提示词片段提取为可注入 system prompt 的文本
- `SkillToolWrapper` —— 工具执行隔离包装器；持有 Skill 上下文，转发 `execute()` 调用并捕获异常转为标准错误

**ESM 循环依赖解决方案**：`skills/` 与 `graph/adapters/tool-adapter.ts` 之间存在循环引用（`wrap_modu_tool` 需要 `SkillToolWrapper`，而 `SkillToolWrapper` 需要 ModuAgent `BaseTool` 类型）。采用**工厂注入**模式：
- `setSkillToolWrapperFactory(factory)` —— 在 `graph/adapters/tool-adapter.ts` 注册工厂函数
- `skills/adapter.ts` 不直接 import `tool-adapter.ts`，而是通过工厂闭包构造 `SkillToolWrapper`
- 该模式保证 `skills/` 模块可独立测试，且加载顺序无关

#### SkillLoader

[loader.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/skills/loader.ts)：
- 目录扫描动态发现（`loadFromDirectory(dir)`）
- 配置驱动加载（`loadFromConfig(config)`）
- 注册到 `ComponentRegistry`（幂等检查）
- 加载失败容错（单 Skill 失败不阻塞其他）

#### SkillPromptAggregator

[prompt-aggregator.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/skills/prompt-aggregator.ts)：
- 合并多 Skill 的提示词片段为统一 system prompt 段
- 去重 + 排序 + 长度截断（防止 prompt 膨胀）
- `create_agent` 流程中调用，聚合结果与 `system_prompt` 拼接

#### 内置 Skill 示例

[math-skill.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/skills/math-skill.ts)：
- `MathSkill` —— 数学能力 Skill 示例，提供数学工具与提示词
- 作为 Skill 开发参考模板

---

## 5. 依赖关系

### 5.1 外部依赖（package.json）

#### dependencies（运行时必需）

| 依赖 | 版本 | 用途 |
|------|------|------|
| `@langchain/core` | `^0.3.0` | LangChain 核心抽象（`BaseMessage` / `StructuredTool` 等） |
| `@langchain/langgraph` | `^0.2.0` | `StateGraph` / `Checkpointer` / `BaseStore` / `Command` / `interrupt` |
| `@langchain/openai` | `^0.3.0` | `ChatOpenAI` 实现（4 provider 共用） |
| `@modelcontextprotocol/sdk` | `^1.0.0` | MCP Client / StdioClientTransport / SSEClientTransport |
| `zod` | `^3.23.0` | Schema 校验（config schemas / PlanSchema / tool 参数） |

#### peerDependencies

- `@langchain/core` / `@langchain/langgraph` —— 由宿主应用提供，避免重复安装

#### optionalDependencies（动态加载，缺失降级）

| 依赖 | 用途 | 降级行为 |
|------|------|----------|
| `@opentelemetry/api` / `@opentelemetry/sdk-trace-base` / `@opentelemetry/resources` / `@opentelemetry/exporter-trace-otlp-*` | OpenTelemetry tracing | 所有 span 操作 no-op |
| `prom-client` | Prometheus metrics | 内存计数器（无导出） |
| `better-sqlite3` | SqliteSaver checkpointer + PersistentEventLog | 降级 MemorySaver / 内存日志 |
| `chromadb` | ChromaLongTermMemory + ChromaStore | 降级 InMemoryStoreAdapter |

#### devDependencies

- `typescript` `^5.5.0` / `vitest` `^2.0.0`

### 5.2 模块依赖图

```
                          ┌────────────────────────┐
                          │   index.ts (顶层导出)   │
                          └──────────┬─────────────┘
                                     │ export *
        ┌────────────┬───────────────┼───────────────┬────────────┐
        ▼            ▼               ▼               ▼            ▼
     core/        config/         graph/          tools/       memory/
   (注册中心)    (热更新)       (LangGraph)      (8 工具)    (短/长记忆)
        ▲            ▲               ▼
        │            │      ┌────────┴────────┐
        │            │      ▼                 ▼
        │            │  adapters/         subgraph/
        │            │  (LLM/Tool/        (Supervisor)
        │            │   Store/Event/
        │            │   MCP/Retry)
        │            │      │
        │            │      ├──→ plan-execute/ (P4)
        │            │      │
        │            │      ▼
        │            │   nodes.ts / graph.ts / factory.ts / runner.ts
        │            │            │
        │            └────────────┤ (RuntimeConfig 注入)
        │                         │
        │   ┌─────────────────────┴──────────────────────┐
        ▼   ▼                                          ▼
   perception/ ──text/vision/audio/security──      reasoning/
   (感知层)                                        (LLM 推理)
        │                                          ▲
        ▼                                          │
     feedback/ ──→ evolution/ ──→ registry.swapComponent
     (反馈)        (进化策略)
        │
        ▼
   observability/ (tracing/metrics/logging)  ←─ 全模块横切
        │
        ▼
   orchestration/ (EventBus/AGUI/SSE/Patterns)
        │
        ▼
     skills/ (SkillAdapter/Loader/Aggregator) ──→ factory.ts 注入
```

### 5.3 关键依赖关系说明

- **graph 模块是核心枢纽**：依赖 `core`（注册中心）、`config`（配置）、`tools`、`memory`、`perception`、`mcp`、`skills`、`evolution`、`orchestration`
- **perception 与 reasoning 解耦**：`reasoning/` 不被 `graph/` 直接依赖（graph 使用 `adapters/llm-adapter.ts`）；`perception/` 通过 `LLMParser.setLlmAdapter` 注入 LLM 适配器，避免循环依赖
- **evolution 仅依赖 core + feedback**：通过 `registry.swapComponent` 间接影响 graph（不直接 import graph）
- **observability 为横切关注点**：所有模块均可选择性调用，但 observability 不反向依赖任何业务模块
- **skills 通过工厂注入与 graph 解耦**：`setSkillToolWrapperFactory` 打破循环

---

## 6. 项目运行方式

### 6.1 安装与构建

```bash
# 安装依赖（在 packages 根目录或 modu-agent 目录）
npm install

# 构建（输出到 dist/，生成 .js + .d.ts + .map）
npm run build
# 等价：tsc -p tsconfig.build.json
```

**tsconfig 关键配置**（[tsconfig.json](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/tsconfig.json)）：
- `target: ES2022` / `module: ESNext` / `moduleResolution: Bundler`
- `baseUrl: ./src`，路径别名 `@/*` → `src/*`
- `declaration: true` / `declarationMap: true` / `sourceMap: true`
- `strict: true` / `esModuleInterop: true`

### 6.2 测试

```bash
npm test
# 等价：vitest run
```

**vitest 配置**（[vitest.config.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/vitest.config.ts)）：
- `environment: 'node'`，`include: ['tests/**/*.test.ts']`
- **`tsJsResolution` 自定义插件**：将 `./x.js` 导入说明符解析为 `./x.ts` 源文件，使 vitest 可直接运行 `src/` 而无需先构建；同时解析 `@/*` 别名

### 6.3 使用示例

#### 基础调用（流式）

```ts
import { create_agent, stream_response } from '@pioneering/modu-agent'

const graph = await create_agent()  // 使用默认 RuntimeConfig

for await (const event of stream_response(
  graph,
  'user-123',                          // user_id
  'session-456',                       // session_id (= thread_id)
  { type: 'text', content: '你好' },    // input_data
  'trace-789',                         // trace_id
)) {
  console.log(event)
}
```

#### 非流式调用

```ts
import { create_agent, run_sync } from '@pioneering/modu-agent'

const graph = await create_agent()
const result = await run_sync(graph, 'user-123', 'session-456', { type: 'text', content: '1+1=?' })
console.log(result.finalState)
```

#### HITL（人工审批）恢复

```ts
import { create_agent, stream_response, resume_sync, get_interrupt_state } from '@pioneering/modu-agent'

const graph = await create_agent()

// 首次调用，触发高危工具审批 → interrupt
for await (const event of stream_response(graph, 'u', 's', { type: 'text', content: '执行 rm -rf' })) {
  // ...工具审批中断事件
}

const state = await get_interrupt_state(graph, 's')
if (state.interrupted) {
  // 用户审批通过后恢复
  await resume_sync(graph, 's', /* approved */ true, /* feedback */ '已批准')
}
```

#### 配置热更新

```ts
import { getConfig, RuntimeConfig } from '@pioneering/modu-agent'

const config = getConfig()
config.set('llm.temperature', 0.5)              // 触发回调 → reset_runner_cache()
config.set('tools.enabled', ['calculator'])     // 触发回调 → 重建图
```

### 6.4 环境变量

#### LLM Provider（必填其一）

| Provider | API Key | Base URL（可选） | Model（可选） |
|----------|---------|-------------------|---------------|
| glm | `MODU_GLM_API_KEY` | `MODU_GLM_BASE_URL` | `MODU_GLM_MODEL` |
| deepseek | `MODU_DEEPSEEK_API_KEY` | `MODU_DEEPSEEK_BASE_URL` | `MODU_DEEPSEEK_MODEL` |
| gpt | `OPENAI_API_KEY` | `OPENAI_BASE_URL` | `OPENAI_MODEL` |
| qwen | `MODU_QWEN_API_KEY` | `MODU_QWEN_BASE_URL` | `MODU_QWEN_MODEL` |
| 通用 fallback | `LLM_API_KEY` | `LLM_BASE_URL` | `LLM_DEFAULT_MODEL` |

#### 其他

| 环境变量 | 用途 | 默认值 |
|----------|------|--------|
| `TAVILY_API_KEY` | SearchTool 优先使用 Tavily | （无，降级 DuckDuckGo） |
| `MODU_CHROMA_PATH` | Chroma 持久化路径 | `./chroma_data` |
| `MODU_CHROMA_IN_MEMORY` | `=1` 时 Chroma 使用内存模式 | （无） |
| `MODU_LOG_LEVEL` | 日志级别 | `INFO` |

### 6.5 包导出（package.json `exports`）

| 子路径 | 入口 |
|--------|------|
| `.` | `./dist/index.js`（全量导出） |
| `./core` | `./dist/core/index.js` |
| `./graph` | `./dist/graph/index.js` |
| `./mcp` | `./dist/mcp/index.js` |
| `./skills` | `./dist/skills/index.js` |

---

## 7. 核心数据流

### 7.1 请求生命周期（默认 ReAct 模式）

```
用户输入
  │
  ▼
stream_response / run_sync
  │
  ├─ _validateInputData
  ├─ _loadPrevConfigOverrides  ← 从 checkpointer 恢复 per-session overrides
  ├─ _buildConfigWithOverrides ← 注入 RunnableConfig.configurable
  ├─ makeInitialState          ← { messages, user_id, session_id, ... }
  │
  ▼
graph.astream(input, config)   ← LangGraph 主入口
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ perception 节点                                              │
│  - runPerceptionPipelineAsync                                │
│  - 输出：perception_result, sensitivity_rejected?            │
│  - 熔断：sensitivity_level>=5 → PERCEPTION_SENSITIVITY_REJECTED │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ memory_query 节点                                            │
│  - store.search(namespace, query) → 历史相关知识             │
│  - 输出：memory_context                                      │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
routeAfterMemoryQuery  ──┬──→ supervisor (multi_agent.enabled)
                          ├──→ planner   (plan_execute_enabled)
                          └──→ agent     (默认 ReAct)
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ agent 节点                                                   │
│  - llm.bindTools(tools).invoke(messages)                     │
│  - PlanContextInjector 注入当前步骤上下文（Plan-Execute 模式）│
│  - 输出：AIMessage（含 tool_calls 或最终 content）           │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
routeAfterAgent  ──┬──→ tools     (有 tool_calls)
                   └──→ finalize_response (无 tool_calls)
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ tools 节点（循环：tools → agent → tools → ...）              │
│  - 高危工具：interrupt → 等待 resume_sync(approved=true)     │
│  - ToolNode 执行 tool_calls                                  │
│  - 输出：ToolMessage[]                                       │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────────────┐
│ finalize_response 节点                                       │
│  - 提取最终 AIMessage content                                │
│  - store.put(namespace, key, value) ← 写入长期记忆           │
│  - 异步触发 FeedbackLoop（不阻塞主流程）                     │
│  - 输出：final_response, perception_metadata                 │
└─────────────────────────────────────────────────────────────┘
  │
  ▼
LangGraph 流事件
  │
  ▼
LangGraphEventBridge._normalizeLangGraphStream
  │
  ├─→ EventBus.publish(AgentEvent)
  │     │
  │     └─→ AGUIStreamAdapter → SSEEncoder → 客户端
  │
  └─→ yield SSE 细粒度事件（thinking/tool_call_start/...）
```

### 7.2 Plan-Execute 模式数据流

```
routeAfterMemoryQuery ──→ planner 节点
                            │
                            ├─ buildToolCatalogText
                            ├─ buildPlannerSystemPrompt
                            ├─ llm.invoke（STRICT JSON）
                            ├─ _parsePlan + PlanSchema.safeParse
                            │
                            └─→ { plan, plan_phase: 'executing', current_step_index: 0 }
                                  │
                                  ▼
                            stepDispatch（条件边）
                                  │
                                  ├──→ agent（执行当前步）
                                  │      │
                                  │      └─→ step_finalize
                                  │             │
                                  │             └─→ stepDispatch（下一步）
                                  │
                                  ├──→ planner（重规划，失败且 max_replans 未达上限）
                                  │
                                  └──→ response（全部完成或不可恢复）
```

**SSE STATE_DELTA 事件**：planner 产出 `{ phase: 'plan', plan }`；step_dispatch 产出 `{ phase: 'execute', step_update: { id, status: 'running' } }`；step_finalize 产出 `{ phase: 'execute', step_update: { id, status, result } }`。

### 7.3 多 Agent 协作数据流

```
routeAfterMemoryQuery ──→ supervisor 节点
                            │
                            ├─ decompose_task（拆分为 max 5 子任务）
                            ├─ reset subtask_results
                            │
                            └─→ route_from_supervisor
                                  │
                                  └─→ Send('subagent_run', { current_subtask: task }) × N
                                        │
                                        ▼
                                  subagent_run（并行）
                                        │
                                        ├─ build_subagent_subgraph（独立 mini ReAct）
                                        ├─ sub_agent → sub_tools → sub_agent → sub_finalize
                                        │
                                        └─→ subtask_results[task_id] = task_output
                                              │
                                              ▼
                                        aggregate_results
                                              │
                                              └─→ finalize_response
```

### 7.4 进化闭环数据流

```
finalize_response
  │
  ├─→ FeedbackLoop.process(response, context, query)
  │     │
  │     ├─→ QualityMonitor.evaluate
  │     │     ├─ rule 模式：启发式评估
  │     │     ├─ llm 模式：judge LLM 评估
  │     │     └─ hybrid 模式：rule → 低置信度回退 llm
  │     │
  │     ├─→ EvolutionSignalCollector.collect
  │     │     └─→ EvolutionSignal[]
  │     │
  │     └─→ EvolutionOrchestrator.evaluateAndEvolve
  │           │
  │           ├─→ ParameterTuneStrategy
  │           │     └─→ config_overrides（注入下一轮 RunnableConfig.configurable）
  │           │
  │           ├─→ ComponentSwapStrategy
  │           │     ├─→ VersionedComponentStore.save（保存当前版本）
  │           │     └─→ registry.swapComponent(type, newImpl)
  │           │
  │           └─→ RollbackMechanism（质量退化时）
  │                 ├─→ VersionedComponentStore.getVersion
  │                 └─→ registry.swapComponent(type, oldImpl)
  │
  ▼
下一轮请求自动应用 config_overrides（_loadPrevConfigOverrides）
```

### 7.5 EventBridge 事件映射

| LangGraph 节点 | EventDomain | EventAction | SSE 细粒度事件 |
|----------------|-------------|-------------|----------------|
| `perception` | `PERCEPTION` | `ANALYZE` | `thinking` |
| `memory_query` | `MEMORY` | `QUERY` | `thinking` |
| `agent` | `REASONING` | `GENERATE` | `thinking` / `response` |
| `tools` | `TOOL` | `INVOKE` | `tool_call_start` / `tool_call_end` / `tool_result` |
| `planner` | `PLAN` | `PLAN_CREATED` | `plan_created` |
| `step_finalize` | `PLAN` | `STEP_COMPLETED` | `step_update` |

**流式 token 事件**：messages stream 每 10 个 token 发布一次 `REASONING.STREAM`（phase: 'progress', token_count）。

---

## 8. 设计约定与关键决策

### 8.1 ESM 与 .js 扩展名约定

**约定**：所有相对导入必须带 `.js` 扩展名（如 `import { x } from './foo.js'`），即使源文件是 `.ts`。

**原因**：
- `package.json` `type: "module"` + `module: ESNext` 要求 ESM 严格语义
- TypeScript 不在输出时重写导入说明符，`.js` 后缀在编译后仍正确指向 `dist/foo.js`
- `vitest.config.ts` 的 `tsJsResolution` 插件在测试时将 `./foo.js` 解析回 `./foo.ts`，使测试无需先构建

### 8.2 单例模式（get + reset）

**约定**：跨模块共享的服务通过 `getXxx()` + `resetXxx()` 对管理单例：
- `getMcpClient()` / `resetMcpClient()`
- `get_event_bus()` / `reset_event_bus()`
- `get_span_manager()` / `reset_span_manager()`
- `get_metrics_registry()` / `reset_metrics_registry()`
- `get_runner()` / `reset_runner_cache()`

`resetXxx()` 主要用于**测试隔离**，避免单例状态在测试间泄漏。

### 8.3 异步优先（async-first）

**约定**：所有 I/O 操作（LLM 调用、工具执行、记忆查询、MCP 调用）均为 `async`。Python 版的同步 `reason()` / 异步 `areason()` 双 API 在 TS 版统一为单一 `async reason()`（`areason` 委托 `reason`）。

### 8.4 配置热更新两层机制

**问题**：配置变更后，已编译的 LangGraph 图需重建才能生效，但每次 set 都重建过于昂贵。

**方案**：两层互补：
1. **回调主动失效**（精确）：`RuntimeConfig.on('change', cb)` 监听特定 keyPath，命中 `_GRAPH_REBUILD_PREFIXES`（`llm.` / `tools.` / `memory.` / `orchestration.` / `streaming.` / `plan_execute.`）任一前缀时立即 `reset_runner_cache()`
2. **hash 惰性重建**（兜底）：`get_runner()` 缓存实例时计算配置 SHA256 hash，下次取用时若 hash 不匹配则重建

### 8.5 per-session 配置覆盖隔离（P0-2 关键修复）

**问题**：早期 `EvolutionOrchestrator` 直接修改全局 `RuntimeConfig`，导致一个会话的进化结果污染所有会话。

**方案**：
- `ParameterTuneStrategy` 返回 `config_overrides`（不修改全局配置）
- `stream_response` 通过 `_loadPrevConfigOverrides` 从 checkpointer 恢复上一轮 overrides
- `_buildConfigWithOverrides` 将 overrides 注入 `RunnableConfig.configurable`（per-request）
- LangGraph 节点从 `config.configurable` 读取覆盖后的值

**效果**：进化结果仅影响产生该信号的会话，全局配置保持稳定。

### 8.6 ModuGraph 代理包装器

**问题**：`CompiledStateGraph` 是 LangGraph 内部对象，无法直接附加 `EvolutionOrchestrator` 引用与自定义方法。

**方案**：`ModuGraph` 使用 ES6 `Proxy` 透明代理 `CompiledStateGraph`：
- 所有属性访问转发到 underlying graph（`get` trap）
- 额外持有 `orchestrator` 引用，便于外部访问进化上下文
- 调用方无需感知包装层，对 `graph.invoke()` / `graph.astream()` 透明

### 8.7 Skill 透明性（工厂注入解循环）

**问题**：`skills/adapter.ts` 的 `SkillToolWrapper` 需要 `BaseTool` 类型（来自 `core`），而 `graph/adapters/tool-adapter.ts` 的 `wrap_modu_tool` 需要包装 `SkillToolWrapper` —— 形成 `skills ↔ graph/adapters` 循环。

**方案**：`setSkillToolWrapperFactory(factory)` 在 `tool-adapter.ts` 注册工厂；`skills/` 模块不直接 import `tool-adapter.ts`，而是通过工厂闭包构造。该模式保证：
- `skills/` 可独立测试
- 加载顺序无关（`graph/adapters` 先加载时注册工厂，`skills` 后加载时使用）
- ESM 严格模式下无循环引用警告

### 8.8 安全守卫多层防御

**约定**：所有高危工具采用多层防御，单层失效不致命：

| 工具 | 防御层 |
|------|--------|
| `CalculatorTool` | 正则白名单 + 字符集合二次校验 + 手写递归下降解析器（非 `eval`） |
| `CodeExecutionTool` | 源码白名单（`_FORBIDDEN_NAMES`/`_FORBIDDEN_ATTRS`）+ 子进程隔离（`-I` 模式）+ 超时 10s + 输出截断 4KB |
| `FileOpsTool` | 路径校验（拒绝绝对路径/盘符/`..`/symlink 越界）+ read 截断 256KB |
| `HttpRequestTool` | SSRF 防护（`_PRIVATE_CIDRS` + DNS 解析后检查）+ `redirect: 'manual'` + 域名白名单 |
| `SqlQueryTool` | SQL 校验（必须 SELECT / 禁止 DDL/DML / 禁止多语句 / 禁止注释 / 表名白名单）+ `query_only = ON` |

**HITL 兜底**：4 个高危工具 `requiresApproval()=true`，调用前 `interrupt` 暂停等待人工审批；拒绝时返回标准 `TOOL_APPROVAL_REJECTED`。

**感知层熔断**：`SecurityGuard.detectAll` 输出 `sensitivity_level` 0-5；`>=5` 时 perception 节点直接返回 `PERCEPTION_SENSITIVITY_REJECTED`，不进入后续流程。

### 8.9 Python 版与 TS 版关键差异

| 方面 | Python 版 | TS 版 |
|------|-----------|-------|
| 异步模型 | `reason()` 同步 + `areason()` 异步（双 API） | 统一 `async reason()`（`areason` 委托） |
| HTTP 客户端 | `httpx.Client` 连接池，`__del__` 析构关闭 | 原生 `fetch`，Node undici 自动管理连接池，`close()` no-op |
| 主编排 | `Coordinator` 上帝类（1047 行） | `StateGraph` 节点函数（`nodes.ts` 21 个导出） |
| 配置注入 | 全局 mutable | per-session `RunnableConfig.configurable` 隔离 |
| 符号推理 | `rule_engine.py` 空文件 | `rule-engine.ts` 空文件（保持等价） |
| 依赖管理 | 必需依赖 | `optionalDependencies` 动态加载 + 降级 |
| 测试 | pytest | vitest + `tsJsResolution` 插件（直接跑 `src/`） |

### 8.10 可选依赖降级策略

**约定**：所有重量级依赖（OTel / prom-client / better-sqlite3 / chromadb）均为 `optionalDependencies`，通过动态 `import()` 加载。加载失败时**降级为内存实现或 no-op**，而非抛错。

**意义**：
- 核心包安装轻量（仅 5 个必需 dependencies）
- 用户按需安装可选依赖启用高级特性（如 `npm install chromadb` 启用长期记忆）
- 降级行为对调用方透明（接口契约不变）

### 8.11 三种执行模式互斥约定

**约定**：`multi_agent.enabled` / `plan_execute.enabled` / 默认 ReAct **三选一**，不可同时启用。

**实现**：
- `buildModuGraph` 中 `multiAgentEnabled && planExecuteEnabled` 时强制 `planExecuteEnabled=false`（multi_agent 优先）
- 原因：两者都消费 `memory_query → 推理入口` 边，同时启用会导致路由冲突
- `routeAfterMemoryQuery` 优先级：`configurable.multi_agent_enabled` > `configurable.plan_execute_enabled` > `plan_execute.enabled`（全局）> 默认 agent

### 8.12 命名约定

| 约定 | 示例 | 说明 |
|------|------|------|
| 私有方法前缀 `_` | `_buildMessages` / `_parsePlan` / `_resolvePipeline` | 标识内部实现，不对外暴露 |
| 常量前缀 `_` + 全大写 | `_DEFAULT_BASE_URL` / `_PRIVATE_CIDRS` / `_FORBIDDEN_NAMES` | 模块级常量 |
| MCP 工具 qualifiedName | `${serverName}__${toolName}` | 双下划线分隔，避免跨 Server 冲突 |
| 错误码 | `MCP_000`~`MCP_004` / `LLM_GENERATION_FAILED` / `TOOL_APPROVAL_REJECTED` | 模块前缀 + 大写下划线 |
| 事件域 | `PERCEPTION` / `MEMORY` / `REASONING` / `TOOL` / `PLAN` | 大写枚举 |

---

## 9. 优化建议

> 基于对 `packages/modu-agent` 全部源码的深度分析，按**优先级**和**影响面**排序，分为架构、模块、工程、安全、性能、文档六大类。

### 9.1 架构层面（高优先级）

#### 9.1.1 统一 barrel 导出策略

**现状问题**：模块导出策略不一致，增加使用心智成本。

| 模块 | 现状 | 问题 |
|------|------|------|
| [tools/index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/index.ts) | 仅导出 3 个符号（`SyncActionExecutor`/`CalculatorTool`/`SearchTool`） | 其余 5 个工具需直接 import 文件路径 |
| [perception/index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/index.ts) | 仅导出 2 个工具函数 | 非 barrel，不重导出 pipeline/fusion/子模块类 |
| [reasoning/index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/index.ts) | 完整 barrel | 一致 |
| [mcp/index.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/mcp/index.ts) | 完整 barrel | 一致 |

**建议**：
- 统一为**完整 barrel**策略，所有公开 API 通过 `index.ts` 导出
- `tools/index.ts` 补齐 `CodeExecutionTool` / `DateTimeTool` / `FileOpsTool` / `HttpRequestTool` / `SqlQueryTool` 导出
- `perception/index.ts` 重导出 `runPerceptionPipeline` / `PerceptionFusion` / `SecurityGuard` 等核心类
- 若有意限制公开 API，则用 `__internal__` 子路径区分（如 `@pioneering/modu-agent/tools/internal`）

#### 9.1.2 消除 reasoning 与 graph/adapters 的能力重复

**现状问题**：存在两套 LLM 调用实现，维护成本高且行为可能漂移。

| 实现 | 位置 | 协议 |
|------|------|------|
| `BaseLLMReasoner` | [reasoning/llm/base-llm.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/base-llm.ts) | 原生 `fetch` 调用 `/chat/completions` |
| `build_chat_model` | [graph/adapters/llm-adapter.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/llm-adapter.ts) | `ChatOpenAI`（LangChain 抽象） |

两者都走 OpenAI 兼容协议，但：环境变量解析逻辑重复（`_PROVIDER_CONFIG` vs 子类构造函数）、错误处理策略可能不一致、重试逻辑只在 `apply_llm_retry` 中存在。

**建议**：
- **方案 A（推荐）**：`BaseLLMReasoner` 内部委托 `build_chat_model` 构建的 `ChatOpenAI`，统一 LLM 调用入口；保留 `reasoning/` 作为面向直接调用的薄封装
- **方案 B**：若需保持 `reasoning/` 零 LangChain 依赖，则抽取共享的 provider 配置模块（`_PROVIDER_CONFIG` 提到 `config/` 中），确保两套实现的环境变量解析、默认值、错误码完全一致

#### 9.1.3 清理占位空文件

**现状问题**：[reasoning/symbolic/rule-engine.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/symbolic/rule-engine.ts) 为空文件，仅含注释，无任何导出。

**建议**：
- 若短期无实现计划，删除该文件并从目录结构中移除（避免误导）
- 若作为未来扩展占位，在文件顶部添加 `// TODO(P3): 实现符号推理规则引擎` 并在 README/roadmap 中登记
- 同步更新 `CODE_WIKI.md` 4.7 节对应描述

#### 9.1.4 ModuGraph Proxy 的类型安全性

**现状问题**：`ModuGraph` 使用 ES6 `Proxy` 透明代理 `CompiledStateGraph`，`get` trap 转发所有属性访问。但 Proxy 的类型推断在 TypeScript 中通常是 `any` 或宽泛类型，丢失类型安全。

**建议**：
- 显式声明 `ModuGraph` 实现一个继承 `CompiledStateGraph` 类型签名的接口
- 或使用 `satisfies` 运算符确保 Proxy 的 `get` trap 返回类型与目标一致
- 添加单元测试覆盖 `graph.invoke` / `graph.astream` / `graph.getState` / `graph.updateState` 等核心方法的类型正确性

---

### 9.2 模块层面（中优先级）

#### 9.2.1 feedback 与 LangGraph 集成的异步边界

**现状问题**：`FeedbackLoop.process` 在 `finalize_response` 节点后异步执行，不阻塞主流程。但异步异常若未捕获会变成 unhandledRejection，且进化结果（`config_overrides`）的回写时机不明确。

**建议**：
- 在 `finalize_response` 节点中显式 `.catch(err => log + emit ERROR event)` 包装 FeedbackLoop 调用
- 明确 `config_overrides` 的持久化路径：是写入 checkpointer 的 state，还是独立的 store namespace？建议在 `CODE_WIKI.md` 7.4 节补充说明
- 考虑为 FeedbackLoop 添加开关（`feedback.async`），允许同步模式用于调试

#### 9.2.2 QualityMonitor 三模式的策略选择

**现状问题**：`rule` / `llm` / `hybrid` 三种模式中，`hybrid` 的"rule 置信度低时回退 llm"阈值未明确文档化，且 rule 模式的启发式规则（长度/重复/格式/关键词）可能对某些领域（如代码生成）失效。

**建议**：
- 将 rule 评估的阈值（置信度下限）提取为配置项（`feedback.rule_confidence_threshold`）
- 允许用户注入领域特定的 rule 评估器（通过 `registry.registerComponent('quality_evaluator', ...)`）
- 在 `CODE_WIKI.md` 4.9 节补充 hybrid 模式的决策流程图

#### 9.2.3 evolution 策略注册的可扩展性

**现状问题**：`EvolutionOrchestrator` 维护 `Strategy[]`，但当前仅内置 3 种策略（ParameterTune/ComponentSwap/Rollback），用户无法在不修改源码的情况下注入自定义策略。

**建议**：
- 暴露 `registerStrategy(strategy)` 公开 API
- 策略接口标准化（`{ name, priority, evaluate(signal, context): Action }`）
- 在 `factory.ts` 的 `create_agent` 流程中从配置读取自定义策略路径并动态加载

#### 9.2.4 orchestration EventBus 的背压处理

**现状问题**：[communication/message-bus.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/message-bus.ts) 的 `publish` 为同步发布，若 handler 执行缓慢会阻塞发布方；`PersistentEventLog` 基于 better-sqlite3 同步写入，高并发场景下可能成为瓶颈。

**建议**：
- `publish` 改为微任务异步（`queueMicrotask` 或 `setImmediate`），handler 异常通过 `Promise.catch` 捕获
- `PersistentEventLog` 引入写入队列（批量提交 + WAL 模式），或提供 `async` 模式开关
- 添加背压指标（队列深度、丢弃数）暴露到 `MetricsRegistry`

---

### 9.3 工程层面（中优先级）

#### 9.3.1 类型严格度提升

**现状问题**：`tsconfig.json` 已开启 `strict: true`，但部分模块仍使用 `any` 或 `Record<string, any>`，削弱类型安全。

| 位置 | 现状 | 建议 |
|------|------|------|
| `event-bridge.ts` 的 SSE payload | `Record<string, any>` | 定义 `SSEPayload` 联合类型，按事件类型区分 |
| `agui-adapter.ts` 的 `_emit(eventType, data)` | `Record<string, any>` | 按事件类型建立映射，`_emit<T extends AGUIEventType>(type: T, data: EventPayload[T])` |
| `nodes.ts` 的 state 操作 | 部分使用类型断言 | 利用 `Annotation.Root` 推导的 State 类型，减少 `as` 断言 |

#### 9.3.2 测试覆盖与可测性

**现状问题**：vitest 配置完善（`tsJsResolution` 插件可直接跑 `src/`），但测试覆盖情况未知，部分模块（如 plan-execute、evolution）逻辑复杂，缺乏测试会导致回归风险。

**建议**：
- 为 plan-execute 添加端到端测试：覆盖正常规划、重规划、降级直答、空 plan 四条路径
- 为 evolution 添加 per-session 隔离测试：验证 `config_overrides` 不污染全局配置
- 为 HITL 添加集成测试：覆盖 interrupt → resume → 完成流程
- 引入覆盖率门槛（`vitest --coverage`，`thresholds: { lines: 80 }`）

#### 9.3.3 配置 Schema 的运行时校验时机

**现状问题**：`config/schemas.ts` 定义了 9 个 zod schema，但 `RuntimeConfig.set` 的校验时机不明确——是否每次 set 都校验？嵌套路径（`llm.temperature`）如何校验？

**建议**：
- 明确文档化校验时机（建议 set 时惰性校验，get 时不校验）
- 为 `RuntimeConfig.set` 添加路径感知校验：根据 keyPath 前缀选择对应 schema
- 提供 `validateAll()` 方法用于启动时全量校验

#### 9.3.4 optionalDependencies 降级的可观测性

**现状问题**：OTel/prom-client/better-sqlite3/chromadb 降级为 no-op 或内存实现时，调用方无感知，可能导致用户误以为功能已启用。

**建议**：
- 降级时通过 `JsonFormatter` 输出 `WARN` 级别日志（`"chromadb not installed, falling back to InMemoryStoreAdapter"`）
- 在 `MetricsRegistry` 中注册 `modu_optional_dep_status` Gauge（label: dep_name, status: enabled|fallback）
- 启动时汇总打印可选依赖状态摘要

---

### 9.4 安全层面（高优先级）

#### 9.4.1 CodeExecutionTool 的 Python 依赖

**现状问题**：[tools/code-executor.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/code-executor.ts) 通过 `execFileAsync` 调用 Python 子进程，假设运行环境已安装 Python。若 Python 未安装或版本不符，错误信息可能不友好。

**建议**：
- 启动时探测 Python 可用性（`_resolvePythonCommand` 已实现，但需在工具注册时主动检测并记录）
- 提供配置项允许禁用 code_executor（`tools.disabled: ['code_executor']`）
- 考虑支持 WebAssembly 沙箱作为 Python 不可用时的降级方案

#### 9.4.2 SqlQueryTool 表名白名单的维护成本

**现状问题**：表名白名单硬编码在源码中，新增表需修改代码重新发布。

**建议**：
- 表名白名单改为配置驱动（`tools.sql_query.allowed_tables: [...]`）
- 支持正则模式（如 `^user_.*$` 允许所有 user 前缀表）
- 在 `CODE_WIKI.md` 4.4 节补充白名单配置说明

#### 9.4.3 HITL 审批超时机制

**现状问题**：`interrupt` 暂停后等待 `resume_sync(approved=true)`，但若用户长时间不审批，interrupt 状态会一直占用 checkpointer 存储，且 LLM 会话上下文长期驻留。

**建议**：
- 为 interrupt 添加 TTL 配置（`hitl.timeout_seconds`，默认 3600s）
- 超时后自动 `resume_sync(approved=false, feedback='timeout')` 并返回 `TOOL_APPROVAL_TIMEOUT`
- 添加定期清理任务（基于 `PersistentEventLog` 的 timestamp）

---

### 9.5 性能层面（低优先级，长期优化）

#### 9.5.1 LangGraph 图重建频率

**现状问题**：配置热更新两层机制中，`_GRAPH_REBUILD_PREFIXES` 命中即 `reset_runner_cache()`，频繁变更 LLM 参数会导致图频繁重建。

**建议**：
- 引入去抖动（debounce 100ms），连续配置变更合并为一次重建
- 对仅影响 LLM 参数的变更（`llm.temperature` / `llm.max_tokens`）考虑不重建图，而是通过 `RunnableConfig.configurable` per-request 注入（与 per-session 隔离机制复用）

#### 9.5.2 perception 管线的并行度

**现状问题**：`runPerceptionPipelineAsync` 首个感知器串行 + 后续 `Promise.all` 并行，但若首个感知器耗时较长，无法与其他并行。

**建议**：
- 评估是否所有感知器均可并行（通过 state 隔离避免写冲突）
- 或允许配置 `perception.parallel_first: true` 跳过首串行假设

#### 9.5.3 ChromaLongTermMemory 的嵌入缓存

**现状问题**：`_simpleHashEmbedding` 使用 SHA-256 生成 384 维向量，每次查询都会重新计算嵌入，无缓存。

**建议**：
- 引入 LRU 缓存（key 为文本 hash，value 为嵌入向量）
- 缓存命中率暴露到 `MetricsRegistry`

---

### 9.6 文档层面（低优先级）

#### 9.6.1 CODE_WIKI.md 的版本化

**建议**：在文档头部添加 `frontmatter`（`source_commit: <sha>` / `doc_version: 1.0`），CI 中校验文档与代码同步。

#### 9.6.2 补充 ADR（Architecture Decision Records）

**建议**：为关键决策（P0-2 per-session 隔离、P4 Plan-Execute 互斥、ESM 工厂注入）建立独立 ADR 文档，记录决策背景、方案对比、取舍理由。`CODE_WIKI.md` 8 章可链接到 ADR。

---

### 9.7 优化优先级矩阵

| 建议 | 优先级 | 影响面 | 实施难度 |
|------|--------|--------|----------|
| 9.1.1 统一 barrel 导出 | 高 | 使用体验 | 低 |
| 9.4.1 CodeExecution Python 探测 | 高 | 安全可用 | 低 |
| 9.4.3 HITL 超时机制 | 高 | 生产稳定性 | 中 |
| 9.3.1 类型严格度 | 高 | 代码质量 | 中 |
| 9.1.2 消除 LLM 调用重复 | 高 | 维护成本 | 高 |
| 9.2.1 feedback 异步边界 | 中 | 稳定性 | 低 |
| 9.2.4 EventBus 背压 | 中 | 性能 | 中 |
| 9.3.2 测试覆盖 | 中 | 质量保障 | 中 |
| 9.3.4 optionalDep 可观测性 | 中 | 运维 | 低 |
| 9.4.2 SqlQuery 白名单配置化 | 中 | 灵活性 | 低 |
| 9.5.1 图重建去抖 | 低 | 性能 | 中 |
| 9.5.3 嵌入缓存 | 低 | 性能 | 低 |
| 9.1.3 清理空文件 | 低 | 整洁度 | 极低 |
| 9.1.4 Proxy 类型安全 | 低 | 类型质量 | 中 |

**建议落地顺序**：先做低难度高收益项（9.1.1、9.4.1、9.3.4、9.1.3），再处理中难度项（9.2.1、9.3.2、9.4.2），最后推进高难度架构项（9.1.2、9.1.4）。

---

## 文档维护说明

本文档基于 `packages/modu-agent/src/` 当前源码现状编写，与代码实际情况完全对齐。如代码结构发生变更，请同步更新本文档对应章节。

**对应源码版本**：`@pioneering/modu-agent` 0.1.0
**最后更新**：2026-07-23