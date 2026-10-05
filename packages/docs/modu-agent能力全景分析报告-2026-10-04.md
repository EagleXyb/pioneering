# ModuAgent（packages/modu-agent）能力全景分析报告

- **分析基线**：分支 V2.6，HEAD `d133c2c`，包内无未提交变更（2026-10-04）
- **代码规模**：src 155 个 TS 文件 / 约 41,600 行；tests 90 文件 / 约 15,600 行（占比 37%）
- **门禁实测**：`tsc --noEmit` 通过（exit 0）；`vitest run` **1056/1066 通过**，10 个失败均为测试断言漂移（6 个 sql-query 断言旧错误码 `SQL_003`，源码已拆分出 `SQL_005`=依赖缺失，src/tools/sql-query.ts:267 附近；4 个 observability 用例依赖未安装的 optionalDependency `prom-client`/`better-sqlite3`），功能代码本身无编译错误
- **方法**：主代理直接精读 graph/nodes/factory/runner/planner/dispatcher/supervisor/tools/perception/mcp/memory/evolution/orchestration/kernel 等全部模块关键路径，结论均回查源码，标注 文件:行号

---

## 一、核心能力清单

Agent 当前具备 **14 组能力**，按"默认开箱可用"与"配置门控启用"区分（门控默认值来自 `src/config/runtime-config.ts` DEFAULT_CONFIG）：

| # | 能力 | 状态 | 默认开关 |
|---|------|------|---------|
| 1 | ReAct 对话循环（原生 function calling） | ✅ 核心路径 | 始终启用 |
| 2 | 工具调用与执行（8 内置工具 + 治理包装链） | ✅ | 4 个安全工具默认注册 |
| 3 | MCP 外部工具接入（stdio/SSE） | ✅ | `mcp.enabled=false` |
| 4 | 短期记忆（checkpoint 会话状态） | ✅ | `memory.checkpointer_type='memory'` |
| 5 | 长期记忆（向量 store 检索/写入） | ✅ | `memory.store_type='chroma'` |
| 6 | 任务规划 Plan-and-Execute（DAG 并行/重规划） | ✅ | `plan_execute.enabled=false` |
| 7 | 多 Agent 协作 Supervisor→Subagent→Consensus | ✅ | `orchestration.multi_agent.enabled=false` |
| 8 | HITL 三类中断（工具审批/澄清/选项）+ 断点续传 | ✅ | `tools.human_in_loop.enabled=false` |
| 9 | 需求澄清（规则预筛 + LLM 复判） | ✅ | `perception.clarification.enabled=false` |
| 10 | 感知与安全（注入/PII/敏感度熔断/输出护栏） | ⚠️ 实现完整但多数默认关闭 | `builtin_processors.enabled=false` 等 |
| 11 | 流式输出与 AG-UI 协议（24 种事件） | ✅ | 始终可用（由宿主消费） |
| 12 | 上下文工程（Observation 蒸馏/分层温度/Few-shot/模型路由） | 部分默认开 | 蒸馏默认开，其余门控 |
| 13 | 反馈进化闭环（质量监控→参数调优→config_overrides） | ✅ | `feedback.enable_evolution=true`（默认开） |
| 14 | 可观测性（OTel tracing/Prometheus/审计日志） | ✅ | 三个开关默认 false |

此外有两项**架构性能力**：配置热更新驱动图重建（runner 缓存 + debounce），以及场景包插件机制（kernel 宿主 + 10 类注册扩展点 + 作用域回滚）。

---

## 二、能力实现方式（逐项定位）

### 2.1 ReAct 对话循环（核心骨架）

- **图拓扑**：`src/graph/graph.ts` `composeDefaultGraph()`（516-791 行）。声明式 GraphSpec（`spec.ts`）+ `buildFromSpec` 编译，固定主干为
  `START → perception → memory_query → agent ⇄(tools → tool_processor) → finalize_response → [feedback] → memory_update → END`
- **推理节点**：`src/graph/nodes.ts` `makeAgentNode()`（1008-1296 行）。用 LangChain `bind_tools` 原生 function calling 替代手写 ReAct 解析；消息组装收敛为可注册的 `ContextStrategy`（`context-strategies.ts` 7 片段：感知/文档任务提醒/长期知识/Observation 历史/Few-shot/plan 步骤，位置+优先级声明式注入）。
- **循环退出与保护**：`routeAfterAgent()`（608-750 行）——有 `tool_calls` 继续循环；推理轮数预算三级防线：复杂度 tier 的 `reasoning_budget` → 配置 `max_reasoning_iterations+3` → 硬编码 8 轮兜底；另有"承诺但未执行"提前终止检测（`_detectPrematureTermination`，763-805 行，advisory 仅告警）。
- **防幻觉底线**：`factory.ts:104` `_DEFAULT_ANTI_HALLUCINATION_PROMPT`，28 条规则（实时数据必须调工具、多步任务闭环、工具预算意识、文档生成模板等），宿主可经 Prompt 注册表 `agent.default_system` 覆盖。
- **温度自适应**：低置信度保守模式（confidence<0.5→0.3）、`config_overrides` per-session 覆盖、复杂度 tier 映射温度（`TIER_TEMPERATURE_MAP`），优先级链清晰（nodes.ts:1126-1178）。
- **韧性**：LLM 调用超时 `_invokeWithTimeout`（llm.request_timeout_ms）、`apply_llm_retry` 指数退避、`apply_llm_metrics` token 计量（factory.ts:653-669）。

### 2.2 工具能力（8 内置工具 + 五层治理）

| 工具 | 文件 | 要点 | 审批 |
|------|------|------|------|
| calculator | tools/calculator.ts | 表达式计算 | 否 |
| datetime | tools/datetime-tool.ts | 当前日期时间，`providesRealtimeData=true` | 否 |
| search_engine | tools/search.ts | 三级后端回退：Tavily→Bing HTML→DuckDuckGo（国内可达性修复后的顺序） | 否 |
| doc_writer | tools/doc-writer.ts | 文档生成专用：自动命名 `{title}_{date}.md`、写后校验、产物上报 | 条件审批 |
| file_ops | tools/file-ops.ts | 路径约束 allowed_root + 穿越/symlink 检测 | 写需审批 |
| http_request | tools/http-request.ts | SSRF 防护（内网段拒绝）、协议/方法限制、域名白名单 | 是 |
| sql_query | tools/sql-query.ts | 仅 SELECT、参数化强校验、表白名单 | 是 |
| code_executor | tools/code-executor.ts | "弱沙箱+强审批"：源码黑名单、子进程隔离、最小环境、超时 10s、rlimit | 是 |

- **治理包装链**：`graph/adapters/tool-adapter.ts` 将 BaseTool 包为 StructuredTool，一次套上：重试（retry.ts）→ 结果缓存（tool-result-cache.ts，LRU+TTL，按 tool+hash(args)）→ 限流（rate-limiter.ts，token bucket per-tool RPM）→ metrics。
- **审批判定单一入口**：`tools/tool-guardrails.ts` `decideToolApprovals()`——顺序为 guardrail 命中（5 条内置规则：file_ops 写/删、sql 写、http 敏感、code 联网，66-101 行）→ 敏感工具名单 → 工具自身 `requiresApprovalFor`；异常时 fail-closed（338 行）。
- **能力矩阵**：`tool-registry.ts` 声明 task_types/intents/fallback_chain，供子 Agent 两级工具过滤（`_filterToolsByTaskType` + `filterToolsByTaskTypeAndIntent`，nodes.ts:2686-2713）。
- **并行编排**：`tool-orchestrator.ts` 依赖分析出串行/并行执行计划（advisory 记录；实际并行由 LangGraph ToolNode 承担，nodes.ts:702-716）。

### 2.3 MCP 接入

`src/mcp/`：`transport.ts` 封装 stdio/SSE 两种传输（+注释预留 WS）；`client.ts` 多 Server 连接与会话管理；`discovery.ts` tools/list 解析与缓存；`lifecycle.ts` stdio 子进程 auto_start 管理。装配点：`factory.ts:_discover_and_register_mcp_tools()`（425-462 行）把 MCP 工具经 `MCPToolAdapter` 幂等注册进 ComponentRegistry，与内置工具同池调度；`mcp.enabled=false` 门控，发现失败不阻断启动。

### 2.4 记忆体系

- **短期**：LangGraph checkpointer 按 `thread_id` 自动持久化全量 State。`factory.ts:171-229` `build_checkpointer`：memory（**共享单例** `BoundedMemorySaver`，按 `memory.checkpointer_max_threads=100` LRU 淘汰，bounded-memory-saver.ts）/ sqlite（可选依赖，失败回退内存）/ none。代码显式告警：内存 checkpoint 下 HITL 暂停态进程重启即丢（factory.ts:211-227）。
- **长期**：`memory_query` 节点 store.search top5 注入知识上下文（nodes.ts:352-402）；`memory_update` 节点把整段对话历史按 `session_时间戳` 写 store（429-516），熔断场景跳过。`memory/chroma.ts` ChromaLongTermMemory + `store-adapter.ts` 包为 BaseStore。
- **策略化**：`MemoryStrategy` 统一契约（recall/persist），`memory-strategy.ts` + registry `resolveMemoryStrategy(taskType)`；策略优先、store 直连回退（P1-T11），宿主可换后端不改内核。

### 2.5 任务规划（Plan-and-Execute）

- **Planner**（`plan-execute/planner.ts`）：未绑定工具的 raw LLM 拆解结构化 PlanStep[]。健壮性是同包内最强的一段：`withStructuredOutput(zod)` 优先→JSON-in-text 降级→两阶段渐进重试（温度 0 + maxSteps 减半 + 紧凑提示词 + max_tokens 减半，496-581 行）→仍失败降级直答（routeAfterPlan，654 行）。schema 外还有语义合理性后检 `_isStepContentReasonable`（拦截"嵌套 plan 塌陷"，179-217 行）。`requires_tool` 三层推断：引用实时工具硬覆盖 > LLM 显式输出 > 工具元数据+关键词兜底（262-279 行）。
- **Dispatcher**（`plan-execute/dispatcher.ts`）：DAG 就绪集扫描 `_identifyReadySteps`（321-338）→ 多就绪步 Send API 并行分发；单步顺序兼容；`delegation` 步骤在有 supervisor 时委托多 Agent（239-258，P1-15 守卫）。步骤级重试（step.retry_policy，指数退避钳制 0-10s/0-5 次，644-677）与计划级 replan（预算 max_replans=2）分层；replan 用"代际标签"隔离旧结果（`_currentGenerationResults`）；部分重规划保留已完成步骤（planner.ts:599-620）；工具全失败但 LLM 有产出 → `done(degraded)` 不误判失败（491-501）。每步产出 `plan_delta` SSE 事件。

### 2.6 多 Agent 协作

- **Supervisor**（`subgraph/supervisor.ts`）：LLM 驱动拆分（`decompose_task_with_llm`，带 depends_on、SOP 角色字典约束）→ 失败回退规则化拆分；`need_help` 信号触发保留成功子任务的重拆分（241-263）。`route_from_supervisor`（306-380）按终态集合调度 Send，P1-16 修复后对"依赖失败阻塞/等待"显式 error 不静默丢任务。
- **Subagent**（nodes.ts `makeSubagentNode` 2487-2667）：每子任务按 task_type/intent 过滤工具构建独立 ReAct 子图（`subgraph/builder.ts`，recursionLimit 独立 10）；结果和错误经重试循环；成功结果写**共享黑板** blackboard 供并行兄弟任务读取。
- **Consensus**（nodes.ts 2754-2873）：动态法定人数 `max(1, ceil(n/2))`；策略工厂 `create_consensus_strategy`（majority_vote/llm_judge 等，`orchestration/patterns/consensus.ts`）；共识结果作为 AIMessage 注入 messages 保证 finalize_response 取到正文；失败可发布进化信号。

### 2.7 HITL 与断点续传

- **审批节点**（nodes.ts `makeHumanReviewNode` 1962-2235）：`interrupt({kind:'tool_confirm', tool_calls…})` 暂停；resume 支持 approved/feedback/timeout/`modified_args`（改参批准，2147-2174 用同 id 新 AIMessage 覆盖原 tool_calls 参数）；拒绝路径为每个 pending 调用生成降级 ToolMessage（区分 `TOOL_APPROVAL_REJECTED`/`TOOL_APPROVAL_TIMEOUT`，P9.4.3）。
- **澄清节点**（`makeClarifyNode` 2281-2381）：`interrupt({kind:'choice'|'clarifying', question, options})`；回答经 `answer`/`answer_id` 双通道解析，注入 HumanMessage 使下游基于"补充后的需求"执行；超时 `continue_with_defaults` 不消耗轮次；`clarification_round` 上限 2。
- **恢复入口**（`runner.ts`）：`resume_sync`/`resume_stream`（`Command({resume})`）、`get_interrupt_state`（权威载荷取 checkpoint pending task 的 `interrupts[].value`，1144-1256）、`checkInterruptTimeout` + `auto_reject_on_timeout` 自动拒绝（1262-1280 起）。
- **审计**：审批请求/批准/拒绝等事件走 `publish_security_audit_event_sync`，且对 interrupt 重放语义做了节点重执行去重（`_shouldPublishApprovalRequired`，1930-1948，容量 4096）。

### 2.8 感知与安全

- **管线**：`perception/pipeline.ts` 按 `input_data.input_type` 路由 text/image/audio 管道（配置 `perception.routing`）→ `runPerceptionPipelineAsync` 并行执行感知器 → `fusion.ts` 加权融合。
- **感知器**（`perception/text/rule-based.ts`、`llm-parser.ts`、`vision/image-processor.ts`、`audio/asr-processor.ts`）：文本清洗（控制字符/零宽/方向控制符）、LLM 意图解析、图像 OCR/元数据（无 OCR 库时降级，可选 tesseract.js/云 API）、语音识别。**但** `perception.builtin_processors.enabled` 默认 false（runtime-config.ts:207-212）→ 默认 `perception_result=null`，整条深度感知为 opt-in；文档意图识别（docGen）是 `_buildPerceptionResult` 内独立关键词逻辑（nodes.ts:150-214），不依赖该开关。
- **安全守卫**（`perception/security/`）：注入/越狱正则模式库、PII 检测、敏感度评分。`routeAfterPerception`（nodes.ts:531-592）三重熔断：PolicyEngine 输入拒绝、敏感度≥5、注入/PII 阻断（后两者需 `block_on_injection/block_on_pii` 配置）；熔断短路到 finalize_response 输出错误并审计。输出护栏（`output-guard-node.ts` PII/密钥/内网 IP 脱敏）与 PolicyEngine input/tool/output 三阶段统一判定（`policy-rules.ts`/`policy-consumers.ts`）均已接线但默认关闭（`sanitize_output.enabled=false`、`policy.engine.enabled=false`）。

### 2.9 流式输出与协议

- **AG-UI**（`orchestration/communication/agui-adapter.ts`，1615 行）：24 种事件类型（RUN_*/TEXT_MESSAGE_*/THINKING_*/TOOL_CALL_*/STATE_*/ARTIFACT_CREATED/USER_QUESTION_REQUEST/RUN_PAUSED/HITL_ABORTED），含 HITL kind 四类协议（`tool_confirm|clarifying|choice|plan_confirm`，plan_confirm 带产物列表字段，agui-adapter.ts:52-57）。
- **链路**：`runner.stream_response`（421 行起）→ `_normalizeLangGraphStream` 归一化 → `graph/adapters/event-bridge.ts` 桥接 EventBus → `streaming.ts` SSEEncoder/StreamPublisher 输出；`ARTIFACT_CREATED` 由 tool_processor 收集的 artifacts 驱动（doc_writer/文件写产物上报，nodes.ts:1458-1487）。
- **EventBus**：`message-bus.ts` 全局事件总线 + `PersistentEventLog` 落盘（`event_bus.log_file_path` 门控）+ 12+ 类安全审计事件；跨进程适配器仅预留接口（`event-bus-adapter.ts` 注释明确 Redis/NATS 未实现）。

### 2.10 上下文工程与推理优化

- **Observation 三层蒸馏**（`adapters/observation-distiller.ts`）：结构化提取→按当前子任务关键词相关性过滤→与历史增量去重压缩；默认启用（`observation_distillation.enabled=true`）；P0-6 修复后仅对未处理 execution_id 蒸馏一次，防历史重复膨胀（nodes.ts:1422-1455）。
- **复杂度分层**（`reasoning/complexity-assessor.ts`）：tier_1/2/3 + reasoning_budget，LLM 评估失败自动降级规则化；门控默认 false。
- **CoT 锚点**（`reasoning/cot-anchors.ts`）：按 tier 注入结构化思考锚点+反思后缀，门控默认 false。
- **Few-shot**（`skills/few-shot-selector.ts`）：MMR 算法（λ=0.7）+1500 token 预算动态选例，门控默认 false，示例库当前为 `InMemoryExampleStore`（graph.ts:801 注释：生产可换 ChromaExampleStore）。
- **模型路由**（`reasoning/llm/router.ts` + factory.ts:885-929）：按 task_type 规则路由到不同 provider/model 的已绑定工具实例，带 provider:model 缓存避免每轮重建，路由路径补齐 retry+metrics 包装。
- **四层 Prompt 解耦**（`reasoning/prompt-composer.ts`）：systemCore+domain+taskSpec+runtimeContext；Markdown 文档提示注入（`config/markdown-loader.ts` 扫 AGENTS.md 等，eager/lazy 分级 + 字符预算截断）。
- **自适应终止**（`graph/termination-engine.ts`）：confidence/information-gain 等多维评分 + 场景化 SCENE_PROFILES + tier 映射，**当前为第一阶段 advisory**——结果写入 `state.termination_advice` 仅采集不改路由（nodes.ts:1241-1290；routeAfterAgent 无消费点，已验证）。

### 2.11 反馈与进化闭环

- **feedback/**：`quality-monitor.ts` rule/llm/hybrid 三模式（llm 模式经 `_build_judge_llm` 构造独立 ModuLLM judge）；`evolution-signal.ts` 信号收集；`loop-controller.ts` 反馈循环。
- **evolution/**：`evolution-orchestrator.ts` `evaluateAndEvolve()`；`parameter-tune.ts` 产出 `config_overrides` 写入 state → 下一轮同会话经 RunnableConfig 注入（nodes.ts:1706-1724 + runner `_loadPrevConfigOverrides` 227 行）；`component-swap.ts` 质量对比组件热替换、`rollback-mechanism.ts`/`versioned-store.ts` 版本回滚。
- **图层接线**：`feedback` 节点在 orchestrator 存在时挂载（profile.feedbackEnabled），`feedback.enable_evolution` 默认 **true**。

### 2.12 运行时装配与扩展

- **create_agent**（factory.ts:500-971）：一次性完成 observability boot → 记忆策略/LLM provider/prompt/context 策略/感知处理器/护栏规则注册 → Skills 加载 → LLM 构建绑工具 → 默认工具注册 → MCP 发现 → checkpointer/store → 复杂度和蒸馏器 → 模型路由 → 编排器 → 编译图（ModuGraph Proxy 包装显式持有 orchestrator，替代 monkey-patch）。
- **热更新**（runner.ts）：`get_runner` 配置 hash 惰性重建 + 配置变更回调 100ms debounce 主动失效；LLM 纯参数变更走"软失效"不重建图（P9.5.1）。
- **扩展点**（core/registry.ts）：registerTool/Perception/LLMProvider/MemoryStrategy/PolicyRule/Prompt/ContextStrategy/Node/Edge/Subgraph/EdgeRemoval 共 10+ 类，均可注册可反注册。
- **场景包内核**（kernel/）：`scenario-loader.ts` manifest 驱动装配、`scenario-host.ts` 场景包唯一交互面 + 注册全部记录反向操作、`deactivate()` 逆序作用域回滚。
- **状态回滚 API**（graph.ts:285-330）：`rollback(threadId, steps)` 基于 getStateHistory + updateState 恢复 N 步前快照（新增记录而非删除历史）。

---

## 三、能力边界与限制（按严重度）

> **实施状态（2026-10-05，第二批已完成）**：
> - P1-1 / P1-2 / P1-3 ✅ 已修复（第一批，§7.2–§7.4）
> - P2-1（hash embedding）、P2-2（termination 第二阶段）、P2-5/P2-7/P2-8 ⏳ 未做
> - P1-4（plan_confirm 无生产者）、P1-5（多模态链路）⏳ 未做
>
> 另已修复：T2-1（扩展点反注册完整性）、T2-3（10 个红测，门禁现已全绿）、T1-1（进化信号接入 EventBus）、T1-2（组件热替换/回滚接线）。
> 详见 **§七 T0 修复实施记录**。下文为**修复前**状态的原始记录，保留作为对照。

### P1（功能声明存在但链路断裂/失效）

1. **组合模式入口断链**：`plan_execute + multi_agent` 同时启用时，`routeAfterMemoryQuery` 首条 mode_router 规则返回 `supervisor`（runtime-config.ts:98-102），但 plan_execute 分支的条件边 targets 只注册 `{agent, planner}`（graph.ts:670）→ 运行时 unknown destination 崩溃。step_dispatch 侧已用 `has('supervisor')` 动态补齐（graph.ts:701），唯独入口边漏配。"解除互斥"（graph.ts:478-485 注释）只完成了一半：delegation 步骤委托可用，但全局组合模式实际不可用。
2. **code_executor 在 macOS 上功能性全失**：rlimit preamble 抛 `ValueError: current limit exceeds maximum limit`（macOS 不允许提升 current limit），连 `print(1)` 都返回 CODE_003；对应测试只断言"非 CODE_002"形成假绿（前次 PoC 实证，本次源码复核结构未变）。缓解面：该工具需宿主显式注册且 requiresApproval=true。
3. **沙箱黑名单可绕行**：`_FORBIDDEN_NAMES` 不含 urllib/socket/gc/http，且 import 检测只匹配行首——`if 1: import urllib.request` 可穿过（前次 PoC 读到 /etc/hosts，RC=0）。定位声明诚实（"弱沙箱+强审批"），但黑名单给出的安全感与实际防护强度不匹配。
4. **plan_confirm 有协议无生产者**：AG-UI 侧 kind/产物字段/前端 UI 齐备（agui-adapter.ts:52-57、1511-1551），内核无任何节点发起 `interrupt({kind:'plan_confirm'})`——"方案确认后继续执行"能力实际不存在。
5. **多模态输入在内核↔宿主链路两处受限**：内核感知图像/音频管道默认不注册（见 P2-4）；`input_data` 可携带图像但上游宿主（desktop SendMessageRequest）无 images 字段，端到端图像输入当前不可用（宿主侧结论，前次实证，本包侧接口本身可达）。

### P2（能力真实存在但有明确缩水/未达最终形态）

1. **语义检索实为词面匹配**：Chroma 默认 `_simple_hash_embedding`（chroma.ts:20-59），`setEmbeddingFunction` 全仓零调用——长期记忆 recall 的"向量相似度"不是真语义检索；启用需外部注入嵌入函数。
2. **自适应终止只到第一阶段**：termination_advice 纯采集，不参与路由决策（nodes.ts:1241 起，routeAfterAgent 不消费）；"防止无效循环"实际仍靠固定轮数预算。
3. **Supervisor 多轮闭环拓扑不可达**：need_help 重拆分逻辑存在（supervisor.ts:241-263），但 `supervisor→subagent_run` 无重入边，waiting 任务本轮不可达，代码自己以 error 日志承认（366-373 行）；子任务依赖仅在 Plan-Execute dispatcher 有完整 DAG 调度。
4. **感知/安全深水区全部 opt-in**：`builtin_processors.enabled=false` 时感知管线为空、注入/PII/语言检测实际不执行（仅文档意图关键词和澄清粗筛不依赖它）；输出护栏、PolicyEngine、敏感度阻断各自独立默认关——默认部署的"安全能力"只剩轮子骨架。
5. **工具超时是"假取消"**：`_invokeWithTimeout` 用 Promise.race 释放主流程，底层 LLM/子进程调用继续跑（nodes.ts:2718-2720 注释明示）；孤儿调用仍消耗配额。
6. **Few-shot/示例库为内存实现**：`InMemoryExampleStore` 每次构图新建（graph.ts:798-809），重启即失，无积累闭环。
7. **checkpoint HITL 暂停态不跨进程**：内存单例模式下进程重启/多实例部署后 `get_interrupt_state` 返回 pending=false（factory.ts:211-227 显式告警），需 sqlite。
8. **记忆写入是全量对话转储**：memory_update 把整段 history 原文写 store（nodes.ts:457-505），无蒸馏/摘要/去重/衰减，recall 又限 top5——长期记忆的信噪比随会话数线性恶化。

### P3（设计使然的边界）

1. **默认开关矩阵决定"两套系统"**：开箱（全默认）只有 perception(空)→memory_query→agent⇄tools→finalize→memory_update + 4 个安全工具 + 防幻觉 prompt + Observation 蒸馏 + 进化闭环；13 项高级能力全部要宿主显式 opt-in。评估"具备什么能力"必须先问"哪些 flag 开了"。
2. **无自主调度/长跑任务能力**：内核无 cron/后台执行/主动触发概念，全部由宿主请求驱动。
3. **rollback 是状态层回滚**：不撤销已执行的工具副作用（已写的文档、已发的 HTTP 请求不补偿）。
4. **EventBus 单进程**：跨进程仅接口预留；多实例部署事件不互通。
5. **组件热替换语义有限**：进化策略的 component_swap 作用于注册表；图实例靠配置 hash 重建，不存在运行中灰度切换。

### P4（质量债，间接约束能力可信度）

1. 10 个测试红的断言漂移未修（sql-query 错误码 6 例 + observability optional 依赖 4 例）。
2. `chatStore↔hitlStore` 循环 import（宿主侧，内核 `graph.ts`↔`nodes.ts` 亦存在双向导入靠 ESM 提升缓解）。
3. 文档生成意图判定为纯关键词匹配（动作词×目标词），中英文短语覆盖有限，存在误判/漏判空间（nodes.ts:150-172 已有防误判注释，说明该路径脆弱性被反复打过补丁）。

---

## 四、能力间协作关系

**主干数据流（一次请求的生命周期）**：

```
输入 → [感知] 清洗/意图/安全评估 → 熔断?(敏感/注入/PII/策略) → [澄清?] interrupt→resume
     → [记忆检索] recall top5 → 模式路由(mode_router: supervisor|planner|agent)
     → [推理] ContextStrategy 组装(system+感知+知识+Observation+Few-shot+plan步骤)
       → LLM(路由模型/自适应温度) → tool_calls?
         → [审批?] guardrails/sensitive/tool_policy → interrupt→resume(可改参)
         → [工具] 重试/缓存/限流包装 → ToolNode 并行执行 → [蒸馏] Observation 三层压缩
         → [产物] doc_writer/file_ops 成功 → artifacts→ARTIFACT_CREATED 事件
       → 无 tool_calls → [文档闭环?] doc_gen_enforce / doc_final_answer 强提醒回环
       → [响应] responseNode(兜底合成) → 输出护栏/策略 → [反馈] QualityMonitor 评分
       → [进化] config_overrides 写回 state → [记忆] 历史写 store → END
```

**关键协作点**：

1. **规划↔ReAct**：plan_execute 不另起执行引擎——planner 产出计划后，每一步仍复用同一 agent⇄tools ReAct 循环；`makePlanContextInjector` 把当前步骤注入消息，`routeAfterAgent` 在 `plan_phase==='executing'` 时把"无 tool_calls"解释为**步骤完成**而非全局结束（nodes.ts:723-725），step_finalize 游标推进后回到 step_dispatch。这是"计划驱动、反应执行"的标准 hybrid。
2. **规划↔多 Agent**：组合模式下 DAG 就绪步 `task_type=delegation` 经 Send 委托 supervisor→subagent×N→consensus→step_finalize 汇入计划流（graph.ts:741-762、dispatcher.ts:239-291）——受限于 P1-1 入口断链，当前只有"先以 plan_execute 进入、再按步委托"的半边可用。
3. **感知→下游全链路分发**：`confidence` 调温度、`task_type` 决定 few-shot 示例选择与模型路由与子图工具集、`cleaned_text` 是所有节点的输入源、`sensitivity/injection/pii` 决定熔断。
4. **记忆→规划→推理**：memory_query 的 knowledge 同时被 planner（"Relevant knowledge from memory"段，planner.ts:478-490）和 agent 上下文片段（ctx.memory_knowledge）消费；进化产出的 config_overrides 经 checkpointer 跨请求传回下一轮 agentNode——形成"记忆→行为参数"的闭环。
5. **HITL 与流式的咬合**：interrupt 载荷由 AG-UI RUN_PAUSED/USER_QUESTION_REQUEST 事件推送，`get_interrupt_state` 从 checkpoint 取权威载荷，resume 后节点**从头重执行**——审计发布为此专门做了去重表（nodes.ts:1868-1880），是 interrupt 语义与可观测性的必要妥协。
6. **工具治理三闸门串联**：guardrails 判定（审批来源）→ HITL 执行（interrupt）→ 限流/缓存/重试（执行质量）；Planner 的 requires_tool 元数据又反向引用同一批工具元数据（providesRealtimeData），工具注册信息是规划、执行、审批三个子系统共享的单一事实源。
7. **反馈进化贯通三层**：response 后 feedback 节点评分（rule/LLM judge）→ ParameterTune 产出温度/迭代预算覆盖（per-session）→ ComponentSwap/rollback 在注册表层换件；同时 consensus 失败、guardrail 命中都作为进化信号进入 EvolutionSignalCollector。

---

## 五、整体架构评估

### 设计思路

1. **声明式图 + 画像装配**：拓扑从命令式 addNode 序列演进为 GraphSpec 声明（profile.when 门控 + `has()` 动态 targets + 宿主 registerNode/Edge/Subgraph），`buildModuGraph` 降为兼容包装。图拓扑成为可被场景包重写的资产。
2. **Feature-flag 化的能力矩阵**：约 20 个能力各配独立开关，且贯彻"注册/门控默认关闭 → 默认路径逐字节零变化"的迁移纪律（几乎每个模块都有"等价改造前行为"的注释契约与等价性测试，如 policy-hitl-equivalence）。这是从 Python 版渐进移植+重构留下的鲜明印记，代价是"仓库能力 ≫ 默认能力"。
3. **防御式降级无处不在**：planner 三阶段降级、MCP/Skills/observability 失败不阻断启动、策略引擎异常回退直调、配置读异常取保守默认、LLM 无正文时程序化兜底回复。系统假设"每个增强都可能坏"，主链路优先保活。
4. **一切皆注册表**：工具/感知器/LLM provider/记忆策略/提示词/上下文策略/护栏规则/图节点边/子图共 10+ 扩展点统一收进 ComponentRegistry，kernel 场景包再在其上收一层"唯一交互面 + 可回滚注册"，形成了清晰的"内核-宿主-场景包"三层可插拔结构。
5. **横切关注点做进包装层**：重试/缓存/限流/计量套在 tool-adapter，token 埋点/超时套在 llm-adapter，审计套在 nodes interrupt 点——节点函数本体保持相对干净。

### 成熟度判断

**分层评级**：

- **核心循环（生产级）**：ReAct + 工具 + 记忆 + 流式 + 中断恢复的链路完整、边界处理密度高（tool_calls 悬挂清理、interrupt 重放去重、reducer 增量语义、蒸馏幂等等都是踩过坑后的形态），41.6k 行配 15.6k 行测试，typecheck 全绿、1056 测试通过。
- **规划/协作（工程完成度高，拓扑有硬伤）**：planner 容错和 dispatcher 的 DAG/重试/replan 设计超过多数同类实现，但组合模式入口断链（P1-1）和 supervisor 无重入边使其停在"各自单用可靠、合起来有洞"。
- **感知/安全（实现完整，默认不生效）**：代码量大（perception 4.3k 行）且设计合理，但 opt-in 矩阵意味着多数部署下这是"纸面能力"；输出护栏历史上曾是零调用死代码（T-05 才接线），提示该层的"接线验证"仍需持续 guarding。
- **多模态与语义记忆（原型级）**：hash embedding、OCR 无库降级、图像链路宿主断裂——方向预留、落地未完成。
- **进化闭环（半自动）**：参数层（config_overrides）真实生效；组件层与版本回滚更多是注册表操作，无 A/B 验证与自动回滚触发器的完整证据。

**总体**：这是一个**架构成熟度高于功能暴露成熟度**的系统——骨架（声明式图、扩展点、降级策略、审计）达到了可持续演进的工程水准；能力暴露高度依赖配置装配，且存在若干"最后一公里"断点（plan_confirm 无生产者、组合路由、termination 第二阶段未接线）。对使用者而言，最重要的心智模型是：**先确认 flag 矩阵，再谈能力清单**；对维护者而言，优先修复 P1 三项（组合路由断链、macOS 代码执行、沙箱绕行）能把"已承诺能力"的可信度拉齐到与架构相称的水平。（**2026-10-05 复查补充**：本段结论已按 §6.7 修订——P1 三项仍为首要，但需新增"进化信号未接入 collector""组件热替换未接线"两个 P1 级项，完整优先级清单见 §六。）

### 风险声明

本报告基于静态精读 + typecheck/vitest 实测 + 既有 PoC 记录（rlimit macOS 失效、沙箱绕行 PoC 为前次动态实证，本次仅复核源码结构未变，未重新执行代码）。"默认能力/门控能力"以 DEFAULT_CONFIG 为准，宿主（apps/desktop、backend-ts）另有装配覆盖，跨包结论已标注来源。

---

## 六、修复优化优先级清单（2026-10-05 复查补充）

### 6.0 补充说明与复查基线

本章为**第二轮复查**的产出。复查基线与第一章一致且未变动：分支 V2.6、HEAD `d133c2c`、包内无未提交变更；`tsc --noEmit` exit 0、`vitest run` 1056/1066 通过、10 失败均已复现。第二轮补齐了首轮未精读的 §2.8–§2.12（感知安全、流式链路、上下文工程、反馈进化、装配扩展），并据此**修正了首轮"整体无事实性偏差"的结论**。

新增发现两类问题：
- **架构连通性落差（T1）**：§2.11 与 §四-7 描述的进化信号闭环、组件热替换，实为"决策逻辑已写、运行时装配未接线"，属报告高估区。
- **事实性偏差（T3/T4）**：ContextStrategy 片段数、扩展点反注册完整性、markdown 截断归属、ARTIFACT_CREATED 归因等。

优先级分档：**T0 安全/正确性硬伤 → T1 架构连通性 → T2 治理补齐 → T3 能力缩水 → T4 文档纠偏**。工作量口径：S≈<0.5d，M≈0.5–2d，L≈>2d。

### 6.1 T0 — 安全与功能硬伤（立即修）

| # | 问题 | 位置 | 修复方向 | 量 |
|---|---|---|---|---|
| T0-1 | **沙箱黑名单可绕行**：`_FORBIDDEN_NAMES` 无 urllib/socket/http/gc；import 检测锚定行首，`if 1: import urllib.request` 可穿透 | `src/tools/code-executor.ts:58-64,122-126` | ① 补齐 `urllib`/`socket`/`http`/`gc`/`ftplib`/`smtplib`/`requests`；② import 检测去掉 `^` 锚定或改全局 multiline + 缩进无关匹配；③ 中期换 Python `ast` 白名单（文件头已列为中期目标） | S |
| T0-2 | **组合模式入口断链**：`routeAfterMemoryQuery` 首选 `mode_router` 规则返回 `supervisor`，而 plan_execute 分支边 targets 仅 `{agent, planner}` → unknown destination 崩溃 | `src/graph/graph.ts:670`（对比 `step_dispatch` 已在 `:701` 用 `has('supervisor')` 补齐） | 复用动态 targets 写法：`targets: (has)=>({agent, planner, ...(has('supervisor')?{supervisor:'supervisor'}:{})})`；补组合模式回归测试 | S |
| T0-3 | **macOS code_executor 全失**：rlimit preamble 对 RLIMIT_AS 设 soft=hard=512MB，macOS 不允许提升 current limit → 连 `print(1)` 都返回 CODE_003 | `src/tools/code-executor.ts:207-221,351-358` | preamble 内 `setrlimit` 包 `try/except`；soft 取 `min(target, current_hard)`、仅 hard 尝试提升；失败降级为仅 timeout 约束并 warn。**修完须同步修测试的"非 CODE_002"假绿断言** | S |

> 合计约 1 人日，对应 §三 P1-1 / P1-2 / P1-3，消除"已承诺能力"可信度缺口。

### 6.2 T1 — 架构连通性（报告高估区，建议提到 P1 之前处理）

| # | 问题 | 位置 | 修复方向 | 量 |
|---|---|---|---|---|
| T1-1 | **进化信号发而不收**：`consensus` 失败、guardrail 命中事件已发布，但 `EvolutionSignalCollector` **从不订阅 EventBus**（全仓唯一 `event_bus.subscribe` 在 `message-bus.ts:293` 落盘），collector 唯一喂入点是 `event-bridge.ts:209-216` | `src/feedback/evolution-signal.ts`、`consensus.ts:443-449`、`perception/security/audit.ts:97-101` | collector 构造时 `event_bus.subscribe(EventDomain.FEEDBACK/SECURITY, collector.onAgentEvent)`；注意 `_MAX_SIGNALS=500` 上限与 `reportInterval` 抽样，避免高频事件淹没 | S–M |
| T1-2 | **组件热替换/版本回滚零接线**：`ComponentSwapStrategy` 只做 `recordScore`/`shouldSwap` 决策**不执行替换**；`RollbackMechanism`/`VersionedComponentStore` 仅被 `evolution/index.ts:5-8` 导出与单测引用，`create_agent`/orchestrator 均未实例化 | `src/evolution/component-swap.ts:36-86`、`rollback-mechanism.ts:47-128`、`versioned-store.ts:202-306`、`registry.ts:763` | 决策与执行分离：新增 `applySwap()` 调 `registry.swapComponent`；在 `evaluateAndEvolve()` 成功路径接入 swap/rollback。参数层（`config_overrides`）已通，组件层本期是否交付需先决策 | M |

> **✅ 实施状态（2026-10-05 第二批）**：T1-1 / T1-2 **均已修复**，详见 §7.9。
> 注：T1-1 实施中额外发现两项问题并一并修复——① 原采样逻辑（`count % reportInterval`）会**系统性丢弃低频高危信号**（consensus 失败仅 1 次时永远达不到阈值），现改为 high/critical 免采样；② 新增订阅后 `event-bridge` 的直投会造成**同一事件重复计数**，已加 `attached` 守卫去重。
> T1-2 采用**保守契约**：新增 `feedback.enable_component_swap` / `enable_auto_rollback` 开关（**默认 false**，关闭时行为逐字节不变），且宿主须在 `context` 中显式声明候选组件，不做猜测性替换。

> **口径提醒**：修复前，§五"进化闭环（半自动）"与 §四-7 的表述应收敛为"决策已实现、装配未接线"，不宜按"组件层可换件"对外宣称。

### 6.3 T2 — 治理补齐（安全纵深，低成本高收益）

| # | 问题 | 位置 | 修复方向 | 量 |
|---|---|---|---|---|
| T2-1 | `registerPerception`/`registerPrompt` **无 unregister**，场景包回滚只能借道可选调用，破坏"均可注册可反注册"契约 | `src/core/registry.ts:204,405`（对比已有 `unregisterTool:604` 等 10 个原语） | 补 `unregisterPerception`/`unregisterPrompt`；`scenario-host.ts:114` 的 `unregister?.()` 改强依赖 | S |
| T2-2 | `code_executor` 仅在 HITL 开启时才有审批保护，HITL 关闭即裸奔 | `code-executor.ts:288-290`、`tool-guardrails.ts:101-107` | 工具目录层标记 `high_risk`，在 factory 注册阶段即强制 `requiresApproval`，不依赖运行时 HITL 开关 | S |
| T2-3 | 10 个测试红：sql-query 6 例断言旧 `SQL_003`；observability 4 例缺 optionalDependency | `tests/tools/sql-query.test.ts:108,116` 等 | 断言改 `SQL_005`；observability 用例加 `skipIf` 或补 devDependency；恢复门禁全绿 | S |

> **✅ 实施状态（2026-10-05）**：T2-1 / T2-3 **已修复**（§7.9.3 / §7.9.4），测试门禁已 **1108/1108 全绿**。
> T2-3 实际为 **7 个 sql-query + 3 个 observability**（报告原写 6+4，总数 10 一致）。
> T2-3 修法与原建议不同：sql-query 未硬编码改为 `SQL_005`，而是断言**语义**（校验通过）+ 按依赖可用性精确校验错误码，使有无 `better-sqlite3` 两种环境均正确。
> T2-2 **未做**（待 W3）。

### 6.4 T3 — 能力缩水（影响声明能力上限，可排期）

| # | 问题 | 位置 | 修复方向 | 量 |
|---|---|---|---|---|
| T3-1 | **开启 `builtin_processors` 也只跑 1 段**：`llm_parser`/`image_processor`/`audio_processor` 从未注册，text 管道第二段恒 "not found, skip" | `src/perception/builtin-processors.ts:52-53,90` | 按 `perception.routing` 声明注册对应处理器；为缺依赖（OCR/ASR）补可选依赖探测与显式降级标记 | M |
| T3-2 | **模型路由只有 task_type 生效**：`factory.ts` 未传 `estimated_complexity`/`cost_budget_max`，router 另两类规则永不命中 | `src/graph/factory.ts:885-929`、`src/reasoning/llm/router.ts:27-32` | 从 `state.complexity_assessment` 透传 complexity；补 costBudget 来源 | S–M |
| T3-3 | **温度优先级注释与实现倒置**：注释写"config_overrides > 低置信 > tier"，实际 低置信(`nodes.ts:1154`) > override(`:1162`) > tier(`:1168`)，per-session 覆盖压不过低置信强制保守 | `src/graph/nodes.ts:1140`（注释）vs `:1154/1162/1168`（实现） | 先明确期望语义（建议 override 最高，符合"宿主可覆盖"直觉），再改实现 + 同步注释 + 补单测锁定 | S |
| T3-4 | **ARTIFACT_CREATED 判定逻辑双份实现**：nodes.ts 与 agui-adapter 各自判定 doc_writer 成功，agui 层不读 `state.artifacts` | `nodes.ts:1459-1465` vs `agui-adapter.ts:1330-1337`（发射点 `:639-651`） | agui 层改读 `state.artifacts`，删除重复判定，防两侧漂移 | S–M |

> **✅ 实施状态（2026-10-05 第三批）**：T3-1 ~ T3-4 **均已修复**（§7.12）。
> T3-2 只接线有真实来源的 `estimatedComplexity`；`costBudget` **未编造数据源**（cost-tracker 只有开关，无累计值）。
> T3-4 **未采用**原建议的"agui 改读 `state.artifacts`"——实测 `values` 在 streamMode 中可行，但会改变发射时序；改为抽取单一事实源 `tools/doc-writer-artifact.ts`（三处判定实际有**三份**而非两份），消除漂移根因且零行为变化。
| T3-5 | **自适应终止只到第一阶段**：`termination_advice` 纯采集，`routeAfterAgent` 无消费点 | `src/graph/termination-engine.ts`、`nodes.ts:1274` | 按原设计口径，先积累 `false_positive_rate < 5%` 再开第二阶段路由，勿提前 | L |
| T3-6 | **长期记忆是 hash 词面匹配 + 全量对话转储**：`setEmbeddingFunction` 零调用；`memory_update` 写整段 history 原文，recall 限 top5 | `src/memory/chroma.ts:24-47,186`、`nodes.ts:457-505` | ① 注入真实 embedding 或接 Chroma 默认 EF；② 写 store 前加摘要/去重/衰减 | L |
| T3-7 | **工具超时是"假取消"**：Promise.race 释放主流程，底层 LLM/子进程继续跑并消耗配额 | `nodes.ts:2718-2739`（注释已明示） | 传 `AbortSignal` 给 LLM/子进程；至少对子进程启用 kill 信号 | M |
| T3-8 | **OCR 仅存在于注释 TODO**：三个 `_AVAILABLE` 硬编码 `false`，无实现无依赖 | `src/perception/vision/image-processor.ts:27-31,38-39,203-215` | 接入 tesseract.js 或云 OCR，或在 capability-registry 显式标注"未实现"而非"可选" | M |

### 6.5 T4 — 文档与注释纠偏（零风险，影响报告可信度）

| # | 问题 | 位置 | 修正 |
|---|---|---|---|
| T4-1 | ContextStrategy 片段数：§2.1 写"7 片段"，实为 **6 个**（源码 `:1` 注释"7段"与 `:3-9` 对照表只列 6 段自相矛盾） | `src/graph/context-strategies.ts:1,128-135` | 改源码注释为 6；同步修正本报告 §2.1 |
| T4-2 | markdown 字符预算截断归属错误：§2.10 归给 `markdown-loader.ts`，实际 `applyCharBudget` 在 `markdown-prompt-aggregator.ts`（`markdown-loader.ts` 只做扫描 + eager/lazy 分级） | `src/config/markdown-prompt-aggregator.ts:60-73` | 修正本报告 §2.10 引用 |
| T4-3 | "跨进程适配器仅预留接口"需限定层：`create_distributed_event_bus` 包装器**有真实实现**，Redis 为伪代码注释 | `src/orchestration/communication/event-bus-adapter.ts:70-111,153` | 本报告 §2.9 补注"backend 层未实例化" |
| T4-4 | agui-adapter 顶部事件数注释陈旧：仍写"19/20 种"，实际 `AGUIEventType` 已 24 种 | `agui-adapter.ts:2,13` vs `:16-42` | 改源码注释 |
| T4-5 | `built-in processors` 默认关闭的描述需补"开启亦残缺"（见 T3-1）；OCR 表述需由"可选 tesseract.js/云 API"下调为"仅 TODO"（见 T3-8） | 本报告 §2.8、P2-4 | 按 T3-1/T3-8 结论修订表述 |

### 6.6 建议执行波次

| 波次 | 内容 | 理由 |
|---|---|---|
| **W1（本周）** | T0-1 / T0-2 / T0-3 + T2-1 / T2-3 | 纯 S 量级；安全与正确性硬伤 + 恢复门禁全绿；无架构依赖，可立即动手 |
| **W2** | T1-1 / T1-2 | 打通进化闭环真实连通性；需先决策"组件层是否本期交付" |
| **W3** | T2-2 + T3-1 / T3-2 / T3-3 / T3-4 | 治理补齐 + 局部能力缩水项，均可独立回归 |
| **W4** | T3-5 / T3-6 / T3-7 / T3-8 + T4 全量 | 长周期能力增强与文档纠偏；T4 成本近零，建议随手并行 |
| **持续** | T3-5 第二阶段、T3-6 记忆语义 | 需指标达标后灰度，勿提前开启 |

**一句话优先级**：先补 T0 三项硬伤（尤其沙箱绕行与组合路由）恢复"声明可信度"，再补 T1 两项让进化闭环名副其实，然后才是 T3 的能力上限增强；T4 文档纠偏零成本可全程并行。

### 6.7 对第五章"成熟度判断"的修订

原 §五"总体"建议"优先修复 P1 三项"。结合第二轮复查，修订为：

1. **P1 三项仍为首要**（组合路由断链、macOS 代码执行、沙箱绕行）——纯 S 量级、收益最直接。
2. **新增两个 P1 级项**：进化信号未接入 collector（T1-1）、组件热替换未接线（T1-2）。这两项使 §五"进化闭环（半自动）"与 §四-7 的结论强度需要下调，属**报告高估导致的对外宣称风险**，优先级应高于 §三 P2 各项。
3. **§五"感知/安全"层判断不变**（实现完整、默认不生效），但需补注"开启 `builtin_processors` 后仍残缺"（T3-1）与"OCR 实为 TODO"（T3-8）。
4. **§五"架构成熟度高于功能暴露成熟度"的核心结论仍成立**，且第二轮复查进一步印证：落差不止在"默认 flag 关闭"，还在"已写代码未装配接线"（T1）与"文档/注释与实现漂移"（T4）。


---

## 七、T0 修复实施记录（2026-10-05）

### 7.1 结论摘要

§六 T0 三项**全部完成修复**并通过全量回归。实施过程中发现 **2 个报告未记录的问题**（其中 1 个严重度高于原 P1-2/P1-3），已一并修复。

| 项 | 状态 | 报告预估 | 实际发现 |
|---|---|---|---|
| T0-1 沙箱黑名单可绕行 | ✅ 已修复 | S | 与报告一致，另发现黑名单遗漏面比报告所述更广 |
| T0-2 组合模式入口断链 | ✅ 已修复 | S | 与报告一致，**另需配套调整 `mode_router` 顺序**才能让组合模式真正可用 |
| T0-3 macOS code_executor | ✅ 已修复 | S | **发现报告未描述的更严重缺陷：POSIX 下用户脚本从未被执行** |

### 7.2 T0-1 沙箱黑名单（`src/tools/code-executor.ts`）

**修复内容**
1. `_FORBIDDEN_NAMES` 补齐网络/内省/子进程类入口：`urllib` `socket` `http` `requests` `ftplib` `smtplib` `telnetlib` `xmlrpc` `webbrowser` `ssl` `asyncio` `gc` `multiprocessing` `pty`。
2. **import 检测解除行首锚定**：`/^\s*import\s+/m` → `/(?:^|[^\w.])import\s+[A-Za-z_]/`。原正则锚定行首，`if 1: import urllib.request`（PoC 形态）可穿透；新规则不锚定且要求 `import` 后紧跟标识符，覆盖行内/条件/循环/函数内 import，同时用 `[^\w.]` 排除 `__import__` 误报。
3. `_FORBIDDEN_FRAGMENTS` 补齐拼接绕过形态（`"url"+"lib"` → `urllib`）。

**审查中额外修正**
- 删除了 `commands`（Python 2 废弃模块，Py3 无效）：无安全价值却增加误报面（`print("commands")` 会被拒）。
- 在源码中显式记录**误报面**：词边界匹配作用于整段代码文本（含注释与字符串），故 `print("see http://x")` 会被拒——遵循文件既有"宁误报不漏报"原则，并指向文件头的 AST 白名单中期目标。

### 7.3 T0-2 组合模式入口断链（`src/graph/graph.ts` + `src/config/runtime-config.ts`）

**修复内容**
1. `memory_query` 的 plan_execute 分支边 targets 补 `supervisor`（原仅 `{agent, planner}`）。修复后"router 可能返回的每个值都有已注册目标"，与 `mode_router` 顺序**解耦**——宿主自定义规则顺序也不会因缺目标崩溃。
2. **无需动态 targets 工厂**（与 §六 原建议不同）：`buildFromSpec` 已内置过滤（剔除未启用节点目标）。补的键在 plan_execute 单开时会被自动剔除，**拓扑逐字节不变**。
3. **配套调整 `mode_router` 顺序**（报告未预见）：原顺序 multi_agent 在首，组合模式下 `routeAfterMemoryQuery` 恒返回 `supervisor`，与 `graph.ts` 自身声明的"plan_execute 优先入口"矛盾，且会让 plan_execute 被完全绕过（planner 永不进入）。已前置 plan_execute 规则。

**连带修复（审查发现的口径不一致）**
- `describeGraphSpec` 原**不做**目标过滤，而 `buildFromSpec` 做，其 docstring 却声称"使用相同的目标过滤逻辑"——golden 快照会失真。已抽取 `_resolveEdgeTargets()` 供两处共用，从根上消除漂移。
- 同步更新组合模式 golden 快照（`memory_query` 目标新增 `supervisor`）。

**无回归验证**：单开任一开关及全关时，`routeAfterMemoryQuery` 返回值与修复前完全一致（`agent` / `planner` / `supervisor`）。

### 7.4 T0-3 code_executor（`src/tools/code-executor.ts`）

**发现报告未描述的严重缺陷（原 P1-2 描述偏轻）**

原 preamble 只设置 rlimit 即结束，而用户脚本作为 `argv[1]` 传入——`python3 preamble.py user.py` **只执行 preamble，用户脚本永不运行**。实测：

| 平台 | 修复前实际行为 |
|---|---|
| macOS | preamble 抛 `ValueError` → 全部返回 `CODE_003`（报告已描述） |
| Linux | rlimit 成功 → **用户代码静默不执行，返回 `status=success` + 空 stdout** |

后者比 macOS 报错更危险：**静默假成功**。若仅按报告建议"加 try/except"，Linux 与 macOS 都会退化为 `RC=0` + 空输出，把崩溃变成静默错误。

**修复内容**
1. preamble 末尾显式 `exec` 用户脚本：rlimit 在**同一进程**生效，语义与直跑一致；保留 `__name__="__main__"`、`__file__` 指向用户脚本（traceback 文件名正确）。
2. 资源限制改为 **soft=min(target, current_hard)、hard 沿用当前值**，消除 macOS `ValueError`。
3. 两个限制**独立隔离**（AS / CPU 各自 try-except），单项失败不跳过另一项；`resource` 模块导入失败亦单独降级。
4. 降级时向 stderr 输出**可定位到具体限制项**的诊断（`RLIMIT_AS unavailable` / `RLIMIT_CPU unavailable` / `resource module unavailable`）。
5. `argv[1]` 缺失时 `raise SystemExit` 而非静默无操作。

**审查中自查出的功能 bug（已修）**
- `RLIMIT_CPU` 的 soft 初版误写为 `_modu_max_cpu`（INFINITY 分支）⇒ `soft=INFINITY` 等于**完全不限制 CPU**；已改为 `_modu_cpu`，并加断言锁定。

### 7.5 平台实测：macOS 资源限制不生效（重要遗留风险）

修复后实测（macOS / Python 3.14.5）：

| 限制 | macOS 行为 |
|---|---|
| `RLIMIT_AS` | 调用**被接受不报错**，但内核**不执行**——`getrlimit` 仍返回 `RLIM_INFINITY`，1GB `bytearray` 分配成功 |
| `RLIMIT_CPU` | 抛 `ValueError: current limit exceeds maximum limit` → 被捕获降级，stderr 输出诊断 |

**结论**：macOS 上资源限制**形同虚设**，真实约束来自 `execFile` timeout（默认 10s）+ `maxBuffer` + `requiresApproval=true`。Linux 上两项均正常生效。

**依赖 rlimit 做硬隔离的部署必须知悉此平台差异**；若需 macOS 上真实内存约束，只能升级为容器/nsjail 级隔离（文件头"长期目标"）。已在源码 docstring 中如实记录，避免"注释宣称生效、实际不生效"的漂移。

### 7.6 验证结果

| 项 | 修复前基线 | 修复后 | 结论 |
|---|---|---|---|
| `tsc --noEmit` | exit 0 | exit 0 | ✅ 无编译错误 |
| `vitest run` 测试数 | 1056 passed / 10 failed（1066） | **1078 passed / 10 failed（1088）** | ✅ +22 全通过 |
| 测试文件 | 87 passed / 3 failed（90） | 88 passed / 3 failed（91） | ✅ 新增文件全通过 |
| 失败用例 | 7 sql-query + 3 observability | **完全相同的 10 个** | ✅ **无新增缺陷** |
| code-executor 用例 | 9 | 25 | ✅ 含真实子进程执行断言 |
| 组合模式图级用例 | 0 | 10 | ✅ 覆盖 4 种开关组合 + 建图 |

新增测试：`tests/graph/t0-combined-mode.test.ts`（10）、`tests/tools/code-executor.test.ts`（+16）。
其中 `code-executor` 已用**真实 python3 子进程**替换原"假绿"断言（`not.toBe('CODE_002')`）——现断言 `status==='success'` **且 stdout 含特征标记**，并覆盖 `__name__`/`__file__` 语义与非零退出归类。

**跨包影响评估**：`mode_router` / `plan_execute_enabled` 在 `packages/modu-agent` 之外**零引用**，重排不影响 `apps/desktop`、`backend-ts`。

### 7.7 遗留风险

| # | 风险 | 等级 | 说明 |
|---|---|---|---|
| 1 | macOS 资源限制不生效 | **中** | 见 7.5；依赖 rlimit 硬隔离的部署需改用容器级隔离 |
| 2 | 沙箱仍为正则/词法级，非 AST | **中** | 继承文件头声明；本轮收紧了已知绕过面，但理论上仍有未覆盖构造 |
| 3 | 黑名单误报面扩大 | **低** | 新增 `http`/`socket` 等词会拒含这些词的注释与字符串；有意的保守取舍 |
| 4 | P1-4 plan_confirm 无生产者 | **中** | 未修复；协议齐备但内核无发起方，能力仍不存在 |
| 5 | 10 个测试仍红 | **低** | 属 T2-3（sql-query 断言旧错误码 + observability 缺 optionalDependency），非本轮范围 |
| 6 | `code_executor` 无独立进程隔离 | **低** | 与用户代码同 Node 进程共享权限边界；`requiresApproval=true` 是主要防线（T2-2 待补强） |

### 7.8 下一步

按 §六 波次，T0 完成后应转入 **W2（T1-1 进化信号接入 / T1-2 组件热替换接线）**，二者是当前"报告高估"最集中的区域；建议同时并行 W1 剩余的 T2-1、T2-3（成本低、可独立回归）。

### 7.9 W1 剩余 + W2 实施记录（2026-10-05 第二批）

继 T0 之后按 §六 波次推进 **W2（T1-1 / T1-2）** 与 **W1 剩余（T2-1 / T2-3）**，四项全部完成。

| 项 | 状态 | 说明 |
|---|---|---|
| T2-1 扩展点反注册完整性 | ✅ 已修复 | S |
| T2-3 10 个红测 | ✅ 已修复 | S |
| T1-1 进化信号接入 EventBus | ✅ 已修复 | S–M |
| T1-2 组件热替换/回滚接线 | ✅ 已修复 | M |

**本批结束时测试门禁首次全绿**：`1108 passed / 1108`（92 文件全通过），此前基线为 `1056 passed / 10 failed`。

#### 7.9.1 T1-1 进化信号接入 EventBus（`src/feedback/evolution-signal.ts` + `src/evolution/evolution-orchestrator.ts`）

**修复内容**
1. `EvolutionSignalCollector` 新增 `attachEventBus(bus?, domains?)` / `detachEventBus()` / `attached`，订阅全局 EventBus 单例（已核**无循环依赖**：`message-bus.ts` 仅依赖 `./protocol.js`）。
2. `EvolutionOrchestrator` 构造时自动 `attachEventBus()`，使 consensus 失败、guardrail 命中等**直接 publish 到总线**的信号首次进入收集器。
3. 新增 `EvolutionOrchestrator.dispose()` 释放订阅（EventBus 为全局单例，orchestrator 反复重建会造成重复计数与泄漏）。

**修复低频高危信号被丢弃（报告未预见）**
原 `onAgentEvent` 仅按 `count % reportInterval === 0` 采样。`consensus` 失败若只发生 1 次，`count=1` 永远达不到 `reportInterval=100` 阈值 → **最该被进化闭环看到的信号被系统性丢弃**。现改为：`high`/`critical` 事件**即时成信号**（不采样），常规事件仍按采样率削峰。

**审查自查出的缺陷（已修）**
`event-bridge.ts` 先 `publish` 到总线、后又直接 `onAgentEvent(...)`，新增订阅后**同一事件被计数两次**（counter 双增、环形缓冲占用翻倍）。已改为：仅当 `collector.attached !== true` 时才直投——订阅路径为单一入口，同时兼容宿主注入独立 collector 的旧用法。

#### 7.9.2 T1-2 组件层进化接线（`src/evolution/*`）

**修复内容**
1. `ComponentSwapStrategy` 新增 `applySwap()`（**真正执行** `registry.swapComponent`）与 `registry` 只读访问器。此前 `shouldSwap` 纯计算，`swapComponent` 全仓无调用方 → 组件层"进化"从未发生。
2. `EvolutionOrchestrator` 新增 `_initComponentLayer()`：按开关实例化 `ComponentSwapStrategy` / `RollbackMechanism` / `VersionedComponentStore`（三者此前连构造调用方都没有）。
3. 新增 `_componentLayerStep()`：记录质量分 → 执行替换/回滚，结果写入 `result['component_action']`。

**保守契约（刻意设计）**
组件替换影响运行中状态，风险高于参数层，故：
- 两个开关 `feedback.enable_component_swap` / `feedback.enable_auto_rollback` **默认 false**，关闭时三层皆 `null`、`evaluateAndEvolve` 跳过组件层 → **与引入前行为逐字节一致**；
- 宿主需在 `context` 中**显式声明**候选组件（`evolution_component` / `evolution_candidates`），未声明时不做任何猜测性替换；
- 缺少候选实例时拒绝写入（不把 `undefined` 灌进注册表）。

#### 7.9.3 T2-1 扩展点反注册完整性（`src/core/registry.ts` + `src/kernel/scenario-host.ts`）

1. 补 `unregisterPerception(name)` 与 `unregisterPrompt(id)`（后者对接口上可选的 `unregister` 做防御性收窄，缺失时告警返回 false 而非抛错）。
2. `ScenarioHost.registerPrompt` 改用强依赖原语（原 `getPromptRegistry().unregister?.()` 是可选调用 → 方法缺失时静默失败、回滚不彻底）。
3. `ScenarioHost` 新增 `registerPerception()`——此前该扩展点既无法被场景包使用、也无法被回滚，两侧补齐后契约完整。

#### 7.9.4 T2-3 红测修复（`tests/`）

| 组 | 根因 | 修法 |
|---|---|---|
| 7 个 sql-query | 硬编码断言 `SQL_003`，而源码已把"依赖缺失"拆为 `SQL_005` | 新增 `expectValidationPassed()`：断言**语义**（校验通过，非 SQL_001/002）+ 按 better-sqlite3 可用性精确校验错误码，**两种依赖状态下均正确** |
| 3 个 observability | `prom-client` 是 optionalDependency，未安装时 MetricsRegistry 降级 no-op → 指标文本恒空 | 按依赖可用性 `skip`（装了该依赖的完整 CI 仍真实执行断言），不再把"环境缺可选依赖"标红为代码缺陷 |

#### 7.9.5 本批验证结果

| 项 | 上一轮（T0 后） | 本批后 |
|---|---|---|
| `tsc --noEmit` | exit 0 | exit 0 |
| 测试通过 | 1078 / 1088（10 失败） | **1108 / 1108（0 失败）** |
| 测试文件 | 88 passed / 3 failed | **92 passed / 92** |

新增 `tests/evolution/t1-wiring.test.ts`（20 例），覆盖：EventBus 订阅连通性、高危事件免采样、attach 幂等、detach 释放、缓冲上限、event-bridge 去重、组件替换真实落库、阈值不足不替换、缺实例拒绝写入、默认关闭零行为变化、保守契约、反注册完整性。

### 7.10 修复后状态总览（截至第二批）

| 优先级 | 项 | 状态 |
|---|---|---|
| T0-1 | 沙箱黑名单 + import 锚定 | ✅ 已修复 |
| T0-2 | 组合模式入口断链（含 mode_router 重排） | ✅ 已修复 |
| T0-3 | code_executor 用户脚本执行 + macOS 降级 | ✅ 已修复 |
| T2-1 | 扩展点反注册完整性 | ✅ 已修复 |
| T2-3 | 10 个红测 | ✅ 已修复 |
| T1-1 | 进化信号接入 EventBus | ✅ 已修复 |
| T1-2 | 组件热替换/回滚接线 | ✅ 已修复 |
| T2-2 | code_executor 强制审批 | ⏳ 未做 |
| T3-1~8 | 能力缩水项 | ⏳ 未做 |
| T4-1~5 | 文档/注释纠偏 | 部分已随代码修复 |
| P1-4 | plan_confirm 无生产者 | ⏳ 未做 |

**门禁现状**：`tsc --noEmit` 通过；`vitest run` **1108/1108 全绿**（92 文件），已消除 §七 记录的全部 10 个历史红测。

**本批新增遗留风险**

| # | 风险 | 等级 | 说明 |
|---|---|---|---|
| 1 | 组件层进化默认关闭，需宿主显式声明候选组件 | 低 | 刻意设计（保守契约），避免猜测性替换运行中组件；开启方式见 §7.9.2 |
| 2 | `EvolutionSignalCollector` 现长驻订阅全局总线 | 低 | 已提供 `dispose()`；宿主销毁 agent 实例时应调用，否则旧 collector 持续收事件 |
| 3 | 高危事件免采样可能提升信号量 | 低 | 受 `_MAX_SIGNALS=500` 环形上限约束，不会无界增长 |
| 4 | macOS 资源限制不生效 | 中 | 承 7.5，未变 |

### 7.11 下一步

- **W3**：T2-2（code_executor 强制审批）+ T3-1/T3-2/T3-3/T3-4（感知处理器残缺、模型路由仅 task_type 生效、温度优先级注释与实现倒置、ARTIFACT_CREATED 双份实现）。
- **W4**：T3-5~T3-8 + T4 文档纠偏零成本项。
- **仍开放**：P1-4（plan_confirm 无生产者）需产品决策——是补内核发起方，还是收敛 AG-UI 协议声明。

### 7.12 W3 实施记录（2026-10-05 第三批）

W3 五项全部完成：**T2-2**（code_executor 强制审批）+ **T3-1**（感知处理器残缺）/ **T3-2**（模型路由仅 task_type 生效）/ **T3-3**（温度优先级倒置）/ **T3-4**（ARTIFACT 双份判定）。

#### 7.12.1 T2-2 code_executor 强制审批（`src/graph/factory.ts`）

**问题本质**：`requiresApproval()` 只是**策略声明**，而 `human_review` 节点仅在 `tools.human_in_loop.enabled=true` 时挂载（`graph.ts` 的 `when: p.hitlEnabled`）。HITL 关闭时该声明**无人执行** → code_executor 实际裸奔（叠加 T0-1 修复前的黑名单绕行与 §7.5 的 macOS rlimit 失效）。

**修法（fail-closed 裁剪）**：装配期检测"无条件要求审批"的工具（注册表中 `requiresApproval() === true`），若 HITL 未开启则**从绑定集剔除**，使该能力对本 agent 实例不可用；未注册此类工具的宿主**零行为变化**。判定异常时保守放行。

> 注：单纯"注册时强制 `requiresApproval`"无效——没有门控节点时该标志不会被消费。故采用剔除而非标记。

#### 7.12.2 T3-1 感知处理器残缺（`src/perception/builtin-processors.ts`）

1. 改为**按 `perception.routing.*.pipeline` 声明**逐个注册（此前只注册 `text_preprocessor`，routing 默认声明的 `llm_parser` / `image_processor` / `audio_processor` 永远 "not found"，配置形同虚设）。
2. 四者均**无构造期外部依赖**、缺依赖时各自降级：`LLMParser`（`llmAdapter=null` 走本地方法）/ `ImageProcessor`（无 OCR 库降级 metadata-only）/ `AudioProcessor`（无 Whisper 走 fallback）。
3. 汇总日志替代"每轮一条 not found"的隐式噪声；宿主注册仍优先。
4. 同步更新文件头已过时的"已知取舍"注释。

**遗留**：OCR / ASR 仍属**能力缺失**（非接线缺失），需接 tesseract.js / Whisper 才算落地（T3-8）。

#### 7.12.3 T3-2 模型路由透传复杂度（`src/graph/factory.ts`）

`router.ts` 的 `_matchCondition` 支持 `task_type` / `estimated_complexity` / `cost_budget_max` 三类条件，装配层只传 `taskType` / `sessionId` → **另两类永不命中**。现补 `tier_1/2/3 → low/medium/high` 映射并透传。

**未编造数据源**：`costBudget` 仍不传 —— `cost-tracker.ts` 只有开关（`is_cost_tracking_enabled`），无累计成本值；待成本统计落地后接入即可（router 侧已支持）。

#### 7.12.4 T3-3 温度优先级链倒置（`src/graph/nodes.ts`）

**问题**：注释声明"config_overrides > 低置信度保守 > tier"，实际 if 链是「低置信度保守 > config_overrides > tier」——进化循环产出的 per-session 温度在低置信轮次被无声覆盖，与 §2.11「config_overrides 真实生效」矛盾。

**修法**：对齐为 `config_overrides > 低置信度保守 > tier > 默认值`。
**安全性**：`config_overrides.temperature` 由质量反馈产出且高失败率时主动下调（`parameter-tune.ts:107-117`），提高优先级不引入失控风险。

#### 7.12.5 T3-4 ARTIFACT_CREATED 双份判定（新增 `src/tools/doc-writer-artifact.ts`）

**问题**：同一套"doc_writer 成功"判定在**三处**各写一遍——`graph/nodes.ts`（写 `state.artifacts`）、`agui-adapter.ts` 的 messages 分支与 SSE 分支（发 ARTIFACT_CREATED）。三者条件几乎逐字重复却**各有细微差异**（nodes 要求 name+path 均存在，agui 只要求 name），任一侧被单独修改即静默漂移。

**修法**：抽取**单一事实源** `detectDocArtifact(toolName, content)`（无任何 import，零循环依赖风险），三处共用；判定语义保持逐字一致（含"status 必为 success"这一两侧共同前置条件）。

> 与 §六 原建议的差异：原建议"agui 层改读 `state.artifacts`"。实测 `values` 确在 streamMode 中、技术可行，但会改变**发射时序**（从 tool-result 消息改为 values 事件），风险更高，故采用"抽单一事实源"——消除漂移根因且**零行为变化**。

#### 7.12.6 审查自查

- **我的测试期望写错并已修正**：`doc_writer` 工具名本身即充分条件，`.pdf` 也会发事件——这是**原有语义**，实现保持不变，测试改为锁定该语义。
- **3 处既有测试断言过时**（`builtin-processors.test.ts` 硬编码 `toBe(1)`/`toBe(0)`，锁定的是"只注册 1 个处理器"这一修复前行为）。已改为按 routing 声明动态断言，保留各用例真实意图（幂等性、宿主不被覆盖）。

#### 7.12.7 验证结果

| 项 | 第二批后 | W3 后 |
|---|---|---|
| `tsc --noEmit` | exit 0 | exit 0 |
| 测试通过 | 1108 / 1108（92 文件） | **1120 / 1120（94 文件）** |
| 失败 | 0 | **0** |

新增 `tests/tools/doc-writer-artifact.test.ts`（8 例）、`tests/perception/t3-builtin-processors.test.ts`（4 例）。

### 7.13 修复后状态总览（截至第三批）

| 优先级 | 项 | 状态 |
|---|---|---|
| T0-1 / T0-2 / T0-3 | 沙箱、组合路由、code_executor | ✅ |
| T1-1 / T1-2 | 进化信号接线、组件层接线 | ✅ |
| T2-1 / T2-2 / T2-3 | 反注册、强制审批、红测 | ✅ |
| T3-1 / T3-2 / T3-3 / T3-4 | 感知处理器、路由透传、温度优先级、产物判定 | ✅ |
| T3-5 ~ T3-8 | 终止第二阶段、记忆语义、超时取消、OCR 落地 | ⏳ |
| T4-1 ~ T4-5 | 文档/注释纠偏 | 部分已随代码修复 |
| P1-4 | plan_confirm 无生产者 | ⏳ 需产品决策 |

**门禁**：`tsc --noEmit` 通过；`vitest run` **1120/1120 全绿**（94 文件）。

**本批新增遗留风险**

| # | 风险 | 等级 | 说明 |
|---|---|---|---|
| 1 | HITL 关闭时高风险工具被剔除 | 中 | 有意的 fail-closed，但改变"注册了 code_executor 却能直接用"的既有习惯；开启 `tools.human_in_loop.enabled=true` 即恢复 |
| 2 | 温度优先级重排改变低置信轮次取值 | 中 | 进化循环下发的温度现可覆盖保守模式；已确认该值来源安全，但建议灰度观察 `avg_rounds_per_task` |
| 3 | 感知处理器实例增加带来启动开销 | 低 | 四者均为轻量构造（无网络/无模型加载） |
| 4 | OCR / ASR 仍无 | 中 | 承 T3-8，属能力缺失需引入依赖 |

### 7.14 下一步（W4）

- **T4-1 ~ T4-5**：零成本文档/注释纠偏，可随手完成（其中 T4-1 ContextStrategy 6≠7、T4-2 markdown 截断归属、T4-3 event-bus 层限定、T4-4 agui 事件数注释仍待改）。
- **T3-5**：自适应终止第二阶段 —— 需先积累 `false_positive_rate` 指标，达标后再开路由（勿提前）。
- **T3-6 / T3-7**：记忆语义化与工具超时真实取消 —— 工作量 L，建议独立排期。
- **T3-8**：OCR 落地需引入 tesseract.js，属依赖决策。
- **P1-4**：需产品决策——补内核发起方，还是收敛 AG-UI 协议声明。

### 7.15 W4 实施记录（2026-10-05 第四批）

W4 完成 **T3-5（仅指标采集）**、**T3-6（增量写入）**、**T3-7（真实取消）** 与 **T4-1/T4-4（注释纠偏）**。**T3-8（OCR 落地）未做** —— 需引入 `tesseract.js` 新依赖，属依赖决策，不擅自引入。

#### 7.15.1 T3-5 自适应终止：只补指标，不接线路由（按原设计口径）

§六 明确要求"先积累 `false_positive_rate` 达标再开路由，勿提前"，故**未改路由**。但发现一个使该门槛**无法评估**的缺口：advice 仅写入 `state.termination_advice`（随 checkpoint 持久化），**无法跨请求聚合统计**。

**修复**：`MetricsRegistry` 新增 `record_termination_advice(action)` + 两个指标（`modu_termination_advice_total`、`modu_termination_advice_by_action_total`），并在 advice 产出处埋点。第二阶段决策所需的数据来源至此具备。

#### 7.15.2 T3-6 长期记忆增量写入（`src/graph/nodes.ts` + `state.ts`）

**问题比报告描述更严重**：原实现每轮把**整段 history 原文**重写一遍（key 为秒级时间戳）：
- 第 1 轮写 `[u1,a1]`、第 2 轮写 `[u1,a1,u2,a2]`、第 N 轮写全量
- 存储量随轮数**平方级增长**；recall top5 命中的多是同一段历史的不同快照

**修复**：
1. 新增状态游标 `memory_persisted_count`，**只写入上次持久化之后的新增消息**。
2. 单条写入长度上限 `memory.max_persist_chars`（默认 8000，<=0 关闭）+ `truncated` 标记。
3. key 增加序号后缀，避免同一秒内多次写入互相覆盖。
4. 游标越界（messages 被裁剪/重建）时**回退为全量写入**并告警——宁可重复也不静默丢数据。

**未包含**：embedding 函数注入（需宿主提供真实语义嵌入，属宿主职责；`setEmbeddingFunction` 仍是零调用）。

#### 7.15.3 T3-7 超时真实取消（`src/graph/nodes.ts`）

`_invokeWithTimeout` 由接收 promise 改为接收**工厂函数 + AbortSignal**：超时触发 `controller.abort()`，经 `invoke(input, { signal })` 透传到 provider 的 fetch，从而真正中断网络请求。4 个调用点（agent LLM / 子图 / 子 Agent 回退路径）全部更新。底层不支持 signal 时退化为原 race 行为，无回归。

#### 7.15.4 T4 注释纠偏

| 项 | 修正 |
|---|---|
| T4-1 | `context-strategies.ts` 首行"7 段"→ **6 段**（与文件内对照表及实际数组一致） |
| T4-4 | `agui-adapter.ts` 的"19 种"/"20 种"→ 实际 **24 种**；并新增**派生常量** `AGUI_EVENT_TYPE_COUNT`（`Object.keys(...).length`），使数量不再手写、防止再次漂移 |

未做的 T4-2 / T4-3 / T4-5 属**报告侧表述修正**（markdown 截断归属、event-bus 层限定、感知/OCR 表述），已在 §7.12 随代码修复同步说明，无需再改源码。

#### 7.15.5 审查自查（重要）

新增测试暴露出**我实现中的一个真实 bug**：游标越界时我最初用 `min(cursor, messages.length)` 兜底，导致 `cursor=99 / len=2` 时 `slice(2)` 为空 → 返回 `skipped_no_new_messages`，**恰好造成我声称要防的"静默丢数据"**。已修正为"越界即视为无效 → 置 0 → 全量写入"，并加告警。该用例已固化为回归测试。

#### 7.15.6 验证结果

| 项 | 第三批后 | W4 后 |
|---|---|---|
| `tsc --noEmit` | exit 0 | exit 0 |
| 测试通过 | 1120 / 1120（94 文件） | **1128 / 1128（95 文件）** |
| 失败 | 0 | **0** |

新增 `tests/graph/t3-w4.test.ts`（8 例）：事件数派生常量、片段数=6、配置键声明、增量写入/无新增跳过/游标越界回退/超长截断/key 不冲突。

### 7.16 修复后状态总览（截至第四批）

| 优先级 | 项 | 状态 |
|---|---|---|
| T0-1 ~ T0-3 | 沙箱、组合路由、code_executor | ✅ |
| T1-1 / T1-2 | 进化信号、组件层接线 | ✅ |
| T2-1 ~ T2-3 | 反注册、强制审批、红测 | ✅ |
| T3-1 ~ T3-4 | 感知处理器、路由透传、温度优先级、产物判定 | ✅ |
| T3-5 | 自适应终止 | 🟡 **仅指标采集**（路由按原设计待指标达标后开） |
| T3-6 | 长期记忆 | 🟡 **增量写入 + 截断**（语义嵌入待宿主注入） |
| T3-7 | 超时取消 | ✅ |
| T3-8 | OCR 落地 | ⏳ **需依赖决策**（tesseract.js） |
| T4-1 ~ T4-5 | 文档/注释纠偏 | ✅ |
| P1-4 | plan_confirm 无生产者 | ⏳ 需产品决策 |

**门禁**：`tsc --noEmit` 通过；`vitest run` **1128/1128 全绿**（95 文件）。四批累计：+72 测试、消除全部 10 个历史红测。

**本批新增遗留风险**

| # | 风险 | 等级 | 说明 |
|---|---|---|---|
| 1 | 记忆改为增量写入后，**历史会话的既有全量记录仍在 store 中** | 低 | 新逻辑只影响后续写入；如需清理历史冗余需一次性迁移脚本 |
| 2 | `memory_persisted_count` 依赖 messages 不被裁剪 | 低 | 越界已回退全量并告警，属可观测的降级 |
| 3 | 超时现在会真正中断 provider 请求 | 低 | 这是**预期行为修正**；若上层有依赖"超时后请求仍完成"的逻辑需复核（当前未发现） |
| 4 | OCR / ASR 仍无 | 中 | 承 T3-8，需引入依赖 |

### 7.17 剩余工作建议（不再属 T0–T4 清单）

1. **P1-4 plan_confirm**：需产品决策——补内核发起方（新增节点 + 编排），或收敛 AG-UI 协议声明（承认该能力不存在）。
2. **T3-5 第二阶段**：待 `modu_termination_advice_by_action_total` 积累足够样本、确认 `false_positive_rate < 5%` 后，再让 advice 参与 `routeAfterAgent` 路由。
3. **T3-6 语义检索**：`setEmbeddingFunction` 仍零调用，需在宿主侧（desktop/backend-ts）注入真实 embedding，或改用 Chroma 默认 EF。
4. **T3-8 OCR**：评估 `tesseract.js` 依赖体积与部署影响后决策。
5. **macOS 沙箱硬隔离**（§7.5）：rlimit 在 macOS 不生效，若需真实内存约束须升级为容器/nsjail 级隔离。
