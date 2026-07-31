# Agent 框架能力评估与重构优化方案（修复核验清理版）

> 版本：基于 v1.4 清理（2026-07-31）
> 评估对象：`packages/modu-agent`（基于 LangGraph 的 TypeScript Agent 框架）
> 评估范围：底层通用基座层、业务适配层、核心能力层三大维度
> 关联代码：所有引用均附 `file://` 绝对路径链接，可直接跳转核对
>
> **清理说明**：本文档在原 v1.4 方案基础上，对照 `packages/modu-agent` 当前主分支代码，逐一核验了文档中标注为「✅ 已修复（v1.1/v1.2/v1.3/v1.4）」的全部问题。核验结论为：**这些已标注修复的问题均已在代码中实际落地**（对应符号/接口/配置项均已存在并接通）。因此，原文档各章节中「已修复问题」的描述与说明已从正文删除，仅保留「未修复 / 部分修复」的遗留项，作为后续改造工作的清单。所有已修复项的紧凑记录统一收录于文末「附录 B：修复状态总览」，便于追溯。

---

## 1. 评估概述与方法论

### 1.1 评估目标

围绕"**如何构建底层通用泛化能力与上层业务适配能力**"这一核心命题，对 `modu-agent` 框架进行深度代码审计，回答以下问题：

- 底层基座是否具备足够的抽象性与泛化能力，能支撑多业务场景接入？
- 业务适配层是否提供清晰的扩展点，能低成本地接入新角色、新工具、新知识源？
- 核心能力层是否覆盖 Agent 的关键模式（规划、记忆、工具、协作、反思），且模式间可组合？
- 现有架构的能力空白与设计缺陷在哪里，应如何重构？

### 1.2 评估方法论

采用**三层九维**评估矩阵：

| 层级 | 维度 | 关键检查点 |
|------|------|-----------|
| 底层通用基座层 | LLM 调用 / 消息协议 / 状态机 / 可观测性 / 安全沙箱 | 抽象接口、多 Provider 适配、协议完备性、状态持久化、追踪指标、安全防御 |
| 业务适配层 | 角色 Agent / Prompt 模板 / 领域知识库 / 专属工具集 / 评估集 | 角色抽象、模板外置、知识库多源、工具集切换、评估闭环 |
| 核心能力层 | 规划策略 / 记忆管理 / 工具调度 / 多 Agent 协作 / 三模式落地 | Plan-Execute 完整性、记忆质量、工具链路、协作机制、模式组合性 |

每个维度按 **现状 → 优点 → 缺陷 → 建议** 四段式输出，所有结论附源码位置佐证。

### 1.3 代码基线

本次评估基于 `packages/modu-agent` 当前主分支代码，关键模块清单：

| 模块 | 路径 | 职责 |
|------|------|------|
| 图编排 | [src/graph/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/) | LangGraph 状态图构建、节点、路由、运行器 |
| Plan-Execute | [src/graph/plan-execute/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/) | Plan-and-Execute 模式实现 |
| 子图 | [src/graph/subgraph/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/) | 多 Agent 协作子图 |
| LLM 推理 | [src/reasoning/llm/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/) | 多 Provider LLM 封装 |
| 通信协议 | [src/orchestration/communication/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/) | EventBus、协议 DTO、SSE 流式 |
| 记忆 | [src/memory/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/) | 短期/长期记忆 |
| 工具 | [src/tools/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/) | 内置工具集 |
| MCP | [src/mcp/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/) | 远程工具协议 |
| Skills | [src/skills/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/) | 可插拔 Skill 子系统 |
| 可观测性 | [src/observability/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/) | Tracing、Metrics、Logging |
| 安全 | [src/perception/security/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/security/) | 输入校验、Prompt 注入防护 |
| 反馈进化 | [src/feedback/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/) + [src/evolution/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/) | 质量评估与自适应进化 |
| 配置 | [src/config/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/config/) | 运行时配置与热更新 |

---

## 2. 底层通用基座层评估（遗留项）

> 说明：§2.1 LLM 调用抽象、§2.2 消息协议（除跨进程 EventBus 外）、§2.3 状态机（除递归预算/回滚外）、§2.4 W3C 注入、§2.5 安全（除沙箱化/AST 外）下原列缺陷/建议均已在 v1.1 修复，正文不再赘述。

### 2.1 LLM 调用抽象

#### 现状

项目存在**双轨 LLM 抽象**：

- **路径 A：自研轻量封装 `BaseLLMReasoner`**（手写 fetch + OpenAI 兼容协议）
  - [base-llm.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/base-llm.ts) L30 定义 `BaseLLMReasoner extends BaseReasoningEngine`
  - 字段：`_apiKey / _baseUrl / _defaultModel / _timeout / _systemPrompt`（L31-35）
  - `reason()`（L113-185）：同步非流式，返回 `[content, usage, toolCalls]`；使用 `AbortSignal.timeout(this._timeout * 1000)` 做超时（L142）；解析 `tool_calls`（L163-176）；token 统计来自 `usage`（L156-161）
  - `stream()`（L195-266）：异步生成器，手动解析 SSE 行（L238-261）
  - 多 Provider 子类：[deepseek.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/deepseek.ts)、[glm.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/glm.ts)、[gpt.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/gpt.ts)、[qwen.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/qwen.ts) 仅在构造函数中解析不同 API key/base_url/model
  - temperature/max_tokens 三级优先级：显式 kwargs > RuntimeConfig > 兜底默认值（L64-94）

- **路径 B：LangChain `ChatOpenAI` 适配**（主流程实际使用路径）
  - [llm-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/llm-adapter.ts) 通过 LangChain `ChatOpenAI` 构造 LLM
  - [factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts) 主流程使用 `boundLlm = llm.bindTools(tools)` 实现原生 function calling
  - [retry.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/retry.ts) 的 `apply_llm_retry` 优先使用 LangChain `withRetry`，不可用降级
  - FeedbackLoop 的 LLM Judge 兼容两种接口（[quality-monitor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/quality-monitor.ts) L260-295 鸭子类型）

#### 优点

1. **OpenAI 兼容协议降低接入成本**：所有 Provider 走 `/chat/completions` 标准，新增 Provider 只需子类化构造函数
2. **超时控制完善**：`AbortSignal.timeout` + 配置化 `_timeout`，避免长尾请求拖垮图执行
3. **流式输出原生支持**：异步生成器手动解析 SSE，与 LangGraph 的 streaming 通路对接
4. **参数解析三级降级**：kwargs > RuntimeConfig > 兜底，配置不可用安全降级
5. **双轨兼容**：自研封装满足独立场景（如 LLM Judge），LangChain 适配满足图编排场景

#### 遗留建议

- **逐步弃用 `BaseLLMReasoner`**（待办）：将 LLM Judge 等独立场景改用 LangChain `ChatOpenAI`，消除双轨 — `BaseLLMReasoner` 已标记 `@deprecated`，但 `QualityMonitor` 等仍兼容旧接口

### 2.2 消息协议

#### 现状

- **事件协议**：[protocol.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/protocol.ts) 定义 `EventDomain`（9 个域，含 P4 新增的 `PLAN`）、`EventAction`（17 个动作，含共识/HITL/Plan-Execute）、`EventPriority`（4 级）、`ErrorCode`（13 个错误码）
- **AgentEvent 结构**（L74-167）：`event_id / trace_id / session_id / user_id / domain / action / timestamp / payload / metadata / priority`，构造时强制校验 `user_id/session_id/domain/action` 非空（L99-113）
- **DTO 类**：`MemoryQueryRequest/Response`、`ToolCallRequest/Response`、`PerceptionInput`、`LLMRequest/Response`，均提供 `toDict/fromDict` 序列化
- **EventBus**：[message-bus.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/message-bus.ts) L60-165 提供 `subscribe/publish/request`（request-response 模式 5s 超时），按 domain 索引优化订阅
- **持久化事件日志**：`PersistentEventLog`（L171-276）文件持久化 + 10MB 滚动 + 异步写入队列
- **SSE 流式**：[streaming.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/streaming.ts) 提供 SSE 事件流封装
- **AGUI 适配**：[agui-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/agui-adapter.ts) 适配前端 AGUI 协议

#### 优点

1. **协议完备**：Domain/Action/Priority/ErrorCode 四维枚举覆盖感知、推理、记忆、工具、反馈、规划全链路
2. **强校验**：`AgentEvent` 构造时强制必填字段，避免脏事件流入总线
3. **request-response 模式**：`EventBus.request` 支持 5s 超时的同步请求，适用于需要确认的场景（如 HITL 审批）
4. **持久化日志**：`PersistentEventLog` 异步写入 + 滚动，不阻塞主流程且可回放
5. **按 domain 索引优化**：订阅时按 domain 分桶，避免全量广播

#### 遗留缺陷

1. **EventBus 仅内存**：无跨进程 pub/sub，分布式部署下多实例间事件不互通 — 待办（P3-2/P3-3）
2. **DTO 类与 LangGraph State 字段重复**：`LLMRequest/Response` 与 `ModuAgentState` 中的 messages/usage 字段语义重叠，增加映射成本 — 待办

#### 遗留建议

1. **跨进程 EventBus**（待办 P3-2/P3-3）：引入 Redis pub/sub 适配器，多实例部署时启用
2. **DTO 与 State 字段对齐**（待办）：评估是否用 DTO 替代 State 中的冗余字段，减少映射

### 2.3 状态机

#### 现状

- **状态定义**：[state.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/state.ts) L131-180 定义 `ModuAgentStateAnnotation`，字段分两类：
  - **last-write-wins（`_lw`）**：`current_subtask / current_step_index / plan_phase / replan_count / confidence / error_code / cleaned_text / perception_result` 等单值字段
  - **追加 reducer**：`messages`（LangGraph 内置 `messagesStateReducer`）、`tool_results / subtask_results / step_results / knowledge / subtasks / plan`（自定义追加）
- **图构建**：[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts) L134 `buildModuGraph()` 使用 LangGraph `StateGraph`，节点包括 `perception / memory_query / agent / tools / tool_processor / human_review / finalize_response / feedback / memory_update`，可选 `supervisor / subagent_run / consensus`（多 Agent）与 `planner / step_dispatch / step_finalize`（Plan-Execute）
- **路由分叉**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) `routeAfterPerception / routeAfterMemoryQuery / routeAfterAgent / routeAfterHumanReview / stepDispatch` 等条件路由函数
- **配置门控**：`orchestration.multi_agent.enabled` / `plan_execute.enabled` / `tools.human_in_loop.enabled` / `skills.enabled` 均默认 false，零侵入
- **递归预算**：[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts) L489-512 按节点类型累加 `recursionLimit`：`baseLimit = maxIterations * 2 + 7`，HITL +2，multi_agent +4，plan_execute 按 `maxSteps * (maxIterations * 3 + 2) + (maxReplans + 1) * 2 + 2`
- **Checkpointer**：[factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts) L76-104 `build_checkpointer` 支持 `memory / sqlite / postgres` 三种，按 `thread_id`（= session_id）持久化
- **图缓存与热重建**：[runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts) L561-588 检测配置 hash 变化触发图重建，`_GRAPH_REBUILD_PREFIXES`（L61）声明哪些配置前缀需要重建

#### 优点

1. **reducer 策略清晰**：单值字段用 `_lw`，列表字段用追加 reducer，避免并发写冲突
2. **配置门控零侵入**：所有可选模式默认关闭，对现有 ReAct 路径无影响
3. **递归预算精细化**：按节点类型累加，而非全局一刀切，避免预算浪费或不足
4. **Checkpointer 多实现**：memory/sqlite/postgres 覆盖开发/测试/生产场景
5. **图缓存热重建**：配置变更自动检测 hash 并重建图，无需重启进程
6. **`thread_id` 自动管理**：Checkpointer 按 `thread_id` 隔离状态，天然支持断点续跑

#### 遗留缺陷

1. **状态字段膨胀**：`ModuAgentState` 已积累 30+ 字段，涵盖 ReAct/multi_agent/plan_execute/feedback/evolution 多模式，单 State 承载过重 — **部分修复**：已通过 `CoreState` + `ModeState` 接口分层，但 `ModuAgentStateAnnotation` 仍为单一 Annotation 组合
2. **模式间状态字段耦合**：`current_subtask`（multi_agent）与 `current_step`（plan_execute）并存，`subtask_results` 与 `step_results` 并存，语义易混淆 — **部分修复**：通过 `MultiAgentModeState` / `PlanExecuteModeState` 接口隔离，但底层 Annotation 仍合并
3. **递归预算估算粗放**：plan_execute 的 `maxSteps * (maxIterations * 3 + 2)` 假设每步最多 ReAct `maxIterations` 轮 — 待办
4. **无状态回滚**：Checkpointer 可恢复状态，但无法主动回滚到 N 步之前的状态 — 待办

#### 遗留建议

1. **递归预算动态计算**（待办）：plan_execute 模式按 `sum(step.estimated_iterations)` 动态计算
2. **状态回滚 API**（待办）：`ModuGraph.rollback(thread_id, steps)` 基于 Checkpointer 历史快照回滚

### 2.4 可观测性

#### 现状

- **Tracing**：[tracing.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/tracing.ts) `OtelSpanManager` 全局单例，`span()` 返回 `SpanHandle`，支持 `end() / recordError() / Symbol.dispose`（`using` 语法）
  - 双 Handle：`NoopSpanHandle`（tracing 未启用，仅日志）+ `OtelSpanHandle`（OTel SDK 启用）
  - 动态 import OTel SDK（L158-196），SDK 不可用时降级到 no-op
  - 全局 `__modu_otel_api` 缓存（L187），供 `trace-context.ts / logging-config.ts` 同步访问
  - 已提供 `async ready()` 入口（L142/L164/L172），可显式等待 SDK 就绪
- **Metrics**：[metrics.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/metrics.ts) Prometheus 指标体系，含 `modu_agent_iterations_total / modu_agent_tool_calls_total / modu_agent_token_usage_total / modu_agent_response_latency_seconds` 等
- **Exporters**：[exporters.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/exporters.ts) 支持 OTLP / Console / Prometheus 多 exporter
- **Logging**：[logging-config.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/logging-config.ts) 结构化日志配置，trace_id 关联
- **Trace Context**：[trace-context.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/trace-context.ts) 跨节点 trace_id 传播

#### 优点

1. **OTel 原生集成**：动态 import + 降级，SDK 不可用时不阻塞主流程
2. **`using` 语法支持**：`Symbol.dispose` 让 span 生命周期管理更优雅
3. **NoopSpanHandle 兜底**：tracing 未启用时仍记录日志，便于本地调试
4. **多 exporter 灵活**：OTLP / Console / Prometheus 按需启用
5. **trace_id 跨节点传播**：`trace-context.ts` 保证全链路追踪
6. **Prometheus 指标体系**：覆盖迭代次数、工具调用、token 用量、响应延迟

#### 遗留缺陷

1. **SDK 初始化异步**：`_initOtel` 是 async，首次调用 `span()` 时 SDK 可能未就绪，退化为 no-op（L211-213 注释明确指出）；现已提供 `tracing.ready()` 显式等待入口，但默认启动路径仍未强制 await — 待办
2. **指标维度有限**：缺少 per-task_type / per-tool / per-provider 维度的指标 — 待办
3. **无指标聚合视图**：仅暴露原始 counter/histogram，无预聚合 dashboard — 待办
4. **日志与 trace 关联弱**：日志中的 trace_id 需手动注入，未自动从 span context 提取 — 待办
5. **无结构化日志 sink**：仅 console 输出，无 file/loki/elasticsearch sink — 待办
6. **无性能剖析**：缺少 CPU/内存 profile 能力，长任务性能瓶颈难定位 — 待办

#### 遗留建议

1. **W3C TraceContext 注入补全**（部分修复）：`http_request` 已注入，MCP transport 注入 `traceparent` 仍待办
2. **指标维度扩展**（待办）：所有指标增加 `task_type / tool_name / llm_provider / session_id` 标签
3. **预聚合 dashboard**（待办）：提供 Grafana dashboard JSON 模板，开箱即用
4. **日志自动注入 trace_id**（待办）：`logging-config.ts` 从 `trace-context.ts` 自动提取当前 span 的 trace_id，注入每条日志
5. **多 sink 日志**（待办）：引入 `pino` + `pino-pretty` + file transport，支持 file/loki sink
6. **性能剖析**（待办）：集成 `clinic.js` 或 `0x`，提供 `--profile` 启动选项

### 2.5 安全沙箱

#### 现状

- **输入校验**：[perception/security/guard.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/security/guard.ts) `SecurityGuard` 提供 `validateInput / detectPromptInjection / sanitizeOutput` 三层防护
  - Prompt 注入检测：基于关键词与模式匹配（"ignore previous"/"system prompt"/"jailbreak" 等）
  - sensitivity_level 分级（0-5），高级别触发更严格校验
- **代码执行沙箱**：[code-executor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/code-executor.ts) `CodeValidator` 用正则检测 import/eval/exec（L74-103），子进程隔离 + 最小环境
- **HTTP SSRF 防护**：[http-request.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/http-request.ts) L26-34 私有 IP CIDR 检测（10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、127.0.0.0/8、169.254.0.0/16）+ 域名白名单 + 禁用重定向
- **文件操作防护**：[file-ops.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/file-ops.ts) L110-143 工作目录约束 + 路径穿越检测（`..` 检测）+ 符号链接检测
- **SQL 注入防护**：[sql-query.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/sql-query.ts) 强制 SELECT + 参数化查询 + 表名白名单 + 禁止注释
- **HITL 审批**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L866-886 `_toolRequiresApproval` 双重判定（配置列表 + 工具实例方法）

#### 优点

1. **安全策略层次分明**：输入校验 → Prompt 注入检测 → 工具级防护（SSRF/路径穿越/SQL 注入）→ HITL 审批，多层防御
2. **sensitivity_level 分级**：支持按场景配置不同安全等级
3. **SSRF 防护全面**：私有 IP CIDR + 域名白名单 + 禁用重定向，覆盖主要攻击面
4. **文件操作多重检测**：工作目录约束 + 路径穿越 + 符号链接，防止目录逃逸
5. **SQL 强制 SELECT**：从语法层面禁止 DDL/DML，参数化查询防注入
6. **HITL 双重判定**：配置列表 + 工具实例方法，灵活性与安全性兼顾

#### 遗留缺陷

1. **CodeExecutor 正则可绕过**：`__import__('o'+'s')` 等字符串拼接可绕过正则，无 AST 解析 — **部分修复**：[code-executor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/code-executor.ts) `_FORBIDDEN_FRAGMENTS` L65-80 增加字符串字面量拼接后片段级匹配（检测 `'o'+'s'` 拼接出 `'os'`），但仍未用 AST 解析
2. **无沙箱化执行**：CodeExecutor 用子进程但未用 namespace/cgroup/seccomp 隔离，进程级隔离弱 — 待办

#### 遗留建议

1. **CodeExecutor AST 校验**（待办，部分缓解）：用 `tree-sitter-python` 或调用 Python 子进程做 `ast.parse` + `NodeVisitor` 白名单校验，替代正则 — 当前已增加 `_FORBIDDEN_FRAGMENTS` 字符串拼接检测（[code-executor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/code-executor.ts) L65-80）作为缓解措施
2. **真沙箱化执行**（待办）：CodeExecutor 改用 Docker 容器或 `gVisor` 隔离，限制 CPU/内存/网络/文件系统

---

## 3. 业务适配层评估

### 3.1 角色 Agent 定义

#### 现状

**没有显式的"角色 Agent"一等公民抽象**，角色由三种机制拼合：

1. **Skill 子系统（轻量级角色封装）**：[skill.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/skill.ts) L14-74 `BaseSkill` 抽象类定义 `name/description/version/tags/examples/systemPromptFragment/tools`，一个 Skill 同时携带"工具集 + 系统提示片段 + few-shot 示例"，事实上承担"角色模板"职责。示例 [math-skill.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/math-skill.ts) L11-45 `MathSkill` 即"数学计算角色"硬编码实现
2. **子图角色模板（多 Agent 协作）**：[builder.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/builder.ts) L27-39 硬编码四类角色模板 `research / coding / review / default`，每个模板对应一段英文 system prompt
3. **Supervisor 任务拆分**：[supervisor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/supervisor.ts) L36 `_DEFAULT_TASK_TYPES = ['research', 'coding', 'review']` 硬编码默认拆分类型

**Skill 加载机制**（可配置但默认关闭）：[loader.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/loader.ts) L48-101 `discover()` 通过目录扫描动态发现 Skill 模块，`loadFromConfig()`（L112-146）受 `skills.enabled` 开关控制，按 `skills.active` 白名单激活，加载失败隔离（L93-96）。

**不支持运行时角色切换**：Skill 在 `create_agent()` 启动时一次性加载（[factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts) L296-303），运行中无法动态增删；`swapComponent('skill', name, component)`（[registry.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/registry.ts) L270-292）虽支持热替换，但已编译的图不会重新构建。

#### 优点

1. **Skill 抽象设计干净**：`BaseSkill` 默认实现完整，子类只需覆写必要方法；`preconditions/requiredScopes/isAvailable` 预留依赖声明与降级机制
2. **运行时对图透明**：Skill 通过 `SkillAdapter`（[adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/adapter.ts) L24-58）降解为"工具名 + 提示片段"，主图无需感知
3. **执行隔离**：`SkillToolWrapper`（L68-117）捕获 Skill 工具内部异常，标准化为 `SKILL_EXECUTION_FAILED`，避免击穿 ReAct 循环
4. **子图状态隔离**：`SubAgentStateAnnotation`（[states.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/states.ts) L43-55）独立于主 `ModuAgentState`，并行子 Agent 不污染主消息历史

#### 缺陷

1. **角色模板硬编码严重**：`builder.ts` L27-39 四套 prompt 与 `supervisor.ts` L36 `_DEFAULT_TASK_TYPES` 直接写在源码中，新增角色必须改代码重新发布
2. **没有"Agent"一等公民抽象**：`BaseSkill` 偏工具/提示封装，`build_subagent_subgraph` 偏图结构，二者没有统一的 `Agent` 接口（如 `Agent.profile / Agent.run / Agent.handoff`），无法表达"客服 Agent"、"数据分析 Agent"这类业务角色
3. **不支持运行时切换**：缺少 per-request 角色路由能力，`routeAfterMemoryQuery`（[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L1073-1091）只能在固定路径中选择
4. **子图 prompt 与 Skill 提示脱节**：`build_subagent_subgraph` 的 system prompt 不经过 `SkillPromptAggregator`，子 Agent 无法继承主图 Skill 提示片段
5. **角色元数据缺失**：没有角色权限声明、角色上下文边界、角色间 handoff 协议
6. **`MathSkill` 是唯一示例**：仓库内仅有一个 Skill 实现，缺乏多角色组合实战验证

#### 建议

1. **引入 `AgentProfile` 抽象**：在 `src/core/interfaces/` 新增 `agent.ts`，定义 `interface AgentProfile { id; role; systemPrompt; tools; skills; routingPolicy; handoffTargets }`，将 Skill + 子图模板 + 路由策略组合成显式角色
2. **角色模板外置**：将 `builder.ts` 的 `_SYSTEM_PROMPT_TEMPLATES` 与 `supervisor.ts` 的 `_DEFAULT_TASK_TYPES` 改为从配置 `orchestration.multi_agent.role_templates` 读取，支持 JSON/YAML 文件加载与热更新
3. **运行时角色路由**：在 `routeAfterMemoryQuery` 之前增加 `role_router` 节点，根据 `state.input_data` 与感知结果选择 AgentProfile，通过 `RunnableConfig.configurable.agent_id` 注入
4. **统一 Skill 与子图 prompt 通路**：让 `build_subagent_subgraph` 接受 `SkillPromptAggregator` 输出作为 base prompt，使子 Agent 继承主图 Skill 上下文
5. **角色注册中心**：扩展 `ComponentRegistry`，新增 `registerAgent/profile`，支持运行时 `swapComponent('agent', ...)`

### 3.2 业务 Prompt 模板

#### 现状

**三层组装模式**（[factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts) L374-387）：

```
第①层：外部传入 + 默认
  effectiveSystemPrompt = configurable['system_prompt'] ?? systemPrompt ?? _DEFAULT_ANTI_HALLUCINATION_PROMPT
        ↓
第②层：Skill 聚合
  SkillPromptAggregator.aggregate(base, registry) → base + '\n\n' + [Skill片段].join()
        ↓
第③层：节点运行时注入
  agentNode 中插入 SystemMessage(perceptionCtx) + SystemMessage(knowledge) + SystemMessage(stepCtx)
```

- **第一层**：[factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts) L55-61 `_DEFAULT_ANTI_HALLUCINATION_PROMPT` 硬编码防幻觉底线 prompt
- **第二层**：[prompt-aggregator.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/prompt-aggregator.ts) L24-47 `aggregate()` 把所有已注册 Skill 的 `systemPromptFragment()` 与 examples 拼接，前缀 `[Skill: name v版本]`
- **第三层**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L437-482 `agentNode` 运行时插入 perception/knowledge/step 上下文 SystemMessage
- **Plan-Execute 专属 prompt**：[prompts.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/prompts.ts) `buildPlannerSystemPrompt`（L47-87）+ `buildPlannerSystemPromptCompact`（L102-131）+ `buildReplanContext`（L139-152）
- **配置预留项**：[runtime-config.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts) L23 `llm.prompt_template: ''` 预留但**完全未使用**

#### 优点

1. **三层分离清晰**：底线 prompt / Skill 聚合 / 节点运行时注入各司其职，宿主只传一段 prompt 也能跑起来
2. **防幻觉底线设计扎实**：`_DEFAULT_ANTI_HALLUCINATION_PROMPT` 显式列举规则，强制工具调用优先
3. **Skill 聚合幂等降级**：`SkillPromptAggregator.aggregate` 异常时返回原 base prompt，不阻断主流程
4. **Plan-Execute 上下文注入精细**：[context.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/context.ts) L30-84 注入当前步骤 + 前序步骤摘要 + `requires_tool` 强制工具调用提醒 + 禁止重复前序内容约束

#### 缺陷

1. **Prompt 硬编码严重，无持久化**：`_DEFAULT_ANTI_HALLUCINATION_PROMPT`、`_SYSTEM_PROMPT_TEMPLATES`、Planner prompt 全部写死在源码中。`llm.prompt_template` 配置项预留却未接通
2. **无模板引擎，变量插值脆弱**：`prompts.ts` L56-86 用 `${toolCatalogText}` 直接插入，若含特殊字符（反引号、$）会破坏 prompt 结构，无转义机制
3. **不支持热更新**：`effectiveSystemPrompt` 在 `create_agent()` 构图时一次性确定，运行时修改 `RuntimeConfig` 不会触发 prompt 重建
4. **无 Prompt 版本管理**：缺少 prompt 版本快照、A/B 测试、回滚能力。`VersionedComponentStore`（[versioned-store.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/versioned-store.ts)）只支持组件版本
5. **Skill 提示片段顺序不确定**：`prompt-aggregator.ts` L27-30 用 `Object.keys(registry.listSkills())` 遍历，跨重启可能变化
6. **Plan-Execute prompt 仅英文**：与中文防幻觉 prompt 风格不一致，多语言场景下效果可能漂移

#### 建议

1. **接通 `llm.prompt_template` 配置项**：在 `factory.ts` L376 增加 `runtimeConfig.get('llm.prompt_template', '')` 作为额外优先级层
2. **引入模板引擎**：采用 Mustache 或自研 `{{var}}` 模板，对变量值做转义。Prompt 改为模板文件，存放于 `prompts/` 目录
3. **Prompt 持久化与热更新**：扩展 `VersionedComponentStore` 支持 prompt 版本管理；通过 `RuntimeConfig.registerChangeCallback` 监听 prompt 配置变更，触发 `ModuGraph` 重建
4. **Skill 提示片段稳定排序**：在 `SkillPromptAggregator` 中按 `skill.name()` 字典序排序
5. **多语言支持**：为 Planner prompt 提供中英文双版本，通过 `llm.language` 配置切换

### 3.3 领域知识库接入

#### 现状

**长/短期记忆双轨架构**：

- **短期记忆**：[short-term-memory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/short-term-memory.ts) L19-114 `InMemoryShortTermMemory`，纯内存 Map，按 userId 维护对话历史，支持 TTL 过期清理 + context_window 解析。**已被 LangGraph Checkpointer 取代**，仅作为兼容保留
- **长期记忆**：[chroma.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/chroma.ts) L61-307 `ChromaLongTermMemory`，基于 ChromaDB 向量存储，按 `${collectionPrefix}_${userId}` 隔离 collection

**向量库接入抽象（三级降级）**：[chroma.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/chroma.ts) L160-175 `_initEmbeddingFunction`：
- 第一级 SentenceTransformer：TS 无等价库，跳过
- 第二级 ONNX Runtime：TS 无等价库，跳过
- 第三级 **hash embedding**（L24-46）：使用 SHA-256 迭代生成 384 维向量，归一化后返回

外部嵌入可通过 `setEmbeddingFunction(fn, dim)`（L185-190）注入。

**知识检索注入机制（RAG 链路）**：
- 查询节点：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L196-225 `makeMemoryQueryNode(store)` 调用 `store.search([userId, 'knowledge'], { query: cleanedText, limit: 5 })`
- 注入节点：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L456-469 `agentNode` 把 `state.knowledge` 拼成 SystemMessage
- 更新节点：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L249-322 `makeMemoryUpdateNode(store)` 把对话历史拼成文本写入

#### 优点

1. **三级降级稳健**：嵌入函数降级到 hash embedding 保证无外部依赖也能运行
2. **持久化路径灵活**：[chroma.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/chroma.ts) L94-104 `_resolvePersistPath` 支持环境变量与显式参数三级优先级
3. **RAG 链路完整**：query → state.knowledge → SystemMessage 注入 → LLM 推理 → memory_update 闭环可观测
4. **按 userId 隔离 collection**：`_getOrCreateCollection`（L196-203）以 `${prefix}_${userId}` 命名，多租户隔离干净

#### 缺陷

1. **嵌入质量差（最严重）**：默认 hash embedding 无语义能力，检索效果接近随机。`chroma.ts` L168-175 警告只在初始化时打一次，用户不易感知
2. **不支持多源知识库**：`makeMemoryQueryNode(store)` 单 store 设计，无法同时检索 Chroma + Elasticsearch + 关系数据库
3. **无知识库管理 API**：缺少知识的 CRUD 接口（导入文档、删除过期、重建索引）
4. **无重排（rerank）能力**：`store.search` 直接返回 top-5，无 cross-encoder 重排
5. **无 chunking 策略**：`makeMemoryUpdateNode` 把整段对话历史作为一个 document 写入，超长文本嵌入质量差
6. **查询仅用 cleanedText**：无 query 改写、HyDE、多查询融合等优化
7. **短期记忆与长期记忆割裂**：`InMemoryShortTermMemory` 实现了 `BaseMemory` 接口但未被 LangGraph 路径使用，沦为遗留代码
8. **无相关性阈值过滤**：`makeMemoryQueryNode` 取 top 5 不论距离，低相关性记忆仍会注入
9. **`limit: 5` 硬编码**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L211 写死 5
10. **无记忆去重**：同一事实在不同会话中重复写入，造成存储膨胀与召回噪音

#### 建议

1. **接入语义嵌入**：在 `chroma.ts:_initEmbeddingFunction` 中动态导入 `@xenova/transformers`（all-MiniLM-L6-v2 ONNX 模型），或对接外部 embedding API（OpenAI/Voyage）
2. **多源知识库聚合层**：新增 `CompositeStore` 实现 `BaseStore`，内部维护 `[store1, store2, ...]` 列表，`search` 时并行查询并合并结果
3. **知识库管理 API**：在 `src/memory/` 新增 `knowledge-admin.ts`，提供 `ingestDocument / deleteByFilter / rebuildIndex` 接口
4. **Chunking 策略**：在 `makeMemoryUpdateNode` 中按句子或固定 token 数切分对话历史
5. **查询改写**：在 `makeMemoryQueryNode` 前增加 `query_rewrite` 节点，用 LLM 把用户原始 query 改写为多个子查询
6. **Rerank**：在 `store.search` 返回后增加 `rerank(query, items, topK)` 步骤
7. **相关性阈值**：`makeMemoryQueryNode` 增加 `memory.relevance_threshold` 配置
8. **`limit` 配置化**：`memory.recall_top_k` 配置项
9. **清理 `InMemoryShortTermMemory`**：标记 `@deprecated` 或迁移为 Checkpointer 的内存实现

### 3.4 专属工具集

#### 现状

**统一注册机制**：[registry.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/registry.ts) L115-135 `registerTool/getTool/listTools` 提供全局注册表，幂等注册。[tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-adapter.ts) L109-137 `wrap_modu_tool` 把 ModuAgent `BaseTool` 适配为 LangChain `DynamicStructuredTool`。

**内置工具集**（[src/tools/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/)）：

| 工具 | 文件 | 审批 | 安全策略 |
|------|------|------|---------|
| CalculatorTool | calculator.ts | 否 | 白名单字符 + 递归下降解析器 |
| DateTimeTool | datetime-tool.ts | 否 | 纯计算 |
| SearchTool | search.ts | 否 | DuckDuckGo 默认，Tavily 可选 |
| HttpRequestTool | http-request.ts | 是 | SSRF 防护 + 域名白名单 + 禁用重定向 |
| FileOpsTool | file-ops.ts | 是 | 工作目录约束 + 路径穿越 + 符号链接检测 |
| CodeExecutorTool | code-executor.ts | 是 | 白名单字符 + 禁止 import/eval + 子进程隔离 |
| SqlQueryTool | sql-query.ts | 是 | 仅 SELECT + 参数化 + 表名白名单 |
| SyncActionExecutor | synchronous-executor.ts | — | registry 查找，异常隔离（**实质已被 ToolNode 取代**） |

**MCP 远程工具接入**（[src/mcp/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/)）：
- 传输层抽象：[transport.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/transport.ts) L36-63 `Transport` 基类，实现 `StdioTransport` + `SSETransport` + `WebSocketTransport`
- 多连接管理器：[client.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/client.ts) L168-366 `MCPClient` 管理多 Server，工具名格式 `server_name__raw_name`
- 适配为 BaseTool：[mcp-tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/mcp-tool-adapter.ts) L37-178 `MCPToolAdapter`，`description()` 前缀 `[MCP:server]`
- 零侵入集成：[factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts) L205-242 `_discover_and_register_mcp_tools` 自动发现并注册

**工具权限控制**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L866-886 `_toolRequiresApproval` 双重判定——工具名在 `tools.human_in_loop.sensitive_tools` 配置列表中 **或** 工具实例 `requiresApproval()` 返回 true。

> 说明：原 §3.4 中与 §4.3 重复的已修复项（CalculatorTool schema 正则、SqlQueryTool 表名提取、MCP 超时硬编码、工具结果大小限制、工具结果缓存）已在 v1.1/v1.3 修复，不再赘述。

#### 优点

1. **统一注册表设计干净**：内置工具与 MCP 工具在 registry 中无差异，`build_langchain_tools` 单一通路消费
2. **安全策略层次分明**：CalculatorTool 白名单 + 递归下降；HttpRequestTool 多层 SSRF 防护；FileOpsTool 路径穿越 + 符号链接；CodeExecutorTool 子进程隔离；SqlQueryTool 强制 SELECT + 参数化
3. **HITL 设计完善**：`requiresApproval` + `sensitive_tools` 双重判定；`onApprovalRejected` 钩子允许工具自定义降级响应
4. **MCP 集成成熟**：传输层抽象支持 stdio/SSE/WebSocket 双协议；工具名全限定避免跨 Server 冲突；`MCPToolAdapter` 执行隔离捕获异常
5. **工具重试机制**：`with_tool_retry` 为工具 invoke 添加指数退避，仅捕获瞬时网络异常
6. **元信息/版本化/组合基础已具备**：`BaseTool.version()` / `followUpTools()` 已提供（v1.3）

#### 缺陷

1. **无"业务专属工具"概念**：所有工具平等注册到 registry，无法表达"客服 Agent 专用工具集"vs"数据分析 Agent 专用工具集"
2. **工具元信息单薄**：`listTools()` 仅返回 name/description/parameters_schema，缺少 `category/required_scopes/cost/latency_profile/version` 等业务维度
3. **MCP 工具权限粒度粗**：`MCPToolAdapter.requiresApproval()` 永远返回 false，所有 MCP 工具一视同仁；`sensitive_tools` 配置只能按名匹配，无法按 Server 维度批量控制
4. **工具无版本管理（未接通）**：`VersionedComponentStore` 支持 `tool` category（[registry.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/registry.ts) L275），但实际未使用
5. **工具调用上下文缺失**：`BaseTool.invoke(params, context)` 的 context 当前为空对象（[tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-adapter.ts) L121 传入 `{}`），无法传递 `userId/sessionId/traceId` 等业务上下文
6. **CodeExecutor 安全策略可绕过**：正则检测 import/eval，但 Python 代码可用 `__import__('o'+'s')` 等字符串拼接绕过

#### 建议

1. **引入工具集（ToolSet）抽象**：新增 `interface ToolSet { id; tools; requiredScopes; applicableRoles }`，`build_langchain_tools` 改为接受 `toolSetId` 参数，支持 per-request 工具集切换
2. **丰富工具元信息**：扩展 `listTools()` 返回 `{name, description, parameters_schema, category, version, required_scopes, cost, avg_latency}`，供 Planner 与 HITL 决策
3. **MCP 工具按 Server 权限控制**：在 `mcp.servers` 配置中增加 `requires_approval: bool` 与 `sensitive_tools: [...]`
4. **工具调用上下文透传**：`wrap_modu_tool` 的 `func` 改为接收 `(input, config)`，从 `RunnableConfig.configurable` 提取 `userId/sessionId/traceId` 注入 `context`
5. **CodeExecutor AST 校验**：用 `tree-sitter-python` 或调用 Python 子进程做 `ast.parse` + `NodeVisitor` 白名单校验
6. **工具版本管理接通**：让 `VersionedComponentStore` 实际接管工具版本，`swapComponent('tool', name, newTool)` 后触发图重建

### 3.5 评估集

#### 现状

**没有显式的"评估数据集"抽象**：全代码搜索未发现 `EvalSet/Dataset/Benchmark/TestSuite` 等概念。`src/feedback/` 与 `src/evolution/` 模块均基于在线（online）反馈信号工作，无离线评估集。

**评估指标体系**（[src/feedback/metrics/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/metrics/)）：
- [accuracy.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/metrics/accuracy.ts) L4-49 `AccuracyMetrics`：从 `toolResults` 计算 `success_rate/error_rate/avg_time`，仅基于 `result.success === true` 字段判定
- [efficiency.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/metrics/efficiency.ts) L4-40 `EfficiencyMetrics`：从 `usage/iterationCount/latencyMs` 计算 `token_efficiency/iteration_efficiency/tokens_per_second`
- [quality-monitor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/quality-monitor.ts) L25-596 `QualityMonitor`：响应质量监控，支持 `rule/llm/hybrid` 三模式
  - rule 模式（L101-134）：基于关键词的 relevance/completeness/confidence/tool_success 评分
  - llm 模式（L167-177）：调用独立 LLM Judge，输出 JSON 五维评分
  - hybrid 模式（L179-189）：规则 + LLM 双路加权融合（默认 rule 0.4 + llm 0.6）

**feedback → evolution 链路**：
- [loop-controller.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/loop-controller.ts) L20-162 `FeedbackLoop`：`evaluate` + `shouldEvolve`（样本量 ≥ `min_sample_size` 默认10 且最近窗口内 60%+ 的 `quality_score < threshold` 默认0.6 时触发）
- [evolution-orchestrator.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/evolution-orchestrator.ts) L33-218 `EvolutionOrchestrator`：串联 FeedbackLoop.evaluate → shouldEvolve → ParameterTuneStrategy.analyzeAndAdjust
- [parameter-tune.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/parameter-tune.ts) L16-211 `ParameterTuneStrategy`：按规则调整 `temperature/max_reasoning_iterations`，返回 `config_overrides` 由调用方注入

**未接通的进化策略**：
- [component-swap.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/component-swap.ts) L12-86 `ComponentSwapStrategy`：基于 A/B 测试得分的组件热替换，**未接入 EvolutionOrchestrator**
- [rollback-mechanism.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/rollback-mechanism.ts) L23-151 `RollbackMechanism`：质量低于阈值时自动回滚，**未接入主链路**
- [versioned-store.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/versioned-store.ts) L50-279 `VersionedComponentStore`：基于文件系统的版本快照存储，**无实际调用方**

#### 优点

1. **三模式评估器设计灵活**：rule/llm/hybrid 覆盖不同精度与成本需求
2. **LLM Judge 输出鲁棒**：`_parseJudgeResponse` 先 JSON.parse，失败后正则提取，逐字段钳制到 [0,1]，容错性强
3. **进化信号统一收集**：`EvolutionSignalCollector` 通过 EventBus 订阅多源事件，按周期聚合
4. **per-session 参数调优**：`config_overrides` 通过 `state.config_overrides` 传递给下一次请求，实现会话级参数覆盖而不污染全局配置
5. **闭环可观测**：`makeFeedbackNode` 把 evaluation/should_evolve/evolution_action 全部写入 state

#### 缺陷

1. **无显式评估数据集**：所有评估均在线进行，缺少离线 benchmark 数据集。无法回答"Agent 在 X 类问题上的准确率是多少"，无法做版本对比
2. **指标体系不完整**：AccuracyMetrics 仅基于 `result.success` 字段，无 ground-truth 对比；缺少 P50/P95/P99 延迟分位数；缺少任务完成率、用户满意度、hallucination 率
3. **进化策略未完整接通**：`ComponentSwapStrategy` 与 `RollbackMechanism` 已实现但未在 `EvolutionOrchestrator` 中调用，沦为死代码；`VersionedComponentStore` 无实际调用方
4. **调优阈值硬编码**：[parameter-tune.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/parameter-tune.ts) L18-30 `ACCURACY_THRESHOLD=0.6`、`ITERATIONS_THRESHOLD=10`、`TOOL_FAILURE_THRESHOLD=0.3`、`TEMPERATURE_STEP=0.1` 写死
5. **进化决策数据源单一**：`shouldEvolve` 仅看 `quality_score`，不考虑 `accuracy/tool_effectiveness` 等其他维度
6. **反馈样本无持久化**：`FeedbackLoop._cumulativeMetrics` 纯内存，进程重启后丢失
7. **LLM Judge 无缓存**：相同 (prompt, response) 重复评估会重复调用 LLM
8. **评估与训练无闭环**：进化仅调整 `temperature/max_iterations` 两个参数，无法调整 prompt、工具集、Skill 组合等更高维度
9. **无 A/B 测试框架**：`ComponentSwapStrategy` 有 `recordScore/shouldSwap` 雏形，但无流量分配、实验组对照组、统计显著性检验

#### 建议

1. **引入评估数据集抽象**：在 `src/eval/` 新增 `dataset.ts` 定义 `interface EvalDataset { id; samples; metrics }`，支持 JSONL 加载、流式评估、结果导出。提供 CLI `modu-agent eval --dataset xxx.jsonl --agent-config yyy.json`
2. **指标体系扩展**：新增 `TaskCompletionMetrics`（任务完成率）、`HallucinationMetrics`（基于事实库对比）、`LatencyPercentileMetrics`（P50/P95/P99）、`UserSatisfactionMetrics`（用户反馈打分）
3. **接通 ComponentSwap 与 Rollback**：在 `EvolutionOrchestrator` 中增加 `componentSwapStrategy` 与 `rollbackMechanism` 成员，`evaluateAndEvolve` 在 ParameterTune 之后调用 `componentSwap.shouldSwap`，并注册 `RollbackMechanism.recordAndCheck` 作为质量回退钩子
4. **调优阈值配置化**：把 `parameter-tune.ts` L18-30 的常量改为从 `feedback.parameter_tune.*` 配置读取
5. **反馈样本持久化**：让 `FeedbackLoop._cumulativeMetrics` 通过 `BaseStore` 持久化，按 sessionId 分片
6. **多维进化决策**：`shouldEvolve` 改为接受多维度阈值 `{quality_score, accuracy, tool_effectiveness}`，任一维度触发即进化
7. **LLM Judge 缓存**：在 `QualityMonitor` 中增加 `(prompt+response) → result` 的 LRU 缓存
8. **Prompt 进化**：扩展 `EvolutionOrchestrator` 支持 `PromptOptimizeStrategy`，基于评估结果调整 prompt 片段
9. **A/B 测试框架**：基于 `ComponentSwapStrategy` 扩展 `ABTestFramework`，支持流量分组、统计显著性检验、实验报告自动生成

---

## 4. 核心能力层评估（遗留项）

### 4.1 规划策略

#### 现状

**Plan-and-Execute 模块**（[src/graph/plan-execute/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/)）：6 文件模块化拆分，统一从 [index.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/index.ts) 导出。

- **类型定义**：[types.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/types.ts) `PlanStep`（L7-21）含 `step_id / title / description / depends_on / status / requires_tool`；`PlanStepSchema` / `PlanSchema`（L29-41）使用 zod 约束；`StepResult`（L44-52）；`PlanStateDelta`（L55-66）对齐前端 SSE 协议
- **Planner 节点**：[planner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/planner.ts) `makePlannerNode`（L212-375）使用**未绑定工具的原始 LLM**（`rawLlm`），规划阶段禁止工具调用
  - **三阶段容错降级**（L286-351）：首次完整 prompt → 重试简洁版（maxSteps/2 + temperature=0）→ 仍失败返回空 plan 降级直答
  - `_parsePlan`（L165-203）：`_extractJson`（兼容 markdown fence）+ zod 校验 + `_isStepContentReasonable` 语义合理性后检
  - `_inferRequiresTool`（L94-103）：弱模型不可靠输出 `requires_tool` 的兜底，基于中英文实时数据关键词匹配
- **步骤分发与收尾**：[dispatcher.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/dispatcher.ts)
  - `makeStepDispatchNode`（L41-83）：定位 `plan[current_step_index]` → 写入 `current_step`、记录 `step_msg_baseline`、标记 step running
  - `stepDispatch` 路由（L98-139）：`idx >= plan.length` → `response`；末步失败 + `continue_on_failure=false` + `replan_count < max_replans` → `planner`；否则 → `agent`
  - `makeStepFinalizeNode`（L177-348）：失败判定三种（`missingToolCall`/`allToolsFailed`/`noOutput`），**降级模式**（L275-284）工具全失败但 LLM 产出 fallback 内容时标记 `degraded=true` 而非 failed，**代际隔离**（L24-29）按 `replan` 标签过滤
- **步骤上下文注入器**：[context.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/context.ts) `makePlanContextInjector`（L27-84）产出 SystemMessage：当前步骤 + 前序步骤摘要（截断 `step_summary_max_chars`）+ `requires_tool=true` 时的强制工具调用提醒 + 禁止重复前序内容约束
- **Planner 提示词**：[prompts.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/prompts.ts) `buildPlannerSystemPrompt`（L47-87）注入工具清单 + 严格 JSON schema + 7 条规则；`buildPlannerSystemPromptCompact`（L102-131）重试专用简洁版 + one-shot 示例

**图接入**：[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts)
- 门控（L277-291）：`plan_execute.enabled` 默认 false；与 `multi_agent` 互斥，**multi_agent 优先**
- 边接线（L402-422）：`memory_query → planner → step_dispatch → agent ⇄ tools → step_finalize → step_dispatch ↻`；`step_dispatch` 失败可重规划 → `planner`
- 递归预算调整（L504-510）：`baseLimit += maxSteps * (maxIterations * 3 + 2) + (maxReplans + 1) * 2 + 2`

**路由分叉**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts)
- `routeAfterMemoryQuery`（L1073-1091）：优先级 `multi_agent > per-request configurable.plan_execute_enabled > 全局 plan_execute.enabled > agent`
- `routeAfterAgent`（L375-395）：有 tool_calls → `tools`；无 tool_calls + `plan_phase === 'executing'` → `step_finalize`；否则 → `__end__`

> 说明：原 §4.1 缺陷 1-8、建议 1-8（DAG 并行分发、步骤级重试、部分重规划、结构化输出、`requires_tool` 元数据驱动、`started_at` 写入、Plan-Execute + multi_agent 组合、`expected_output/verification_hint`）均已在 v1.2 修复，正文不再赘述。

#### 优点

1. **零侵入门控**：默认关闭，对现有 ReAct / HITL / 多 Agent 路径无影响
2. **Planner 容错健壮**：三阶段降级（完整 → 简洁 → 直答），针对弱模型嵌套 plan 塌陷有专门防御
3. **`requires_tool` 兜底推断**：弱模型不可靠输出该字段时，关键词匹配 + 引用前序步骤排除逻辑做代码层兜底
4. **代际隔离**：`step_results` 按 `replan` 标签过滤，避免重规划后旧失败结果干扰新计划路由
5. **降级模式**：工具全失败但 LLM 产出 fallback 内容时判 `degraded` 而非 `failed`，避免无意义重规划
6. **前序步骤工具调用豁免**：`missingToolCall` 判定时若前序步骤已成功调用工具且本步有 AI 输出则不判失败
7. **per-request 启用**：`configurable.plan_execute_enabled` 支持运行时按请求开启

#### 遗留缺陷

1. **递归预算估算粗放**：`maxSteps * (maxIterations * 3 + 2)` 假设每步最多 ReAct `maxIterations` 轮 — 待修复：仍沿用 `baseLimit += maxSteps * (maxIterations * 3 + 2) + (maxReplans + 1) * 2 + 2` 估算公式，未按 `sum(step.estimated_iterations)` 动态计算
2. **无计划持久化与恢复**：checkpointer 保存 `plan / step_results / current_step_index`，但 `replan_count` 语义在恢复后可能混乱 — 待修复：`step_dispatch` 未增加幂等检查，恢复后 `replan_count` 语义仍可能混乱

#### 遗留建议

1. **计划持久化与恢复**：在 `step_dispatch` 增加幂等检查，恢复后从 `current_step_index` 继续 — 待修复：未实现幂等检查与 `replan_count` 语义恢复
2. **递归预算精细化**：按 `sum(step.estimated_iterations)` 动态计算 — 待修复：仍沿用静态估算公式

### 4.2 记忆管理

#### 现状

**短期/长期清晰分工**：
- 短期由 LangGraph Checkpointer（thread_id 自动管理）持久化整个 State
- 长期由 Store（向量库）按 namespace 检索

**抽象接口**：[memory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/memory.ts) L8-20 `BaseMemory`：`query(userId, contextWindow, requiredFields)` / `update(userId, newData, metadata)`，返回值标注为 `Promise<Record> | Record`（混用同步/异步）。

**长期记忆实现**：[chroma.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/chroma.ts) `ChromaLongTermMemory`：
- 嵌入三级降级：SentenceTransformer（TS 无库跳过）→ ONNX Runtime（TS 无库跳过）→ **hash embedding**（SHA-256 迭代生成 384 维向量）
- `setEmbeddingFunction`（L185-190）支持外部注入语义嵌入函数
- 持久化路径解析（L94-104）：显式 > `MODU_CHROMA_IN_MEMORY=1`（内存模式）> `MODU_CHROMA_PATH` > `./chroma_data`
- `query`（L205-264）：跳过 `last_` 开头的 contextWindow，返回 `{content, relevance_score, ...requiredFields}`
- `update`（L266-307）：upsert by `doc_id`，自动丰富 metadata

**图状态字段**：[state.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/state.ts)
- `messages`（L147-149）：LangGraph 内置 `messagesStateReducer`，自动追加
- `history`（L169）：`Array<Record>`，last-write-wins reducer——**实际未被图节点写入**（已被 `messages` 取代）
- `knowledge`（L170）：`Array<Record>`，由 `memory_query` 节点写入
- `cleaned_text`（L161）：感知节点产出的清洗后文本，作为 memory query 的查询输入

**记忆节点**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts)
- `makeMemoryQueryNode`（L196-225）：`store.search([userId, 'knowledge'], {query: cleanedText, limit: 5})`，仅取 top 5
- `makeMemoryUpdateNode`（L249-322）：将 `messages` 拼接为 `role: content` 文本，`store.put([userId, 'history'], key=sessionId_timestamp, {...})`。熔断场景（`error_code` 非空）跳过更新

#### 优点

1. **短期/长期清晰分工**：短期由 Checkpointer 持久化整个 State，长期由 Store 向量库检索
2. **per-user 命名空间隔离**：`[userId, 'knowledge']` / `[userId, 'history']` 防止跨用户数据泄露
3. **记忆更新接入图结构**：`memory_update` 节点替代原 fire-and-forget，可观测、异常可追踪
4. **熔断跳过更新**：`error_code` 非空时跳过记忆写入，避免错误响应污染记忆库
5. **嵌入函数可注入**：`setEmbeddingFunction` 为生产环境接入语义嵌入预留扩展点
6. **Chroma 持久化路径灵活**：三级解析支持开发/生产/测试多场景

#### 缺陷

1. **hash embedding 无语义（最严重）**：SHA-256 哈希向量本质上是关键词精确匹配，cosine 相似度无语义意义，严重限制长期记忆召回质量
2. **无记忆去重**：`memory_update` 每次写入新 key（`sessionId_timestamp`），同一事实在不同会话中重复写入
3. **无记忆压缩/摘要**：`makeMemoryUpdateNode` 将完整 `messages` 拼接为文本直接 put，长对话会迅速膨胀单条记录大小
4. **无相关性阈值过滤**：`makeMemoryQueryNode` 取 top 5 不论距离
5. **查询输入单一**：memory query 仅用 `cleaned_text`，未融合最近 N 轮对话上下文
6. **无跨会话聚合**：所有会话写入同一 `[userId, 'history']` namespace
7. **无记忆分类**：所有记忆同质化存储，无 fact/preference/entity/event 分类
8. **无记忆衰减/遗忘**：Chroma 长期记忆无任何遗忘机制，过时信息永久驻留
9. **接口同步/异步不一致**：`BaseMemory.query` 返回 `Promise | Record`（[memory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/memory.ts) L13），调用方需 typeof 判断，类型不安全
10. **`history` state 字段僵尸**：[state.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/state.ts) L169 定义但无节点写入
11. **`limit: 5` 硬编码**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L211 写死 5

#### 建议

1. **集成语义嵌入**：引入 `@xenova/transformers`（Node.js 兼容）运行 all-MiniLM-L6-v2，或对接外部 embedding API（OpenAI/Voyage）
2. **记忆去重**：写入前用 embedding 相似度（阈值 0.92）检测近重复，命中则 upsert 合并
3. **记忆压缩/摘要**：`memory_update` 节点增加 LLM 摘要步骤，将原始对话压缩为结构化事实（`{facts: [...], preferences: [...], entities: [...]}`）后写入
4. **相关性阈值**：`makeMemoryQueryNode` 增加 `memory.relevance_threshold` 配置
5. **查询上下文扩展**：memory query 输入改为 `cleaned_text + 最近 3 轮 messages`
6. **记忆分类**：扩展 Store namespace 为 `[userId, 'knowledge', 'fact']` / `[..., 'preference']` / `[..., 'entity']`
7. **记忆衰减**：长期记忆按 `recency * relevance` 加权，定期归档低分记忆
8. **统一接口签名**：`BaseMemory.query` 强制 `Promise<Record>`
9. **移除 `history` 字段**或重新启用
10. **`limit` 配置化**：`memory.recall_top_k` 配置项
11. **废弃 `InMemoryShortTermMemory`**：标记 `@deprecated`

### 4.3 工具调度

#### 现状

**ReAct 工具循环**：[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts) L462-464 `tools → tool_processor → agent`，工具结果经 `toolResultProcessor` 处理后回到 agent。

- `routeAfterAgent`（[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L375-395）：检查最后一条 AIMessage 的 `tool_calls`，有 → `tools`，无 → `__end__` 或 `step_finalize`
- `ToolNode`（[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts) L346）：使用 `@langchain/langgraph/prebuilt` 的 `ToolNode`
- `makeToolResultProcessor`（[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L551-593）：遍历 messages 提取 ToolMessage，按 `tool_call_id` 去重

**HITL 人工审批**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) `makeHumanReviewNode`（L900-1036）
- `_toolRequiresApproval`（L866-886）：检查 `sensitiveTools` 配置列表 + `moduTool.requiresApproval()` 方法
- 命中则 `interrupt({...})` 暂停图（L951-957），等待 `Command(resume={approved, feedback, timeout})` 恢复
- 拒绝路径（L984-1032）：调用 `moduTool.onApprovalRejected(args)` 钩子生成降级结果
- **超时机制**（[runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts) L1138-1217）：`checkInterruptTimeout` 读取 `tools.human_in_loop.approval_timeout_seconds`（默认 300s），超时自动 `resume_sync(approved=false, {timeout: true})`

**工具重试**：[retry.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/retry.ts)
- `isRetryableException`（L46-74）：429 / 5xx / Node.js 网络错误码 / TypeError / timeout 正则
- `with_tool_retry`（L86-140）：指数退避 `base_delay * 2^attempt`，钳制到 `max_delay`

**Skill 工具包装**：[adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/adapter.ts) `SkillToolWrapper`（L68-117）执行隔离包装，异常标准化为 `{status:'error', error_code:'SKILL_EXECUTION_FAILED'}`

**MCP 远程工具**：[mcp/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/) + [mcp-tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/mcp-tool-adapter.ts)
- `MCPClient`（[client.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/client.ts) L168-366）：多 Server 连接管理，单 Server 失败不阻断其他
- `MCPToolAdapter`（[mcp-tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/mcp-tool-adapter.ts) L37-178）：`name()` 返回 `qualifiedName`，`description()` 前缀 `[MCP:server]`，`requiresApproval()` 默认 false

#### 优点

1. **统一工具抽象**：原生工具 / Skill 工具 / MCP 远程工具都通过 `BaseTool` → `wrap_modu_tool` → `StructuredTool` 统一接入
2. **HITL 使用原生 interrupt**：基于 LangGraph `interrupt()` + `Command(resume)`，checkpointer 自动持久化暂停状态
3. **HITL 超时清理**：`checkInterruptTimeout` + `sweepExpiredInterrupts` 提供生产级超时清理
4. **拒绝路径有钩子**：`onApprovalRejected` 让工具自定义拒绝消息
5. **工具重试精准**：仅重试瞬时故障（429/5xx/网络错误），不重试参数错误
6. **SkillToolWrapper 执行隔离**：单个 Skill 异常不扩散到图
7. **MCP 全限定名**：`server__raw_name` 避免跨 Server 同名工具冲突
8. **MCP 单 Server 失败不阻断**：`MCPClient.start` 容错

> **本节结论**：原 §4.3 列出的 10 项缺陷与 11 项建议（工具结果截断/缓存、HITL 改参批准、动态敏感性检测、工具限流、MCP 超时配置化、WebSocket transport、SyncActionExecutor 废弃、工具版本化、工具组合 API、类型安全重构）均已在 v1.3 全量修复（部分限流项在 v1.1 §2.5 已修复）。详见文末「附录 B：修复状态总览」。本节无遗留问题项。

### 4.4 多 Agent 协作

#### 现状

**子图构建器**：[builder.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/builder.ts) `build_subagent_subgraph`（L75-188）构建独立编译子图：`START → sub_agent ⇄ sub_tools → sub_finalize → END`，使用 `SubAgentStateAnnotation` 隔离状态，独立 `recursionLimit`（默认 10）。`build_subagent_subgraph` 已在 `tools` 非空时被 `makeSubagentNode` 调用，启用带 ReAct 工具循环的子图。

**Supervisor 节点**：[supervisor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/supervisor.ts)
- `decompose_task`（L75-111）：**规则化拆分**——按 `_DEFAULT_TASK_TYPES = ['research', 'coding', 'review']` 切片到 `max_subagents`，每个子任务携带**相同 prompt 但不同 task_type**
- `decompose_task_with_llm`（L128-195）：**LLM 驱动拆分**，每个子任务有独立 description + `depends_on` 依赖关系；失败自动 fallback 到 `decompose_task`
- `make_supervisor_node`（L218-282）：优先 LLM 拆分，检测 `need_help` 信号触发重新拆分（动态子 Agent 生成），支持多轮 `supervisor_round`
- `route_from_supervisor`（L301-334）：依赖感知分发，仅派发 `depends_on` 已完成的子任务

**图接入**：[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts)
- 门控（L362-368）：`orchestration.multi_agent.enabled` 默认 false
- 边接线（L537-545）：`memory_query → supervisor → route_from_supervisor (Send × N) → subagent_run → consensus → finalize_response`
- 节点初始化（L415-424）：`make_supervisor_node(null, null, supervisorPlannerLlm)` 传入 plannerLlm；`makeSubagentNode(boundLlm, systemPrompt, tools)` 传入 tools 启用子 Agent 工具能力

**子 Agent 节点**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) `makeSubagentNode`（L1229-1397）：
- `tools` 非空时通过 `build_subagent_subgraph` 构建带 ReAct 循环的子图（按 task_type 过滤工具，`_filterToolsByTaskType` L1411-1427）
- 黑板：读取 `state.blackboard` 注入子任务上下文（L1287-1291），写入结果摘要供后续子 Agent 读取（L1385-1392）
- 超时：`_invokeWithTimeout` L1436-1446（`Promise.race`）+ `subgraph_timeout_ms` 配置（默认 30s）
- 重试：指数退避重试（`subagent_max_retries` 默认 1，L1300-1366）

**共识聚合**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) `makeConsensusNode`（L1461-1580）
- 动态 quorum（L1484-1488）：`max(1, ceil(subtask_count / 2))`，配置 `consensus_quorum > 0` 时沿用配置
- 统一入口（L1498-1520）：改用 `ConsensusPattern` 封装 quorum 校验 + 失败事件发布
- 链路修复（L1536, L1565, L1574）：consensus 结果作为 AIMessage 追加到 `messages`
- 策略选择（L1493-1496）：`create_consensus_strategy(strategyName, judgeLlm, taskDesc)`，默认 `majority_vote`

**共识策略**：[consensus.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/consensus.ts)
- `MajorityVoteStrategy`（L60-145）：改用 Jaccard 词元相似度（`_textSimilarity` L124-136 + `_tokenize` L138-142）替代严格哈希分组，避免 embedding 依赖
- `WeightedAggregateStrategy`：按 `task_type` 权重排序
- `LLMJudgeStrategy`（L200-300）：增加重试（`_MAX_RETRIES=1` L212 + L241-272 重试循环），judge LLM 失败时自动降级到 majority vote

**委托模式**：[delegation.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/delegation.ts) `DelegationPattern`，已标记 `@deprecated` JSDoc（L16），明确指引使用 Supervisor + SubAgent 模式替代。

#### 优点

1. **状态隔离**：`SubAgentState` 与 `ModuAgentState` 分离，并行子 Agent 不污染主状态
2. **Send API 并行分发**：`route_from_supervisor` 返回 `Send[]`，LangGraph 自动并行调度，结果通过 `mergeSubtaskResults` reducer 合并
3. **独立子图递归预算**：`build_subagent_subgraph` 的 `recursionLimit` 独立于主图
4. **三种共识策略**：`majority_vote` / `weighted` / `llm_judge` 覆盖不同场景
5. **共识失败作为进化信号**：`makeConsensusNode` 在 quorum 未达时发布 `FEEDBACK` 事件
6. **EventBus 域/动作过滤**：避免全量广播
7. **PersistentEventLog 异步写入**：不阻塞主流程

> **本节结论**：原 §4.4 缺陷 1-12、14 与建议 1-12、14 均已在 v1.4 修复（LLM 驱动任务拆分、子 Agent 工具能力、子图启用、子 Agent 间黑板通信、子 Agent → Supervisor 升级、动态子 Agent 生成、子 Agent 超时、DelegationPattern 废弃、consensus 链路修复、统一共识入口、LLMJudgeStrategy 重试、动态 quorum、Jaccard 相似度、子 Agent 失败重试）。详见文末「附录 B：修复状态总览」。

#### 遗留缺陷

1. **EventBus 仅内存**：无跨进程 pub/sub（归入 P3-3 跨进程部署改造项）— 待办

#### 遗留建议

1. **跨进程 EventBus**：引入 Redis pub/sub 适配器（归入 P3-3 跨进程部署改造项）— 待办

### 4.5 ReAct / Plan-and-Execute / Reflection 模式

#### 现状

**ReAct 模式**（[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) + [graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts)）：
- 图结构（[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts) L425-464）：`memory_query → agent ⇄ tools → tool_processor → agent ↻`，无 tool_calls 时 → `finalize_response`
- `makeAgentNode`（[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L413-536）：
  - 注入 SystemMessage + 感知上下文 + 长期知识 + （可选）步骤上下文
  - 低置信度保守模式（L503-509）：`confidence < 0.5` 时切到 `conservativeTemperature`(0.3)
  - per-session `config_overrides.temperature` 覆盖（L489-499）
  - 使用 LangChain 原生 `bindTools` 实现原生 function calling
- `routeAfterAgent`（L375-395）：tool_calls → `tools`；无 tool_calls + `plan_phase='executing'` → `step_finalize`；否则 → `__end__`
- 递归上限由 `recursionLimit` 控制，默认 `maxIterations * 2 + 7`
- **无单轮内反思**：agent 输出后直接路由，无自我批评/修正环节

**Plan-and-Execute 模式**：见 4.1。默认关闭，与 ReAct 二选一。

**Reflection 模式**（[src/feedback/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/) + [src/evolution/](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/)）：
- `FeedbackLoop`（[loop-controller.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/loop-controller.ts) L20-162）：`evaluate` 调用 `QualityMonitor.evaluateAsync` 评估响应质量；`shouldEvolve` 样本量 ≥ `min_sample_size`(默认10) 且最近窗口内 60%+ 的 `quality_score < threshold`(默认0.6) 时触发进化
- `QualityMonitor`（[quality-monitor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/quality-monitor.ts) L25-596）：三种模式（rule/llm/hybrid），LLM 模式失败自动 fallback 到 rule
- `EvolutionOrchestrator`（[evolution-orchestrator.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/evolution-orchestrator.ts) L33-218）：`evaluateAndEvolve` 串联 FeedbackLoop.evaluate → shouldEvolve → ParameterTuneStrategy.analyzeAndAdjust，返回 `config_overrides`
- 图接入（[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts) L309, L467-474）：`feedback` 节点位于 `finalize_response → feedback → memory_update → END`
- **per-session 参数调优**（[runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts) L219-251）：`_loadPrevConfigOverrides` 从 checkpointer 读取上次会话的 `config_overrides`，注入下次 `initialState`

**模式组合性**：
- ReAct 与 Plan-Execute 互斥（[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts) L286-291，multi_agent 优先于 plan_execute）
- Reflection 是**后置闭环**，与 ReAct/Plan-Execute 都可叠加（feedback 节点独立于推理路径）
- Plan-Execute 与 multi_agent 互斥

#### 优点

1. **三种模式共存**：通过配置开关切换，ReAct 默认、Plan-Execute 可选、Reflection 常开
2. **ReAct 简洁完整**：原生 function calling + ToolNode + tool_processor，删除手写 ReAct 循环
3. **Reflection 闭环**：评估 → shouldEvolve → ParameterTune → config_overrides → 下次请求注入，形成自适应调参
4. **LLM-as-Judge 高质量评估**：5 维度语义级评分
5. **Hybrid 模式**：rule + LLM 双路加权融合（默认 0.4/0.6）
6. **LLM 失败 fallback**：`_safeEvaluateWithLlm` 超时/解析失败自动降级到 rule
7. **累积统计 + sliding window**：`shouldEvolve` 用最近 `min_sample_size` 次评估判定
8. **per-session 隔离**：`config_overrides` 按 session_id 隔离
9. **熔断跳过评估**：`makeFeedbackNode` 在 `error_code` 非空时跳过

#### 缺陷

1. **ReAct 无单轮内反思**：agent 输出后直接路由，无"自我批评 → 修正"环节
2. **Plan-Execute 与 Reflection 未集成**：步骤失败仅触发 replan，不触发 reflection
3. **Reflection 仅后置**：响应生成后评估，无法在推理过程中纠错
4. **进化策略单一**：仅 `ParameterTuneStrategy`（调温度/max_tokens），无 component swap、无 prompt rewrite
5. **`shouldEvolve` 阈值全局化**：`threshold=0.6` 不区分任务类型
6. **`min_sample_size=10` 偏高**：短会话永远无法触发进化
7. **`config_overrides` 持久化范围窄**：仅温度/max_tokens，不包含 system_prompt 或工具选择
8. **无 A/B 测试框架**
9. **无人类反馈通道**：仅自动质量监控
10. **LLMJudge 提示词硬编码**：5 维度权重固定
11. **无工具选择质量评估**：`QualityMonitor` 评估响应文本，不评估 LLM 是否选对了工具
12. **无计划质量评估**：不评估 Plan-Execute 的计划好坏
13. **三种模式不可自由组合**：Plan-Execute XOR multi_agent，Reflection 仅后置
14. **`_computeOverall` 权重硬编码**（[quality-monitor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/quality-monitor.ts) L382-396）

#### 建议

1. **引入单轮内反思**：在 `agent` 节点后增加可选 `self_critique` 节点，LLM 自评输出质量，低分时重新生成
2. **Plan-Execute + Reflection 集成**：`step_finalize` 判定 failed 时先调用 reflection，再决定 replan 还是 retry
3. **增加 component swap 进化**：质量持续低时自动尝试切换 LLM provider
4. **增加 prompt rewrite 进化**：累积失败模式后 LLM 重写 `system_prompt` 片段，版本化存储
5. **任务特定阈值**：`feedback.evolution_threshold` 改为按 `task_type` 配置
6. **降低 `min_sample_size`**：默认改为 3
7. **扩展 `config_overrides`**：支持 `system_prompt_override` / `tools_subset` / `plan_execute_enabled` 等更多覆盖项
8. **A/B 测试框架**：进化变体按 session_id 哈希分流
9. **人类反馈通道**：增加 `feedback.human_feedback` 事件
10. **工具选择质量指标**：`QualityMonitor` 增加 `tool_selection_score`
11. **计划质量指标**：`FeedbackLoop` 在 Plan-Execute 模式下额外采集 `plan_step_count` / `replan_count` / `step_success_rate`
12. **模式自由组合**：重构 `routeAfterMemoryQuery` 支持组合标志
13. **per-turn 迭代上限**：新增 `llm.max_iterations_per_turn` 配置
14. **`_computeOverall` 权重配置化**

---

## 5. 跨层综合诊断

### 5.1 跨层共性优点

1. **零侵入集成哲学**：Skill、MCP 工具、Plan-Execute、multi_agent 均通过适配器或门控降解为已有抽象，主图无需感知，工程化程度高
2. **降级与隔离扎实**：Skill 加载隔离、SkillToolWrapper 执行隔离、MCP 工具异常隔离、QualityMonitor LLM 失败 fallback 到 rule、Planner 三阶段降级，多层防御保证主流程稳定
3. **配置驱动设计**：`RuntimeConfig` 点分路径 + 热更新 + EventEmitter 回调，为进化机制预留了动态调整通路
4. **LangGraph 原生集成**：Checkpointer 接管短期记忆、BaseStore 接管长期记忆、Send API 实现并行子 Agent、interrupt 实现 HITL，没有重复造轮子
5. **三级降级稳健**：嵌入函数降级到 hash embedding、OTel SDK 降级到 no-op、LLM Judge 降级到 rule，保证无外部依赖也能运行

### 5.2 跨层共性缺陷（遗留）

1. **"角色 Agent"一等公民缺失**：Skill 偏工具/提示封装，子图偏图结构，Supervisor 偏任务拆分，三者没有统一的 `Agent` 抽象，无法表达业务角色。这是"业务适配层"最核心的空白
2. **配置预留项未接通**：`llm.prompt_template`、`ComponentSwapStrategy`、`RollbackMechanism`、`VersionedComponentStore` 等能力已预留但未实际接入主链路，存在大量"半成品"
3. **硬编码普遍**：角色模板、调优阈值、MCP 超时、默认 prompt、`limit: 5`、quorum、`_DEFAULT_TASK_TYPES` 等关键参数写死在源码中，配置化程度不足
4. **无离线评估能力**：所有评估均在线进行，无评估数据集、无版本对比、无 A/B 测试框架，进化机制缺少 ground-truth 校准
5. **多源知识库不支持**：单 store 设计无法满足"客服知识库 + 产品文档 + 历史工单"多源 RAG 需求
6. **运行时切换能力弱**：Skill 在启动时加载，prompt 在构图时确定，工具集通过 `configurable.tools` 静态过滤，缺少真正的运行时动态切换
7. **三种模式不可自由组合**：Plan-Execute XOR multi_agent，Reflection 仅后置；无法应对"先规划再委托子 Agent 执行各步 + 每步反思"这类复杂场景

### 5.3 关键能力空白矩阵（遗留）

| 能力 | 现状 | 期望 | 差距 |
|------|------|------|------|
| 角色 Agent 抽象 | Skill + 子图 + Supervisor 三套机制拼合 | 统一 `AgentProfile` 抽象 | **核心空白** |
| 语义嵌入 | hash embedding 兜底 | all-MiniLM-L6-v2 或外部 API | **最严重功能缺陷** |
| 离线评估数据集 | 无 | JSONL 数据集 + CLI | **核心空白** |
| ComponentSwap/Rollback | 已实现未接通 | 接入 EvolutionOrchestrator | **死代码** |
| Prompt 持久化与热更新 | 硬编码源码 | 模板文件 + VersionedStore | **核心空白** |
| 多源知识库 | 单 store | CompositeStore 聚合 | **核心空白** |
| 模式自由组合 | Plan-Execute XOR multi_agent | 组合标志位 | **架构缺陷** |
| 单轮内反思 | 仅后置 Reflection | 可选 self_critique 节点 | **能力空白** |

> 注：原矩阵中的「子 Agent 工具能力（重大能力浪费）」「DAG 步骤并行（能力闲置）」两项已在 v1.4 / v1.2 修复，已从矩阵中移除。

---

## 6. 重构优化方案（遗留改造项）

### 6.1 总体架构演进路线

**目标**：从"单 ReAct 循环 + 可选模式门控"演进为"**AgentProfile 驱动的可组合编排框架**"，实现底层泛化与上层业务适配的解耦。

```
┌──────────────────────────────────────────────────────────────────┐
│  业务适配层（Business Adaptation Layer）                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ AgentProfile │  │ PromptStore  │  │  EvalDataset │            │
│  │  Registry    │  │ (版本化)      │  │  + CLI       │            │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
└─────────┼─────────────────┼─────────────────┼────────────────────┘
          │                 │                 │
┌─────────▼─────────────────▼─────────────────▼────────────────────┐
│  核心能力层（Core Capability Layer）                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ Plan-Execute │  │ Memory       │  │ Tool         │            │
│  │ (DAG + 并行) │  │ (语义嵌入 +  │  │ (ToolSet +   │            │
│  │              │  │  多源聚合)    │  │  上下文透传) │            │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ Multi-Agent  │  │ Reflection   │  │ Mode Router  │            │
│  │ (LLM 拆分 +  │  │ (单轮内 +    │  │ (组合标志位) │            │
│  │  子图工具)   │  │  多维进化)    │  │              │            │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘            │
└─────────┼─────────────────┼─────────────────┼────────────────────┘
          │                 │                 │
┌─────────▼─────────────────▼─────────────────▼────────────────────┐
│  底层通用基座层（Base Layer）                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐            │
│  │ Unified LLM  │  │ Event Bus    │  │ State Machine│            │
│  │ Interface +  │  │ (跨进程 +    │  │ (分层 State +│            │
│  │ Model Router │  │  版本号)      │  │  schema 版本)│            │
│  └──────────────┘  └──────────────┘  └──────────────┘            │
│  ┌──────────────┐  ┌──────────────┐                              │
│  │ Observability│  │ Security     │                              │
│  │ (W3C + 多sink)│  │ (LLM 检测 + │                              │
│  │              │  │  真沙箱)     │                              │
│  └──────────────┘  └──────────────┘                              │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 P0 优先级改造项（遗留）

#### P0-1：接入语义嵌入，修复长期记忆召回质量

> **状态**：⏳ 待办

**问题**：hash embedding 无语义能力，长期记忆检索效果接近随机，是**最严重的功能性缺陷**。

**改造点**：
- [chroma.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/chroma.ts) `_initEmbeddingFunction`（L160-175）：动态导入 `@xenova/transformers`，加载 `all-MiniLM-L6-v2` ONNX 模型，生成 384 维语义向量
- 保留 hash embedding 作为兜底，当 `@xenova/transformers` 不可用时降级
- 新增配置项 `memory.embedding.provider: 'xenova' | 'openai' | 'hash'`，默认 `xenova`
- 新增 `memory.embedding.openai_api_key` / `memory.embedding.openai_model` 配置项，支持外部 embedding API

**验收标准**：
- 单元测试：相同语义不同表述的 cosine 相似度 > 0.7
- 集成测试：长期记忆召回 top-5 中至少 3 条语义相关

#### P0-2：引入 AgentProfile 抽象，统一角色定义

> **状态**：⏳ 待办

**问题**：Skill + 子图 + Supervisor 三套机制拼合，没有统一的"Agent"一等公民抽象。

**改造点**：
- 新增 [src/core/interfaces/agent.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/agent.ts)，定义 `interface AgentProfile { id; role; systemPrompt; tools; skills; routingPolicy; handoffTargets }`
- 扩展 [registry.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/registry.ts)，新增 `registerAgentProfile / getAgentProfile / listAgentProfiles`
- [factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts) `create_agent` 支持 `configurable.agent_id`，触发 `AgentProfile` 解析，注入 `systemPrompt / tools / skills`
- [builder.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/builder.ts) `_SYSTEM_PROMPT_TEMPLATES` 与 [supervisor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/supervisor.ts) `_DEFAULT_TASK_TYPES` 改为从 `orchestration.multi_agent.role_templates` 配置读取
- 新增 `role_router` 节点（位于 `memory_query` 之后），根据 `state.input_data` 与感知结果选择 AgentProfile

**验收标准**：
- 单元测试：`AgentProfile` 注册、查询、热替换
- 集成测试：per-request 切换角色，prompt 与工具集隔离

#### P0-3：接通 ComponentSwap / Rollback / VersionedStore，消除死代码

> **状态**：⏳ 待办

**问题**：`ComponentSwapStrategy`、`RollbackMechanism`、`VersionedComponentStore` 已实现但未接入主链路，沦为死代码。

**改造点**：
- [evolution-orchestrator.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/evolution-orchestrator.ts) 增加 `componentSwapStrategy` 与 `rollbackMechanism` 成员
- `evaluateAndEvolve` 在 ParameterTune 之后调用 `componentSwap.shouldSwap`，触发 `registry.swapComponent`
- 注册 `RollbackMechanism.recordAndCheck` 作为质量回退钩子，质量持续低于阈值时自动回滚到稳定版本
- `VersionedComponentStore` 实际接管组件版本，`swapComponent` 前先 `saveVersion` 快照

**验收标准**：
- 单元测试：ComponentSwap 触发与回滚
- 集成测试：质量持续低时自动回滚到上一稳定版本

> 说明：原 P0-4（CalculatorTool schema 正则 bug）已在 v1.1 修复，不再列入改造项。

### 6.3 P1 优先级改造项（遗留）

#### P1-1：Prompt 模板外置 + 模板引擎 + 热更新

> **状态**：⏳ 待办

**改造点**：
- 接通 `llm.prompt_template` 配置项，[factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts) L376 增加从 RuntimeConfig 读取
- 引入 Mustache 模板引擎，将 `_DEFAULT_ANTI_HALLUCINATION_PROMPT`、`_SYSTEM_PROMPT_TEMPLATES`、Planner prompt 改为模板文件，存放于 `prompts/` 目录
- 扩展 `VersionedComponentStore` 支持 prompt 版本管理
- 通过 `RuntimeConfig.registerChangeCallback` 监听 prompt 配置变更，触发 `ModuGraph` 重建（加入 `_GRAPH_REBUILD_PREFIXES`）

#### P1-2：引入 EvalDataset 抽象 + 离线评估 CLI

> **状态**：⏳ 待办

**改造点**：
- 新增 `src/eval/dataset.ts` 定义 `interface EvalDataset { id; samples; metrics }`，支持 JSONL 加载、流式评估、结果导出
- 新增 `src/eval/metrics/` 扩展指标：`TaskCompletionMetrics` / `HallucinationMetrics` / `LatencyPercentileMetrics` / `UserSatisfactionMetrics`
- 提供 CLI `modu-agent eval --dataset xxx.jsonl --agent-config yyy.json`
- A/B 测试框架：基于 `ComponentSwapStrategy` 扩展 `ABTestFramework`，支持流量分组、统计显著性检验

#### P1-3：多源知识库 CompositeStore + Chunking + Rerank

> **状态**：⏳ 待办

**改造点**：
- 新增 `CompositeStore` 实现 `BaseStore`，内部维护 `[store1, store2, ...]` 列表，`search` 时并行查询并合并结果
- `build_store` 改为支持 `store_type: 'composite'` 与 `stores: [...]` 配置
- `makeMemoryUpdateNode` 中按句子或固定 token 数切分对话历史
- `makeMemoryQueryNode` 增加 `query_rewrite` 节点 + `rerank` 步骤
- 新增 `memory.relevance_threshold` 与 `memory.recall_top_k` 配置项
- 记忆去重：写入前用 embedding 相似度（阈值 0.92）检测近重复
- 记忆压缩：`memory_update` 节点增加 LLM 摘要步骤

> 说明：原 P1-4（子 Agent 启用工具 + LLM 驱动任务拆分）、P1-5（Plan-Execute 增强）、P1-6（统一 LLM 接口 + 模型路由）均已在 v1.4 / v1.2 / v1.1 修复，不再列入改造项。

### 6.4 P2 优先级改造项（遗留）

#### P2-1：工具集（ToolSet）抽象 + per-request 切换

> **状态**：🟡 部分修复（v1.3） — 已实现：工具结果截断（[tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-adapter.ts) `_truncateToolResult`）、工具结果缓存 LRU+TTL（[tool-result-cache.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-result-cache.ts)）、工具元信息 `version()` + `followUpTools()`（[action.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/action.ts)）、MCP 超时配置化（[mcp-tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/mcp-tool-adapter.ts)）、MCP WebSocket transport（[transport.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/transport.ts)）。仍待办：`ToolSet` 接口抽象、`build_langchain_tools(toolSetId)` 参数化、`listTools()` 元信息结构化、`RunnableConfig.configurable` 上下文透传、MCP Server 权限控制

**改造点**：
- 新增 `interface ToolSet { id; tools; requiredScopes; applicableRoles }`
- `build_langchain_tools` 改为接受 `toolSetId` 参数
- 丰富工具元信息：`listTools()` 返回 `{name, description, parameters_schema, category, version, required_scopes, cost, avg_latency}`
- 工具调用上下文透传：`wrap_modu_tool` 的 `func` 改为接收 `(input, config)`，从 `RunnableConfig.configurable` 提取 `userId/sessionId/traceId`
- MCP 工具按 Server 权限控制：在 `mcp.servers` 配置中增加 `requires_approval: bool` 与 `sensitive_tools: [...]`

#### P2-3：单轮内反思 + Plan-Execute + Reflection 集成

> **状态**：⏳ 待办

**改造点**：
- 在 `agent` 节点后增加可选 `self_critique` 节点，LLM 自评输出质量，低分时重新生成（受 `recursionLimit` 约束）
- `step_finalize` 判定 failed 时先调用 reflection（分析失败原因），再决定 replan 还是 retry
- 增加 prompt rewrite 进化策略：累积失败模式后 LLM 重写 `system_prompt` 片段

> 说明：原 P2-2（HITL 增强：改参批准 + 动态敏感性）、P2-4（状态机分层 + 路由配置化）均已在 v1.3 / v1.1 修复，不再列入改造项（状态机「递归预算精细化」「状态回滚」仍遗留，见 §2.3 / §4.1）。

#### P2-5：安全增强

> **状态**：🟡 部分修复（v1.1） — 已实现：LLM-based Prompt 注入检测（[guard.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/security/guard.ts) `detectInjectionWithLLMJudge` L139-175）、SqlQueryTool 表名提取增强（[sql-query.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/sql-query.ts) L38-39、L181-196）、输出敏感信息检测（[guard.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/security/guard.ts) `detectOutputSensitive` / `sanitizeOutput` L302-395）、集中化审计日志（[audit.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/security/audit.ts)）。仍待办：CodeExecutor AST 校验、真沙箱化执行、完整 SQL parser、`sanitizeOutput` 的 LLM 双路检测

**改造点**：
- LLM-based Prompt 注入检测：`SecurityGuard.detectPromptInjection` 增加 LLM 二次校验
- CodeExecutor AST 校验：用 `tree-sitter-python` 或 Python 子进程 `ast.parse` + `NodeVisitor` 白名单
- 真沙箱化执行：CodeExecutor 改用 Docker 容器或 gVisor 隔离
- SqlQueryTool 用 `node-sql-parser` 做完整 SQL 解析
- 输出敏感信息检测：`sanitizeOutput` 实现正则 + LLM 双路检测 PII/密钥/内网 IP
- 集中化审计日志：安全事件统一发布 `SECURITY.AUDIT` 事件

### 6.5 P3 优先级改造项（遗留）

#### P3-1：可观测性增强

> **状态**：🟡 部分修复（v1.1） — 已实现：W3C TraceContext 注入到 `http_request` 工具出站请求（[trace-context.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/trace-context.ts) `inject_trace_context` L45、[http-request.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/http-request.ts) L320-327，tracing 未启用时为 no-op）、`tracing.ready()` 异步就绪等待入口已提供。仍待办：默认启动路径强制 await tracing.ready()、MCP transport 注入 traceparent、指标维度扩展、日志自动注入 trace_id + 多 sink、性能剖析

- 同步初始化 OTel：在模块加载时显式 `await tracing.ready()`（入口已存在，待接入启动流程）
- W3C TraceContext 注入：`http_request` 工具与 MCP transport 中注入 `traceparent` header
- 指标维度扩展：所有指标增加 `task_type / tool_name / llm_provider / session_id` 标签
- 日志自动注入 trace_id + 多 sink（pino + file/loki）
- 性能剖析：集成 `clinic.js` 或 `0x`

#### P3-2：协议增强

> **状态**：🟡 部分修复（v1.1） — 已实现：`payload` 改为泛型 `T`（[protocol.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/protocol.ts) L96）、`metadata` 改为 `Record<string, unknown>`（同上 L98）、事件版本号 `schema_version`（同上 L101、L128）、事件 TTL（[message-bus.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/message-bus.ts) L189-261 `event_ttl_ms` 配置）。仍待办：跨进程 EventBus（Redis pub/sub 适配器）

- `payload` 改为泛型 `T`，消除 hex 编解码
- `metadata` 改为 `Record<string, unknown>`，允许结构化值
- 跨进程 EventBus：Redis pub/sub 适配器
- 事件版本号 + TTL

#### P3-3：跨进程部署

> **状态**：⏳ 待办

- EventBus Redis 适配器（仅定义 `EventBusBackend` 接口与 `create_distributed_event_bus` 包装器于 [event-bus-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/event-bus-adapter.ts)，具体 Redis/NATS 后端实现由部署方按需引入）
- Checkpointer 多实例共享（postgres）
- Store 多实例共享（Chroma 远程模式）

---

## 7. 实施路线图与里程碑（遗留）

### 7.1 阶段划分

| 阶段 | 范围 | 优先级 | 关键交付物 |
|------|------|--------|-----------|
| 阶段一：基础修复 | P0-1 ~ P0-3 | 紧急 | 语义嵌入、AgentProfile 抽象、死代码接通 |
| 阶段二：业务适配 | P1-1 ~ P1-3 | 高 | Prompt 模板外置、EvalDataset CLI、多源知识库 |
| 阶段三：核心能力 | P2-1、P2-3、P2-5 | 中 | ToolSet 抽象、单轮内反思、安全增强 |
| 阶段四：生产化 | P3-1 ~ P3-3 | 低 | 可观测性增强、协议增强、跨进程部署 |

> 注：原路线图中 P0-4、P1-4、P1-5、P1-6、P2-2、P2-4 对应项均已修复，已从阶段划分移除。

### 7.2 关键里程碑

**M1：基础修复完成（阶段一）**
- 长期记忆召回质量达标（语义嵌入生效）
- AgentProfile 抽象可用，per-request 角色切换
- ComponentSwap/Rollback 接入主链路

**M2：业务适配闭环（阶段二）**
- Prompt 模板外置 + 热更新
- 离线评估 CLI 可用，支持 JSONL 数据集
- 多源知识库 CompositeStore + Chunking + Rerank

**M3：核心能力补全（阶段三）**
- ToolSet per-request 切换
- 单轮内反思 + Plan-Execute + Reflection 集成
- 安全沙箱化

**M4：生产化（阶段四）**
- W3C TraceContext 跨服务追踪（含 MCP transport）
- 跨进程 EventBus + Checkpointer + Store
- 多 sink 日志 + 性能剖析

### 7.3 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 语义嵌入引入大依赖（@xenova/transformers ~50MB） | 包体积膨胀 | 提供 `memory.embedding.provider: 'hash'` 兜底，按需启用 |
| AgentProfile 抽象重构影响现有图构建 | 兼容性 | 保留 `systemPrompt` 直传入口作为降级，`agent_id` 为可选 |
| 状态机分层破坏 Checkpointer 兼容 | 历史会话丢失 | 引入 `state_schema_version` + 迁移函数，旧版本按需迁移 |
| 模式自由组合增加路由复杂度 | 调试困难 | 路由决策日志化 + 可视化工具（graphviz 导出） |
| Plan-Execute DAG 并行引入并发写冲突 | 状态不一致 | 复用 `mergeSubtaskResults` reducer（right wins）+ 代际标签 |
| 子 Agent 启用工具后递归预算爆炸 | 图执行中断 | 独立子图 `recursionLimit` + 全局预算上限 |
| LLM-based 安全检测增加延迟 | 响应变慢 | 仅在 sensitivity_level >= 3 时触发，关键词检测作为快速预筛 |

---

## 附录 A：评估文件清单

### 底层通用基座层

| 模块 | 文件 |
|------|------|
| LLM 调用 | [base-llm.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/base-llm.ts)、[deepseek.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/deepseek.ts)、[glm.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/glm.ts)、[gpt.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/gpt.ts)、[qwen.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/qwen.ts)、[llm-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/llm-adapter.ts)、[retry.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/retry.ts) |
| 消息协议 | [protocol.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/protocol.ts)、[message-bus.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/message-bus.ts)、[streaming.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/streaming.ts)、[agui-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/agui-adapter.ts) |
| 状态机 | [state.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/state.ts)、[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts)、[factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts)、[runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts) |
| 可观测性 | [tracing.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/tracing.ts)、[metrics.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/metrics.ts)、[exporters.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/exporters.ts)、[logging-config.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/logging-config.ts)、[trace-context.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/trace-context.ts) |
| 安全沙箱 | [guard.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/security/guard.ts)、[code-executor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/code-executor.ts)、[http-request.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/http-request.ts)、[file-ops.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/file-ops.ts)、[sql-query.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/sql-query.ts) |

### 业务适配层

| 模块 | 文件 |
|------|------|
| 角色 Agent | [skill.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/skill.ts)、[adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/adapter.ts)、[loader.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/loader.ts)、[math-skill.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/math-skill.ts)、[builder.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/builder.ts)、[supervisor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/supervisor.ts) |
| Prompt 模板 | [factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts)、[prompt-aggregator.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/prompt-aggregator.ts)、[prompts.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/prompts.ts)、[context.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/context.ts)、[runtime-config.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts) |
| 领域知识库 | [chroma.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/chroma.ts)、[short-term-memory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/short-term-memory.ts)、[memory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/memory.ts)、[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) |
| 专属工具集 | [calculator.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/calculator.ts)、[code-executor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/code-executor.ts)、[datetime-tool.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/datetime-tool.ts)、[file-ops.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/file-ops.ts)、[http-request.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/http-request.ts)、[search.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/search.ts)、[sql-query.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/sql-query.ts)、[synchronous-executor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/synchronous-executor.ts)、[tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-adapter.ts)、[mcp/client.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/client.ts)、[mcp-tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/mcp-tool-adapter.ts) |
| 评估集 | [loop-controller.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/loop-controller.ts)、[quality-monitor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/quality-monitor.ts)、[accuracy.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/metrics/accuracy.ts)、[efficiency.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/metrics/efficiency.ts)、[evolution-orchestrator.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/evolution-orchestrator.ts)、[parameter-tune.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/parameter-tune.ts)、[component-swap.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/component-swap.ts)、[rollback-mechanism.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/rollback-mechanism.ts)、[versioned-store.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/evolution/versioned-store.ts) |

### 核心能力层

| 模块 | 文件 |
|------|------|
| 规划策略 | [plan-execute/index.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/index.ts)、[types.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/types.ts)、[planner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/planner.ts)、[dispatcher.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/dispatcher.ts)、[context.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/context.ts)、[prompts.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/prompts.ts) |
| 记忆管理 | [chroma.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/chroma.ts)、[short-term-memory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/short-term-memory.ts)、[memory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/memory.ts) |
| 工具调度 | [nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts)、[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts)、[tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-adapter.ts)、[retry.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/retry.ts)、[mcp-tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/mcp-tool-adapter.ts)、[adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/adapter.ts) |
| 多 Agent 协作 | [subgraph/builder.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/builder.ts)、[subgraph/supervisor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/supervisor.ts)、[subgraph/states.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/states.ts)、[patterns/consensus.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/consensus.ts)、[patterns/delegation.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/delegation.ts) |
| ReAct / Reflection | [nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts)、[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts)、[factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts)、[loop-controller.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/loop-controller.ts)、[quality-monitor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/quality-monitor.ts) |

---

## 附录 B：修复状态总览

> **状态图例**：✅ 已确认修复（代码中已落地）｜🟡 部分修复｜⏳ 待办（详见正文）

### B.1 已确认修复项（v1.1）

| 章节 | 已修复项 | 关键代码 |
|------|---------|---------|
| §2.1 | 双轨抽象维护负担 / 统一 LLM 接口 `ModuLLM` / 结构化返回 `LLMResult` / 模型路由 `RuleBasedLLMRouter` / 成本核算 `LLM.COST` / 连接池 `undici.Agent` | [llm.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/llm.ts)、[base-llm.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/base-llm.ts)、[modu-llm-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/modu-llm-adapter.ts)、[router.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/router.ts)、[cost-tracker.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/cost-tracker.ts) |
| §2.2 | payload 泛型 `T` / metadata `Record<string, unknown>` / 事件版本号 `schema_version` / 事件 TTL `event_ttl_ms` | [protocol.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/protocol.ts)、[message-bus.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/message-bus.ts) |
| §2.3 | 状态字段分层 `CoreState` / `ModeState` / 移除 `history` 僵尸字段 / `migrate_state` schema 版本 / 路由分叉配置化 `mode_router` | [state.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/state.ts)、[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts)、[runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts) |
| §2.4 | W3C TraceContext 注入（http_request） | [trace-context.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/trace-context.ts)、[http-request.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/http-request.ts) |
| §2.5 | LLM-based Prompt 注入检测 / SqlQueryTool 表名提取增强 / 输出敏感信息检测+脱敏 / 动态敏感性 `requiresApprovalFor` / 工具调用限流 token bucket / CalculatorTool schema 正则 bug / 集中化审计日志 `SECURITY.AUDIT` | [guard.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/security/guard.ts)、[sql-query.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/sql-query.ts)、[action.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/action.ts)、[rate-limiter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/rate-limiter.ts)、[calculator.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/calculator.ts)、[audit.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/security/audit.ts) |
| P0-4 | CalculatorTool schema 正则 bug | [calculator.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/calculator.ts) L41 |
| P1-6 | 统一 LLM 接口 + 模型路由 | [llm.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/llm.ts)、[base-llm.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/base-llm.ts)、[router.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/router.ts)、[cost-tracker.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/cost-tracker.ts) |
| P2-4 | 状态机分层 + 路由配置化（递归预算精细化/状态回滚仍遗留） | [state.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/state.ts)、[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) |

### B.2 已确认修复项（v1.2 / v1.3 / v1.4）

| 版本 | 改造项 | 关键代码 |
|------|--------|---------|
| v1.2（P1-5） | Plan-Execute DAG 并行（Send API）/ 步骤级重试 / `withStructuredOutput` / 部分重规划 / `expected_output+verification_hint` / Plan-Execute+multi_agent 组合 / `requires_tool` 工具元数据驱动 / `started_at` 写入 | [dispatcher.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/dispatcher.ts)、[planner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/planner.ts)、[types.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/types.ts)、[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts)、[action.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/action.ts) |
| v1.3（P2-1/P2-2） | 工具结果截断 `_truncateToolResult` / 缓存 `ToolResultCache` / HITL 改参批准 `modified_args` / 动态敏感性 `requiresApprovalFor` / 工具限流 `ToolRateLimiter` / MCP 超时配置化 / MCP WebSocket transport / `SyncActionExecutor` 废弃 / 工具版本化 `version()` / 工具组合 `followUpTools()` / 类型安全 `instanceof ToolMessage` | [tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-adapter.ts)、[tool-result-cache.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-result-cache.ts)、[action.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/core/interfaces/action.ts)、[rate-limiter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/rate-limiter.ts)、[mcp-tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/mcp-tool-adapter.ts)、[transport.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/transport.ts)、[synchronous-executor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/synchronous-executor.ts)、[search.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/search.ts) |
| v1.4（P1-4） | LLM 驱动任务拆分 `decompose_task_with_llm` / 子 Agent 工具能力 `build_subagent_subgraph` / 黑板通信 `blackboard` / `need_help` 升级 / 动态子 Agent 生成 / 子 Agent 超时 / `DelegationPattern` 废弃 / consensus→messages 链路修复 / 统一共识入口 `ConsensusPattern` / `LLMJudgeStrategy` 重试 / 动态 quorum / Jaccard 相似度 / 子 Agent 失败重试 | [supervisor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/supervisor.ts)、[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts)、[state.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/state.ts)、[consensus.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/consensus.ts)、[delegation.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/delegation.ts) |

### B.3 剩余改造项速查表（与正文 §6 对应）

| 优先级 | 编号 | 名称 | 关键收益 | 状态 |
|--------|------|------|---------|------|
| P0 | P0-1 | 接入语义嵌入 | 修复长期记忆召回质量（最严重功能缺陷） | ⏳ 待办 |
| P0 | P0-2 | 引入 AgentProfile 抽象 | 统一角色定义，支持 per-request 切换 | ⏳ 待办 |
| P0 | P0-3 | 接通 ComponentSwap / Rollback / VersionedStore | 消除死代码，激活自适应进化闭环 | ⏳ 待办 |
| P1 | P1-1 | Prompt 模板外置 + 模板引擎 + 热更新 | Prompt 持久化、版本管理、A/B 测试基础 | ⏳ 待办 |
| P1 | P1-2 | EvalDataset 抽象 + 离线评估 CLI | 离线评估能力，版本对比基准 | ⏳ 待办 |
| P1 | P1-3 | 多源知识库 CompositeStore + Chunking + Rerank | 多源 RAG 支持，召回质量提升 | ⏳ 待办 |
| P2 | P2-1 | ToolSet 抽象 + per-request 切换 | 业务专属工具集，工具元信息丰富 | 🟡 部分修复（v1.3） |
| P2 | P2-3 | 单轮内反思 + Plan-Execute + Reflection 集成 | 推理过程纠错能力 | ⏳ 待办 |
| P2 | P2-5 | 安全增强 | LLM 检测 + AST 校验 + 真沙箱 | 🟡 部分修复（v1.1） |
| P3 | P3-1 | 可观测性增强 | W3C TraceContext + 多 sink 日志 | 🟡 部分修复（v1.1） |
| P3 | P3-2 | 协议增强 | 泛型 payload + 跨进程 EventBus | 🟡 部分修复（v1.1） |
| P3 | P3-3 | 跨进程部署 | Redis EventBus + 共享 Checkpointer/Store | ⏳ 待办 |

---

## 附录 C：核心结论摘要

### C.1 框架定位评估

`modu-agent` 是一个**工程化程度高、降级机制扎实、但业务适配层薄弱**的 LangGraph-based Agent 框架。底层基座层在 LLM 抽象、状态机、可观测性、安全沙箱上均有扎实实现，三层降级（OTel no-op / hash embedding / rule fallback）保证了无外部依赖也能运行；核心能力层覆盖了 ReAct、Plan-Execute、Reflection、多 Agent 协作四种模式，且通过配置门控实现零侵入集成；但业务适配层缺少"角色 Agent"一等公民抽象，Prompt 模板与角色模板硬编码严重，无离线评估数据集，是制约框架泛化到多业务场景的核心瓶颈。

### C.2 三大核心结论

1. **底层基座可用，但需统一抽象**：双轨 LLM 抽象（`BaseLLMReasoner` vs `ChatOpenAI`）、双轨短期记忆（`InMemoryShortTermMemory` vs Checkpointer）、DTO 与 State 字段重叠等问题表明基座层存在重复抽象，已通过统一接口（`ModuLLM`、`BaseMemory` 强制异步）消除维护负担。

2. **业务适配层是最大短板**：`AgentProfile` 抽象缺失导致无法表达"客服 Agent / 数据分析 Agent"这类业务角色；Prompt、角色模板、调优阈值普遍硬编码；离线评估完全空白。**P0-2（AgentProfile）+ P1-1（Prompt 外置）+ P1-2（EvalDataset）** 是补齐业务适配层的三大关键改造项。

3. **核心能力层"已实现未接通"现象已基本消除**：`build_subagent_subgraph`（带工具循环的子图）已在 v1.4 被 `makeSubagentNode` 调用启用子 Agent 工具循环；`DelegationPattern` 已标记 `@deprecated`；`ConsensusPattern` 已被 `makeConsensusNode` 封装使用。仅 `ComponentSwapStrategy` / `RollbackMechanism` / `VersionedComponentStore` 仍已实现未接入主链路（P0-3 待办）。

### C.3 最严重缺陷 Top 3

1. **hash embedding 无语义**（[chroma.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/memory/chroma.ts) L24-46）：长期记忆检索效果接近随机，直接影响 RAG 链路质量
2. **角色 Agent 抽象缺失**：Skill + 子图 + Supervisor 三套机制拼合，无统一 `Agent` 接口，业务接入成本高
3. **无离线评估能力**：所有评估在线进行，进化机制缺少 ground-truth 校准

### C.4 演进方向

从"**单 ReAct 循环 + 可选模式门控**"演进为"**AgentProfile 驱动的可组合编排框架**"：

- **底层**：统一 LLM 接口 + 模型路由 + 跨进程 EventBus + W3C 追踪
- **核心**：AgentProfile 驱动角色路由 + Plan-Execute DAG 并行 + 子 Agent 工具能力 + 单轮内反思 + 模式自由组合
- **业务**：Prompt 模板外置 + 多源知识库 + 离线评估数据集 + A/B 测试框架 + ComponentSwap/Rollback 闭环

通过 P0 → P1 → P2 → P3 的渐进式改造，框架将从"能跑的 Agent Demo"升级为"可支撑多业务场景接入的生产级 Agent 平台"。

---

## 附录 D：分层推进重构规划方案（底层 → 核心 → 业务）

> 本附录针对"**先夯实底层通用基座，再补齐核心能力，最后完善业务适配**"的垂直分层推进路线，评估其可行性并输出完整重构规划。该路线与正文 §6 / §7 的 P0-P3 混合优先级路线为**替代关系**：P0-P3 路线按"紧急程度"横向切分，本路线按"架构层次"垂直切分。两者覆盖的改造项集合基本一致，差异在于**编排顺序与阶段边界**。
>
> **清理说明**：本附录引用的 P0-4、P1-4、P1-5、P1-6、P2-2、P2-4 等改造项已在 v1.1~v1.4 修复，阅读时按"已完成"理解即可，其余待办项与正文 §6 一致。

### D.1 路线可行性评估

#### D.1.1 路线优势

1. **符合"先基础后上层"工程原则**：底层稳定后，核心能力与业务适配的开发可避免反复返工。当前框架的多个"半成品"（如 `build_subagent_subgraph` 被搁置、`ComponentSwapStrategy` 未接通）本质上是因为底层抽象不统一导致上层实现不敢启用；其中 `build_subagent_subgraph`、`DelegationPattern`、`ConsensusPattern` 已在 v1.4 接通。
2. **职责边界清晰**：三阶段对应三层架构，便于团队按层分工，减少跨层耦合的协作成本。
3. **回归测试成本低**：每阶段交付后，上层尚未接入，回归范围可控，便于建立基线测试。
4. **与现有架构对齐**：`modu-agent` 已有"底层基座 / 核心能力 / 业务适配"的隐式分层（见正文 §1.3 模块清单），本路线是显式化这一分层而非推翻重建。

#### D.1.2 路线风险

| 风险 | 影响 | 严重度 |
|------|------|--------|
| 底层改造周期长，业务方等待窗口大 | 业务迭代停滞 | 高 |
| 底层在无业务验证下推进，可能过度设计 | 投入产出比低 | 中 |
| 部分紧急缺陷（CalculatorTool bug、hash embedding）推迟修复 | 线上质量持续受损 | 高 |
| 核心能力（如 AgentProfile）设计缺乏业务场景验证 | 设计偏差，阶段三返工 | 中 |
| 严格串行推进丧失并行机会 | 整体周期拉长 | 中 |

#### D.1.3 可行性结论

**基本可行，但需采用"分层推进 + 关键修复穿插 + 核心抽象预验证"的混合策略**，而非纯串行的瀑布推进：

1. **关键修复穿插**：P0 级紧急 bug（CalculatorTool schema 正则，已 v1.1 修复）与最严重功能缺陷（hash embedding 无语义，P0-1 待办）不等待阶段排期，立即穿插修复。
2. **核心抽象预验证**：阶段一在定义统一接口（`ModuLLM`、`AgentProfile`、`ToolSet`）时，仅产出**接口契约 + 一个参考实现**，不做全量业务填充。
3. **阶段内并行**：每阶段内部任务按依赖关系并行推进（如阶段一的 LLM 统一与可观测性增强无依赖，可并行）。
4. **阶段间部分重叠**：阶段一收尾（最后 20%）可与阶段二启动（前 20%）重叠，缩短整体周期。

#### D.1.4 与 P0-P3 路线的映射关系

| P0-P3 路线 | 分层推进路线 | 说明 |
|-----------|-------------|------|
| P0-1 语义嵌入 | 阶段一·任务6（数据底座）+ 穿插立即修复 | hash embedding 是底层缺陷，提前修 |
| P0-2 AgentProfile | 阶段二·任务1（核心抽象） | 接口属核心，实例属业务 |
| P0-3 ComponentSwap/Rollback | 阶段二·任务7（进化机制） | 依赖底层 VersionedStore（阶段一） |
| P0-4 CalculatorTool bug | 已修复（v1.1） | 不等待阶段排期 |
| P1-1 Prompt 外置 | 阶段三·任务2（业务 Prompt 库） | 业务模板属业务层 |
| P1-2 EvalDataset | 阶段三·任务5（业务评估集） | 离线评估数据集属业务层 |
| P1-3 多源知识库 | 阶段二·任务5（记忆能力） | CompositeStore 是核心能力 |
| P1-4 子 Agent 工具 | 已修复（v1.4） | 核心模式修复 |
| P1-5 Plan-Execute 增强 | 已修复（v1.2） | 核心模式增强 |
| P1-6 统一 LLM 接口 | 已修复（v1.1） | 底层基座 |
| P2-1 ToolSet | 阶段二·任务4（工具调度）+ 阶段三·任务4（业务工具集） | 抽象属核心，实例属业务 |
| P2-2 HITL 增强 | 已修复（v1.3） | 核心交互能力 |
| P2-3 单轮内反思 | 阶段二·任务6（反思能力） | 核心模式 |
| P2-4 状态机分层 | 已修复（v1.1） | 底层基座 |
| P2-5 安全增强 | 阶段一·任务5（安全沙箱） | 底层基座 |
| P3-1 可观测性 | 阶段一·任务4（可观测性） | 底层基座 |
| P3-2 协议增强 | 阶段一·任务2（消息协议） | 底层基座 |
| P3-3 跨进程部署 | 阶段一·任务2（消息协议，预留） | 底层基座 |

---

### D.2 阶段一：底层通用基座夯实

#### D.2.1 阶段目标

构建**稳定、统一、可观测、安全**的底层基座，消除双轨抽象与硬编码业务逻辑，为核心能力层与业务适配层提供干净的依赖底座。阶段结束时，底层基座应满足：

- LLM 调用、消息协议、状态机、可观测性、安全沙箱、记忆数据底座、配置与组件管理七大子系统能独立运行并通过基线测试
- 底层不包含任何业务角色定义、业务 Prompt 模板、业务工具集、业务评估集
- 所有业务相关常量已外置为配置占位或接口契约

#### D.2.2 核心任务

**任务 1：LLM 调用统一**（已修复 v1.1）

- `interface ModuLLM { invoke(messages): Promise<LLMResult>; stream(messages): AsyncGenerator<string>; bindTools(tools): ModuLLM; withRetry(opts): ModuLLM }` 已实现
- `BaseLLMReasoner` 与 LangChain `ChatOpenAI` 适配均实现该接口
- `reason()` 返回结构化对象 `{ content, usage, toolCalls, finishReason, raw }`
- `LLMRouter` 按 `task_type / estimated_complexity / cost_budget` 路由（接口 + 简单实现）
- LLM 接口层统一采集 token 用量，发布 `LLM.COST` 事件
- 引入 `undici.Agent` 显式管理连接池

**任务 2：消息协议增强**（payload 泛型 / metadata / schema_version / TTL 已修复 v1.1）

- `AgentEvent<T = unknown>` 泛型 payload 已实现
- `metadata: Record<string, unknown>` 已实现
- `schema_version` 事件版本号已实现
- `PersistentEventLog` 支持 `event_ttl` 已实现
- 预留跨进程 EventBus 适配器接口 `interface EventBusBackend { publish; subscribe; request }`，Redis 适配器实现留待阶段三按需启用（[event-bus-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/event-bus-adapter.ts) 已提供 `EventBusBackend` + `create_distributed_event_bus` 包装器，具体后端由部署方实现）

**任务 3：状态机分层**（已修复 v1.1）

- `ModuAgentState` 拆分为 `CoreState` + `ModeState` 已实现
- `state_schema_version` + `migrate_state` 已实现
- 移除 `history` 僵尸字段已实现
- `routeAfterMemoryQuery` 读取 `orchestration.mode_router` 配置已实现
- 递归预算按 `sum(step.estimated_iterations)` 动态计算接口预留（待办）

**任务 4：可观测性补齐**（部分修复）

- `tracing.ready()` 异步就绪等待入口已实现（待接入启动流程强制 await）
- W3C TraceContext 注入：`http_request` 已实现；MCP transport 待办
- 指标维度扩展：待办
- `logging-config.ts` 自动提取 trace_id：待办
- 引入 `pino` + file transport：待办

**任务 5：安全沙箱强化**（部分修复）

- `detectPromptInjection` LLM 二次校验已实现（[guard.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/security/guard.ts)）
- SqlQueryTool 表名提取增强已实现
- 输出敏感信息检测 + 脱敏已实现
- CodeExecutor AST 校验（待办）、真沙箱化执行（待办）、完整 SQL parser（待办）

**任务 6：记忆数据底座**（待办：语义嵌入）

- hash embedding 三级降级已实现
- 语义嵌入（@xenova/transformers / 外部 API）待办（P0-1）

---

> 文档结束。本清理版已删除所有经代码核验确认修复的问题描述，仅保留未修复 / 部分修复项；完整修复记录见附录 B。
