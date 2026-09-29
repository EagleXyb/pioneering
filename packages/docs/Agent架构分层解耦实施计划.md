# Agent 架构分层解耦实施计划

> **上游依据**：`packages/docs/Agent架构分层解耦评估报告.md`（2026-09-29）
> **实施对象**：`packages/modu-agent`（`src/` 139 个 TS 文件、`tests/` 57 个）+ `packages/evals`
> **本计划日期**：2026-09-29（**修订 6**：P2 代码独立复查，修复 8 项缺陷（含 1 项高危"装配层覆盖宿主注册"），见 **§5.3.2**；**修订 7**：**P3 优先级优化** —— 新增 P3-A 地基组 T-20~T-24、T-17a 前移、T-18 拆三轨道、T-19 合并原 T-18④、M4/M5 零改动口径分段，见 **§5.4**；**修订 8**：**P3-A 地基组落地**（T-20/T-21/T-22/T-23/T-24 全部完成），见 **§5.4.6**；**修订 9**：**P3-A 独立复查** —— 修复 3 处缺陷（含 1 处高危「层边界扫描器漏检跨行 import 致 B-0 假阴性」）+ 1 处代码卫生问题，实测 `tsc` 零错误、`vitest run` **884/891**，见 **§5.4.7**）
> **本计划性质**：**待评审的执行方案**，第 9 节「待确认事项清单（D-01~D-18）」全部确认后方可开工
> **核验方式**：逐文件精读 + 全仓引用检索 + 三路并行独立复核（所有结论均标注 `文件:行号`）
> **修订 2 范围**：① 新增 §0.1（P1 开工前复核，11 项修正 + P0 已生效能力清单）；② 重写 §5.2（P1 拆为 T-12/T-11/T-10/T-10b，T-10c 移入 T-13）；③ 修正 §4.1.1/§4.1.2/§4.1.3 契约；④ 更新 §5.5/§6/§7/§8/§9/§10/§11；⑤ 新增风险 R-13~R-16、决策 D-15~D-18、验证层 L10/L11
> **修订 3 范围**：**按 §5.2 的排序（T-12 → T-11 → T-10 → T-10b）完成 P1 代码实施**，结果与验证见 **§5.2.6**；同步修正 §0.1（补充 1 项新发现）、§5.2.4 ④（`enable_guard`/`llm_judge.*` 实际处置为**接线**而非删除）、§9 D-06

---

## 0. 核验结论摘要（本计划与评估报告的差异）

编写本计划前对评估报告的全部关键结论做了独立复核。**10 项能力判定全部成立**，但发现 **4 处描述需修正**，修正后才可作为实施依据：

| # | 评估报告原文 | 代码实况 | 影响 |
|---|---|---|---|
| 1 | `create_agent` 有"14 位置参数"（§3.4） | `create_agent` 仅 **3 个参数**：`config / runtimeConfig / systemPrompt`（`src/graph/factory.ts:450-454`）。14 个位置参数指的是内部调用 `buildModuGraph(...)`（`src/graph/factory.ts:680-697`） | 降低 P0⑦ 接线成本估计；`buildModuGraph` 才是需 spec 化的对象 |
| 2 | `memory.context_window` / `enable_compression` 属"死配置"（§3.3） | **已从 DEFAULT_CONFIG 移除**（`src/config/runtime-config.ts:71-75` 有显式说明注释），其语义已由 `config/schemas.ts:187,189` 与 `orchestration/communication/protocol.ts:291,293` 作为独立入参承载 | 删减 P0 死配置清单：实际死配置 **5 个**（非 8 个） |
| 3 | `metrics.prometheus_port` 位于顶层 `metrics.*`（§3.5） | 不存在顶层 `metrics` 段，应为 `observability.metrics.prometheus_port`（`src/config/runtime-config.ts:287`） | 配置文件键路径须修正，避免宿主写错 |
| 4 | 观测"仅 `runner.ts` 有埋点"（§3.5） | 结论成立，但需补注：5 项审计/安全能力比报告描述**更弱**——`detectOutputSensitive`/`sanitizeOutput`（`src/perception/security/guard.ts:312,369`）在 src/ 与 tests/ **均零调用**（纯死代码）；12 类审计事件**仅 1 类**（`tool_rate_limited`，`src/graph/adapters/rate-limiter.ts:120`）有发布者 | P0③⑤ 的收益略高于报告估计（消除死代码） |

**新增可利用资产（报告未提及，可显著降低 P2 风险）**：
- `STATE_SCHEMA_VERSION` + `migrate_state()` 已存在于 `src/graph/state.ts:24-25`（经 `graph/index.ts:24-25` 导出）→ 直接作为 GraphSpec 改造的会话兼容机制。
- `state.task_type` 已存在（`src/graph/state.ts:159` 类型、`:370` Annotation、`:506` 初始值，由 perception 节点写入）→ P0⑦ 模型路由**无需新增状态字段**，只需在消费点透传。
- `CAPABILITY_REGISTRY` + `UNDECLARED_CONSUMED_KEYS`（`src/config/capability-registry.ts:46,270`，且有断言为空的测试 `tests/config/p5-env-capability.test.ts`）→ 可直接作为"配置键无悬挂"的自动化验收锚点。
- `ComponentRegistry.swapComponent` 已支持 11 类组件热替换（`src/core/registry.ts:270-292`）→ 底座"策略可替换"是**已有机制的扩展**，不是从零建设。

### 0.1 P1 开工前复核（P0 已落地后的二次核查，2026-09-29）

**前提**：P0（T-01~T-09）已实施完成。下表为对 P1 相关代码的逐文件复核结论，**11 处描述需修正**（另 1 项 P0 后新发现见本小节末表），修正后 §4.1.1/§4.1.2/§4.1.3 与 §5.2 的 P1 定义方可作为开工依据。

| # | P1 相关原文（本计划初稿 / 评估报告） | 代码实况（P0 完成后） | 对 P1 的影响 |
|---|---|---|---|
| 1 | T-10 取代对象含"`nodes.ts:1803-1828` 内联判定" | **已被 P0 T-09 消除**：`_toolRequiresApproval` 已删除，判定收敛为纯函数 `decideToolApprovals`（`src/tools/tool-guardrails.ts:360`）+ `toolRequiresApproval`（`:297`）；唯一调用点 `src/graph/nodes.ts:1934` | T-10 只需**包装**既有纯函数为 `PolicyRule`，成本由"中高"降为"中"；**不得再改 `nodes.ts` 判定逻辑** |
| 2 | T-10 取代对象含"`guard.ts:19-87` 正则库""`tool-guardrails.ts:61-108`" | 二者仍是"私有常量 + 模块级数组"，**无任何规则注册表/判定链抽象**（对比 `src/perception/pipeline.ts:26-34,86-90,92-110` 的注册表 + 逐项 try/catch 范式） | 一致，仍是 T-10 的收敛目标；但 `guard.ts` 的导出面仅为 `SecurityGuard` 类（`guard.ts:96`），规则常量**未导出**（`:19-34,:40-46,:52-56,:63-78,:81-87`）→ 规则化需先开放导出 |
| 3 | T-10 §4.1.3 契约中 `PolicyDecision.sanitizedText` 由 PolicyEngine 输出 | 输出护栏**已由 P0 T-05 以节点装饰器落地**：`makeOutputGuardNode`（`src/perception/security/output-guard-node.ts:36`），挂载 `src/graph/graph.ts:518`，门控 `perception.security.sanitize_output.enabled`（`runtime-config.ts:226-228`，默认 false） | **禁止搬迁**：若 T-10 再把清洗放进 PolicyEngine，将出现"两处清洗 + 两套审计"双实现。契约需明确「PolicyEngine 只产出决策，执行仍由 output-guard-node 承担」 |
| 4 | T-04（P0）应补齐 12 类审计事件发布者 | **P0 已完整补齐 12/12**（非部分）：`prompt_injection_blocked`/`pii_detected`（`rule-based.ts:248,259`）、`ssrf_blocked`（`http-request.ts:326,345`）、`path_traversal_blocked`（`file-ops.ts:205`）、`sql_injection_blocked`（`sql-query.ts:218`）、`code_validation_blocked`（`code-executor.ts:264`）、`tool_approval_required`（`nodes.ts:1970`）、`tool_approval_approved`/`_rejected`（`nodes.ts:2031`）、`tool_rate_limited`（`rate-limiter.ts:121`）、`output_sensitive_blocked`（`output-guard-node.ts:66`）、`sensitivity_circuit_breaker`（`nodes.ts:475`） | **T-04 可判定为完成**；P1 只需把"12/12 有发布者"作为**回归断言**锁定（防回退），无需新增发布者 |
| 5 | T-06 应清完死配置（G-2 断言"已声明未消费 = 0"） | **P0 未清完，剩余 3 处**：`perception.security.enable_guard`（`runtime-config.ts:219`）**零消费**（`TextPreprocessor` 只吃构造参数，未读配置）；`perception.security.llm_judge.{enabled,risk_threshold}`（`:232-237`）**零消费**（注意：`consensus.ts:302` 的 `llm_judge` 是 `orchestration.multi_agent.consensus_strategy` 的另一条路径，与本键无关）；`guard.ts:139 detectInjectionWithLLMJudge` **仅被 `tests/perception/security/guard.test.ts:51-101` 调用**、无生产调用者；`guard.ts:232 sanitize()` **零调用**（含内部） | G-2 断言当前**不成立**；必须纳入 T-10b 的"接线或删除"清单，否则 P1 验收自身不通过 |
| 6 | T-10 备注"HITL 节点插入位置改为 profile 声明（依赖 T-12 的 `GraphProfile`）" | `GraphProfile` 定义于本计划 §4.1.5，对应任务为 **T-13（P2）**，与 T-12（LLMProviderFactory）无关——**编号引用错误**；实际位置为 `graph.ts:530-532`（addNode）、`:652-666`（agent→human_review 条件边） | **将"HITL 拓扑声明化"从 P1 移出至 T-13**，否则 P1 被迫引入 GraphSpec 依赖，破坏"P1 无 P2 依赖"的并行前提 |
| 7 | T-11 "让 `ObservationMemory` 实现统一契约" | `ObservationMemory`（`src/memory/observation-memory.ts:94`）**全仓无构造点、无调用点**（`update/getContext/summarizeLongTerm/serialize/deserialize` 均零外部调用）；`state.observation_memory`（`state.ts:151,361,505`）为**零读写死字段** | "让它实现契约"收益近似为 0。T-11 核心应改为**主链路真在用的 `BaseStore` 路径**（见 #8），`ObservationMemory` 降级为独立决策项 |
| 8 | T-11 取代对象"三套并行抽象（`BaseMemory`、`store-adapter.ts` 桥、`ObservationMemory`）" | 实况是**两套互不相通**的真路径：① 主链路 = LangGraph `BaseStore`（`ChromaStore`/`InMemoryStoreAdapter`，`store-adapter.ts:113,327`）→ `memory_query`/`memory_update` 节点（`graph.ts:499-504,528`；读写 `nodes.ts:333,425`）；② `BaseMemory` 家族 = 仅被 P0 的 `memory-strategy.ts:42` 注册进 registry，**无任何运行时消费**（`registry.getMemory()` 零消费） | T-11 必须**以 ① 为主目标**；② 需通过 `LegacyMemoryStrategyAdapter` 兼容；同时须消除"②注册了但主链路不用"的**半接线假象** |
| 9 | T-11 "开放 `namespace/embedding/chunking` 为配置项（`chroma.ts:199,280,186-191`）" | `memory` 配置段**不存在**这三个键（`runtime-config.ts:69-79` 仅 `default_strategy/checkpointer_type/store_type/chroma_persist_path`）；`chroma.ts` **无 chunking 实现**（`update()` 直接 `upsert` 整段 `text`，`:267-308`）；命名空间硬编码于**读写两侧**（写 `chroma.ts:199`、读 `nodes.ts:333`） | 该项是**新增配置面+新增代码**（非"接线"），成本被低估；且必须**成对修改读写两侧**，否则改前缀即断裂 |
| 10 | T-12 取代对象"双轨映射表（`llm-adapter.ts:22-51` + `reasoning/llm/index.ts:8-12`）" | `src/reasoning/llm/index.ts:8-12` **不是映射表**，只是命名再导出；真正的第二轨是 4 个 `*LLMReasoner` 类自带的 env/model 常量（`gpt.ts:6,23-25`、`qwen.ts:6,23-25` 等），且这些类**除 index 再导出外零消费者**（死代码族） | 修正取代对象描述；同时产生新决策项：`BaseLLMReasoner` 家族**删除 / 保留为内置默认工厂**（见 §9 D-16） |
| 11 | §4.1.1 契约 `create(cfg, runtimeConfig): ModuLLM` | 主链路与 P0 路由表工厂都用 **LangChain ChatModel**：`build_chat_model(): ChatOpenAI`（`llm-adapter.ts:63`）；路由表工厂 `factory.ts:342-345` 内 `build_chat_model` + `wrap_chat_model_as_modu`；`factory.ts:519` 主链路同理 | **契约返回类型错误**：若按 `ModuLLM` 实现，P0 的 T-08 路由链路（`factory.ts:753` → `graph.ts:435` → `nodes.ts:1161-1174`）将断裂。应改为返回 **ChatModel**，`ModuLLM` 视图仍由既有 `_build_modu_llm`（`factory.ts:302`）单独包装 |

**P0 后新发现（修订 3 补充，独立于 P1 范围，仅登记不修复）**：

| # | 发现 | 证据 | 影响 |
|---|---|---|---|
| 12 | **感知处理器从未注册**：`runPerceptionPipeline(Async)` 通过 `registry.getPerception('text_preprocessor')` 查找，但全仓 `src/` **无任何 `registerPerception` 调用**（`TextPreprocessor` 也从未被 `new`）→ 运行时管线为空，`perception_result` 恒为 `null`，`injection_detected`/`pii_detected` 恒为 `false` | `perception/pipeline.ts:86-90,154-158`（未注册即 warning + skip）；`core/registry.ts` 无调用者 | ① `block_on_injection`/`block_on_pii` 路由阻断在**当前默认运行时永不触发**；② P0 T-04 的 `pii_detected`/`prompt_injection_blocked` 发布点（`perception/text/rule-based.ts:248,259`）同样不执行；③ 属"已实现未接线"的新实例，**建议单独立项**（不在 P1 范围，且修复会改变默认运行行为，需独立验收） |

**P0 已核实生效、可直接作为 P1 前置的能力（无需重复建设）**：

| 能力 | 落地位置（已核实） | P1 可依赖点 |
|---|---|---|
| 模型路由**已真正接线** | `factory.ts:753`（构造）→ `:749-793`（`llmRouteResolver`）→ `:813`（传入图）→ `graph.ts:369,435-436`（透传）→ `nodes.ts:910,1161-1174`（invoke 前按 `state.task_type` 切换） | T-12 的依赖 T-08 **已完成**，可立即开工；但改注册表时**必须保留 `factory.ts:342-345` 的构造路径** |
| 工具能力矩阵自动派生 | `registry.ts:124-130`（`ensureToolCapability` 保守派生） | T-10 的 `checkGuardrail` 第二层回退（`tool-guardrails.ts:209-226`）已随之覆盖 MCP/Skill 工具 |
| 审批判定单一入口 | `tool-guardrails.ts:360`（`decideToolApprovals`，含 `ToolApprovalSource`/`ToolApprovalDecision` 类型 `:322-345`） | T-10 只需 **1 个 `PolicyRule` 包装器**，无需重写判定 |
| 观测 boot / 审计落盘 / 输出护栏 | `factory.ts:474-495`、`graph.ts:512-518`、`output-guard-node.ts:36` | T-10b 只需补"规则注册 + 缺失审计发布者"，不新建机制 |
| 状态兼容机制 | `state.ts:185`（`STATE_SCHEMA_VERSION`）、`:415`（`migrate_state`） | P1 不涉及 schema 变更，**无需升级版本**（P2 T-13 才用） |

---

## 1. 现状复核与问题定性

### 1.1 十项能力复核结果

> **注（修订 2）**：本节为 **P0 开工前**的基线复核快照，保留作为"改造前对照"。其中已变化的项：#1 模型路由（已由 T-08 接线生效）、#6 权限（输出护栏已接线、审批判定已收敛为纯函数、审计发布者已补齐 **12/12**）、#5 观测（boot/埋点/落盘已接线）、#9 业务护栏。最新状态以 **§0.1** 与 **§5.1 交付实况**为准。

| # | 层 | 归属 | 报告判定 | 复核结论 | 核心证据（已复核） |
|---|---|---|---|---|---|
| 1 | 模型路由 | 底座 | 未分离 | ✅ 成立 | `_build_llm_router` 定义 `src/graph/factory.ts:312`，仅被 `graph/index.ts:67` 与 `src/index.ts:53` 再导出，**零调用**；`create_agent`（`:450`）全程只用 `llm`/`boundLlm`，从未调用 |
| 2 | 工具协议 | 底座 | 合格 | ✅ 成立 | 三路归一：内置 `src/core/registry.ts:115`、MCP `src/mcp/mcp-tool-adapter.ts`、Skill `src/core/registry.ts:206-236`；中间件装配 `src/graph/adapters/tool-adapter.ts:257-306` |
| 3 | 记忆 | 底座 | 半成品 | ✅ 成立 | 三套并行：`BaseMemory`（`src/core/interfaces/memory.ts:8`）、LangGraph `BaseStore` 桥（`src/graph/adapters/store-adapter.ts`）、`ObservationMemory`（`src/memory/observation-memory.ts:94`，不继承 `BaseMemory`） |
| 4 | 编排 | 底座 | 部分分离 | ✅ 成立（有细微差异） | `buildModuGraph` `src/graph/graph.ts:349-762`，`addNode` 全在 `:492-534`；全仓 `GraphSpec/NodeSpec/buildFromSpec/registerNode` **0 命中**。**差异**：subagent 走真子图（`src/graph/subgraph/builder.ts:98`，`compile()` 于 `:111,:202`），plan-execute 的 planner/step_dispatch/step_finalize 才是内联同图节点（`src/graph/graph.ts:531-533`） |
| 5 | 观测 | 底座 | 半成品 | ✅ 成立 | `configure_otlp_exporter`（`src/observability/exporters.ts:34`）、`start_prometheus_server`（`:159`）、`configure_structured_logging`（`src/observability/logging-config.ts:201`）**src/ 与 tests/ 均零调用**；`record_tool_call`（`src/observability/metrics.ts:212`）、`record_llm_tokens`（`:237`）无生产调用者（仅 tests）；仅 `record_request` 有生产调用（`src/graph/runner.ts:496,547`） |
| 6 | 权限 | 底座 | 未分离 | ✅ 成立（比报告更弱） | 全仓无 `PolicyEngine`/`PolicyRule`/`interface *Policy`；判定散落 `src/perception/security/guard.ts:19-87`、`src/tools/tool-guardrails.ts:61-108`、`src/graph/nodes.ts:1803-1828`、各工具 `requiresApprovalFor`（`src/tools/http-request.ts:184`、`src/tools/file-ops.ts:100`、`src/tools/doc-writer.ts:148`） |
| 7 | 领域知识 | 场景包 | 半可插拔 | ✅ 成立 | `DOMAIN_ADAPTERS` `src/reasoning/domain-adapters.ts:40` **默认空**；`registerDomainsFromMarkdown` `:103-118` 在 src/ **零调用**；`prompt_composer.enabled=false`（`src/config/runtime-config.ts:337`） |
| 8 | SOP 流程 | 场景包 | 半可插拔 | ✅ 成立（**修订 7 校正 2 处**） | 角色模板硬编码 ~~`src/graph/subgraph/builder.ts:27-39`~~（P2 T-14 已迁至 `graph/prompt-templates.ts:124-160`）；`_DEFAULT_TASK_TYPES` `src/graph/subgraph/supervisor.ts:42`；`make_supervisor_node(null, null, ...)` ~~`src/graph/graph.ts:467`~~ → 实为 **`graph.ts:580`**（断链，`plannerLlm` 已接线、`maxSubagents`/`taskTypes` 仍为 null）；Planner prompt 硬编码 `src/graph/plan-execute/prompts.ts:59-107,122-154`；步骤类型固定 3 类 `src/graph/plan-execute/types.ts:11`、zod `:93` |
| 9 | 业务护栏 | 场景包 | 半可插拔 | ✅ 成立 | `registerGuardrailRule` `src/tools/tool-guardrails.ts:115-124` 在 src/ 零调用；预置 5 条规则绑定具体工具（`:61-108`）；`react_optimization.action_guardrails.enabled=false`（`src/config/runtime-config.ts:349`），仅消费点 `src/graph/nodes.ts:1892-1893` |
| 10 | 评估口径 | 场景包 | 口径外置/实现硬编码 | ✅ 成立 | `packages/evals/src/config-loader.ts:157-158`（固定 `metrics/thresholds.yaml`）、`:182-183`（固定 `gates/ci_gates.yaml`）；`createMetricGroups` 硬组装 `packages/evals/src/metrics.ts:243-249`；无场景/pack 维度 |

### 1.2 三个症结的代码证据（定性）

- **症结①「已实现未接线」**：最典型的是模型路由——接口（`src/core/interfaces/llm.ts:202-205`）、实现（`src/reasoning/llm/router.ts`）、配置（`src/config/runtime-config.ts:55-67`）三件套齐全且构造逻辑已写好（`src/graph/factory.ts:312-360`，含 `PassthroughLLMRouter` 兜底），**唯一缺的是 `create_agent` 里的一行装配**。
- **症结②「装配靠手动」**：`registerDomainAdapter` / `registerGuardrailRule` / `registerToolCapability` / `registerDomainsFromMarkdown` 四个注册入口在 src/ 中**全部零调用**，只能由宿主手写代码调用。
- **症结③「场景包无处声明」**：`PluginManifest`（`src/config/plugin-manifest.ts:24-39`）+ `parseManifest`（`:95`）+ `loadManifestFromFile`（`:112`）已完整实现，消费方仅 `src/config/index.ts:60-64` 的 re-export 与 `tests/config/p2-enhancements.test.ts`。**注意**：该实现读取的是 `<dir>/manifest.json`（`:115`），并非报告建议的 `pack.yaml` —— 此为待确认项 D-02。

### 1.3 改进方向（一句话）

> **不新增业务能力，只做"通电 → 收口 → 可注册 → 场景包"四步基建**：先把已有能力接进运行时，再把底座抽象补齐到"可替换"，然后开放节点/prompt/上下文扩展点，最后用场景包目录约定 + 统一装配器把上层从源码里搬出来。

**依赖方向（不可倒置）**：

```
场景包层
   ↑ 依赖
PromptRegistry / ContextRegistry / PolicyEngine / GraphSpec     ← 扩展点
   ↑ 依赖
MemoryStrategy / LLMProviderFactory / 统一 ToolCapability        ← 底座抽象
   ↑ 依赖
通电修复（router / 观测 boot / 审计落盘 / 输出护栏 / 装配器 / 死配置）
```

---

## 2. 分层解耦的目标与范围

### 2.1 目标（可度量）

| 编号 | 目标 | 度量方式 |
|---|---|---|
| G-1 | 消除"已实现未接线" | `CAPABILITY_REGISTRY` 中 `status: 'implemented'` 的每一项都能在 `create_agent` 调用链上被触达；`record_*` / `configure_*` / export 函数在 src/ 有真实调用者（或删除） |
| G-2 | 配置无悬挂 | `UNDECLARED_CONSUMED_KEYS` 保持 `[]`（`src/config/capability-registry.ts:281`）；且"已声明未消费"检查为 0（**当前状态：5 个观测键已由 P0 T-01 接线；剩余 3 个见 T-10b ④**） |
| G-3 | 底座可替换 | 在不改上层代码的前提下，替换 LLM provider / 记忆后端 / 权限规则集 / 观测 exporter 各 ≥1 次 |
| G-4 | 拓扑与提示词可注册 | 新增 1 个图节点、1 个任务级 prompt、1 个上下文策略，**不改 `graph/graph.ts` 与 `graph/nodes.ts`** |
| G-5 | 上层可插拔 | 新增一个场景包，**仅新增 `packs/` 目录文件**，零内核源码改动 |
| G-6 | 默认行为零变化 | 全部既有测试通过；字符等价类测试（prompt 组装）逐字节一致；`STATE_SCHEMA_VERSION` 升级有 `migrate_state` 覆盖 |

### 2.2 范围内（In Scope）

1. **底座六要素**的接线与抽象收口：模型路由、工具协议（补齐）、记忆、编排（拓扑 spec 化）、观测、权限。
2. **新增内核装配层**：`src/kernel/`（`ScenarioLoader` / `ScenarioHost` / `PromptRegistry` / `ContextRegistry` / `ObservabilityBoot`）。
3. **新增扩展点**：`ComponentRegistry` 增加 `registerLLMProvider` / `registerMemoryStrategy` / `registerPolicyRule` / `registerNode` / `registerPrompt` / `registerContextStrategy`。
4. **场景包目录约定与四类上层迁移**：领域知识、SOP 流程、业务护栏、评估口径。
5. **配置面治理**：5 个观测死配置键（P0 已接线）**+ P0 后新发现的 3 处**（`perception.security.enable_guard`、`llm_judge.*`、`guard.ts` 零调用函数）的接线或删除（见 §5.2.4 ④、§9 D-06）。
6. **验证基建**：层边界测试、字符等价测试、双向解耦验收。

### 2.3 范围外（Out of Scope，明确不做）

| 不做项 | 理由 |
|---|---|
| 跨进程 `EventBus` 实现（`src/orchestration/communication/event-bus-adapter.ts:70` 仅接口） | 无业务诉求，接口保留即可 |
| 插件市场 / 场景包热更新 | `manifest.version` 先只做静态校验 |
| 分布式 Checkpointer | 与本次解耦目标无因果 |
| 重写 `src/graph/runner.ts` | 职责清晰（报告 §8 硬约束） |
| 重构 `src/perception/*` | **已达成插件化目标，本计划将其作为范式模板而非改造对象**（`src/perception/pipeline.ts:26-34,85-90` 的"配置解析链 + 注册表查找 + 逐项 try/catch"即目标形态） |
| 重构 `src/observability/tracing.ts` / `metrics.ts` 的协议选型 | 只接线不改实现 |
| 重构 `src/graph/adapters/tool-adapter.ts` 中间件 | 只接不改（仅新增审批中间件位置） |

### 2.4 硬约束

1. **默认路径行为零变化**：所有改造以"默认关闭 / 默认等价"为前提，沿用 `react_optimization.*` 门控范式与 `prompt-composer.ts:9-12` 的字符等价回归范式。
2. **新增不破坏**：所有新接口为**新增可选方法**，不改既有方法签名；`buildModuGraph` 保留为兼容包装，`GraphSpec` 走并行路径。
3. **失败降级**：场景包加载**逐能力 try/catch 隔离**，单包/单能力失败仅告警并降级到内置默认，绝不阻断启动（复用 `src/skills/loader.ts:79-96,137-144` 范式）。
4. **不改配置键语义**：现有键只做"接线或删除"，不做重命名（避免宿主配置静默失效）。

---

## 3. 目标分层形态与模块归属

### 3.1 目标分层

```
┌────────────────────────────────────────────────────────────────────┐
│ ① 场景包层  packs/<pack>/            （可插拔，不改内核）             │
│    pack.yaml | domain/*.md | sop/{roles,graph}.yaml                 │
│    guardrails/rules.yaml | prompts/*.md | eval/*.yaml               │
├────────────────────────────────────────────────────────────────────┤
│ ② 内核装配层  src/kernel/            （新增，解决症结①②③）          │
│    ScenarioLoader.activate(packDir, host) → 分发到各注册表            │
│    ScenarioHost | PromptRegistry | ContextRegistry | ObservabilityBoot│
├────────────────────────────────────────────────────────────────────┤
│ ③ 通用底座层  src/{tools,memory,graph/spec,observability,            │
│                perception/security,reasoning/llm}/                  │
│    模型路由 │ 工具协议 │ 记忆 │ 编排 │ 观测 │ 权限   ← 六要素          │
│    对外零业务假设；唯一注册入口 ComponentRegistry（src/core/registry.ts）│
├────────────────────────────────────────────────────────────────────┤
│ ④ 运行时层  src/graph/runner.ts | StateGraph | Checkpointer | EventBus│
│    （基本复用现有，只新增 boot 钩子，不重构）                          │
└────────────────────────────────────────────────────────────────────┘

依赖方向：① →(仅经 ScenarioHost)→ ② → ③ → ④ ，严禁反向。
```

### 3.2 模块归属与动作清单

| 模块（现路径） | 目标层 | 动作 | 本计划任务 |
|---|---|---|---|
| `src/core/interfaces/*.ts` | ③ 底座契约 | **新增** 6 个接口文件/接口块（llm-provider / memory-strategy / policy / graph-spec / prompt / context） | T-10~T-15（llm-provider=T-12、memory-strategy=T-11、policy=T-10、graph-spec=T-13、prompt=T-14、context=T-15） |
| `src/core/registry.ts` | ③ 底座注册表 | **扩展** 6 个 `registerXxx` 方法（不改既有 11 类） | T-10~T-15 |
| `src/graph/factory.ts` | ④/② 边界 | **改造**：`create_agent` 成为装配入口（router / 观测 boot / 场景包 / 领域装配器） | T-01⑦, T-03, T-06, T-07 |
| `src/graph/graph.ts` | ③ 编排 | **改造**：`buildModuGraph` 拆为 `composeDefaultGraph(profile)` + `buildFromSpec` 兼容包装 | T-11 |
| `src/graph/nodes.ts` | ③/② 边界 | **收敛**：审批/护栏内联判定（原 `:1803-1937`）**已由 P0 T-09 迁出**（`tool-guardrails.ts:360`）；P1 仅把调用点 `:1934` 改为经 `PolicyEngine`；上下文注入（`agentNode`）改走 `ContextBuilder` | T-09✅, **T-10**, T-15 |
| `src/graph/adapters/tool-adapter.ts` | ③ 工具 | **扩展**：中间件链新增"审批判定"位置（与 retry/rate-limit/cache 同级）+ 观测埋点 | T-02, T-06 |
| `src/tools/tool-registry.ts` | ③ 工具 | **收敛**：`registerTool` 自动派生 `ToolCapability`；`TOOL_CAPABILITY_MATRIX` 降级为"内置默认值表" | T-06 |
| `src/tools/tool-guardrails.ts` | ③→① 迁移源 | **保留接口**，5 条预置规则迁出为 YAML 数据源 | T-09, T-18 |
| `src/perception/security/guard.ts` / `audit.ts` | ③ 权限 | **接线**（输出护栏，P0 已完成）+ **收敛**（正则库→PolicyRule）+ **补齐发布者**（12 类事件，P0 完成 3 类，余 2 类转 T-10b ③） | T-04✅, T-05✅, **T-10b** |
| `src/observability/*.ts` | ③ 观测 | **接线**（boot 单入口）+ **删除** 5 个死配置键 + 中间件埋点 | T-01①, T-02, T-06 |
| `src/memory/observation-memory.ts` | ③ 记忆 | **重定范围**：该文件零调用（死代码），**移出 P1 验收**，改为去留决策（§9 D-15） | — |
| `src/memory/base-store-strategy.ts`（新） | ③ 记忆 | **新增**：包装主链路 `BaseStore` 读写的 `MemoryStrategy` 实现 | **T-11** |
| `src/reasoning/domain-adapters.ts` | ③→① 迁移源 | **接线**：`registerDomainsFromMarkdown` 由装配层调用 | T-07 |
| `src/reasoning/llm/*.ts` + `src/graph/adapters/llm-adapter.ts` | ③ 路由 | **合并**两处 provider 映射为 `LLMProviderFactory` 注册表 | T-12 |
| `src/config/plugin-manifest.ts` | ② 装配 | **扩展**：`ScenarioPackManifest`（格式待 D-02） | T-14 |
| `src/config/capability-registry.ts` | ② 装配 | **扩展**：作为验收锚点 + 增加"已声明未消费"清单 | T-06 |
| `src/kernel/*`（新） | ② 装配 | **新增** | **T-16**（修订 7 修正原「T-14」编号错误） |
| `src/skills/loader.ts` | 参照模板 | **不动**（作为隔离范式） | — |
| `src/graph/runner.ts` / `src/perception/pipeline.ts` | ④/③ | **不动** | — |
| `packages/evals/src/config-loader.ts` | ① 口径 | **扩展**：支持按 pack 目录加载（保留全局默认） | T-19 |

---

## 4. 各层之间的接口定义（契约先行）

> 原则：**契约先冻结、实现后填充**。所有接口先以"新增可选"方式落地，默认实现等价现状。

### 4.1 底座层对外契约

#### 4.1.1 模型路由 —— `LLMProviderFactory`（新增）

```ts
// src/core/interfaces/llm-provider.ts（新增）
import type { RuntimeConfig } from '../../config/runtime-config.js'

export interface LLMProviderConfig {
  provider: string
  model?: string
  temperature?: number
  maxTokens?: number
}

export interface LLMProviderFactory {
  /** provider 唯一标识，如 'deepseek' / 'glm' / 'gpt' / 'qwen' */
  readonly id: string
  /** 默认模型名（消除 llm-adapter.ts:22-51 与 reasoning/llm/gpt.ts:6,23-25 的双轨默认值） */
  readonly defaultModel: string
  /** API Key 环境变量名（与在用约定一致，如 'MODU_DEEPSEEK_API_KEY'） */
  readonly apiKeyEnv: string
  /** 别名环境变量（兼容双轨，如 gpt 的 'MODU_OPENAI_API_KEY'）+ 通用回退（'LLM_API_KEY'） */
  readonly apiKeyEnvAliases?: string[]
  readonly baseUrlEnv?: string
  readonly baseUrlEnvAliases?: string[]
  readonly defaultBaseUrl?: string
  /**
   * 返回 LangChain ChatModel（与现状 `build_chat_model(): ChatOpenAI`（llm-adapter.ts:63）一致）。
   * 注：**不返回 `ModuLLM`** —— 主链路（factory.ts:519）与 P0 路由表工厂（factory.ts:342-345）
   * 都消费 ChatModel，`ModuLLM` 视图由既有 `_build_modu_llm`（factory.ts:302）单独包装。
   */
  create(cfg: LLMProviderConfig, runtimeConfig: RuntimeConfig): BaseChatModel
}
```

> **修正说明（相对初稿）**：初稿 `create(): ModuLLM` 会破坏 P0 T-08 已接线的路由链路（`factory.ts:753` 传入的是 `_build_modu_llm(...)` 的**输入** ChatModel，路由表工厂亦返回 ChatModel）。契约必须与"在用的消费形态"对齐，`ModuLLM` 包装保持为独立步骤。

```ts
// src/core/registry.ts（扩展，不改既有方法）
registerLLMProvider(factory: LLMProviderFactory): void
getLLMProvider(provider: string): LLMProviderFactory | undefined
listLLMProviders(): string[]
```

**接入点（行号已按 P0 后代码修正）**：`create_agent` 内 `factory.ts:519`（主链路）与 `factory.ts:342-345`（`_build_llm_router` 的 routeTable 工厂，P0 T-08 新增）**两处**都改走 `registry.getLLMProvider(...)`；`build_chat_model`（`llm-adapter.ts:63`）保留为兼容包装（默认 `glm` 次级兜底 `llm-adapter.ts:74` 需统一为读 `llm.default_provider`，与 `runtime-config.ts:21` 的 `'deepseek'` 一致）。
**约束**：不得改变 `llmRouteResolver`（`factory.ts:749-793`）与 `nodes.ts:1161-1174` 的既有语义，否则 T-08 成果回退。

#### 4.1.2 记忆 —— `MemoryStrategy`（新增，替代三套并行抽象）

```ts
// src/core/interfaces/memory-strategy.ts（新增）
export interface MemoryItem {
  id: string
  content: string
  metadata?: Record<string, unknown>
  score?: number
}

export interface MemoryRecallContext {
  userId: string
  taskType?: string
  sessionId?: string
  topK?: number
}

export interface MemoryStrategy {
  readonly id: string
  /** 该策略是否适用于给定任务类型（undefined = 通用兜底） */
  supports(taskType?: string): boolean
  recall(query: string, ctx: MemoryRecallContext): Promise<MemoryItem[]>
  persist(items: MemoryItem[], ctx: MemoryRecallContext): Promise<void>
}
```

```ts
registerMemoryStrategy(strategy: MemoryStrategy): void
getMemoryStrategy(id: string): MemoryStrategy | undefined
resolveMemoryStrategy(taskType?: string): MemoryStrategy | undefined  // 按 supports 选首个命中，无命中回退 memory.default_strategy
```

**兼容策略（已按 P0 后实况修正）**：

| 实现 | 现状角色 | P1 处置 |
|---|---|---|
| `BaseStore` 桥（`store-adapter.ts:113 ChromaStore`、`:327 InMemoryStoreAdapter`） | **主链路真路径**：`factory.ts:204-224 build_store` → `graph.ts:499-504,528` 的 `memory_query`/`memory_update` 节点；读写 `nodes.ts:333`（`store.search`）/`:425`（`store.put`） | **新增 `BaseStoreMemoryStrategy`**（包装 `search`/`put`）作为 T-11 核心目标 |
| `BaseMemory` 家族（`core/interfaces/memory.ts:8`；`InMemoryShortTermMemory`、`ChromaLongTermMemory`） | P0 的 `memory-strategy.ts:42-80` 仅把它注册进 registry（`InMemoryShortTermMemory`），**运行时无消费点** | 用 `LegacyMemoryStrategyAdapter` 包装为 `MemoryStrategy`，并把注册目标从 `registry.registerMemory` 切换到**新策略表**，消除"注册了但主链路不用"的半接线 |
| `ObservationMemory`（`src/memory/observation-memory.ts:94`） | **零构造、零调用**；`state.observation_memory`（`state.ts:151,361,505`）为**零读写死字段** | **移出 T-11 验收范围**，作为独立决策项（§9 D-15：接线 or 删除死字段） |

**激活（修正）**：`memory.default_strategy` 已被 P0 的 `factory.ts:483` 消费（`memory-strategy.ts:49`），但**只完成"注册"未完成"消费"**。T-11 的验收必须包含「`resolveMemoryStrategy(taskType)` 被主链路 `memory_query`/`memory_update` 实际调用」，而非仅"配置键有 `get()` 点"。

**namespace/embedding/chunking（降级为可选项）**：`memory` 配置段当前**不存在**这三个键（`runtime-config.ts:69-79`），且 `chroma.ts` **无 chunking 实现**（`:267-308` 整段 upsert）。故此项是"新增配置面 + 新增代码"，且命名空间为**读写两侧硬编码**（写 `chroma.ts:199`、读 `nodes.ts:333`），必须成对修改。建议 T-11 只做 `namespace` 前缀单一来源化（读写共用），`embedding`/`chunking` 明确标注为本轮**不做**（避免范围蔓延）。

#### 4.1.3 权限 —— `PolicyEngine`（新增，唯一无抽象接口的底座）

```ts
// src/core/interfaces/policy.ts（新增）
export type PolicyStage = 'input' | 'tool' | 'output'

export interface PolicySubject {
  /** input 阶段：用户输入文本；tool 阶段：工具名+参数；output 阶段：最终响应文本 */
  kind: PolicyStage
  text?: string
  toolName?: string
  args?: Record<string, unknown>
  toolMeta?: { requiresApproval?: boolean }
}

export interface PolicyContext {
  userId?: string
  sessionId?: string
  taskType?: string
  dryRun?: boolean          // 对应 action_guardrails.dry_run_enabled（runtime-config.ts:350）
}

export type PolicyEffect = 'allow' | 'deny' | 'require_approval'

export interface PolicyDecision {
  effect: PolicyEffect
  /** 命中的规则 id（用于审计与调试） */
  ruleId?: string
  reason?: string
  /** 脱敏/改写后的文本（output 阶段使用，对应 guard.ts:369 sanitizeOutput） */
  sanitizedText?: string
}

export interface PolicyRule {
  readonly id: string
  readonly stage: PolicyStage
  /** 规则优先级，数值越小越先评估 */
  readonly priority?: number
  evaluate(subject: PolicySubject, ctx: PolicyContext): Promise<PolicyDecision> | PolicyDecision
}

export interface PolicyEngine {
  use(rule: PolicyRule): void
  decide(stage: PolicyStage, subject: PolicySubject, ctx?: PolicyContext): Promise<PolicyDecision>
  listRules(stage?: PolicyStage): string[]
}
```

```ts
registerPolicyRule(rule: PolicyRule): void
getPolicyEngine(): PolicyEngine
```

**收敛映射（旧 → 新，行号已按 P0 后代码修正）**：

| 旧位置（现状） | 新形态 | 迁移方式 |
|---|---|---|
| `guard.ts` 私有正则库 `_INJECTION_PATTERNS:19-34` / `_PII_PATTERNS:40-46` / `_SECRET_PATTERNS:63-78` / `_INTERNAL_IP_PATTERNS:81-87` | `InputGuardPolicyRule`（stage: input） | **需先开放导出**（当前仅 `SecurityGuard` 导出，`guard.ts:96`）；规则数按 4 类常量对齐（非初稿"5 类"） |
| `guard.ts:312 detectOutputSensitive` / `:369 sanitizeOutput` | `OutputGuardPolicyRule`（stage: output） | **只登记不搬迁**：执行仍由 `output-guard-node.ts:36 makeOutputGuardNode`（挂载 `graph.ts:518`）承担，规则内**委派** `sanitizeOutput` 产出 `sanitizedText` 供该节点消费 |
| `tool-guardrails.ts:61-108`（5 条 `ACTION_GUARDRAILS`） | `ToolGuardrailPolicyRule`（stage: tool） | 包装 `checkGuardrailsForToolCalls`（`:254`）；数据源仍为 `ACTION_GUARDRAILS` + `registerGuardrailRule`（`:115`），YAML 化留待 P3 |
| ~~`nodes.ts:1803-1828` `_toolRequiresApproval`~~ | `ToolApprovalPolicyRule`（stage: tool） | **P0 T-09 已消除内联函数**：直接包装 `decideToolApprovals`（`tool-guardrails.ts:360`）+ `toolRequiresApproval`（`:297`），**判定内核零重写** |
| 各工具 `requiresApproval*`（`action.ts:39,56`；`file-ops.ts:87,102`、`http-request.ts:164,186`、`doc-writer.ts:141,148`、`sql-query.ts:100`、`code-executor.ts:228`、`mcp-tool-adapter.ts:209`） | **不改**，由 `ToolApprovalPolicyRule` 委派调用 |
| `nodes.ts:474 sensitivity_circuit_breaker`（P0 已发布） | `CircuitBreakerPolicyRule`（stage: input，**可选**） | 可只登记不接管（`routeAfterPerception` 保持原判定） |
| `guard.ts:139 detectInjectionWithLLMJudge`（**零调用**）+ `runtime-config.ts:232-237 llm_judge.*`（**零消费**） | `LlmJudgePolicyRule`（stage: input，`llm_judge.enabled` 门控） | **二选一**：接线（则该规则与 `perception/text/rule-based.ts:237` 的评分路径去重）或**删除配置键与死函数**（推荐后者，避免 P1 引入 LLM 调用成本） |

**兼容关键（修正）**：
1. `PolicyEngine.decide` 无规则命中返回 `allow`（等价现状）；`require_approval` 等价于 `requiresApprovalFor()===true` 语义，审批执行链路（`nodes.ts:1988` 的 `interrupt` → `:2049/:2088` 分支 → `routeAfterHumanReview` `:2149-2159`）**保持不变**。
2. **单实现约束**：`decideToolApprovals` 仍是唯一判定内核；`PolicyEngine` 只做"按 stage 分发到规则链 + 逐项 try/catch + 优先级排序 + 无命中 allow"。禁止出现第二套 guardrail/sensitive/tool_policy 判定顺序实现。
3. **禁止搬迁输出清洗**：`sanitizeOutput` 的执行点唯一为 `output-guard-node.ts:47`；`PolicyEngine` 若同时清洗将产生双脱敏（审计双发、文本二次替换）。
4. **节点改动下限**：唯一允许的节点改动为 `nodes.ts:1934`（`decideToolApprovals(...)` 调用改为经 `PolicyEngine.decide('tool', ...)`），且必须受 `policy.engine.enabled=false` 短路保护（默认等价）。

#### 4.1.4 工具能力矩阵自动派生（扩展，非新接口）

```ts
// src/core/registry.ts registerTool 内部新增（不改签名）
registerTool(tool: BaseTool): void {
  // 既有逻辑 ...
  // 新增：自动派生默认能力（未显式 registerToolCapability 时生效）
  if (getToolCapability(tool.name()) === undefined) {
    deriveDefaultCapability(tool)   // 保守默认：requires_confirmation=true, allow_network=false
  }
}
```

**保守默认原则（R-07 缓解）**：自动派生一律取**最保守值**（`requires_confirmation: true`），只有当工具的 `requiresApproval()` 显式返回 false 且属于内置白名单时才降级；`registerToolCapability`（`src/tools/tool-registry.ts:140`）保留为**显式覆盖**入口。

#### 4.1.5 编排 —— `GraphSpec`（新增）

```ts
// src/graph/spec.ts（新增）
import type { ModuGraphDeps } from './graph.js'

export interface NodeSpec {
  name: string
  factory: (deps: ModuGraphDeps) => (...args: any[]) => any
  /** 条件插入（对应 graph.ts:371-395 的 4 个布尔 → 声明化） */
  when?: (profile: GraphProfile) => boolean
}

export interface EdgeSpec {
  from: string
  /** 静态边：目标节点名；动态边：路由函数（对应 graph.ts:557-620 的三套并列分支） */
  to: string | { router: (...args: any[]) => string; targets: Record<string, string> }
  when?: (profile: GraphProfile) => boolean
}

export interface GraphProfile {
  hitlEnabled: boolean
  multiAgentEnabled: boolean
  planExecuteEnabled: boolean
  clarifyEnabled: boolean
  /** 场景包注入的扩展开关（T-11 后由 profile 声明，取代硬编码） */
  extra?: Record<string, boolean>
}

export interface GraphSpec {
  nodes: NodeSpec[]
  edges: EdgeSpec[]
  /** 场景包扩展子图（真子图，复用 subgraph/builder.ts 的 compile 范式） */
  subgraphs?: Array<{ name: string; parentNode: string; builder: (deps: ModuGraphDeps) => any }>
}
```

```ts
// ComponentRegistry 扩展
registerNode(spec: NodeSpec): void
registerEdge(spec: EdgeSpec): void
listNodeSpecs(): string[]

// graph.ts 新增
export function composeDefaultGraph(profile: GraphProfile): GraphSpec  // 现有 18 节点拓扑的声明化等价物
export function buildFromSpec(spec: GraphSpec, deps: ModuGraphDeps): ModuGraph
export function buildModuGraph(...): ModuGraph                        // 保留为 buildFromSpec(composeDefaultGraph(...)) 的包装
```

**兼容关键**：`composeDefaultGraph` 产出的 spec 必须与 `graph.ts:492-534` 的 `addNode` 顺序**逐节点等价**；`buildModuGraph` 的 14 个位置参数签名**保持不变**（`src/graph/factory.ts:680-697` 不需改动）。

#### 4.1.6 观测 boot 单入口（新增，包装既有三函数）

```ts
// src/observability/boot.ts（新增）
export interface ObservabilityBootResult {
  tracingEnabled: boolean
  metricsEnabled: boolean
  loggingEnabled: boolean
  errors: Array<{ component: string; error: string }>
}

/** 统一 boot：内部按 observability.*.enabled 门控调用既有函数，逐项 try/catch 隔离 */
export function bootObservability(runtimeConfig: RuntimeConfig): ObservabilityBootResult
//   → configure_structured_logging(...)   logging-config.ts:201
//   → configure_otlp_exporter(...)        exporters.ts:34
//   → start_prometheus_server(...)        exporters.ts:159
```

**默认行为**：`observability.tracing.enabled` / `observability.metrics.enabled` / `observability.logging.structured`（`src/config/runtime-config.ts:280,286,291`）默认均为 `false` → `bootObservability` 为 **no-op**，行为与现状完全一致。

### 4.2 装配层契约（内核 → 场景包）

```ts
// src/kernel/types.ts（新增）
import type { ComponentRegistry } from '../core/registry.js'
import type { PolicyEngine } from '../core/interfaces/policy.js'
import type { PromptRegistry } from '../core/interfaces/prompt.js'
import type { ContextRegistry } from '../core/interfaces/context.js'
import type { GraphSpec } from '../graph/spec.js'
import type { RuntimeConfig } from '../config/runtime-config.js'

/** 装配层提供给场景包的全部能力（场景包不得 import 内核内部模块） */
export interface ScenarioHost {
  registry: ComponentRegistry
  policy: PolicyEngine
  prompts: PromptRegistry
  contexts: ContextRegistry
  graph: { addSpec(spec: GraphSpec): void; addNode(spec: NodeSpec): void }
  /** 评估口径注册点（T-19 落地时定义；T-16 可先声明为 unknown + 运行时校验） */
  eval?: EvalRegistry
  runtimeConfig: RuntimeConfig
  /**
   * 场景包注入配置覆盖（**不写回全局单例**）。
   *
   * 修订 7 修正：原表述「落到 configurable.profiles.<task_type>」不成立 ——
   * 全仓无 `profiles` 配置段，且 `configurable` 是 per-request `RunnableConfig`
   * 字段（`graph/runner.ts:282-295`），非持久配置。T-17a 须在以下两项中二选一并冻结：
   *   ① 新增 `RuntimeConfig` 段 `scenario.profiles.<task_type>`（**持久**，须登记
   *      `DEFAULT_CONFIG` + `CAPABILITY_REGISTRY`，否则违反 G-2/L7）；
   *   ② 仅注入 per-request `RunnableConfig.configurable`（**易失**，随 runner 每轮传入）。
   */
  applyConfigProfile(profile: Record<string, unknown>): void
}

export interface ScenarioPackManifest {
  name: string
  version: string
  capabilities: Array<'domain' | 'sop' | 'guardrail' | 'prompt' | 'context' | 'eval'>
  entry?: string
  extends?: string[]
  configProfile?: Record<string, unknown>
}
```

```ts
// src/kernel/scenario-loader.ts（新增）
export class ScenarioLoader {
  constructor(host: ScenarioHost)
  /** 逐能力 try/catch 隔离；任一能力失败仅记录并降级到内置默认，绝不抛出 */
  async activate(packDir: string): Promise<{ pack: string; loaded: string[]; failed: Array<{ capability: string; error: string }> }>
  private loadPrompts / loadDomains / loadSop / loadGuardrails / loadEval
}
```

### 4.3 扩展点契约（PromptRegistry / ContextRegistry）

```ts
// src/reasoning/prompt-registry.ts（新增）
export interface PromptTemplate {
  id: string                       // 如 'plan_execute.planner' / 'subagent.research'
  version: string
  taskTypes?: string[]             // 适用任务类型（subagent 角色选择依据）
  messages: Array<{ role: 'system' | 'user'; content: string }>
  variables?: string[]             // 模板变量名（渲染时校验）
}
export interface PromptRegistry {
  register(tpl: PromptTemplate): void
  get(id: string): PromptTemplate | undefined
  /** 字符等价保证：变量未提供时保留原占位符，默认路径输出与迁移前逐字节一致 */
  render(id: string, vars: Record<string, unknown>): string
  list(taskType?: string): PromptTemplate[]
}
```

```ts
// src/reasoning/context-builder.ts（新增）
export interface ContextFragment {
  id: string
  priority: number          // 对应 nodes.ts agentNode 中 7 段 splice/push 的顺序
  budget?: number           // 字符预算上限
  build(state: ModuAgentState, ctx: ContextRuntime): string | null
}
export interface ContextStrategy {
  readonly id: string
  supports(taskType?: string): boolean
  fragments(): ContextFragment[]
}
export interface ContextRegistry {
  registerStrategy(strategy: ContextStrategy): void
  resolve(taskType?: string): ContextStrategy | undefined
}
```

### 4.4 层间依赖规则（可自动化校验）

| 规则 | 内容 | 违反示例 |
|---|---|---|
| B-1 | 底座层（`core/interfaces`、`tools`、`memory`、`observability`、`perception/security`、`reasoning/llm`、`graph/spec.ts`）**不得** import `kernel/` 或场景包 | `tools/*.ts` import `kernel/scenario-loader.js` |
| B-2 | 底座层**不得** import 具体业务常量（如 `doc_writer` 强制流程、`document_generation` 判定） | `core/registry.ts` 内写死 `doc_writer` |
| B-3 | `src/kernel/` 是**唯一**允许 import 全部底座的模块；底座不得反向 import | — |
| B-4 | 场景包（`packs/`）**只能**通过 `ScenarioHost` 接口访问内核，不得 import `src/` 内部路径 | `packs/x/domain/a.md` 的加载脚本 import `src/graph/nodes.js` |
| B-5 | 运行时层（`runner.ts`）不得新增对场景包/装配层的依赖 | — |

**校验方式**：新增 `tests/architecture/layer-boundaries.test.ts`，用 TS AST 解析 import 图并断言上述规则。

---

## 5. 迁移步骤与优先级

### 5.1 P0 · 通电（目标：让已实现能力真正进入运行时）

> 全部为"接线 / 清理"，不引入新抽象。9 项任务**互不依赖，可 2~3 人并行**。

| ID | 改动 | 具体位置 | 动作 | 验收断言 |
|---|---|---|---|---|
| **T-01** | 观测 boot 接线 | `src/graph/factory.ts:450-457` 之后 | 调用 `bootObservability(runtimeConfig)`（新增 `src/observability/boot.ts`），内部按 `observability.*.enabled`（`:280,286,291`）门控三个既有函数（`logging-config.ts:201`、`exporters.ts:34,159`）；逐项 try/catch | 三函数在 src/ 有真实调用者；三项 enabled 全 false 时调用链为 no-op（行为等价） |
| **T-02** | 观测埋点补齐 | `src/graph/adapters/tool-adapter.ts:257-306` 中间件层 | 在既有中间件位置补 `record_tool_call`（`metrics.ts:212`）；在 LLM 调用包装处补 `record_llm_tokens`（`:237`）。**禁止改 `nodes.ts`** | 启用 `observability.metrics.enabled=true` 时，`tool_calls_total` / `llm_tokens_total` 有数据；`nodes.ts`/`graph.ts` 埋点数为 0（保持不变） |
| **T-03** | 审计落盘 | `src/orchestration/communication/message-bus.ts:192` `PersistentEventLog` | 默认实例化并订阅 `EventDomain.SECURITY`；路径由既有 `event_bus.log_file_path`（`runtime-config.ts:199`）驱动，空字符串=不落盘 | 配置 `log_file_path` 后产生审计文件；默认空串时行为等价 |
| **T-04** | 审计事件补齐 | `src/graph/nodes.ts:1803-1937`（human_review 审批路径） | 审批结果发布 `tool_approval_required`/`_approved`/`_rejected`；输入护栏命中发布 `pii_detected`/`prompt_injection_blocked`（事件类型见 `audit.ts:26-34`） | 12 类事件中**每一类**都存在发布者（`tool_rate_limited` 已有：`rate-limiter.ts:120`）或明确标记为"暂无触发场景" |
| **T-05** | 输出护栏接线 | `src/perception/security/guard.ts:312,369`（当前死代码） | 在 `finalize_response` / `responseNode` 前调用 `detectOutputSensitive` + `sanitizeOutput`；受 `perception.security.block_on_pii`（`runtime-config.ts:221`）门控 | 明文 PII 在响应中被脱敏；两函数不再是死代码 |
| **T-06** | 能力矩阵自动同步 + 死配置清理 | `src/core/registry.ts:115`；`src/config/runtime-config.ts:281-283,287-288` | ① `registerTool` 内自动派生保守 `ToolCapability`；② 5 个死配置键（`tracing.otlp_endpoint`/`service_name`/`sampling_rate`、`metrics.prometheus_port`/`path`）**接线或删除**（推荐接线：T-01 的 boot 消费它们）；③ `memory.default_strategy`（`:70`）接线 | `registerToolCapability`（`tool-registry.ts:140`）不再是 MCP/Skill 工具"能力未知"的唯一出路；新增"已声明未消费"检查为 0 |
| **T-07** | 领域装配器接线 | `src/graph/factory.ts`（`create_agent` 内） | 调用 `registerDomainsFromMarkdown`（`reasoning/domain-adapters.ts:103`），扫描 `config/domains/*.md`；受 `react_optimization.prompt_composer.enabled` 或新增开关门控 | 放置一个 domain MD 文件后，`DOMAIN_ADAPTERS`（`:40`）非空且被 `prompt-composer.ts:57-62` 读到 |
| **T-08** | 模型路由接入 | `src/graph/factory.ts:450-717` + `src/graph/nodes.ts` agentNode | `const moduLlm = _build_modu_llm(llm, provider ?? ...)`（`:290`）→ `const router = _build_llm_router(moduLlm, runtimeConfig)`（`:312`）；在 `agentNode` 读取 `state.task_type`（`state.ts:159,370`）构造 `LLMRouteContext`（`core/interfaces/llm.ts:180-191`）并 `router.route(ctx)` | `llm.router.enabled=true` 且有规则时，不同 `task_type` 走不同模型；`enabled=false`（默认）时 `PassthroughLLMRouter`（`:317`）保证零变化 |
| **T-09** | 工具护栏/审批判定收敛（前置：为 T-09' P1 铺路） | `src/tools/tool-guardrails.ts:61-108`；`src/graph/nodes.ts:1885-1915` | 保持行为不变的前提下，把"guardrail 命中 + requiresApproval"合并判定抽为**纯函数**（单一入口，供 P1 的 `PolicyRule` 包装） | `react_optimization.action_guardrails.enabled`（`:349`）true/false 两种情况下，`tests/tools/tool-guardrails.test.ts` + `tests/graph/hitl-*.test.ts` 全绿 |

**P0 整体验收**：
```bash
npx tsc -p tsconfig.build.json --noEmit      # 零类型错误
npx vitest run                                # 全绿（豁免 better-sqlite3 环境问题，见 §9.1）
```
+ 断言：`CAPABILITY_REGISTRY`（`src/config/capability-registry.ts:46`）中 `status:'implemented'` 的每一项都有真实消费者；5 个死配置键已接线或已删除；`UNDECLARED_CONSUMED_KEYS` 仍为 `[]`。

**P0 交付实况（复核结论，2026-09-29）**：

| 任务 | 状态 | 实况与偏差 |
|---|---|---|
| T-01 观测 boot | ✅ | `factory.ts:474-478` 调用 `boot_observability` |
| T-02 观测埋点 | ✅ | `factory.ts:574-582` `apply_llm_metrics`（`graph/adapters/llm-metrics.ts:97`）；工具侧 `record_tool_call` 在 `tool-adapter.ts` |
| T-03 审计落盘 | ✅ | `factory.ts:491-495` `start_persistent_event_log_from_config` |
| T-04 审计事件 | ✅ | **12/12 类均有发布者**：见 §0.1 #4 的完整清单；P1 仅需回归断言锁定（L11） |
| T-05 输出护栏 | ✅ | `output-guard-node.ts:36`，挂载 `graph.ts:518`（默认 false 门控） |
| T-06 能力矩阵+死配置 | ⚠️ **部分** | `registry.ts:124-130` 自动派生 ✅；5 个观测死键已由 T-01 接线 ✅；`memory.default_strategy` 已接线但**仅注册未消费**（→ T-11）；**剩余 3 处未处置**：`perception.security.enable_guard`（`:219`）、`llm_judge.{enabled,risk_threshold}`（`:232-237`）、`guard.ts:139`/`:232` 无生产调用 → 转 **T-10b ④** |
| T-07 领域装配器 | ✅ | `factory.ts:651-658` |
| T-08 模型路由 | ✅ | `factory.ts:753` 构造 → `:749-793` 解析器 → `:813` 传图 → `graph.ts:369,435-436` → `nodes.ts:1161-1174`（**已核实真正生效**） |
| T-09 护栏判定收口 | ✅ | `tool-guardrails.ts:360` `decideToolApprovals`；`nodes.ts:1934` 唯一调用点；原内联 `_toolRequiresApproval` 已删除 |

> **结论**：M1 的"12 类审计事件均有发布者"已达成（12/12）；**"已声明未消费配置键 = 0"尚未达成**（剩余 3 处），残余工作已显式拆入 P1 的 **T-10b ④**，M1 行按 §6 标注为"部分交付"。

### 5.2 P1 · 底座收口（目标：六底座达到"接口清晰 + 实现多态 + 策略可替换"）

> **本节已按 §0.1 的 11 项复核结论重写。** 相对初稿的 3 处结构性调整：
> 1. **T-10 拆为 T-10 / T-10b**，并按"判定层 vs 执行层"隔离（避免输出护栏双实现）；
> 2. **HITL 拓扑声明化移出 P1**（原 T-10 ③ 依赖 `GraphProfile` = P2 的 T-13，编号引用错误，已改为 T-10c 挂到 T-13）；
> 3. **T-11 / T-12 因 P0 落地而重定范围**：T-11 改为"主链路 `BaseStore` 路径优先"，T-12 修正契约返回类型并纳入"死代码族处置"决策。

#### 5.2.0 P1 任务总表（按依赖与风险排序）

| 顺序 | ID | 任务 | 依赖 | 成本 | 收益 | 风险 | 可并行 |
|---|---|---|---|---|---|---|---|
| ① | **T-12** | LLM provider 注册表收口 | T-08 ✅（已完成并核实生效） | 中 | 中 | **低** | 与 T-11 并行 |
| ② | **T-11** | 记忆策略收口（主链路优先） | T-06 ✅ | 中 | 中 | 低 | 与 T-12 并行 |
| ③ | **T-10** | `PolicyEngine` 骨架 + 工具审批规则化 | T-04/T-05/T-09 ✅ | 中 | **高** | 中高 | 主线，需独立 PR |
| ④ | **T-10b** | 输入/输出护栏规则化 + P0 遗留清零 | T-10 | 低 | 中高 | 低 | 依赖 T-10 骨架 |
| — | ~~T-10c~~ | HITL 拓扑声明化 | T-13（P2） | — | — | — | **移出 P1**，并入 T-13 |

**为什么把 T-12 提到最前**：它是 P1 三项中**唯一依赖已 100% 就绪、且不触碰安全语义**的任务（T-08 已核实真正生效），可作为"横向可替换"验收（M2 断言②）的**最低成本样板**；同时它的产出（provider 注册表）会反向简化 T-10b 的 LLM-judge 处置决策。

#### 5.2.1 T-12 · LLM provider 注册表收口（P1 首项）

| 项 | 内容 |
|---|---|
| **新接口** | `LLMProviderFactory`（§4.1.1，**返回 ChatModel，非 ModuLLM**） |
| **取代对象（修正）** | ① `_PROVIDER_CONFIG` 硬编码映射表（`graph/adapters/llm-adapter.ts:22-51`）；② 4 个 `*LLMReasoner` 类自带的 env/model 常量（`reasoning/llm/gpt.ts:6,23-25`、`qwen.ts:6,23-25`、`glm.ts:6,23-25`、`deepseek.ts:7,24-26`）。**注**：`reasoning/llm/index.ts:8-12` 仅命名再导出，不是映射表 |
| **改动点** | ① 新增 `src/core/interfaces/llm-provider.ts`；② `ComponentRegistry.registerLLMProvider/getLLMProvider/listLLMProviders`；③ 内置 4 个 factory（glm/deepseek/gpt/qwen）**以在用的 `llm-adapter.ts:22-51` 约定为准**，把 `MODU_OPENAI_API_KEY`/`MODU_OPENAI_BASE_URL`/`MODU_OPENAI_MODEL` 作为 `apiKeyEnvAliases`/`baseUrlEnvAliases`；④ `factory.ts:519`（主链路）与 `factory.ts:342-345`（routeTable 工厂）改走注册表；⑤ `build_chat_model` 保留为兼容包装 |
| **双轨差异必须逐条处理（已核实）** | gpt：key `OPENAI_API_KEY` vs `MODU_OPENAI_API_KEY`、model `gpt-4o-mini` vs `gpt-4o`；qwen：model `qwen-plus` vs `qwen-max`；通用回退 `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_DEFAULT_MODEL` **仅 `llm-adapter.ts:84,90-101` 有** → 注册表须同时声明"主 env + 别名 + 通用回退"三级解析 |
| **顺带修正（新发现）** | `llm-adapter.ts:74` 的次级兜底 `'glm'` 与全局 `llm.default_provider='deepseek'`（`runtime-config.ts:21`）及 `factory.ts:578,715,751` 的 `'deepseek'` 不一致 → 统一为"读配置单一路径"，消除第 4 个默认值来源 |
| **死代码族处置** | `BaseLLMReasoner`（`base-llm.ts:15/49/52` 类级 `@deprecated`）与 4 个子类**除 index 再导出外零消费者**。① 删除 `_buildMessages`（`base-llm.ts:627`）的 prompt 组装职责（仅被类内 `reason():520`、`astream():612` 调用，无外部调用者）；② 家族去留按 §9 **D-16** 决策（推荐：保留为"内置默认工厂"实现体，但从 `reasoning/index.ts:7-13` 主导出移出并标 deprecated） |
| **新增测试（当前零覆盖）** | `tests/reasoning/llm-provider.test.ts`：`tests/` 下**无任何** llm/router/provider 测试（现有仅 `tests/kernel/p0-wiring.test.ts:448,623-627` 做配置断言）→ 需补：① 4 provider 的 env 别名解析；② `defaultModel` 与 `_PROVIDER_CONFIG` 逐项一致；③ 未知 provider 降级；④ 注册表替换 provider 后端到端取到新模型 |
| **验收断言** | ① `npx tsc --noEmit` 零错误；② 新建测试全绿；③ **横向可替换样板**：注册一个自定义 provider factory（替代 gpt），`git diff --name-only -- packs/`（P3 后）或对 `src/graph/nodes.ts`/`src/graph/graph.ts` 为 0；④ `llm.router.enabled=true` 时 `tests/kernel/p0-wiring.test.ts` 与路由行为**不变**（T-08 成果不回退） |

#### 5.2.2 T-11 · 记忆策略收口（主链路优先）

| 项 | 内容 |
|---|---|
| **新接口** | `MemoryStrategy`（§4.1.2） |
| **取代对象（修正）** | 不再是"三套并行抽象"，而是：① **主链路 `BaseStore` 路径**（`store-adapter.ts:113,327` → `graph.ts:499-504,528` → `nodes.ts:333,425`）抽象为 `BaseStoreMemoryStrategy`；② `BaseMemory` 家族经 `LegacyMemoryStrategyAdapter` 兼容；③ **消除** `memory-strategy.ts:42` 的"注册了但运行时零消费"半接线 |
| **改动点** | ① 新增 `src/core/interfaces/memory-strategy.ts` + `registerMemoryStrategy/resolveMemoryStrategy`；② 新增 `src/memory/base-store-strategy.ts`（`recall` → `store.search([userId,'knowledge'], {query, limit:5})`；`persist` → `store.put([userId,'history'], key, {...})`，与 `nodes.ts:333,425` **逐字段等价**）；③ `graph.ts:437-439` 的 `makeMemoryQueryNode/makeMemoryUpdateNode` 改为经 `resolveMemoryStrategy(task_type)` 取策略，未注册策略时走原 `store` 直连（默认等价）；④ `memory-strategy.ts` 升级为注册到新策略表（保留 `registry.registerMemory` 作为兼容旁路） |
| **默认行为等价** | `perception` 写入的 `task_type` 目前仅 `'document_generation'`/`null`（`nodes.ts:172,201`；`state.ts:370` 默认 null）→ `resolveMemoryStrategy(undefined)` 必须回退 `memory.default_strategy`（`'cache'`），保证默认路径逐字节等价 |
| **namespace 单一来源（本轮唯一配置化项）** | 写侧 `chroma.ts:199`（`${prefix}_${userId}`）与读侧 `nodes.ts:333`（`[userId,'knowledge']`）**必须成对修改**为同一 namespace 来源；`memory` 段新增键须同时登记进 `DEFAULT_CONFIG`（`runtime-config.ts:69-79`）与 `CAPABILITY_REGISTRY`（否则违反 G-2） |
| **本轮明确不做** | `embedding` 配置化（当前仅代码注入 `chroma.ts:186`，默认哈希降级 `:146`）、`chunking`（**无实现**，需新增切分层）→ 标注为 P3 随场景包再做，避免 P1 引入新配置面 |
| **移出范围** | `ObservationMemory`（`observation-memory.ts:94`，零调用）与 `state.observation_memory`（`state.ts:151,361,505`，零读写）→ 独立决策 §9 **D-15**（接线 or 删死字段） |
| **新增测试** | `tests/memory/base-store-strategy.test.ts`（recall/persist 与 `nodes.ts:333,425` 语义等价）；`tests/kernel/p1-memory-strategy.test.ts`（策略解析：`supports(taskType)` 命中/未命中回退、默认等价） |
| **验收断言** | ① **横向可替换样板**：注册一个自定义 `MemoryStrategy`（替代 `cache`），`git diff --name-only -- src/graph/nodes.ts src/graph/graph.ts` 为 0；② `tests/graph/react-news-e2e.test.ts` / `hitl-*.test.ts` 全绿（`memory_query`/`memory_update` 是每轮必经节点）；③ `resolveMemoryStrategy` 有**主链路真实调用点**（非仅注册） |

#### 5.2.3 T-10 · `PolicyEngine` 骨架 + 工具审批规则化（P1 主线）

| 项 | 内容 |
|---|---|
| **新接口** | `PolicyRule` / `PolicyEngine`（§4.1.3） |
| **取代对象（修正）** | **不再包含** `nodes.ts:1803-1828`（已被 P0 T-09 消除）。实际收敛目标：`guard.ts` 私有正则库（`:19-34,:40-46,:52-56,:63-78,:81-87`）、`tool-guardrails.ts:61-108`（5 条规则）、`tool-guardrails.ts:360`（判定纯函数）、各工具 `requiresApproval*` |
| **改动点** | ① 新增 `src/core/interfaces/policy.ts`（`PolicyStage`/`PolicySubject`/`PolicyDecision`/`PolicyRule`/`PolicyEngine`）；② 新增 `src/perception/security/policy-engine.ts`（**参照 `perception/pipeline.ts:26-34,86-90,92-110` 范式**：注册表查找 + **逐项 try/catch** + 优先级排序 + 命中即短路 + 无命中 `allow`）；③ `ComponentRegistry.registerPolicyRule/getPolicyEngine`；④ 新增 `ToolApprovalPolicyRule`（**委派** `decideToolApprovals`，判定内核零重写）；⑤ `nodes.ts:1934` 改为经 `PolicyEngine.decide('tool', ...)`，受新键 `policy.engine.enabled`（默认 **false**）短路 |
| **判定内核唯一性（硬约束）** | `decideToolApprovals`（`tool-guardrails.ts:360`）仍是唯一判定内核。`PolicyEngine` 只做"stage 分发 + 规则链 + 异常隔离 + 优先级 + 默认 allow"。**禁止**第二套 guardrail→sensitive→tool_policy 顺序实现 |
| **审批链路不动** | `interrupt`（`nodes.ts:1988`）、resume 解析（`:2006-2021`）、approved/rejected 分支（`:2049,:2088-2136`）、`routeAfterHumanReview`（`:2149-2159`）、超时自动拒绝（`runner.ts:1287`）**全部保持不变** |
| **与 T-10b 的分工** | T-10 只做"骨架 + 工具审批规则"；输入/输出护栏规则与 P0 遗留清零放 T-10b（可独立验收、独立回滚） |
| **新增测试** | `tests/core/policy-engine.test.ts`（注册/优先级/异常隔离/无命中 allow/默认门控）；`tests/graph/policy-hitl-equivalence.test.ts`（**四组合等价矩阵**） |
| **验收断言** | ① `tests/graph/hitl-e2e.test.ts`、`tests/graph/hitl-interrupt-payload.test.ts`、`tests/tools/tool-guardrails.test.ts` **全绿**；② **等价矩阵**：`action_guardrails.enabled ∈ {false,true}` × `policy.engine.enabled ∈ {false,true}` 四种组合下，`decideToolApprovals` 输出与 `PolicyEngine.decide('tool')` 输出**逐工具逐字段一致**（`source`/`requiresApproval`/`ruleId`）；③ `policy.engine.enabled=false` 时 `git diff` 对 `nodes.ts` 判定行为等价（开关回滚可用） |

#### 5.2.4 T-10b · 输入/输出护栏规则化 + P0 遗留清零

| 项 | 内容 |
|---|---|
| **目标** | 让 `PolicyStage` 的 `input`/`output` 两端**有规则可注册**，并清掉 P0 剩余的 3 处悬挂配置键（否则 G-2 断言不成立） |
| **① 输入规则** | `InputGuardPolicyRule`（stage: input）包装 `SecurityGuard.detectAll`（`guard.ts:285`）；**需先开放常量导出**（`guard.ts` 当前仅导出 `SecurityGuard` 类，`:96`）。**不改** `perception/text/rule-based.ts:237` 的评分与 `nodes.ts:489-498` 的路由阻断（保持"评分 + 路由阻断"现状） |
| **② 输出规则** | `OutputGuardPolicyRule`（stage: output）**只登记不搬迁**：委派 `sanitizeOutput`（`guard.ts:369`），执行仍为 `output-guard-node.ts:47`。契约中声明"执行方 = 节点包装器"，避免双脱敏 |
| **③ 回归锁定审计发布者（P0 已达成，仅需防回退）** | P0 T-04 **已补齐 12/12** 类发布者（清单见 §0.1 #4）。P1 只需新增断言测试锁定该状态（防止后续改动删除发布点），**无需新增发布者** |
| **④ 清零"声明未消费"键（剩余 3 处）** —— **实际处置：全部接线（修订 3）** | `perception.security.enable_guard`（`runtime-config.ts:219`）→ **接线**：由 `InputGuardPolicyRule.evaluate` 读取，`false` 时直接放行（`policy-rules.ts`）；`perception.security.llm_judge.{enabled,risk_threshold}`（`:232-237`）→ **接线**：同规则读取，启用时调用 `guard.detectInjectionWithLLMJudge`，并新增 `createModuLlmJudgeCallback(judgeLlm)` 由 `create_agent` 注入真实 LLM 判定回调（`guard.ts:139` 由此获得**生产调用者**）；`guard.ts:232 sanitize()` → **不接线/不删除**（D-18「只登记不迁执行」，输入阶段无执行方，保留为公共 API） |
| **验收断言** | ① `UNDECLARED_CONSUMED_KEYS === []`（`capability-registry.ts:281`）**且**"已声明未消费"检查为 0（含上述 3 处处置结果）；② 12 类 `AuditEventType`（`audit.ts:25-37`）**仍每类有发布者**（回归断言，防删除）；③ `perception.security.sanitize_output.enabled=false`（默认）时 `response` 文本逐字节不变 |

#### 5.2.5 P1 验收（修正版）

**验收定义**（M2 门禁，逐项可执行）：

| # | 断言 | 执行方式 |
|---|---|---|
| 1 | 三个注册方法在 `ComponentRegistry` 可用且**被主链路消费** | `registerLLMProvider`/`registerMemoryStrategy`/`registerPolicyRule` + 各自消费点（`factory.ts:519,342`、`graph.ts:437`、`nodes.ts:1934`） |
| 2 | **横向替换 × 3**（不改上层） | ① 换 provider（T-12）→ `git diff --name-only -- src/graph/nodes.ts src/graph/graph.ts` 为 0；② 换记忆策略（T-11）→ 同上；③ 换权限规则集（T-10）→ 同上 |
| 3 | **默认行为零变化** | `npx vitest run tests/graph tests/perception tests/tools tests/reasoning tests/config` 全绿；`react-news-e2e`/`hitl-e2e`/`hitl-interrupt-payload`/`clarify-node` 全绿 |
| 4 | **审批语义回归** | 四组合等价矩阵通过（§5.2.3 ②） |
| 5 | **配置无悬挂** | `UNDECLARED_CONSUMED_KEYS === []` **且**"已声明未消费" = 0（当前含 3 处 P0 遗留，见 T-10b ④） |
| 6 | 类型与构建 | `npx tsc -p tsconfig.build.json --noEmit` 零错误 |
| 7 | **P0 成果不回退** | `tests/kernel/p0-wiring.test.ts` 全绿（尤其 `llm.router` 相关断言 `:448,623-627`、`unwrap_modu_llm` `:433-443`） |

**P1 不做（明确排除，避免范围蔓延）**：HITL 拓扑声明化（→ T-13）、`embedding`/`chunking` 配置化（→ P3）、`ObservationMemory` 接线（→ D-15）、输入护栏阻断语义变更（保持"评分 + 路由阻断"）。

#### 5.2.6 P1 实施结果（修订 3，已完成）

**按 §5.2.0 的排序完成 T-12 → T-11 → T-10 → T-10b，全部为"新增 + 可选注入"，默认路径行为零变化。**

**新增文件**

| 文件 | 任务 | 作用 |
|---|---|---|
| `src/core/interfaces/llm-provider.ts` | T-12 | `LLMProviderFactory` / `LLMProviderSpec` 契约（返回 ChatModel，见 §4.1.1 修正） |
| `src/graph/adapters/llm-provider-registry.ts` | T-12 | 内置 provider 规格表（唯一事实源）+ 工厂装配 + 幂等注册（回调注入，无 `@langchain` 依赖） |
| `src/core/interfaces/memory-strategy.ts` | T-11 | `MemoryStrategy` / `MemoryItem` / 召回-持久化上下文契约 |
| `src/memory/base-store-strategy.ts` | T-11 | `BaseStoreMemoryStrategy`（包装主链路 `BaseStore`，与 `nodes.ts:333,425` 逐字段等价） |
| `src/core/interfaces/policy.ts` | T-10 | `PolicyEngine` / `PolicyRule` / 三层阶段契约（含 `ToolApprovalDetail`，与 `ToolApprovalDecision` 结构兼容） |
| `src/core/policy-engine.ts` | T-10 | `DefaultPolicyEngine`（优先级 + 短路 + 逐项 try/catch 隔离 + 默认 allow）/ `NoopPolicyEngine` |
| `src/perception/security/policy-rules.ts` | T-10/T-10b | `ToolApprovalPolicyRule`（委派 `decideToolApprovals`，零重写）、`InputGuardPolicyRule`、`OutputGuardPolicyRule`、`registerDefaultPolicyRules`、`createModuLlmJudgeCallback` |

**改动文件（关键点）**

| 文件 | 改动 |
|---|---|
| `src/core/registry.ts` | 新增 `registerLLMProvider/getLLMProvider/listLLMProviders`、`registerMemoryStrategy/getMemoryStrategy/listMemoryStrategies/setDefaultMemoryStrategy/getDefaultMemoryStrategyId/resolveMemoryStrategy`、`registerPolicyRule/getPolicyEngine/setPolicyEngine/listPolicyRules`。**既有 11 类组件、`listAll()`、`swapComponent()` 均未改动**（`tests/core/registry.test.ts:145` 断言不受影响） |
| `src/graph/adapters/llm-adapter.ts` | `build_chat_model` 改为**经注册表**取工厂构造；新增 `registerBuiltinLLMProviders` / `listBuiltinLLMProviders`；默认 provider 次级兜底 `'glm'` → `'deepseek'`（与 `DEFAULT_CONFIG` 统一）；env 解析增补"别名"一级（`MODU_OPENAI_*`） |
| `src/graph/nodes.ts` | ① 工具审批：新增 `_decideToolApprovalsViaPolicy`，受 `policy.engine.enabled`（默认 false）门控，**异常/形状不符自动降级直调**；② 记忆节点：新增可选 `resolveStrategy` 参数（`makeMemoryQueryNode` / `makeMemoryUpdateNode`），未传时行为逐字段不变 |
| `src/graph/graph.ts` | `buildModuGraph` 末尾新增可选参数 `memoryStrategyResolver`（沿用 P0 的"追加可选参数"实践），透传给记忆节点 |
| `src/graph/factory.ts` | ① `registerBuiltinLLMProviders`（T-12）；② `registerBaseStoreMemoryStrategy` + 构造 `memoryStrategyResolver` 并传图（T-11）；③ `registerDefaultPolicyRules` + `createModuLlmJudgeCallback(judgeLlm)`（T-10/T-10b） |
| `src/memory/memory-strategy.ts` | 新增 `registerBaseStoreMemoryStrategy`（宿主覆盖优先，不强制改默认） |
| `src/config/runtime-config.ts` | 新增 `policy.engine.enabled`（**默认 false**） |
| `src/config/capability-registry.ts` | 新增 `policy_engine` 能力条目（`status: 'implemented'`，`enabledKey: 'policy.engine.enabled'`） |
| `src/core/index.ts` / `src/memory/index.ts` / `src/perception/security/index.ts` / `src/graph/adapters/index.ts` | 导出新增契约与实现 |

**新增测试（67 项）**

| 文件 | 项数 | 覆盖 |
|---|---|---|
| `tests/reasoning/llm-provider.test.ts` | 16 | 规格表与改造前 `_PROVIDER_CONFIG` 逐项等价；注册幂等；**宿主覆盖优先**；**自定义 provider 端到端可用**；env 解析五级顺序；未知 provider 回退 glm；默认 provider 兜底 deepseek |
| `tests/memory/base-store-strategy.test.ts` | 17 | `recall`/`persist` 与 `nodes.ts:333,425` 逐字段等价；namespace 单一来源（读写成对）；节点带/不带策略结果相同；注册表解析/默认/异常隔离；`registerBaseStoreMemoryStrategy` 幂等与宿主覆盖 |
| `tests/core/policy-engine.test.ts` | 26 | 引擎语义（优先级/短路/异常隔离/阶段隔离/默认 allow）；`ComponentRegistry` 懒构造与规则重放；三层规则行为；**`enable_guard`/`llm_judge.*` 消费验证**（含 `risk_threshold` 跳过 LLM 的分支） |
| `tests/graph/policy-hitl-equivalence.test.ts` | 6 | **L10 等价矩阵**：`action_guardrails.enabled` × `policy.engine.enabled` 四组合下 `decideToolApprovals` ≡ `PolicyEngine.decide('tool')`；图级 interrupt 载荷四组合一致 |
| `tests/kernel/p1-wiring.test.ts` | 2 | **装配层接线（§5.2.5 断言 #1）**：真实 `create_agent()` 后 `listLLMProviders()`=4、`listMemoryStrategies()` 含 `base_store` 且为默认、`listPolicyRules()`=3；重复调用幂等 |

**验证结果（修订 3 实测）**

```bash
cd packages/modu-agent
npx tsc -p tsconfig.build.json --noEmit     # ✅ 零错误
npx vitest run                               # ✅ 755 passed / 762（67 新增全绿）
```

- 唯一 7 项失败为 `tests/tools/sql-query.test.ts` 的 `better-sqlite3` 原生绑定缺失（`Could not locate the bindings file`）——**已知环境问题（R-12 / D-14），非本次改动引入**；P0 基线为 688/695，+67（新增测试）→ 755/762，失败数**不变**（688+67=755、695+67=762，逐项对齐）。
- **P0 成果未回退**：`tests/kernel/p0-wiring.test.ts` 全绿（路由/观测/审计/输出护栏断言）；`tests/graph/react-news-e2e.test.ts`、`hitl-e2e.test.ts`、`hitl-interrupt-payload.test.ts`、`clarify-node.test.ts`、`tests/core/registry.test.ts` 全绿。

**默认行为零变化的实现方式（逐项）**

| 能力 | 门控 | 关闭时行为 |
|---|---|---|
| provider 注册表（T-12） | 无开关（等价重构） | 未注册自动兜底注册内置工厂；构造参数与 env 解析顺序与改造前一致 |
| 记忆策略（T-11） | `resolveMemoryStrategy` 无命中 → 节点回退 `store` 直连 | 与改造前逐字段一致；`BaseStoreMemoryStrategy` 亦与直连路径等价 |
| 策略引擎（T-10） | `policy.engine.enabled=false`（默认） | `human_review` 直调 `decideToolApprovals`；引擎路径还会在异常/形状不符时自动降级 |
| 输入/输出规则（T-10b） | 规则仅"登记"；`enable_guard` 默认 true、`llm_judge.enabled` 默认 false、`block_on_*` 默认 false | 不改变既有路由/清洗执行方（D-18） |

**P1 遗留（显式记录，避免被误认为已收口）**

1. `guard.ts:232 sanitize()` 仍无调用者 —— 按 D-18 保留（输入阶段无执行方），非配置键、不影响 G-2。
2. 输入/输出阶段规则为**可注册扩展**：`create_agent` 仅登记，主链路未消费 `input`/`output` 决策（避免与 `routeAfterPerception`、`output-guard-node` 形成双实现，R-13）。若后续需要"策略引擎真正接管输入阻断"，须先解决同步路由（`routeAfterPerception` 为同步函数）→ 归入 P2/P3。
3. **感知处理器未注册**（§0.1 #12）：`enable_guard`/`llm_judge` 虽已有消费点，但其所依赖的 `TextPreprocessor` 路径在默认运行时不被执行 —— 建议单独立项。
4. `ObservationMemory` / `state.observation_memory` 去留仍待 D-15。
5. `embedding` / `chunking` 配置化按 D-17 未做（P3）。
6. `BaseLLMReasoner` 家族去留仍待 D-16。

#### 5.2.7 P0 + P1 落地代码复查与修复（修订 4，已完成）

对 P0（T-01~T-09）与 P1（T-10/T-10b/T-11/T-12）的全部落地代码做逐文件复查，
**发现 2 处真实缺陷并已修复**；其余项经核查**无缺陷**（见下方"核查通过项"）。

**缺陷 1 · P0（T-06）自动派生能力的"保守标注"被判定逻辑采信 → 行为反向漂移（R-17）**

| 项 | 内容 |
|---|---|
| **现象** | `ensureToolCapability`（`tools/tool-registry.ts`）为所有未登记工具（MCP / Skill / 宿主自定义）派生 `requires_confirmation: true` 的**保守标注**。该标注随后被两处**判定逻辑**采信：<br>① `tool-guardrails.ts:209` `checkGuardrail` 第二层回退 → 判为需审批；<br>② `tool-orchestrator.ts:75` `hasDependency` → 判为写操作、串行 |
| **后果** | 相对 T-06 之前（能力未知 → 不命中任何判定）产生**行为漂移**：<br>· `react_optimization.action_guardrails.enabled=true` 时，**所有**第三方工具被强制审批，且与 MCP 工具自身 `requiresApproval()` 返回 `false`（`mcp-tool-adapter.ts:209`）的**契约直接冲突**；<br>· `react_optimization.parallel_tools.enabled=true` 时，任意两个第三方工具被判为"有依赖"而强制串行 |
| **与计划的偏差** | 计划 §4.1.4 明确要求"只有当工具的 `requiresApproval()` 显式返回 false 且属于内置白名单时才降级"——**未实现**（`ensureToolCapability` 只接收工具名，拿不到工具实例） |
| **修复** | ① `ToolCapability` 新增 `derived?: boolean`；`ensureToolCapability` 标记派生条目；<br>② 新增 `isExplicitlyConfirmRequired(cap)` 作为**单一判定入口**（避免两处判定各自解释语义而分歧）；<br>③ 两处判定改为**仅采信显式声明**（内置 7 项 + `registerToolCapability`）<br>**保留** T-06 的收益：派生条目仍可供 `filterToolsByTaskType` 的 task_type 覆盖判断与可观测性使用 |
| **默认路径影响** | 无（`action_guardrails.enabled` / `parallel_tools.enabled` 均默认 false）；但这两个开关一旦开启即会暴露，故按缺陷处理 |
| **回归测试** | `tests/tools/capability-derivation.test.ts`（11 项）：派生不触发审批/依赖判定；显式声明仍生效；内置 7 项判定未回退；宿主显式覆盖派生条目后可参与判定 |

**缺陷 2 · P1（T-11）记忆策略在非 BaseStore 场景被忽略（R-18）**

| 项 | 内容 |
|---|---|
| **现象** | `graph.ts` 仅在 `store` 非空时才把 `memoryStrategyResolver` 传给记忆节点（`store ? makeMemoryXxx(store, resolver) : 退化版`） |
| **后果** | 宿主注册的非 BaseStore 后端（Redis / 自研向量库）在 `memory.store_type='none'` 时被**完全忽略** —— 而该配置正是宿主"停用内置 store、只用自己的策略"时的自然选择，形成 M2「横向替换 ×3」的覆盖缺口 |
| **修复** | `graph.ts` 恒使用工厂版本并传入解析器；无策略命中时返回值与既有 `memoryQueryNode`（空 `knowledge`）/ `memoryUpdateNode`（`skipped_no_store`）**逐字段一致**，默认行为不变 |
| **回归测试** | `tests/memory/base-store-strategy.test.ts` 新增 4 项：无 store + 策略 → 经策略读写；无 store + 无策略 → 保持原退化行为 |

**核查通过（无缺陷）的关键项**

| 项 | 核查结论 |
|---|---|
| T-01 观测 boot | 三项默认 false → no-op；进程内幂等（`_booted`）避免重复绑端口；逐项 try/catch 隔离 ✅ |
| T-02 观测埋点 | `record_tool_call` 已在 `tool-adapter.ts:354` 的 `finally` 中接线；`record_llm_tokens` 经 `llm-metrics.ts` Proxy 接线，默认原样返回 ✅ |
| T-03 审计落盘 | 仅 `event_bus.log_file_path` 非空时启动；`_writerLoop` 在 stop 后仍处理完队列（无丢数据）；落盘补了 `payload` ✅ |
| T-04 审计事件 | **12/12 类均有发布者**；`tool_approval_required` 去重表有界（4096）且键含 `messages.length`（resume 重执行去重正确）✅ |
| T-05 输出护栏 | 执行方唯一为 `output-guard-node.ts:47`，异常降级原响应 ✅ |
| T-08 模型路由 | 构造/透传/消费链路完整；路由结果按 `provider:model` 缓存；异常三层降级（表工厂/router/resolver）✅ |
| T-09 审批判定收敛 | `decideToolApprovals` 为唯一判定内核，判定顺序与迁移前一致 ✅ |
| T-10 策略引擎 | 默认门控关闭；异常/形状不符自动降级直调；**审批判定内核零重写**（委派）✅ |
| T-10b 悬挂键清零 | `enable_guard`/`llm_judge.*` 已由 `InputGuardPolicyRule` 消费；`guard.ts:139` 已有生产调用者 ✅ |
| T-12 provider 注册表 | 规格表与改造前 `_PROVIDER_CONFIG` 逐项等价；env 解析五级顺序含别名；未知 provider 仍回退 glm；默认 provider 次级兜底已统一为 `deepseek` ✅ |

**验证结果（修订 4 实测）**

```bash
cd packages/modu-agent
npx tsc -p tsconfig.build.json --noEmit     # ✅ 零错误
npx vitest run                               # ✅ 770 passed / 777
```

- 唯一 7 项失败仍为 `tests/tools/sql-query.test.ts` 的 `better-sqlite3` 原生绑定缺失（R-12 / D-14）；
- 修订 3 基线 755/762 → 修订 4 **770/777**（+15 项新增回归测试），失败数**不变**。

### 5.3 P2 · 可注册化（目标：拓扑/prompt/上下文可被外部注册）

| ID | 改动 | 新接口 | 取代对象 | 关键约束 |
|---|---|---|---|---|
| **T-13** | `GraphSpec` + `buildFromSpec`（**含 P1 移入的 T-10c：HITL 拓扑声明化**） | `NodeSpec`/`EdgeSpec`/`GraphSpec`（§4.1.5） | `buildModuGraph` 硬编码拓扑（`graph.ts:351-762`，`addNode` 于 `:492-548`）；条件边平行分支 `:554-670`；模式布尔 `:375-399` | ① `composeDefaultGraph` 与现有 `addNode` 顺序**逐节点等价**；② plan-execute 内联节点（`:544-548`）导出为**可注册子图 spec 片段**（参照真子图 `subgraph/builder.ts:98` 的 `compile` 范式）；③ 用 `STATE_SCHEMA_VERSION` + `migrate_state`（`state.ts:185,415`）承载会话兼容；④ `buildModuGraph` 签名与行为保持不变；⑤ **T-10c（自 P1 移入）**：HITL 节点插入位置（`graph.ts:530-532` addNode、`:652-666` agent→human_review 条件边）与 `perception.clarification`（`:448-454,565-567`）统一改为 `GraphProfile` 声明，取代 `hitlEnabled`/`clarifyEnabled` 布尔分支 |
| **T-14** | `PromptRegistry` | `PromptTemplate` + `render()`（§4.3） | 13 处内联 prompt：`plan-execute/prompts.ts:59-107,122-154`、`factory.ts:75-114`、`nodes.ts:979-996`、`feedback/quality-monitor.ts:50`、`orchestration/patterns/consensus.ts:201`、`subgraph/builder.ts:27-39` 等 | **强制字符等价**：逐文件迁移，每迁一处跑等价性测试（扩展现有 `tests/reasoning/prompt-composer.test.ts`） |
| **T-15** | `ContextRegistry` + `ContextBuilder` | `ContextStrategy`/`ContextFragment`（§4.3） | `agentNode` 过程式注入（`nodes.ts:939-1065` 的 7 段 splice/push） | 同上，字符等价 + fragment 顺序与现状一致（由 `priority` 保序） |

**并行提示**：T-14 / T-15 的**接口定义与注册表**可在 T-13 完成前先行落地（无依赖）。

**P2 验收**：新增 1 个图节点 + 1 个任务级 prompt + 1 个上下文策略，**不改 `graph/graph.ts` 与 `graph/nodes.ts`**。

#### 5.3.1 P2 实施结果（修订 5，已完成）

**按 T-13 / T-14 / T-15 顺序实施，全部为"新增可注册扩展点 + 默认路径等价"，默认行为零变化。**

**新增文件**

| 文件 | 任务 | 作用 |
|---|---|---|
| `src/graph/spec.ts` | T-13 | `NodeSpec`/`EdgeSpec`/`GraphProfile`/`GraphSpec` 契约 + `buildFromSpec` 执行器 + `computeRecursionLimit`/`describeGraphSpec`（拓扑快照） |
| `src/graph/prompt-templates.ts` | T-14 | 内置 Prompt 模板**唯一事实源**（planner / planner.compact / subagent×4 / doc_generation_task）+ `registerBuiltinPrompts` |
| `src/graph/context-strategies.ts` | T-15 | 默认上下文策略（6 个片段：perception / doc_gen_task / memory_knowledge / observations / few_shot / plan_step）+ `registerBuiltinContextStrategies` |
| `src/core/interfaces/prompt.ts` | T-14 | `PromptTemplate`/`PromptRegistry` 契约（零依赖） |
| `src/core/interfaces/context.ts` | T-15 | `ContextStrategy`/`ContextFragment`/`ContextRuntime`/`ContextRegistry` 契约 |
| `src/reasoning/prompt-registry.ts` | T-14 | `DefaultPromptRegistry` + 全局单例 + `renderPromptWithFallback`（注册表优先 / 未注册回退内置模板） |
| `src/reasoning/context-builder.ts` | T-15 | `applyContextFragments`（anchor/append 两阶段 + 优先级 + 逐片段 try/catch + budget） |

**改动文件（关键点）**

| 文件 | 改动 |
|---|---|
| `src/graph/graph.ts` | `buildModuGraph`（**14 个位置参数签名不变**）改为 `buildFromSpec(composeDefaultGraph(resolveGraphProfile(...)), deps)`；新增 `composeDefaultGraph`（18 节点 + 37 条边声明）/`resolveGraphProfile`（**含原 T-10c：HITL/澄清拓扑由 `GraphProfile` 声明，取代 4 个布尔分支**）/`createFewShotSelector`；`_estimatePlanTotalIterations` 迁入 `spec.ts` |
| `src/core/registry.ts` | 新增 `registerNode/registerEdge/listNodeSpecs/listEdgeSpecs/clearGraphSpecs`（T-13）、`registerPrompt/getPrompt/listPrompts/renderPrompt`（T-14）、`registerContextStrategy/resolveContextStrategy/...`（T-15）。**既有 11 类组件、`listAll()`、`swapComponent()` 均未改动** |
| `src/graph/nodes.ts` | `agentNode` 的 6 段过程式 `splice`/`push` 上下文注入 → `applyContextFragments(..., resolveContextStrategy(task_type) ?? 内置默认策略)`；新增 `_resolveAgentContextStrategy`（受 `context.registry.enabled` 门控） |
| `src/graph/plan-execute/prompts.ts` | `buildPlannerSystemPrompt`/`...Compact` 改为经注册表渲染（`renderPromptWithFallback`），字面量迁至 `prompt-templates.ts` |
| `src/graph/subgraph/builder.ts` | `_getSystemPrompt` 的角色模板改为经注册表渲染（宿主可替换 `subagent.<role>`） |
| `src/graph/factory.ts` | ① `registerBuiltinPrompts()` + 注册 `agent.default_system`（`_DEFAULT_ANTI_HALLUCINATION_PROMPT` 包装为模板，字面量不搬运以避免字符漂移）；② `registerBuiltinContextStrategies()`；③ 默认 system prompt 经注册表渲染（T-14） |
| `src/config/runtime-config.ts` | 新增 `graph.spec.enabled`（true）/`prompt.registry.enabled`（true）/`context.registry.enabled`（true）三个**单点回滚开关** |
| `src/config/capability-registry.ts` | 新增 3 个能力条目：`graph_spec`/`prompt_registry`/`context_registry`（均 `status: 'implemented'`） |
| `src/{graph,reasoning,core}/index.ts` | 导出新增契约与实现 |

**新增测试（45 项）**

| 文件 | 项数 | 覆盖 |
|---|---|---|
| `tests/graph/graph-spec-equivalence.test.ts` | 14 | **L4 拓扑等价快照**（5 组画像：默认 / HITL+澄清+反馈 / 多 Agent / plan_execute / 组合模式，节点与边**逐条**对照改造前 addNode/addEdge 序列）；`resolveGraphProfile` 参数优先与配置回落；`computeRecursionLimit` 逐项复刻；`buildFromSpec` 最小 spec 可编译执行；**宿主注册节点/边真实生效**；`graph.spec.enabled=false` 单点回滚；同名冲突以内置为准 |
| `tests/reasoning/prompt-registry.test.ts` | 18 | 注册表语义（覆盖/未知 id/缺失变量保留占位符/多消息连接/`renderOr`/`list(taskType)`）；**字符等价 golden**（planner 完整版/简洁版、subagent×4、doc_generation_task，含数值常量硬编码防漂移）；宿主替换 `subagent.research` 生效 |
| `tests/reasoning/context-builder.test.ts` | 13 | 构建器语义（anchor/append、优先级、锚点偏移、异常隔离、budget、异步、越界钳制）；**等价矩阵 1024 组合**（7 开关 × 2 系统提示词 × 4 基线消息，迁移前内联算法逐字复刻 ⇄ ContextBuilder）；上下文策略注册表与替换 |

**验证结果（修订 5 实测）**

```bash
cd packages/modu-agent
npx tsc -p tsconfig.build.json --noEmit     # ✅ 零错误
npx vitest run                               # ✅ 815 passed / 822
```

- 唯一 7 项失败仍为 `tests/tools/sql-query.test.ts` 的 `better-sqlite3` 原生绑定缺失（R-12 / D-14）；修订 4 基线 770/777 → 修订 5 **815/822**（+45 项新增测试），失败数**不变**。
- **P0/P1 成果未回退**：`tests/kernel/p0-wiring.test.ts`、`p1-wiring.test.ts`、`tests/graph/react-news-e2e.test.ts`、`hitl-e2e.test.ts`、`hitl-interrupt-payload.test.ts`、`clarify-node.test.ts`、`policy-hitl-equivalence.test.ts`、`tests/core/registry.test.ts` 全绿。
- **字面量迁移的独立校验**：一次性脚本按 `git show HEAD:<旧文件>` 提取改造前的字符串字面量片段，断言新文件**逐字包含**同一内容（doc_gen 10 段 / perception 1 段 / knowledge 2 段 / observations 8 段 / subagent 角色 7 段 / planner 5 句静态文本），全部通过后脚本已删除。

**默认行为零变化的实现方式（逐项）**

| 能力 | 开关（默认） | 关闭/未接线时行为 |
|---|---|---|
| GraphSpec（T-13） | `graph.spec.enabled=true`；注册表为空 | `composeDefaultGraph` 产出的节点/边与改造前 addNode/addEdge **逐条一致**（快照锁定）；无宿主声明时图结构零变化 |
| PromptRegistry（T-14） | `prompt.registry.enabled=true`；未注册时回退内置模板对象 | 渲染结果与迁移前逐字节一致 |
| ContextRegistry（T-15） | `context.registry.enabled=true`；无策略命中时回退内置默认策略 | 默认策略 = 迁移前 6 段内联注入的等价物（1024 组合等价矩阵锁定） |

**P2 遗留（显式记录，避免被误认为已收口）**

1. **T-14 的提示词迁移为部分交付**：计划列举的 13 处内联 prompt 中已迁移 8 处（`plan_execute.planner`、`plan_execute.planner.compact`、`subagent.research|coding|review|default`、`agent.doc_generation_task`、`agent.default_system`）；**未迁移**：`feedback/quality-monitor.ts`（LLM Judge 提示词）、`orchestration/patterns/consensus.ts:203-206`（`_JUDGE_PROMPT`，使用 `{task}`/`{candidates}` 单花括号占位符，与本轮 `{{var}}` 语法不同）、`graph/nodes.ts` 中其余零散提示片段 → 归入 P3（随场景包迁移，需先统一占位符语法）。
2. **`GraphSpec.subgraphs` 仅声明未使用**：真子图（`subgraph/builder.ts`）当前仍由 `makeSubagentNode` 内部消费，未纳入 `buildFromSpec` 的 `subgraphs` 装配路径 → 归入 P3 场景包。
3. `ObservationMemory` / `state.observation_memory` 去留仍待 D-15；`BaseLLMReasoner` 家族去留仍待 D-16（均与 P2 无关）。

#### 5.3.2 P2 复查修正（修订 6）

对 P2 代码做了一轮**独立复查**（方法：以 `git show HEAD:<改造前文件>` 为基准逐段核对；对"注册 ↔ 消费"链做覆盖语义与生命周期走查），发现并修复以下缺陷：

| # | 严重度 | 缺陷 | 修复 |
|---|---|---|---|
| 1 | **高** | `registerBuiltinPrompts()` 在每次 `create_agent` 中**无条件覆盖**同 id 模板 → 宿主"先注册 → 再 `create_agent`"的真实启动序列下，宿主 prompt 被**静默改回内置版本**，"替换 prompt 不改内核源码"实际失效 | 改为**只填补缺失**（`reg.has(id)` 时跳过）。`ComponentRegistry.registerPrompt` 仍保留"同 id 覆盖"语义（宿主显式注册即权威），二者分工明确：装配层填默认、宿主可覆盖 |
| 2 | 中 | 同类问题：`factory.ts` 中 `registerPrompt(agent.default_system)` 无条件覆盖 | 改为 `if (!getRegistry().getPrompt(id))` 才注册 |
| 3 | 中 | `registerBuiltinContextStrategies()` 每次强制 `makeDefault`，把宿主 `setDefaultContextStrategy(...)` 的结果顶回内置策略 | 仅在 `getDefaultContextStrategyId() === null` 时请求 `makeDefault` |
| 4 | 中 | `resetRegistry()` 不清 prompt 全局单例 → `afterEach(resetRegistry)` 无法清除上一用例注册的 prompt 覆盖（跨用例污染） | `resetRegistry()` 同步调用 `resetPromptRegistry()`，使"reset = 全清"成立 |
| 5 | 中 | `_getSystemPrompt` 用 `SUBAGENT_PROMPT_TEMPLATES[taskType]` 直接下标（迁移前为 `taskType in _SYSTEM_PROMPT_TEMPLATES`），`taskType` 为 `'toString'`/`'constructor'` 等原型链名时会取到**非模板值** | 改用 `Object.prototype.hasOwnProperty.call(...)`，非法名回退 `default` 角色 |
| 6 | 低 | `GraphProfile.fewShotEnabled` 声明了却未被消费（selector 仍自行读配置），画像不闭环 | agent 工厂改为 `deps.profile.fewShotEnabled ? createFewShotSelector() : null`（同一配置键，行为等价） |
| 7 | 低 | 三处边界：`tools` 工厂未兜底 `deps.tools` 缺失；`applyContextFragments` 未钳制负 `anchorIndex`（-1 会被 `splice` 解释为"从末尾倒数"）；`describeGraphSpec` 对 START/END 虚拟端点与"源/目标未启用"的静态边处理与 `buildFromSpec` 不一致 | 分别加固，并统一虚拟端点判定 |
| 8 | 低 | `buildFromSpec` 日志统计的是边**声明数**而非**实际添加数**（跳过项被计入，误导排障） | 改为实际添加计数 |

**复查确认"无问题"的疑点**（逐项排除，避免下次复查重复排查）：

- `ComponentRegistry.registerPrompt/getPrompt/renderPrompt` 与 `reasoning/prompt-registry.ts` 全局单例是**同一存储**（前者为单向委托）→ 不存在"注册到 A、消费从 B"的静默失效；
- `agentNode` **未发生双重注入**：`makeAgentNode` 仅把 `planContextInjector`/`fewShotSelector` 透传给 `ContextRuntime`，注入逻辑唯一存在于 `ctx.few_shot` / `ctx.plan_step` 片段；
- 迁移前注入顺序（perception → doc_gen → knowledge → observations → few-shot → plan）与 `_query = state.cleaned_text ?? ''`、`if (stepMsg)` 等细节已用 `git show HEAD:.../nodes.ts` **逐行核对**，与 `legacyAssemble` 复刻一致；
- `resolveGraphProfile` 读取的配置键与改造前 `buildModuGraph` **完全一致**（`tools.human_in_loop.enabled` / `orchestration.multi_agent.enabled` / `plan_execute.enabled` / `perception.clarification.enabled`；输出护栏键 `perception.security.sanitize_output.enabled` 与 P0 T-05 一致）；
- 无新增 ESM 循环依赖（`config/runtime-config.ts` 仅依赖 node 内置与 `yaml-loader`；`core/registry.ts` → `reasoning/prompt-registry.ts` 为单向）；
- `graph.ts` 中因移除 `StateGraph`/`START`/`END`/`ModuAgentStateAnnotation` 而失效的导入已清理；`nodes.ts` 中因 T-15 迁出而失效的 `extractPerceptionContext` 导入已清理（`formatDistilledAsContent`、`shouldOrchestrate` 为**改造前既已存在**的未使用导入，未在本轮改动）。

**验证**：`npx tsc -p tsconfig.build.json --noEmit` 零错误；`npx vitest run` **823 passed / 830**（较修订 5 +8 项缺陷回归测试），失败仍为已知 7 项 `better-sqlite3` 环境问题。

新增回归测试（8 项）：宿主模板/默认策略不被装配层覆盖（含全局单例与 `resetRegistry` 联动）、`_getSystemPrompt` 原型链属性名回退、负 `anchorIndex` 钳制、`describeGraphSpec` 剔除未启用端点边、内置上下文策略首次装配成为默认且重复调用无副作用。

### 5.4 P3 · 场景包落地（目标：上层可插拔）

> **修订 7 · P3 优先级优化**：本节基于 P0/P1/P2 全部落地后的**代码实况**（复核方法：`src/` 逐文件精读 + 全仓引用检索 + `git show HEAD` 基线对照）重排。相对修订 6 的 5 处结构性变动：
> 1. **新增 5 项「P3 前置任务」T-20~T-24**，把原计划隐含在 T-16/T-17/T-18 内部的三类缺口（骨架闭环 / 验收锚点 / 感知真空）显式化；
> 2. **T-17 的「约定冻结」前移到 T-16 之前**（任务拆为 T-17a / T-17b）——Loader 结构由目录约定倒推，且 D-02/D-03 是其输入；
> 3. **T-18 拆为 T-18a/b/c 三条独立验收轨道**，按「现有通路成熟度」排序（护栏 → SOP → 领域）；原 T-18④ 与 **T-19 合并**（改同一文件族，分开必二次返工）；
> 4. **修正 3 处已过期/错误描述**：`graph.ts:467` 行号错误（实为 `:580`）、`builder.ts:27-39` 角色模板已被 P2 T-14 迁走、T-18③ 的 `PolicyEngine.use` 非必需；
> 5. **校正 M4/M5 的「零内核源码改动」口径**：拆为「地基 PR（P3-0，允许改内核）」与「场景包 PR（P3-1，禁止改内核）」两段（见 §5.4.4）。

#### 5.4.1 P3 开工前复核：与计划假设的差异（逐项已核，2026-09-29）

> **注**：本节为 **P3-A 开工前**的快照（保留作为对照）。其中 #7（T-23 感知注册）、#8/#9（`subgraphs` / `extra`）、#11（L7 载体缺失）、#13（M4/M5 口径不可达）、#14（L6 载体缺失）均已由 **P3-A 落地**解决，最新状态以 **§5.4.6** 为准；#3/#4/#5/#6/#10/#12 为 **P3-B/P3-C 的输入**，仍然有效。

| # | 原计划描述 | 代码实况（已核实） | 对 P3 的影响 |
|---|---|---|---|
| 1 | `src/kernel/`、`packs/`、`ScenarioLoader` / `ScenarioHost` / `ScenarioPackManifest` / `EvalRegistry` 为「新增」 | **全仓零存在**：`src/` 顶层无 `kernel/`（仅 `tests/kernel/` 两个测试文件）；`packs/` 全仓 0 命中；4 个符号在 `*.ts` 中 0 命中 | T-16/T-17 是**从零新建**，可复用的既有资产仅 `skills/loader.ts` 的隔离范式 |
| 2 | `plugin-manifest` 已实现、零消费者 | ✅ 成立：唯一 src 侧引用为 `config/index.ts:65` re-export；另有 `tests/config/p2-enhancements.test.ts:17`；读取文件名固定为 `manifest.json`（`:115`） | **D-02 是真实阻塞项**；若选 `pack.yaml` 必须新增独立 loader（R-10） |
| 3 | T-18② 需修 `graph.ts:467` 传 `null` 的断链 | ⚠️ **行号错误 + 部分已修**：调用点在 `graph.ts:580`；`:467` 实为 `clarifyEnabled`（属 `resolveGraphProfile`）；且 `plannerLlm` **已接线**（`deps.rawLlm ?? deps.llm`），仅 `maxSubagents` / `taskTypes` 仍传 `null` | T-18b 的改动点改为 `graph.ts:580`；且 `composeDefaultGraph` 已 spec 化 → 应经 **`GraphProfile.extra` 或注册表注入**，而非回改硬编码 |
| 4 | T-18② `roles.yaml` 取代 `builder.ts:27-39` 与 `supervisor.ts:42` | ⚠️ **前半已过期**：角色字面量已由 P2 T-14 迁至 `graph/prompt-templates.ts:124-160`（`SUBAGENT_PROMPT_TEMPLATES` 4 角色）；`builder.ts:20,71-74` 仅渲染，`:59-64` **已有** `agents.<task_type>.prompt` 覆盖通路。后半成立：`supervisor.ts:42` `_DEFAULT_TASK_TYPES` 仍硬编码 | T-18b 降级为「写 YAML → `registerPrompt('subagent.<role>')` + 注入 taskTypes」，**成本显著低于原估**（收益结构变化，优先序需上调） |
| 5 | T-18③ 护栏 → `registerGuardrailRule` **+ `PolicyEngine.use`** | `GuardrailRule` 是**纯数据**（`tool-guardrails.ts:23-36`，无函数字段）；`registerGuardrailRule`（`:115`）在 src 生产侧**零调用**；`ACTION_GUARDRAILS` 5 条（`:61-108`） | YAML 化零阻力；但 **`PolicyEngine.use` 非必需**——`ToolGuardrailPolicyRule` 读取同一 `ACTION_GUARDRAILS` 数组，数据入口唯一即可；仅当场景包新增**判定逻辑**时才用 `PolicyEngine.use`。P3 中收益/成本比最高项 |
| 6 | T-19「当前固定单份」 | ⚠️ 部分成立：`loadThresholds` / `loadGates` **已支持可选 `filePath`**（`config-loader.ts:157-158,182-183`）；CLI 无 pack 参数（`cli.ts:113,126,151`）；`createMetricGroups` 无 pack 维度（`metrics.ts:243`） | T-19 为**纯增量**（加 `--pack` + 路径解析 + 指标注册点），成本低于原估 |
| 7 | §0.1 #12：感知处理器从未注册 | ✅ 成立：`registerPerception`（`core/registry.ts:201` 为定义）在 src 生产侧 **0 调用**；`new TextPreprocessor` 在 src 下 **0 处**；`pipeline.ts:86,154` 未注册即 warning + skip | 升级为 **P3 硬前置（T-23）**：否则输入护栏与 P0 T-04 的审计发布点在默认运行时不可达，T-18a/T-18c 的端到端验收只能得出「装了但不生效」的伪结论 |
| 8 | `GraphSpec.subgraphs` 已提供 | ⚠️ **仅声明未消费**：字段定义 `spec.ts:139-140`，`buildFromSpec`（`:209-303`）**零引用**；真子图 `compile()` 在 `subgraph/builder.ts:207` | `sop/graph.yaml` 是**空承诺** → 需 T-20 先闭环，否则 T-18b 的子图部分无法交付 |
| 9 | `GraphProfile.extra` 保留位（供 P3 使用） | ⚠️ 已声明（`spec.ts:65-66`）但 `resolveGraphProfile`（`graph.ts:425-474`）与 `composeDefaultGraph`（`:488`）**均未写入/消费** | SOP 包注入「启用新节点」的通路缺失 → T-20 一并闭环 |
| 10 | T-14 残余 5 处提示词（随场景包迁移，需统一占位符语法） | ✅ 成立且**语法不一致**：`quality-monitor.ts:50` `_JUDGE_SYSTEM_PROMPT` **无花括号占位符**（`:334-337` 模板串拼接）；`consensus.ts:203-206` `_JUDGE_PROMPT` 用**单花括号** `{task}` / `{candidates}`（`:237-239` `.replace`） | `prompts/*.md` 的占位符语法须**先统一**（T-21），否则场景包作者踩坑（R-02 类回归） |
| 11 | G-2「已声明未消费 = 0」有自动化载体（L7 blocking） | ❌ **不成立**：仅有反方向的 `UNDECLARED_CONSUMED_KEYS`（`capability-registry.ts:347`，当前 `[]`）；无「已声明未消费」检查函数（现仅 `listCapabilities:352` / `listEnabledKeys:361` / `capabilityStatus:375`）；该文件头 `:11-12` 自述本应支持**两个方向** | L7/M2 的 blocking 断言**当前无载体**；T-16 新增 `scenario.enabled` 后更需先补（T-22） |
| 12 | §4.2 `ScenarioHost.applyConfigProfile` 落到 `configurable.profiles.<task_type>` | ❌ **该配置段不存在**：全仓无 `profiles` 配置段（`profiles` 命中仅为 `termination-engine.ts` 的 `SCENE_PROFILES`，语义无关）；`configurable` 是 per-request `RunnableConfig` 字段（`runner.ts:282-295`） | **契约须修正**：明确「`RuntimeConfig` 新增 `scenario.profiles.<task_type>`（持久）」或「per-request `configurable`（易失）」——两者语义不同，不可混称 |
| 13 | M4/M5「`git diff --name-only src/ == 0`」 | ⚠️ 当前**不可达**：`scenario.enabled` 须写入 `DEFAULT_CONFIG` + `CAPABILITY_REGISTRY`；`create_agent` 须新增装配一行；`GraphProfile.extra` / `subgraphs` 的消费点须改 `graph.ts` / `spec.ts` | 必须**分段**（见 §5.4.4），否则 P3 验收自始失败 |
| 14 | `tests/architecture/layer-boundaries.test.ts`（L6）为 M4 交付物 | ❌ 不存在：`tests/` 14 个子目录无 `architecture/`（共 66 个测试文件） | L6 需新建；建议**提前到 P3 首个任务**作为架构护栏（成本最低、收益最大） |

**另需在 T-16 落地时补齐的契约缺口**：§4.2 的 `ScenarioHost.eval?: EvalRegistry` 引用了**未定义类型** `EvalRegistry`（全仓 0 命中）→ 须在 `src/kernel/types.ts` 中定义或改为 `unknown` + 运行时校验。

#### 5.4.2 优化后的 P3 任务表（按执行顺序）

**P3-A · 地基与锚点（P3-0，允许改内核；5 项互不依赖，可 2~3 人并行）**

| # | ID | 任务 | 依赖 | 成本 | 收益 | 风险 | 落点（已核实） |
|---|---|---|---|---|---|---|---|
| A1 | **T-22** | 「已声明未消费」配置检查（补 L7/M2 的自动化载体） | 无 | 低 | 中高 | 低 | `config/capability-registry.ts` 新增检查函数 + 扩展 `tests/config/p5-env-capability.test.ts` |
| A2 | **T-24** | `tests/architecture/layer-boundaries.test.ts`（B-1~B-5 + 无 ESM 环） | 无 | 低 | 中 | 低 | 新建 `tests/architecture/`；参照 `spec.ts:18-19` 的「值依赖 / 类型依赖」判定范式 |
| A3 | **T-20** | **骨架闭环**：`GraphSpec.subgraphs` 消费 + `GraphProfile.extra` 落地 | 无 | 中 | **高** | 中 | `graph/spec.ts:139-140,209-303`（消费 subgraphs）、`graph.ts:425-474,488`（extra 读写）、`core/registry.ts` 复用 `registerNode/registerEdge`（`:504,516`） |
| A4 | **T-21** | 提示词占位符语法统一 + T-14 残余站点迁移 | 无 | 低中 | 中 | 中（R-02 字符等价） | `feedback/quality-monitor.ts:50,334-337`、`orchestration/patterns/consensus.ts:203-206,237-239`；对齐 `graph/prompt-templates.ts` 的 `{{var}}` 语法 |
| A5 | **T-23** | **感知处理器注册**（§0.1 #12，独立 PR + 独立验收） | 无 | 中 | **高** | 中高（改默认运行行为） | `core/registry.ts:201`（唯一非测试调用点缺失）；`perception/text/rule-based.ts` 的 `TextPreprocessor` 构造；门控建议沿用 `perception.security.enable_guard` |

**P3-B · 装配层（P3-0 尾段）**

| # | ID | 任务 | 依赖 | 成本 | 收益 | 风险 | 落点 |
|---|---|---|---|---|---|---|---|
| B1 | **T-17a** | `packs/` 目录约定 + manifest 格式**冻结**（含 D-02/D-03/D-04/D-11 决策） | 无（仅需 D-02/D-03 决策，可与 P3-A 并行） | 低 | 高 | 低 | 产出「目录/文件名/格式」规格文档；`plugin-manifest.ts:112-121` 现状为 `manifest.json` |
| B2 | **T-16** | `src/kernel/{types,scenario-loader}.ts` + `scenario.enabled` 门控 + `create_agent` 单点装配 | B1, A3 | 中 | **极高** | 中 | `factory.ts` 装配序列插入点（现有：`boot_observability` `:503` → provider `:530` → prompts `:544` → context `:551` → memory `:666` → domains `:747` → policy `:807`）；隔离范式 `skills/loader.ts:79-96,137-144` |
| B3 | **T-17b** | 首个**真实业务**场景包骨架（D-04 定业务；建议以 `apps/` 子项目驱动，而非自造示例包） | B2 | 中 | 高 | 低 | 新建 `packs/<name>/`；`apps/` 现有 `backend` / `backend-ts` / `desktop` / `marketing` / `mobile` / `web` 六个候选 |

**P3-C · 四类上层迁移（P3-1，禁止改内核）**

| # | ID | 任务 | 依赖 | 成本 | 收益 | 风险 | 落点与关键约束 |
|---|---|---|---|---|---|---|---|
| C1 | **T-18a** | 护栏 → `guardrails/rules.yaml` → `registerGuardrailRule` | B2 | 低 | **中高** | 低 | 规则从 `tool-guardrails.ts:61-108` 迁出；数据结构 `:23-36` 天然可 YAML 化；**数据入口唯一**（无需 `PolicyEngine.use`） |
| C2 | **T-18b** | SOP → `sop/{roles,graph}.yaml` → `registerPrompt('subagent.<role>')` + taskTypes 注入 + 子图 | B2, A3 | 中 | 高 | 中 | 角色模板落 `prompt-templates.ts:124-160`（替换点 `builder.ts:59-64,71-74`）；taskTypes 断链在 `graph.ts:580`；子图需 A3 |
| C3 | **T-18c** | 领域 → `domain/*.md` → `registerDomainsFromMarkdown` | B2 | 低 | 中 | 低 | 装配已接线（`factory.ts:747`），默认扫描 `getPackageRoot()/config/domains`（`markdown-loader.ts:284-285`）；受 `react_optimization.prompt_composer.enabled`（默认 false）门控 |
| C4 | **T-19** | 评估口径按 pack 加载（**吸收原 T-18④**） | B2 | 低 | 中 | 中（R-08） | `evals/src/config-loader.ts:157-183`（已有 `filePath` 覆盖）、`cli.ts:113,126,151`（加 `--pack`）、`metrics.ts:243`（指标注册点）；**全局默认优先，pack 仅覆盖** |

**P3-D · 验收**：M5 纵向 / 横向 / 降级 / 回归（见 §5.4.5）。

#### 5.4.3 顺序理由（关键重排的依据）

1. **T-17a 先于 T-16（依赖倒置）**：Loader 的每个 `loadXxx(packDir, host)` 都由目录名、文件名与格式决定，且 **D-02（manifest 格式）/ D-03（packs 位置）是 Loader 的输入**；不先冻结则必返工（R-10 的触发条件即此）。
2. **T-22 / T-24 排最前（验收锚点优先）**：二者是 L7 / L6 的**自动化载体**，当前**一件都不存在**；在开始新增 `src/kernel/` 与 `packs/` 之前建立「配置无悬挂 + 层边界」检查，可避免「边写边违规」并让 P3 全程可判定。
3. **T-20 必须先于 T-18b（骨架闭环）**：`sop/graph.yaml` 若声明自定义节点/子图，依赖 `subgraphs` 消费与 `extra` 通路——两者当前**均未消费**。不先闭环，T-18b 只能交付「角色 + taskTypes」，`graph.yaml` 会变成空承诺。
4. **T-23 是硬前置（消除伪验收）**：感知管线为空 ⇒ 输入侧能力（`injection_detected` / `pii_detected`、`block_on_*` 路由阻断）在默认运行时不触发。若不同步修复，T-18a（护栏）与 T-18c（领域）的端到端验收将得出「护栏已装但不生效」的**伪结论**。因其改变默认运行行为，须**独立 PR + 独立验收**（并沿用 P1 D-18 的「执行方唯一」约束）。
5. **T-18a（护栏）排第一（通路成熟度最高）**：`GuardrailRule` 为纯数据可直接 YAML 化；`registerGuardrailRule` 已存在、仅缺调用方；P1 的 `PolicyEngine`/`ToolGuardrailPolicyRule` 已就绪 → **成本最低、收益同比最高**，适合作 P3-1 的首个验收样板。
6. **T-18c（领域）排末位**：装配器已接线（`factory.ts:747`），只差目录 + 开关；但被 `prompt_composer.enabled` 默认 false 限制，收益需宿主显式开启——因此不宜占用首个样板位。
7. **T-19 吸收原 T-18④**：两者改**同一文件同一函数族**（`config-loader.ts:157-183`），分开实施必二次返工；且「全局默认优先、pack 覆盖 opt-in」（R-08）是同一设计决策，应一次定稿。

#### 5.4.4 验收口径校正（D-11 分段适用）

| 阶段 | 允许改动 `src/` | 断言 |
|---|---|---|
| **P3-0 · 地基**（T-22/T-24/T-20/T-21/T-23/T-17a/T-16/T-17b） | **允许**（一次性 PR 集，逐任务独立提交以支持细粒度回滚） | ① `npx tsc -p tsconfig.build.json --noEmit` 零错误；② 全量 `vitest run` 不回退（基线 823/830，唯一 7 项为已知 `better-sqlite3` 环境问题）；③ **L6**（层边界 B-1~B-5 + 无环）与 **L7**（`UNDECLARED_CONSUMED_KEYS === []` 且「已声明未消费 = 0」）新断言通过；④ `scenario.enabled=false`（默认）时 `create_agent` 行为与 P2 逐字段一致 |
| **P3-1 · 场景包**（T-18a/b/c/T-19） | **禁止**（`git diff --name-only -- src/` 必须为空） | ① **纵向**：新增场景包零内核改动；② **横向**：换 provider / 记忆后端，`git diff --name-only -- packs/` 为空；③ 降级：坏 YAML → 启动成功 + 告警（逐能力隔离）；④ 回归：`react-news-e2e` / `hitl-e2e` / `hitl-interrupt-payload` / `clarify-node` / `graph-spec-equivalence` 全绿 |

> **修正说明**：原 M4/M5 将 `git diff --name-only src/ == 0` 作为**全程**门禁（口径 ①），但 P3-0 的 8 项地基任务必然新增配置键、装配调用与 `GraphProfile`/`subgraphs` 消费点 → 该断言在 P3-0 期间**恒失败**。故拆为两段：P3-0 用「改动清单受控 + 新增文件白名单」核验，P3-1 才启用最严的 `src/` 零 diff 断言。

#### 5.4.5 P3 验收（双向解耦验证，修订版）

- **纵向**：以 **D-04 选定的真实业务**（建议取自 `apps/` 六个子项目之一）为场景包；P3-1 期间 `git diff --name-only -- src/` 为空；
- **横向**：替换一个底座实现（换 LLM provider / 换记忆后端），`git diff --name-only -- packs/` 为空；
- **降级**：故意投放损坏 YAML → 启动成功 + 告警（复用 `skills/loader.ts:79-96,137-144` 的逐项隔离）；
- **门禁**：L1 类型 + L6 层边界 + L7 配置无悬挂 + 全量回归（关键子集 `tests/graph tests/perception tests/tools tests/reasoning tests/config` 必须全绿）。
- **补充（P3-A 落地后）**：T-18a/T-18c 的**输入侧端到端证据**须显式开启 `perception.builtin_processors.enabled=true`（见 §5.4.6 ⑤），否则感知管线为空，验收会得出"护栏已装但不生效"的伪结论（§5.4.3 第 4 条）。

#### 5.4.6 P3-A 实施结果（修订 8，已完成）

**按 §5.4.2 的 P3-A 顺序完成 T-22 → T-24 → T-20 → T-21 → T-23，全部为"新增 + 默认等价"，默认路径行为零变化。**

**新增文件**

| 文件 | 任务 | 作用 |
|---|---|---|
| `tests/config/config-consumption-audit.test.ts` | T-22 | L7 载体：扫描 `src/` 配置键字面量 ⇄ `DEFAULT_CONFIG`，断言 ①②③④⑤（含声明面自引用防护） |
| `tests/architecture/layer-boundaries.test.ts` | T-24 | L6 载体：B-0（无 ESM 值依赖环）+ B-1~B-6（层边界），含"仅值依赖计入、`import type` 不计"的口径 |
| `tests/graph/graph-spec-subgraphs.test.ts` | T-20 | `subgraphs` 装配/隔离/回滚 + `extra` 读取/优先级/`profileFlag` 端到端 |
| `src/perception/builtin-processors.ts` | T-23 | `registerBuiltinPerceptionProcessors`（默认关闭 + 不覆盖宿主注册 + 逐项隔离） |

**改动文件（关键点）**

| 文件 | 改动 |
|---|---|
| `src/config/capability-registry.ts` | 新增 `DECLARED_UNCONSUMED_KEYS`（悬挂键基线，**11 项 → 10 项**）、`flattenConfigKeys`、`auditConfigConsumption`（六字段审计结果）；新增 `perception_builtin_processors` 能力条目 |
| `src/config/runtime-config.ts` | **删除** 2 个零消费键（`llm.max_format_retries`、`event_bus.max_log_size`，带 D-06 说明注释）；**新增** `perception.builtin_processors.enabled`（默认 false）、`graph.spec.extra`（默认 `{}`） |
| `src/perception/pipeline.ts` | `_resolvePipeline` 兜底感知器改读 `perception.default_processor`（接线，默认值不变 → 字符等价） |
| `src/graph/spec.ts` | 新增 `SubgraphSpec` 类型与 `profileFlag()`；`buildFromSpec` **消费 `spec.subgraphs`**（挂载/冲突跳过/异常隔离）；`describeGraphSpec` 计入挂载点 |
| `src/graph/graph.ts` | `resolveGraphProfile` 新增 `extra`（参数优先 → 否则读 `graph.spec.extra`，非法值降级 `{}`） |
| `src/core/registry.ts` | 新增 `registerSubgraph` / `listSubgraphs`；`clearGraphSpecs()` 一并清空 |
| `src/graph/prompt-templates.ts` | 新增 3 个模板：`feedback.quality_judge_system` / `feedback.quality_judge_user` / `orchestration.consensus_judge`（占位符由单花括号统一为 `{{var}}`） |
| `src/feedback/quality-monitor.ts` | Judge system/user 提示词改经 `renderPromptWithFallback` 渲染（`_JUDGE_SYSTEM_PROMPT` 保留为模板派生视图） |
| `src/orchestration/patterns/consensus.ts` | `_JUDGE_PROMPT` 改为模板派生 + 经注册表渲染 |
| `src/graph/factory.ts` | 新增 T-23 装配调用（门控 `perception.builtin_processors.enabled`） |
| `src/graph/index.ts`、`src/perception/index.ts` | 导出新增契约与实现 |

**验证结果（修订 9 实测，含复查修正）**

```bash
cd packages/modu-agent
npx tsc -p tsconfig.build.json --noEmit     # ✅ 零错误
npx vitest run                               # ✅ 884 passed / 891
```

- 唯一 7 项失败仍为 `tests/tools/sql-query.test.ts` 的 `better-sqlite3` 原生绑定缺失（R-12 / D-14）；修订 6 基线 823/830 → 修订 8 880/887 → 修订 9 **884/891**（+61 项新增测试，其中 +4 项为修订 9 复查回归测试），失败数**不变**。
- **P0/P1/P2 成果未回退**：`tests/kernel/{p0,p1}-wiring.test.ts`、`graph-spec-equivalence`、`prompt-registry`、`policy-hitl-equivalence`、`hitl-*`、`react-news-e2e` 全绿。

**T-22 实证产出（重要发现，均为"零消费"确认）**

| 处置 | 键 | 依据 |
|---|---|---|
| **接线**（1 项） | `perception.default_processor` | `pipeline.ts:_resolvePipeline` 硬编码 `'text_preprocessor'` 与默认值重合，故长期未被发现 |
| **接线**（1 项） | `perception.max_length` | `builtin-processors.ts` 作为 `TextPreprocessor.maxLength`（T-23） |
| **删除**（2 项） | `llm.max_format_retries`、`event_bus.max_log_size` | 零消费（前者已被原生 function calling 取代；后者无内存事件环形缓冲实现），按 D-06「接线或删除」 |
| **登记基线**（10 项） | `perception.deep_parsing.*`(6) / `perception.event_log_*`(2) / `perception.enable_context_reduction` / `plan_execute.compact_completed_steps` | 均为**未实现能力**的配置面；其中 `plan_execute.compact_completed_steps` 此前被注册表 `configKeys` **错误声称已消费**，由审计的"注册表方向"交叉校验发现 |

**两处口径修正（实现中发现，已固化进测试）**

1. **审计必须排除声明面文件自身**：`src/config/capability-registry.ts` 的 `configKeys` 与基线常量是"声明"而非"消费"。不排除时 11 个悬挂键**全部被自身声明"消费"掉** → 门禁失效（自引用假阴性）。测试以 `DECLARED_SITE` 常量显式排除并断言扫描面不含该文件。
2. **消费判定要求前缀"含点"**：`consumedKeys` 中的裸前缀（如 `'llm'` / `'tools'`）**不得**覆盖整棵子树，否则 131 个叶子键仅剩 1 个"未消费"，掩盖真实悬挂。实测：放宽后仅检出 `event_bus.max_log_size`；收紧后检出 13 项。

**P3-A 遗留（显式记录）**

1. **T-23 默认关闭**：`perception.builtin_processors.enabled=false` 时行为与改造前完全一致（`perception_result` 仍为 null）。开启会改变默认运行行为（`perception_result` 非 null、`cleaned_text` 可能被截断），故属宿主/场景包**显式 opt-in**；P3-C 的输入侧端到端验收须显式开启。
2. **`LLMParser` 未注册**：语义型处理器（intent/entities/sentiment/quality）依赖 `LLMAdapter` 注入且**每轮产生 LLM 调用成本** → `perception.deep_parsing.*`(6 项) 留在基线，待单独决策。
3. **`perception.event_log_*` / `enable_context_reduction` / `plan_execute.compact_completed_steps`**：无对应实现模块，需"接线或删除"单独决策（不属 P3-A 范围）。
4. **B-3 / B-4 仍为真空成立**：`src/kernel/` 与 `packs/` 尚不存在，两规则在 P3-B 落地后自动转为实检。

#### 5.4.7 P3-A 复查修正（修订 9）

对 P3-A 全部落地代码做**独立复查**（方法：逐文件重读 + 用修正后的检测重算基线 + 对"漏检/误报"两类失效做反向验证），发现 **3 处缺陷并已修复**；其余项经核查**无缺陷**（见下方"核查通过项"）。

| # | 严重度 | 缺陷 | 证据 | 修复 |
|---|---|---|---|---|
| 1 | **高** | **T-24 扫描器漏检跨行 import → B-0「无环」为假阴性**。初版正则用 `[^'\n]`（禁换行），而 `src/` 有 **393 条跨行 import 语句**、37 个文件的依赖被**整体漏判**（含 `graph.ts→spec.ts`、`nodes.ts→perception/pipeline.js`、`policy-rules.ts→tools/tool-guardrails.js`）。漏检下 B-0 报"0 环"并不成立（连 `core/registry.ts ↔ graph/spec.ts` 这条真实类型环都未被计出） | 实测：现行正则命中 439 条 vs 容错正则 534 条；漏判文件 37 个 | 正则限定符改为 **`[^'";]`**（允许换行、不跨分号/引号）；新增 2 项**扫描器自检**测试：① 断言跨行 import 产生的两条边存在 + 边总数 > 300；② 断言无自环 |
| 2 | 中 | **T-24 注释中的 import 产生误报（自环）**：`orchestration/communication/event-bus-adapter.ts:119` 的 JSDoc 示例含 `import { EventBusBackend } from './event-bus-adapter.js'`（**自引用**）。缺陷 1 修复后若不处理，会立刻产生 `X→X` 自环、B-0 假红 | `event-bus-adapter.ts:117-120` | 扫描前**剥离块注释与行注释**（`stripComments`，`[^:'"`\\]` 前缀跳过 URL 的 `//`）；自检②回归锁定 |
| 3 | 中 | **T-20 `subgraphs.parentNode` 未防虚拟端点**：`parentNode` 为 `START` / `END` / `__start__` / `__end__` 时会执行 `addNode(START, built)`，破坏图拓扑（且 `describeGraphSpec` 会把虚拟端点计入快照，与 `buildFromSpec` 口径分裂） | `spec.ts` 挂载循环（修订 8 无任何守卫） | 引入 `_isVirtualEndpoint()`，`buildFromSpec` 与 `describeGraphSpec` **同口径跳过**并告警；新增 2 项测试（虚拟端点跳过 + 同一 parentNode 仅首个生效） |

**另修正 1 处代码卫生问题（非功能缺陷）**：`consensus.ts` 的 `private static readonly _JUDGE_PROMPT` 在 T-21 迁移后**已无引用**，且注释声称"兼容视图"不成立（`private` 无对外兼容价值）→ 已删除，避免形成提示词"第二来源"；`QualityMonitor._JUDGE_SYSTEM_PROMPT` 为 `public`（保留），但其注释已明确"反映内置模板、**不**反映宿主注册表覆盖"。

**核查通过（无缺陷）的关键项**

| 项 | 核查结论 |
|---|---|
| T-22 删除键的副作用 | `llm.max_format_retries` / `event_bus.max_log_size` 在 `src/` **零残留消费**（仅注释与测试哨兵引用）；`config/schemas.ts` 未声明二者且未使用 `.strict()` → 宿主既有配置不会触发校验失败 ✅ |
| T-22 审计口径 | 声明面排除（`capability-registry.ts`）、前缀"含点"、注册表方向交叉校验（`registryKeysNotDeclared` 检出 `plan_execute.compact_completed_steps` 被错误声称已消费）均经验证有效 ✅ |
| T-20 挂载时序 | 挂载点在边处理**之前**写入 `enabledNodeNames`，且 `has` 为闭包 → 后续边可引用子图挂载点 ✅ |
| T-20 扩展门控一致性 | `spec.subgraphs` 不经 `graph.spec.enabled` 门控（与 `spec.nodes/edges` 一致），仅 `registry.registerSubgraph` 受门控（与 `registerNode/registerEdge` 一致）✅ |
| T-21 字符等价 | 三条 golden 逐字节断言 + 两个消费者端到端断言（`QualityMonitor.evaluateAsync` / `LLMJudgeStrategy.aggregate`）全绿；末行 JSON 示例为单花括号、不受 `{{var}}` 渲染影响 ✅ |
| T-23 默认行为 | 门控默认 false，且开启后的行为变化（`perception_result` 非 null）已由测试断言"未注册时管线返回 null"对照锁定 ✅ |

**T-21 一处**刻意保留的**行为差异**（已确认可接受，记录备查）：迁移前 `consensus.ts` 用 `String.replace('{task}', ...)`，替换串中的 `$&` / `$\`` / `$1` 等会被**特殊展开**；迁移后由 `renderTemplateContent` 的回调插入，为**字面量插入**。后者语义更正确（变量值不应被当作替换模式），仅在变量含 `$` 特殊序列时与旧行为不同。

**修订 9 验证**：`npx tsc --noEmit` 零错误；`npx vitest run` **884/891**（较修订 8 +4 项复查回归测试），失败仍为已知 7 项 `better-sqlite3` 环境问题；修正后 B-0 在**完整** 339 条值依赖边下仍报 0 环，B-1~B-6 全部 0 违规（此前是漏检下的 0 违规）。

### 5.5 优先级总表与依赖链

| 优先级 | 任务 | 层 | 依赖 | 成本 | 收益 | 状态 |
|---|---|---|---|---|---|---|
| **P0** | T-01 观测 boot | 观测 | 无 | 低 | 高 | ✅ 已完成 |
| **P0** | T-03 审计落盘 | 权限 | 无 | 低 | 中 | ✅ 已完成 |
| **P0** | T-05 输出护栏 | 权限 | 无 | 低 | 中 | ✅ 已完成 |
| **P0** | T-06 能力矩阵 + 死配置 | 工具/全局 | 无 | 低 | 中高 | ⚠️ 部分（能力矩阵✅、5 观测键✅；剩余 3 处悬挂键转 T-10b ④） |
| **P0** | T-07 领域装配器 | 领域 | 无 | 低 | 高 | ✅ 已完成 |
| **P0** | T-02 观测埋点 | 观测 | 无 | 低 | 中 | ✅ 已完成 |
| **P0** | T-04 审计事件补齐 | 权限 | 无 | 低 | 中 | ✅ 已完成（12/12 有发布者） |
| **P0** | T-09 护栏判定收口（纯函数） | 护栏 | 无 | 低 | 中 | ✅ 已完成 |
| **P0** | **T-08 模型路由接入** | 路由 | `state.task_type`（已存在） | 中 | **高** | ✅ 已完成（已核实生效） |
| **P1** | **T-12 `LLMProviderFactory`**（P1 首项） | 路由 | T-08 ✅ 已完成 | 中 | 中 | 低风险，依赖已就绪，作"横向可替换"样板 |
| **P1** | T-11 `MemoryStrategy`（主链路优先） | 记忆 | T-06 ✅ | 中 | 中 | 与其他两项无依赖，可并行 |
| **P1** | T-10 `PolicyEngine`（骨架+工具审批） | 权限 | T-04 ✅,T-05 ✅,T-09 ✅ | 中 | **高** | 唯一无抽象接口的底座；主线，独立 PR |
| **P1** | T-10b 输入/输出护栏规则化 + P0 遗留清零 | 权限 | T-10 | 低 | 中高 | 清 3 处"声明未消费"键 + 12/12 审计发布者回归锁定 |
| **P1** | ~~T-10c HITL 拓扑声明化~~ | 编排 | — | — | — | **移出 P1**，并入 T-13（依赖 `GraphProfile`） |
| **P2** | T-13 `GraphSpec`（含 T-10c） | 编排 | T-10 ✅ | 高 | **高** | ✅ 已完成（修订 5，见 §5.3.1） |
| **P2** | T-14 `PromptRegistry` | Prompt | 无（可先行） | 中 | 高 | ⚠️ 部分（8/13 处提示词已迁移，见 §5.3.1 遗留 1） |
| **P2** | T-15 `ContextRegistry` | 上下文 | 无（可先行） | 中 | 高 | ✅ 已完成（修订 5，见 §5.3.1） |
| **P3-A** | **T-22** 配置「已声明未消费」检查（补 L7 载体） | 装配 | 无 | 低 | 中高 | ✅ 已完成（修订 8，见 §5.4.6；基线 13→10 项，含 2 删除 + 2 接线） |
| **P3-A** | **T-24** `tests/architecture/` 层边界测试（补 L6 载体） | 装配 | 无 | 低 | 中 | ✅ 已完成（修订 8；B-0 + B-1~B-6，9 项） |
| **P3-A** | **T-20** `subgraphs` 消费 + `GraphProfile.extra` 落地 | 编排 | 无 | 中 | **高** | ✅ 已完成（修订 8；15 项，SOP 包前置已解除） |
| **P3-A** | **T-21** 占位符语法统一 + T-14 残余提示词迁移 | Prompt | 无 | 低中 | 中 | ✅ 已完成（修订 8；T-14 残余 3 站点全部迁入，内置模板 7→10） |
| **P3-A** | **T-23** 感知处理器注册（§0.1 #12） | 感知 | 无 | 中 | **高** | ✅ 已完成（修订 8；默认关闭 + 门控 `perception.builtin_processors.enabled`；`LLMParser` 未纳入） |
| **P3-B** | T-17a `packs/` 约定与 manifest 格式**冻结** | 场景包 | 无 | 低 | 高 | 待开工（修订 7：前移至 T-16 之前） |
| **P3-B** | T-16 `ScenarioLoader` + manifest 消费 | 装配 | T-17a,T-20 | 中 | **极高** | 待开工 |
| **P3-B** | T-17b 首个**真实业务**场景包骨架 | 场景包 | T-16 | 中 | 高 | 待开工（修订 7：由 `apps/` 驱动） |
| **P3-C** | T-18a 护栏 → `guardrails/rules.yaml` | 场景包 | T-16 | 低 | 中高 | 待开工（P3-1 首个样板） |
| **P3-C** | T-18b SOP → `sop/{roles,graph}.yaml` | 场景包 | T-16,T-20 | 中 | 高 | 待开工 |
| **P3-C** | T-18c 领域 → `domain/*.md` | 场景包 | T-16 | 低 | 中 | 待开工 |
| **P3-C** | T-19 口径按 pack 加载（**吸收原 T-18④**） | 评估 | T-16 | 低 | 中 | 待开工（修订 7：与原 T-18④ 合并） |
| **P3-D** | M5 双向解耦验收（纵向 / 横向 / 降级 / 回归） | 验收 | P3-C 全部 | 低 | 高 | 待开工 |

> **P3 优先级的 5 项调整（修订 7 摘要，理由见 §5.4.3）**：① 新增 **P3-A 地基组（T-20~T-24）**，先闭环骨架与验收锚点；② **T-17a 前移**到 T-16 之前（依赖倒置）；③ **T-18 拆为 a/b/c 三轨道**并按通路成熟度排序（护栏 → SOP → 领域）；④ **T-19 合并原 T-18④**（同文件族一次定稿）；⑤ **M4/M5 的 `src/` 零 diff 口径分段**（P3-0 允许改内核 / P3-1 禁止），详见 §5.4.4。

**并行机会（修正）**：P0 的 9 项互不依赖（已完成）；**P1 的 T-12 与 T-11 无依赖，可双人并行；T-10 是主线需单独立 PR，T-10b 紧随 T-10 骨架后**；P2 的 T-14 / T-15 可在 T-13 前先做接口；**P3-A 的 T-20/T-21/T-22/T-24 四项互不依赖可并行（T-23 因改默认行为需独占 PR 串行验收）**。

**P1 排序理由（相对初稿的变化）**：初稿将 T-10 列为首位，但复核发现 ① T-10 的"最高风险项"（HITL 拓扑声明化）依赖 P2 的 `GraphProfile`，属跨阶段依赖；② T-12 的依赖 T-08 已完整落地且不触碰安全语义；③ T-11 需先决定主链路路径（原表述会让实现者去改死代码 `ObservationMemory`）。故调整为 **T-12（低风险样板）→ T-11（并行）→ T-10（主线）→ T-10b（清遗留）**。

---

## 6. 可交付成果与验收标准（按里程碑）

| 里程碑 | 交付成果 | 验收标准（可执行） |
|---|---|---|
| **M1 · 通电**（P0） | ① `src/observability/boot.ts`；② 5 个死配置键的处置结果（接线/删除）；③ 审计落盘产物 + 12 类事件发布者清单；④ 输出护栏生效；⑤ 能力矩阵自动同步；⑥ 领域装配器接线；⑦ 模型路由在 `create_agent` 生效 | ✅ **已交付**（T-01/02/03/04/05/07/08/09 完成，12/12 审计发布者达成；**唯 T-06 部分完成**：能力矩阵 + 5 观测键已交付，但剩余 3 处"声明未消费"键转 P1 T-10b ④，故 M1 的"已声明未消费 = 0"断言**顺延至 M2**） |
| **M2 · 底座收口**（P1）—— ✅ **已交付（修订 3，实测见 §5.2.6：tsc 零错误 / 755 passed of 762，唯一 7 项为已知 better-sqlite3 环境问题）** | ① T-12 `LLMProviderFactory`（**首项**）；② T-11 `MemoryStrategy`（**主链路 `BaseStore` 优先**）；③ T-10 `PolicyEngine` 骨架 + `ToolApprovalPolicyRule`；④ T-10b 输入/输出护栏规则化 + **P0 遗留清零**（3 处悬挂配置键；12/12 审计发布者仅作回归锁定）；⑤ `tests/reasoning/llm-provider.test.ts`、`tests/core/policy-engine.test.ts`、`tests/graph/policy-hitl-equivalence.test.ts`、`tests/memory/base-store-strategy.test.ts` | ① 三个注册方法在 `ComponentRegistry` 可用**且被主链路消费**（`factory.ts:519,342`、`graph.ts:437`、`nodes.ts:1934`）；② **横向替换 ×3**：换 provider / 换记忆策略 / 换权限规则集，`git diff --name-only -- src/graph/nodes.ts src/graph/graph.ts` 为 0；③ **四组合等价矩阵**通过（`action_guardrails.enabled` × `policy.engine.enabled`，`decideToolApprovals` 与 `PolicyEngine.decide('tool')` 逐字段一致）；④ `UNDECLARED_CONSUMED_KEYS === []` **且**"已声明未消费" = 0；⑤ `tests/graph/hitl-e2e.test.ts`、`tests/graph/hitl-interrupt-payload.test.ts`、`tests/tools/tool-guardrails.test.ts` 全绿；⑥ `tests/kernel/p0-wiring.test.ts` 全绿（**P0 成果不回退**）；⑦ `npx tsc -p tsconfig.build.json --noEmit` 零错误 |
| **M3 · 可注册**（P2）—— ✅ **已交付（修订 5，实测见 §5.3.1：tsc 零错误 / 815 passed of 822，唯一 7 项为已知 better-sqlite3 环境问题；T-14 为部分交付 8/13 处提示词）** | ① `src/graph/spec.ts` + `composeDefaultGraph` + `buildFromSpec`；② `PromptRegistry`；③ `ContextRegistry` + `ContextBuilder` | ① `composeDefaultGraph(profile)` 与改造前 `buildModuGraph` 产出**图拓扑快照逐节点等价**（`tests/graph/graph-spec-equivalence.test.ts` 5 组画像快照，节点/边逐条对照）；② prompt 字符等价测试全绿（**逐文件迁移，当前 8/13**，见 §5.3.1 遗留 1）；③ 新增节点/prompt/上下文策略的测试**不修改 `graph.ts`/`nodes.ts`**（三处扩展点均已由测试证明：`registerNode/registerEdge`、`registerPrompt`、`registerContextStrategy`）；④ 存量会话兼容：P2 **未新增任何 state 字段** → `STATE_SCHEMA_VERSION` 保持 `1`，无需 `migrate_state` 变更（P3 若新增字段再按 D-13 处理） |
| **M4 · 场景包闭环**（P3） | ① **P3-A 地基**：`tests/architecture/layer-boundaries.test.ts`（T-24）、「已声明未消费」检查（T-22）、`subgraphs`/`extra` 消费（T-20）、占位符统一（T-21）、感知处理器注册（T-23）；② `src/kernel/{types,scenario-loader}.ts`（T-16）+ `packs/` 约定（T-17a）；③ `packs/<首个真实场景包>/` 全目录（T-17b）；④ `evals` 按 pack 加载（T-19） | ① **P3-0 期间**：`tsc` 零错误 + 全量回归不回退 + L6/L7 新断言通过 + `scenario.enabled=false` 行为等价（**允许改内核，用改动清单受控核验**）；② **P3-1 期间**：新增场景包**零内核源码改动**（`git diff --name-only -- src/` 为空，按 §5.4.4 分段口径核验）；③ 场景包加载失败的降级测试（故意放坏 YAML → 启动成功 + 告警）；④ `tests/architecture/layer-boundaries.test.ts` 通过（B-1~B-5 规则 + 无 ESM 环） |
| **M5 · 双向解耦验证**（贯穿 M4） | ① 纵向验收报告；② 横向验收报告；③ 回归基线报告 | ① **纵向**：`packs/` 新增一个**真实业务**场景包（D-04 选定，建议取自 `apps/`），P3-1 期间 `git diff --name-only -- src/` 为 0；② **横向**：替换底座实现（provider/记忆后端），`git diff --name-only -- packs/` 为 0；③ 两向验收后全量测试仍全绿 |

**回归基线（每个里程碑执行，作为门禁）**：
```bash
cd packages/modu-agent
npx tsc -p tsconfig.build.json --noEmit
npx vitest run
# 关键子集（必须全绿，作为行为等价证据）
npx vitest run tests/graph tests/perception tests/tools tests/reasoning tests/config
```

---

## 7. 风险与依赖项

### 7.1 风险登记表

| ID | 风险 | 触发点 | 影响 | 概率 | 缓解措施 | 回滚手段 |
|---|---|---|---|---|---|---|
| **R-01** | `GraphSpec` 改造破坏 Checkpointer/会话兼容 | T-13 | 存量会话无法续跑 | 中 | 已有 `STATE_SCHEMA_VERSION` + `migrate_state`（`src/graph/state.ts:185,415`）；新增字段一律可选；拓扑快照等价测试 | 恢复 `buildModuGraph` 直调（保留为兼容包装）；回退 `STATE_SCHEMA_VERSION` |
| **R-02** | `PromptRegistry` 迁移引入提示词回归 | T-14 | 输出质量/行为漂移 | 高 | 逐文件迁移 + 每处跑字符等价测试（扩展 `tests/reasoning/prompt-composer.test.ts`）；默认路径字符逐字节一致作为 CI 门禁 | 单文件回退（迁移是逐文件独立提交） |
| **R-03** | 场景包加载失败阻断启动 | T-16,T-17 | 框架不可用 | 中 | 强制**逐能力 try/catch 隔离**（复用 `src/skills/loader.ts:79-96,137-144`）；失败降级内置默认 | 关闭 `scenario.enabled`；删除 `packs/` 目录 |
| **R-04** | 观测 boot 引入副作用（端口占用/性能） | T-01 | 启动变慢、端口冲突 | 中 | `bootObservability` 严格按 `observability.*.enabled`（默认全 false）门控 → 默认 no-op；逐项 try/catch | 保持三项 enabled=false；回退 boot 调用 |
| **R-05** | 模型路由接入改变默认行为 | T-08（**已落地**）/ T-12 改造时回退 | 默认路径模型被切换 | 低 | `llm.router.enabled` 默认 `false`（`runtime-config.ts:56`）→ `PassthroughLLMRouter`（`factory.ts:328-330`，且不注入 resolver）；默认路由缺失兜底（`factory.ts:349-354`）、`RuleBasedLLMRouter` 构造失败降级（`factory.ts:365-370`） | 置 `llm.router.enabled=false` |
| **R-06** | 权限收敛导致审批语义变化 | T-10 | 敏感工具被误放行/误拦截 | 中高 | `PolicyEngine` 无命中默认 `allow`；`ToolApprovalPolicyRule` **委派**既有 `decideToolApprovals`（`tool-guardrails.ts:360`，契约不变）；HITL `interrupt` 链路（`nodes.ts:1988`）不动；`action_guardrails.enabled` 默认 false；**四组合等价矩阵**（L10）作为门禁 | `policy.engine.enabled=false`；回退 `nodes.ts:1934` 单行为直调 `decideToolApprovals` |
| **R-07** | 能力矩阵自动同步把危险工具判为低风险 | T-06 | 敏感工具绕过审批 | 中 | **保守默认**：自动派生一律 `requires_confirmation: true`；仅内置白名单显式降级；`registerToolCapability` 保留为显式覆盖。**（修订 4 补充）** 反向风险同样存在且**已发生**：保守标注被判定逻辑采信 → 所有第三方工具被强制审批/强制串行（见 **R-17**）| 删除自动派生代码；恢复 `TOOL_CAPABILITY_MATRIX`（`tool-registry.ts:61-133`）硬编码 |
| **R-08** | 评估口径按 pack 加载致 CI 门禁漂移 | T-19 | CI 门禁失效或误报 | 中 | 保留全局默认 `thresholds.yaml`/`ci_gates.yaml`（`config-loader.ts:157-158,182-183`），pack 仅做**覆盖**；新增 pack 口径需显式 opt-in | 忽略 pack 目录，回退单份口径 |
| **R-09** | 合并双轨 provider 造成环境变量/模型名差异 | T-12 | 宿主配置静默失效 | 中 | 双变量名别名兼容（`OPENAI_API_KEY` + `MODU_OPENAI_API_KEY`）；模型名差异记录为"兼容映射表"；旧 map 保留为内置默认工厂 | 恢复 `llm-adapter.ts:22-51` 硬编码路径 |
| **R-10** | 场景包 manifest 格式冲突（现有实现读 `manifest.json`） | T-16 | 约定与实现不一致，加载器返工 | 中 | **开工前必须先决（D-02）**；若采 `pack.yaml` 则新增 loader 而非改 `plugin-manifest.ts` 既有行为 | 退回 `manifest.json` 方案 |
| **R-11** | 底座改造引入循环依赖（ESM） | T-11~T-15 | 构建/运行时失败 | 中 | 参照既有 `setSkillToolWrapperFactory` 的**工厂注入**范式（`src/core/registry.ts:22-30`）解决循环；`tests/architecture/layer-boundaries.test.ts` 断言无环 | 回退为注入式而非直接 import |
| **R-12** | `better-sqlite3` 原生绑定未构建导致测试基线不干净 | 全阶段 | 无法判定"是否回归" | 高（已知） | 基线前执行 `npm rebuild better-sqlite3`；或在基线中显式豁免 `tests/tools/sql-query.test.ts` 的 7 个用例并记录 | 无需回滚，属环境问题 |
| **R-13** | **`PolicyEngine` 与既有护栏形成"双实现"**：T-10 若把输出清洗/输入评分也搬进规则链，将出现两套脱敏（`output-guard-node.ts:47` + 规则内）、两套审计发布、判定顺序分歧 | T-10 / T-10b | 输出被二次替换、审计重复、四种开关组合下结果不一致 | **中高** | ① 契约层明确"**PolicyEngine 只产出决策，执行方唯一**"（输出执行 = `output-guard-node.ts:47`；输入评分/阻断 = `perception/text/rule-based.ts:237` + `nodes.ts:489,495`）；② `decideToolApprovals`（`tool-guardrails.ts:360`）为**唯一判定内核**，`PolicyEngine` 只做 stage 分发；③ 新增"四组合等价矩阵"测试（§5.2.3 ②）作为门禁 | 置 `policy.engine.enabled=false`（默认）→ 完全回到 P0 现状；回退 `nodes.ts:1934` 单行改动 |
| **R-14** | **记忆策略"半接线"被误判为已收口**：P0 的 `memory-strategy.ts:42` 已消费配置键并把 `InMemoryShortTermMemory` 注册进 registry，但 `registry.getMemory()` **零消费**——若 T-11 只看"配置键有 `get()` 点"即验收，主链路实际未切换 | T-11 | M2 断言②（横向替换记忆后端）形同虚设；宿主换后端不生效 | **中高** | ① 验收必须断言"`resolveMemoryStrategy` 在 `memory_query`/`memory_update`（`graph.ts:437-439`）被真实调用"，而非仅注册；② T-11 目标锁定**主链路 `BaseStore` 路径**（`store-adapter.ts:113,327`），非零调用的 `ObservationMemory`（`observation-memory.ts:94`）；③ namespace 读写两侧（`chroma.ts:199` / `nodes.ts:333`）成对修改 | 恢复 `graph.ts:437-439` 的 `store` 直连（策略解析短路）；`memory.default_strategy` 保持 `'cache'` |
| **R-15** | **T-12 契约返回类型选错导致 P0 T-08 路由链路断裂**：初稿 `create(): ModuLLM`，但主链路与 routeTable 工厂都消费 LangChain ChatModel（`llm-adapter.ts:63`、`factory.ts:342-345,519`） | T-12 | 路由解析器 `factory.ts:749-793` / `nodes.ts:1161-1174` 每轮运行时抛错降级 → 模型路由静默失效 | 中 | ① 契约固定为返回 **ChatModel**，`ModuLLM` 视图由 `_build_modu_llm`（`factory.ts:302`）保留；② 回归门禁必须含 `tests/kernel/p0-wiring.test.ts`（llm 相关断言 `:448,623-627`）与 `llm.router.enabled=true` 的路由冒烟；③ provider 默认值来源统一为 `llm.default_provider`（`runtime-config.ts:21`），消除 `llm-adapter.ts:74` 的 `'glm'` 次级兜底分歧 | 保留 `_PROVIDER_CONFIG` 为内置默认工厂（不删）；`git revert` 单任务提交 |
| **R-16** | **P1 引入 P2 依赖导致阶段门禁失效**：初稿 T-10 ③ 要求 HITL 节点插入位置改为 `GraphProfile` 声明（属 T-13/P2） | T-10 | P1 无法独立验收、无法独立回滚；P2 被迫提前 | 中 | 已将该项显式移出为 **T-10c 并挂到 T-13**（§5.2.0、§5.3）；P1 范围清单（§5.2.5"P1 不做"）作为评审检查项 | 无需回滚（结构性修正） |
| **R-17** | **"保守标注"被判定逻辑采信 → 行为反向漂移**（修订 4 实测缺陷）：P0 T-06 的 `ensureToolCapability` 为所有未登记工具派生 `requires_confirmation: true`，该标注随后被 ①`tool-guardrails.checkGuardrail` 第二层回退 ②`tool-orchestrator.hasDependency` 采信 | T-06（已修复） | ①`action_guardrails.enabled=true` 时**所有** MCP/Skill/自定义工具被强制审批，且与 MCP 工具自身 `requiresApproval()=false` 的契约冲突；②`parallel_tools.enabled=true` 时任意两个第三方工具被判为有依赖而强制串行 | **高（已发生）** | 派生条目标记 `derived: true`，新增 `isExplicitlyConfirmRequired()` 作为**单一判定入口**，两处判定**仅采信显式声明**（内置 7 项 + `registerToolCapability`）；回归测试 `tests/tools/capability-derivation.test.ts` 锁定隔离语义 | 恢复两处判定直接读 `requires_confirmation`（即回退到缺陷版本）；或 `registerToolCapability` 显式覆盖 |
| **R-18** | **记忆策略在非 BaseStore 场景被忽略**（修订 4 实测缺陷）：`graph.ts` 仅当 `store` 非空时才把策略解析器传给记忆节点 | T-11（已修复） | 宿主注册的非 BaseStore 后端（Redis / 自研向量库）在 `memory.store_type='none'` 时被完全忽略 —— 而该配置正是宿主"停用内置 store、只用自己的策略"的自然选择，形成 `M2 横向替换 ×3` 的覆盖缺口 | 中 | `graph.ts` 恒使用工厂版本并传入解析器；无策略命中时返回值与既有 `memoryQueryNode`/`memoryUpdateNode` **逐字段一致**（默认行为不变）；回归测试见 `tests/memory/base-store-strategy.test.ts` | 恢复 `store ? 工厂版 : 退化版` 三元分支 |

### 7.2 依赖项

**内部依赖（代码资产，已复核存在）**
- `STATE_SCHEMA_VERSION` / `migrate_state`：`src/graph/state.ts:24-25`（导出 `graph/index.ts:24-25`）→ R-01 缓解基础。
- `state.task_type`：`src/graph/state.ts:159,370,506` → T-08 无需新增状态字段。
- `UNDECLARED_CONSUMED_KEYS` + 断言测试：`src/config/capability-registry.ts:270`、`tests/config/p5-env-capability.test.ts` → T-06 验收锚点。
- 工厂注入范式（解 ESM 循环）：`src/core/registry.ts:22-30`。
- 隔离加载范式：`src/skills/loader.ts:79-96,137-144`。
- 字符等价范式：`src/reasoning/prompt-composer.ts:9-12` + `tests/reasoning/prompt-composer.test.ts`。
- 插件化参照标准：`src/perception/pipeline.ts:26-34,85-90`。

**外部依赖（`packages/modu-agent/package.json`）**
- 可选依赖已声明：`@opentelemetry/*`、`prom-client`、`chromadb`、`better-sqlite3`（`:29-38`）→ 观测/记忆接线**无需新增依赖**。
- 框架依赖：`@langchain/core`、`@langchain/langgraph`、`zod`（`:18-24`）。

**环境依赖**
- `node_modules` 已安装（可跑 `tsc` / `vitest`）。
- `better-sqlite3` 原生绑定**未构建** → `tests/tools/sql-query.test.ts` 7 用例失败（环境问题，非代码回归）。**开工前须先修复或显式豁免**，否则无法建立干净基线。

**上游决策依赖**：第 10 节待确认事项清单**全部确认**。

---

## 8. 验证与回滚策略

### 8.1 验证分层

| 层级 | 验证内容 | 载体 | 门禁 |
|---|---|---|---|
| **L1 类型** | 零类型错误 | `npx tsc -p tsconfig.build.json --noEmit` | blocking |
| **L2 契约测试** | 新增注册/接口的契约行为（注册→解析→**被主链路消费**闭环） | P1 新增：`tests/core/policy-engine.test.ts`、`tests/reasoning/llm-provider.test.ts`、`tests/memory/base-store-strategy.test.ts`、`tests/kernel/p1-memory-strategy.test.ts` | blocking |
| **L3 字符等价** | prompt 组装结果逐字节一致（默认路径） | 扩展 `tests/reasoning/prompt-composer.test.ts` | blocking（T-14/T-15） |
| **L4 拓扑等价** | `composeDefaultGraph(profile)` 与改造前 `buildModuGraph` 节点/边集合一致（快照） | 新增 `tests/graph/graph-spec-equivalence.test.ts` | blocking（T-13） |
| **L5 端到端行为** | 默认配置下 ReAct 全流程/HITL/plan-execute 行为不变 | `tests/graph/react-news-e2e.test.ts`、`tests/graph/hitl-e2e.test.ts`、`tests/graph/hitl-interrupt-payload.test.ts`、`tests/graph/clarify-node.test.ts` | blocking |
| **L6 层边界** | B-1~B-5 依赖规则 + 无循环依赖 | 新增 `tests/architecture/layer-boundaries.test.ts` | blocking（M4 起） |
| **L7 配置无悬挂** | `UNDECLARED_CONSUMED_KEYS === []` 且"已声明未消费"= 0 | `tests/config/p5-env-capability.test.ts` 扩展 | blocking（**M2 起收紧**：P0 残留 3 项须清零） |
| **L8 双向解耦** | 纵向：新 pack 零 `src/` 改动；横向：换底座不改执行层 | M2 起用 `git diff --name-only -- src/graph/nodes.ts src/graph/graph.ts` 断言（P1 三项替换各 1 例）；M5 起加 `packs/` 断言 | blocking（**M2 起**先按"不改 `nodes.ts`/`graph.ts`"口径执行） |
| **L9 观测有效性** | 开启开关后指标有数据、审计有落盘 | 新增集成测试 + 手工核验 | advisory → M2 起 blocking |
| **L10 决策等价矩阵**（P1 新增） | `action_guardrails.enabled` × `policy.engine.enabled` 四组合下，`decideToolApprovals` 与 `PolicyEngine.decide('tool')` 输出逐工具逐字段一致 | 新增 `tests/graph/policy-hitl-equivalence.test.ts` | blocking（T-10） |
| **L11 P0 不回退**（P1 新增） | 路由/观测/审计/输出护栏/能力矩阵的 P0 行为不变 | `tests/kernel/p0-wiring.test.ts`（含 `:433-443,448,623-627`） | blocking（T-12 尤其） |

**基线执行顺序**（每次提交前）：
```bash
cd packages/modu-agent
npx tsc -p tsconfig.build.json --noEmit          # L1
npx vitest run                                    # L2~L7（含既有 56 个测试文件）
```
**已知豁免**：`tests/tools/sql-query.test.ts` 的 7 个用例（`better-sqlite3` 绑定未构建）。豁免必须**显式记录在基线报告中**，并在 R-12 修复后取消豁免。

### 8.2 分阶段验证要点

| 阶段 | 必须先绿 | 新增验证 |
|---|---|---|
| P0 | 全量既有测试 + 端到端（L5） | 观测数据源存在性（L9）；死配置键清零（L7）；路由生效但默认不生效（R-05 验证） |
| P1 | L5 全绿（尤其 HITL 审批语义） | 三个"替换实现不改上层"集成测试（L8 的横向雏形） |
| P2 | L3 字符等价 + L4 拓扑等价 | "新增扩展点不改 `graph.ts`/`nodes.ts`"（`git diff` 断言） |
| P3 | L6 层边界 + L8 双向解耦 | 场景包失败降级测试 |

### 8.3 回滚策略（四层）

| 层级 | 手段 | 粒度 | 适用场景 |
|---|---|---|---|
| **① 开关回滚**（首选） | 所有新能力挂 feature flag，默认关闭/等价：`observability.*.enabled`（`:280,286,291`）、`llm.router.enabled`（`:56`）、`react_optimization.prompt_composer.enabled`（`:337`）、`react_optimization.action_guardrails.enabled`（`:349`）、新增 `policy.engine.enabled` / `scenario.enabled` / `graph.spec.enabled` | 单个能力 | 灰度发现问题，无需发版 |
| **② 配置回滚** | 删除 `config.yaml` 中的覆盖项即回落到 `DEFAULT_CONFIG` | 单键 | 宿主配置导致的问题 |
| **③ 代码回滚** | 每任务独立提交、每阶段独立 PR，支持 `git revert` 单任务 | 单任务 | 开关无法隔离的实现缺陷 |
| **④ 会话兼容回滚** | `STATE_SCHEMA_VERSION` + `migrate_state`（`state.ts:24-25`）双向迁移；升级前快照存量 checkpointer | 会话级 | GraphSpec/state 改造导致的存量会话问题 |

**回滚触发条件（建议）**：任一 blocking 门禁变红且 2 小时内无法定位；或灰度期出现敏感工具绕过审批、审计事件丢失、默认路径行为漂移（字符/拓扑不等价）中的任意一项 → **立即回滚到上一阶段稳定态**。

### 8.4 灰度建议

1. **能力维度**：先 `observability` → 再 `policy` → 再 `graph.spec` → 最后 `scenario`。
2. **流量维度**：`scenario.enabled` 先对单个 pack、单任务类型开启。
3. **观测维度**：灰度期必须同时观察 ① 指标（工具调用/LLM tokens）② 审计落盘 ③ 端到端成功率 ④ 平均轮次（对比 `avg_rounds_per_task` 基线）。

---

## 9. 待确认事项清单（Decision Log）

> 以下 18 项需评审确认后方可开工。**D-01、D-02、D-05、D-11 为阻塞项**（不确认则 P3 无法定稿）。
> **P1（M2）开工前必须先确认：D-05（`PolicyEngine` 默认决策）、D-06（配置键处置口径）、D-08（记忆契约）、D-15（`ObservationMemory` 去留）、D-16（`BaseLLMReasoner` 家族去留）、D-17（`embedding`/`chunking` 是否本轮做）、D-18（`enable_guard`/`llm_judge` 处置）。**

| ID | 待确认事项 | 备选方案 | 建议 | 影响范围 | 需确认方 |
|---|---|---|---|---|---|
| **D-01** ⛔ | **本轮实施范围**：一次性做完 P0~P3，还是分阶段批准（仅 P0+P1 / 到 P2 / 到 P3）？ | ① 仅 P0+P1；② P0~P2；③ 全量 P0~P3 | ① 先批准 **P0+P1**（低风险高收益，且是后续一切的前置），M2 验收后再议 P2/P3 | 全部排期与人力 | 项目负责人 |
| **D-02** ⛔ | **场景包 manifest 格式**：复用现有 `manifest.json`（`plugin-manifest.ts:115` 已实现）还是新增 `pack.yaml`？是否两者都支持？ | ① 只用 `manifest.json`（零新增代码）；② 只用 `pack.yaml`（与既有 `config.yaml` 风格一致）；③ 双格式（JSON 优先，YAML 兜底） | ② 但**新增独立 loader**，不改 `plugin-manifest.ts` 既有行为；或 ③ | T-16/T-17 全部设计 | 架构负责人 |
| **D-03** | **`packs/` 目录位置**：`packages/modu-agent/packs/` / 仓库根 `packs/` / 宿主应用目录（`apps/`）？ | ① 包内；② 仓库根；③ 宿主目录（配置指定） | ③ + 默认扫描包内 `packs/`（宿主可覆盖，与 `skills.auto_discover_dirs` 范式一致） | T-17 目录约定 | 架构负责人 |
| **D-04** | **首个真实场景包选哪个业务**？（`apps/` 下有大量业务代码） | ① 现有某个 `apps/` 子项目；② 新建"数据分析"示例包 | ① 用**真实**业务驱动验收（报告 §10.7 M4 也建议以真实场景包驱动） | T-17/T-18/M4 验收 | 业务方 |
| **D-05** ⛔ | **`PolicyEngine` 默认决策与审批超时语义**：无规则命中时 `allow`（兼容现状）还是 `deny`（安全优先）？`tools.human_in_loop.enabled=true` 但无 HITL 通道时的行为？ | ① `allow` + 保持 `auto_reject_on_timeout=true`（`:136`）；② `deny`（安全优先，破坏兼容） | ① 保持兼容；`deny-by-default` 作为场景包 opt-in | T-10 设计、安全语义 | 安全负责人 |
| **D-06** | **死配置键处置口径**：P0 的 5 个观测键（`tracing.otlp_endpoint`/`service_name`/`sampling_rate`、`metrics.prometheus_port`/`path`）已由 T-01 boot 接线；**P0 后新发现 3 处**：`perception.security.enable_guard`（`runtime-config.ts:219`）、`perception.security.llm_judge.{enabled,risk_threshold}`（`:232-237`）。接线还是删除？**（修订 3：已按 ① 全部接线实施完毕，本条转为"已决"）** | ① 全部接线；② 全部删除；③ 混合 | ① **全部接线（已实施）**：`enable_guard` + `llm_judge.{enabled,risk_threshold}` 由 `InputGuardPolicyRule` 消费；`guard.ts:139 detectInjectionWithLLMJudge` 由 `createModuLlmJudgeCallback` 注入真实 LLM 回调后获得**生产调用者**；`guard.ts:232 sanitize()` 按 D-18 保留不接线（非配置键） | T-10b、G-2 断言 | 运维/架构 |
| **D-07** | **`llm.router.enabled` 是否在 P0 后改为默认 `true`**？ | ① 保持 `false`（仅保证"能生效"）；② 改 `true` 并配默认规则 | ① 保持 `false`，由宿主按需开启（R-05 前提） | T-08、默认行为 | 架构负责人 |
| **D-08** | **记忆统一契约语义**：`BaseMemory` 现返回 `Promise \| 同步` 联合类型（`core/interfaces/memory.ts:9-19`），`MemoryStrategy` 是否强制全异步？旧接口是否允许标记 deprecated？**补充（P0 后新事实）**：`memory.default_strategy` 已被 `memory-strategy.ts:42` 消费，但只完成"注册"（`registry.registerMemory`），`registry.getMemory()` **零消费** → 是否接受"P1 以主链路 `BaseStore` 路径为唯一验收对象"？ | ① 新增接口全异步 + 旧接口保留（`LegacyMemoryStrategyAdapter`），主链路以 `BaseStore` 路径为准；② 改造旧接口为全异步（breaking） | ① 并存且明确"验证对象 = 主链路"；`registry.registerMemory` 保留为兼容旁路（不作为验收依据） | T-11、R-14 | 架构负责人 |
| **D-09** | **字符等价是否作为 CI blocking 门禁**（prompt 迁移）？ | ① blocking；② advisory（人工 review） | ① blocking（否则 T-14/T-15 回归无保障） | T-14/T-15、CI | 质量负责人 |
| **D-10** | **确认"不做"清单**：跨进程 EventBus、插件市场/热更新、分布式 Checkpointer 是否确认排除本轮？ | ① 确认排除；② 纳入 | ① 确认排除（避免范围蔓延） | 全范围 | 项目负责人 |
| **D-11** ⛔ | **"零内核源码改动"的度量口径**：禁止修改既有文件？还是允许修改但禁止新增内核文件？如何自动化核验？ | ① `git diff --name-only src/ == 0`（最严）；② 允许 `src/` 非 `kernel/` 的**新增**文件；③ 允许修改但需评审 | ① 作为 M5 纵向验收断言（`git diff --name-only -- src/` 必须为空） | T-17/M5 验收 | 架构负责人 |
| **D-12** | **排期与人力**：各里程碑迭代数、每阶段 review 人、是否接受"每任务独立 PR"以支持细粒度回滚？ | ① 按报告建议 M1=1 迭代 / M2=2 / M3=2 / M4=2；② 调整 | ① 且 M1 的 9 项可 2~3 人并行 | 全部排期 | 项目负责人 |
| **D-13** | **是否接受 `STATE_SCHEMA_VERSION` 升级**（影响存量会话，需迁移）？升级时机：M3 一次性升级还是分次？ | ① 一次性（M3）；② 分次增量 | ① 一次性 + `migrate_state` 双测（旧→新、新→旧） | T-13、存量会话 | 架构/运维 |
| **D-14** | **`better-sqlite3` 绑定问题**开工前修复还是基线豁免？ | ① `npm rebuild better-sqlite3` 修复；② 豁免并记录 | ① 修复（保证基线干净） | 全部验证 | 开发负责人 |
| **D-15** | **`ObservationMemory` 与 `state.observation_memory` 去留**（P1 新增）：`ObservationMemory`（`memory/observation-memory.ts:94`）零构造零调用；`state.observation_memory`（`state.ts:151,361,505`）零读写死字段。P1 接线还是删除？ | ① P1 接线（接进 `tool_processor` → `agentNode`，与既有 `ObservationDistiller` 职责可能重叠）；② 删除死字段 + 保留类（从 `memory/index.ts` 导出）；③ P1 冻结（不动），留待场景包需求驱动 | ③ **冻结**：P1 不做（避免与 `graph/adapters/observation-distiller.ts` 的蒸馏路径重复），但在 P1 验收中**显式标注"未接线"**，避免被误记为"已收口" | T-11 范围界定、M2 验收 | 架构负责人 |
| **D-16** | **`BaseLLMReasoner` 家族去留**（P1 新增）：`reasoning/llm/{base,gpt,glm,deepseek,qwen}.ts` **除 `index.ts` 再导出外零消费者**，且 `base-llm.ts:15,49,52` 类级已 `@deprecated`。T-12 后如何处置？ | ① 保留为实现体（作为注册表"内置默认工厂"的落点），但从 `reasoning/index.ts:7-13` 移出主导出；② 删除（依赖 `deepseek.ts` 无其他消费者）；③ 冻结不动 | ① 保留为实现体 + 移出主导出（**删 `_buildMessages:627` 的 prompt 组装职责**），删除留待单独清理任务（避免 P1 变更面过大） | T-12、包体积/维护面 | 架构负责人 |
| **D-17** | **`embedding` / `chunking` 是否本轮配置化**（P1 新增）：`chroma.ts` 无 chunking 实现（`:267-308` 整段 upsert），embedding 仅代码注入（`:186`，默认哈希降级 `:146`）；`memory` 段无这两个键 | ① P1 只做 `namespace` 单一来源化，`embedding`/`chunking` 转 P3；② P1 全做（新增配置面 + 切分层实现） | ① 只做 `namespace`（读写两侧 `chroma.ts:199` / `nodes.ts:333` 成对修改），另两项**显式标注本轮不做** | T-11 范围、配置面治理 | 架构负责人 |
| **D-18** | **`PolicyEngine` 与既有护栏的边界**（P1 新增）：输入护栏现状是"评分（`rule-based.ts:237`）+ 路由阻断（`nodes.ts:489,495`）"，输出护栏是"节点装饰器（`output-guard-node.ts:47`）"。P1 是否要求把它们**迁入** `PolicyEngine`？ | ① 只登记规则、**不迁执行**（保持单一执行方）；② 迁入执行（推翻 P0 T-05 实现） | ① **只登记不迁执行**：`PolicyEngine` 输出决策，执行方唯一（防止 R-13 双实现） | T-10 / T-10b、T-13（原 T-10c）、R-13 | 安全负责人 |

---

## 10. 附录：关键证据索引（本计划新增/修正部分）

| 结论 | 证据 |
|---|---|
| `create_agent` 仅 3 参数（修正报告"14 位置参数"） | `packages/modu-agent/src/graph/factory.ts:450-454`；14 参数是 `buildModuGraph` 调用 `:680-697` |
| `memory.context_window`/`enable_compression` 已移除（修正报告） | `packages/modu-agent/src/config/runtime-config.ts:71-75`；语义承载于 `src/config/schemas.ts:187,189`、`src/orchestration/communication/protocol.ts:291,293` |
| 死配置为 5 个且路径为 `observability.metrics.*`（修正报告） | `packages/modu-agent/src/config/runtime-config.ts:281-283,287-288` |
| 输出护栏为零调用死代码（**P0 前基线；T-05 后已由 `output-guard-node.ts:47` 调用，默认关闭**） | `packages/modu-agent/src/perception/security/guard.ts:312,369-370`（`:370` 为内部自调用） |
| 12 类审计事件仅 1 类有发布者（**P0 前基线；P0 后已达 12/12，见下**） | 定义 `src/perception/security/audit.ts:25-37`；P0 前唯一发布者 `src/graph/adapters/rate-limiter.ts:120-122` |
| `STATE_SCHEMA_VERSION`/`migrate_state` 已存在 | `src/graph/state.ts:185,415`（P0 后行号修正） |
| `state.task_type` 已存在且由 perception 写入 | `src/graph/state.ts:159,370,507` |
| `plugin-manifest.ts` 读取的是 `manifest.json` 而非 `pack.yaml` | `src/config/plugin-manifest.ts:112-121`（`:115` 拼 `manifest.json`） |
| 真子图 vs 内联节点的差异 | 真子图 `src/graph/subgraph/builder.ts:98,111,202`；内联 `src/graph/graph.ts:544-548`（P0 后行号修正） |
| **【P1 新增】** 审批判定已被 P0 T-09 收敛为单一纯函数（原 `nodes.ts:1803-1828` 内联函数已删除） | `src/tools/tool-guardrails.ts:297`（`toolRequiresApproval`）、`:360`（`decideToolApprovals`）；唯一调用点 `src/graph/nodes.ts:1934` |
| **【P1 新增】** 模型路由已真正接线并生效（T-08） | 构造 `src/graph/factory.ts:753`；解析器 `:749-793`；传图 `:813`；透传 `src/graph/graph.ts:369,435-436`；消费 `src/graph/nodes.ts:910,1161-1174` |
| **【P1 新增】** 路由表工厂用 `build_chat_model` + `wrap_chat_model_as_modu`（T-12 契约须返回 ChatModel 而非 ModuLLM） | `src/graph/factory.ts:342-345`；`build_chat_model(): ChatOpenAI` `src/graph/adapters/llm-adapter.ts:63`；`_build_modu_llm` `src/graph/factory.ts:302` |
| **【P1 新增】** provider 双轨差异（env/model 不一致） | `llm-adapter.ts:37-43`（`OPENAI_API_KEY`/`gpt-4o-mini`）vs `reasoning/llm/gpt.ts:6,23-25`（`MODU_OPENAI_API_KEY`/`gpt-4o`）；qwen `llm-adapter.ts:49`（`qwen-plus`）vs `reasoning/llm/qwen.ts:6`（`qwen-max`） |
| **【P1 新增】** 第二轨 `*LLMReasoner` 家族零消费者（除 index 再导出） | `src/reasoning/llm/index.ts:8-12`（仅命名再导出，非映射表）；类级 `@deprecated` `src/reasoning/llm/base-llm.ts:15,49,52`；`_buildMessages` `:627` 仅内部 `:520,:612` 调用 |
| **【P1 新增】** 记忆主链路真路径为 `BaseStore`（`BaseMemory` 家族仅被注册、无消费） | 主链路：`store-adapter.ts:113,327` → `factory.ts:204-224,594` → `graph.ts:499-504,528` → 读写 `nodes.ts:333,425`；`memory-strategy.ts:42-80` 注册后 `registry.getMemory()` 零消费 |
| **【P1 新增】** `ObservationMemory` 与 `state.observation_memory` 为零接线死代码 | `memory/observation-memory.ts:94`（无构造函数点）；`state.ts:151,361,505`（零读写） |
| **【P1 新增】** 输出护栏执行方唯一（P0 T-05），T-10 不得搬迁 | `perception/security/output-guard-node.ts:36,47`；挂载 `graph.ts:512-518`；门控 `runtime-config.ts:226-228` |
| **【P1 新增】** 输入护栏为"评分 + 路由阻断"两个分离点 | 评分 `perception/text/rule-based.ts:193,237`；阻断 `graph/nodes.ts:489,495`；开关 `runtime-config.ts:220-221` |
| **【P1 新增】** P0 后剩余 3 处"声明未消费"键/无生产调用函数 | `runtime-config.ts:219`（`enable_guard` 零消费）、`:232-237`（`llm_judge.*` 零消费）；`guard.ts:139`（`detectInjectionWithLLMJudge` 仅测试调用 `tests/perception/security/guard.test.ts:51-101`）、`:232`（`sanitize` 零调用，含内部） |
| **【P1 新增】** 审计发布者已达 **12/12**（T-04 完整达成） | `rule-based.ts:248,259`；`http-request.ts:326,345`；`file-ops.ts:205`；`sql-query.ts:218`；`code-executor.ts:264`；`nodes.ts:475,1970,2031`；`rate-limiter.ts:121`；`output-guard-node.ts:66` |
| **【P1 新增】** P1 相关测试资产：`tests/kernel/p0-wiring.test.ts`（P0 回归锚点）、`tests/core/registry.test.ts`；**llm/router/provider 测试为零** | `tests/kernel/p0-wiring.test.ts:433-443,448,611-612,623-627`；`tests/core/registry.test.ts` |
| `record_request` 是唯一有生产调用者的指标函数 | `src/observability/metrics.ts:212,237` 无调用者；`src/graph/runner.ts:496,547` 调用 `record_request` |
| `swapComponent` 已支持 11 类组件热替换 | `src/core/registry.ts:270-292`（组件清单 `:35-36`） |
| `UNDECLARED_CONSUMED_KEYS` 断言测试 | `src/config/capability-registry.ts:270`；`tests/config/p5-env-capability.test.ts` |
| 隔离加载范式 | `src/skills/loader.ts:79-96,137-144` |
| 感知层为插件化参照标准 | `src/perception/pipeline.ts:26-34,85-90` |
| 可选依赖已在 package.json 声明 | `packages/modu-agent/package.json:29-38` |
| 既有测试规模（56 文件，作为回归资产） | `packages/modu-agent/tests/**/*.test.ts` |

---

## 11. 下一步

1. 评审人逐项确认第 9 节 **D-01 ~ D-18**（阻塞项优先：D-01、D-02、D-05、D-11）。
2. **M1（P0）已交付**：T-01~T-09 中 8 项完成（含 12/12 审计发布者）；**唯 T-06 中"剩余 3 处悬挂键"部分**已由 P1 的 T-10b ④ **以接线方式清零**（见 §5.2.6），故 M1 遗留项已闭合。
3. **M2（P1）已交付（修订 3）**：T-12 / T-11 / T-10 / T-10b 全部实施完成，实测 `tsc` 零错误、`vitest run` 753/760（唯一 7 项为已知 `better-sqlite3` 环境问题），详见 **§5.2.6**。
4. **P1 已由实施"事实确认"的决策**：**D-06**（3 处悬挂键 → 全部接线）、**D-08**（记忆契约 → 主链路 `BaseStore` 为验证对象，旧接口以兼容旁路保留）、**D-18**（`PolicyEngine` 与既有护栏边界 → 只登记不迁执行）；评审时按"事后确认"处理即可。
5. **仍需确认的决策（影响后续阶段）**：**D-15**（`ObservationMemory` 去留）、**D-16**（`BaseLLMReasoner` 家族去留）、**D-17**（`embedding`/`chunking` 是否本轮做）、**D-01**（是否继续 P2/P3）。
6. 完成 **D-14**（`better-sqlite3` 修复），使基线彻底干净；当前已按 §5.2.6 记录豁免（7 项，未随本次改动变化）。
7. **M3（P2）已交付并经复查修正（修订 6）**：T-13 / T-14 / T-15 实施完成，实测 `tsc` 零错误、`vitest run` **823/830**（唯一 7 项为已知 `better-sqlite3` 环境问题），详见 **§5.3.1** 与 **§5.3.2**（复查修复 8 项缺陷，含 1 项高危的"装配层覆盖宿主注册"）；T-14 的提示词迁移为部分交付（8/13 处），残余站点已列明并转入 P3。
8. **P3 启动前须处理 §0.1 #12**（感知处理器从未注册 —— 使 `block_on_injection`/`block_on_pii` 与 P0 T-04 的两个审计发布点在默认运行时不可达）：**已正式编号为 T-23**（修订 7）并**已完成**（修订 8）：注册 `TextPreprocessor`，受新键 `perception.builtin_processors.enabled`（默认 false）门控，见 §5.4.6。
9. **P3-A 地基组已交付并经复查修正（修订 8 + 修订 9，见 §5.4.6 / §5.4.7）**：T-22（L7 载体）/T-24（L6 载体）/T-20（`subgraphs`+`extra` 骨架闭环）/T-21（T-14 残余提示词迁移、占位符语法统一）/T-23（感知处理器注册）全部完成；复查修复 3 处缺陷（高危项：层边界扫描器漏检跨行 import 致 B-0 假阴性）与 1 处代码卫生问题。实测 `tsc` 零错误、`vitest run` **884/891**（唯一 7 项为已知 `better-sqlite3` 环境问题）。
10. **P3 后续顺序（修订 7 不变，现可从 B 组开工）**：确认 **D-01** 后按 **P3-B（T-17a 约定冻结 → T-16 Loader → T-17b 首个真实包）→ P3-C（T-18a 护栏 → T-18b SOP → T-18c 领域 → T-19 口径）→ P3-D（M5 验收）** 拆为独立 PR；P3 可直接复用已就绪的注册入口（`registerNode/registerEdge/registerSubgraph`、`registerPrompt`、`registerContextStrategy`、`Profile.extra`）。
11. **P3 需在 T-17a 阶段一并定夺的阻塞决策（原 D-01/D-02 之外）**：**D-03**（`packs/` 位置）、**D-04**（首个真实场景包业务 —— 建议取自 `apps/{backend,backend-ts,desktop,marketing,mobile,web}`）、**D-11**（零内核改动口径 → 按 §5.4.4 分段适用）；另需回归确认 **D-17**（`embedding`/`chunking`）是否因首个场景包为「领域知识/RAG」类而被动触发。
12. **P3-A 遗留的 4 项待决策（不阻塞 P3-B 开工，但需登记）**：① `LLMParser` 语义解析是否启用（`perception.deep_parsing.*` 6 键，含每轮 LLM 调用成本）；② `perception.event_log_*`(2) + `perception.enable_context_reduction` 接线或删除；③ `plan_execute.compact_completed_steps` 接线或删除；④ P3-C 输入侧端到端验收**须显式开启** `perception.builtin_processors.enabled=true`。
