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

**总体**：这是一个**架构成熟度高于功能暴露成熟度**的系统——骨架（声明式图、扩展点、降级策略、审计）达到了可持续演进的工程水准；能力暴露高度依赖配置装配，且存在若干"最后一公里"断点（plan_confirm 无生产者、组合路由、termination 第二阶段未接线）。对使用者而言，最重要的心智模型是：**先确认 flag 矩阵，再谈能力清单**；对维护者而言，优先修复 P1 三项（组合路由断链、macOS 代码执行、沙箱绕行）能把"已承诺能力"的可信度拉齐到与架构相称的水平。

### 风险声明

本报告基于静态精读 + typecheck/vitest 实测 + 既有 PoC 记录（rlimit macOS 失效、沙箱绕行 PoC 为前次动态实证，本次仅复核源码结构未变，未重新执行代码）。"默认能力/门控能力"以 DEFAULT_CONFIG 为准，宿主（apps/desktop、backend-ts）另有装配覆盖，跨包结论已标注来源。
