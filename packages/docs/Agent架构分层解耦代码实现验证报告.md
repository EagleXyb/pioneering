# Agent 架构分层解耦——代码实现验证评估报告

> **评估对象**：`packages/modu-agent`（120+ 源文件）+ `packages/evals`
> **评估命题**：验证"底层六要素（模型路由、工具协议、记忆、编排、观测、权限）做成通用底座；上层四要素（领域知识、SOP 流程、业务护栏、评估口径）做成可插拔场景包"这一设计目标是否已在代码中落地
> **对照基线**：[Agent架构分层解耦评估报告.md](file:///d:/Administrator/Desktop/pioneering/packages/docs/Agent架构分层解耦评估报告.md)（2026-09-29，总体达成度约 35%）
> **评估方式**：逐文件精读 + 全仓引用检索 + 编译/全量测试实测复现，证据均标注 `文件:行号`
> **评估日期**：2026-06（实测环境：Windows + Node + vitest 2.1.9）

---

## 1. 总体结论

### 1.1 一句话判定

**"底座已经通电，场景包仍无载体"——分层解耦目标完成约 70%。**

- **底层六要素**：基线报告中的核心症结"已实现未接线"已基本消除。模型路由、记忆策略、声明式编排、观测 boot 均已在 `create_agent` 中真正装配并被节点消费；权限已建立统一 `PolicyEngine`，但三层中仅 tool 阶段接入主链路。
- **上层四要素**：领域知识/SOP 的**注册机制**已全部就位且部分已接线，但"可插拔场景包"的**物理载体仍不存在**——无 `packs/` 目录、无 `src/kernel/` 装配层、无 `ScenarioLoader/ScenarioHost`，`PluginManifest` 仍无生产消费者。场景接入仍需宿主手写代码或手工放置文件 + 翻转开关。

### 1.2 契合度总览（基线 vs 现状）

| # | 能力 | 归属 | 基线判定 | **现状判定** | 变化 | 核心理由 |
|---|---|---|---|---|---|---|
| 1 | 模型路由 | 底座 | ★☆☆☆☆ 未分离 | **★★★★☆ 合格** | ↑↑↑ | Provider 注册表 + 路由 resolver 已接入 agent 节点（默认关闭） |
| 2 | 工具协议 | 底座 | ★★★★☆ 合格 | **★★★★☆ 保持** | = | 三路归一稳固；能力矩阵已随注册自动派生 |
| 3 | 记忆 | 底座 | ★★☆☆☆ 半成品 | **★★★★☆ 合格** | ↑↑ | `MemoryStrategy` 统一契约 + 策略 resolver 接入记忆节点 |
| 4 | 编排 | 底座 | ★★☆☆☆ 部分分离 | **★★★★☆ 合格** | ↑↑ | 18 节点 37 边全部 GraphSpec 声明化，节点/边/子图可注册 |
| 5 | 观测 | 底座 | ★★☆☆☆ 半成品 | **★★★★☆ 合格** | ↑↑ | `boot_observability` 接入装配链，埋点/事件日志有数据源 |
| 6 | 权限 | 底座 | ★☆☆☆☆ 未分离 | **★★★☆☆ 大半完成** | ↑↑ | `PolicyEngine` 三阶段契约成立；tool 已消费，input/output 未消费 |
| 7 | 领域知识 | 上层 | ★★☆☆☆ 半可插拔 | **★★★☆☆ 机制闭环** | ↑ | markdown 装配器已被 factory 调用，PromptComposer 链路贯通（默认关闭） |
| 8 | SOP 流程 | 上层 | ★★☆☆☆ 半可插拔 | **★★★☆☆ 扩展增强** | ↑ | 子图可注册；但角色/步骤类型仍为写死枚举 |
| 9 | 业务护栏 | 上层 | ★★☆☆☆ 半可插拔 | **★★☆☆☆ 基本未变** | = | 5 条规则硬编码；doc_gen 节点仍内建于默认拓扑 |
| 10 | 评估口径 | 上层 | ★★★☆☆ | **★★★☆☆ 未变** | = | 口径 YAML 外置但单份；指标实现写死；无 pack 维度 |

> **量化**：底座 23/30（≈77%），上层 11/20（≈55%），综合 **≈68%~70%**（基线约 35%）。

### 1.3 基线"三大症结"的处置情况

| 症结 | 基线描述 | 现状 |
|---|---|---|
| ① 已实现未接线 | 八类能力三件套齐全但零生产调用 | **基本解决**：LLM 路由、观测导出/结构化日志/埋点、领域装配器、持久化日志均已接线；仅输入/输出护栏决策仍刻意不消费 |
| ② 装配靠手动 | 各 `registerXxx` 只能宿主手写调用 | **未解决**：无 ScenarioLoader，仍需手写代码/手工放文件 |
| ③ 场景包无处声明 | `PluginManifest` 无消费者 | **未解决**：消费者仍仅测试；packs 目录、manifest 驱动装配均不存在 |

---

## 2. 代码结构与模块划分

### 2.1 现状结构

```
packages/modu-agent/src/
├── core/
│   ├── interfaces/        ③ 契约层（11+ 类接口；零 src 值依赖，B-6）
│   ├── registry.ts        ③ 全局组件注册中心（统一扩展门面）
│   └── policy-engine.ts   ③ 默认 PolicyEngine 实现
├── config/                ③ RuntimeConfig + PluginManifest（manifest 无消费者）
├── graph/
│   ├── spec.ts            ③ GraphSpec 声明式拓扑契约（底座特例文件）
│   ├── graph.ts           ② 兼容包装 + composeDefaultGraph（默认拓扑声明）
│   ├── factory.ts         ② create_agent 唯一装配入口
│   ├── nodes.ts           ② 18 个节点实现（业务逻辑主要承载处）
│   ├── runner.ts          ② 流式/同步运行时
│   ├── adapters/          ③ LLM/Tool/MCP/重试等通用中间件
│   ├── plan-execute/      ② Plan-Execute 模式（步骤类型枚举写死）
│   └── subgraph/          ② Supervisor/Subagent（任务类型模板写死）
├── tools/                 ③ 内置工具 + tool-guardrails（规则硬编码）
├── memory/                ③ BaseStoreMemoryStrategy 等
├── perception/            ③ 管道 + 内置处理器（默认不注册）+ security（护栏内核）
├── reasoning/
│   ├── llm/               ③ 路由器、provider reasoner、cost-tracker
│   ├── domain-adapters.ts ② 领域知识注册表
│   ├── prompt-composer.ts ② 四层 Prompt 组装
│   └── prompt-registry.ts ③ Prompt 注册/渲染
├── observability/         ③ metrics/tracing/logging + boot
├── orchestration/         ② communication（共享底座）+ patterns（业务模式）
├── feedback/ evolution/ skills/  ②/③ 反馈进化与技能子系统
└── packs/                 ✗ 不存在
```

### 2.2 判定

- **底座模块明确存在**：`core/interfaces`、`tools`、`memory`、`observability`、`perception/security`、`reasoning/llm` 及 `graph/spec.ts` 被架构测试显式定义为底座层（[layer-boundaries.test.ts:132-140](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/tests/architecture/layer-boundaries.test.ts#L132-L140)），且边界由 CI 强制执行。
- **"场景包"无物理模块**：`packages/modu-agent/packs/`、仓库根 `packs/`、`src/kernel/` 经 Glob 实测均不存在。上层四要素以"源码内注册表 + 开关"形态分散存在，**结构分层成立、载体分层未成立**。

---

## 3. 底层通用底座验证（六要素）

### 3.1 模型路由：★☆☆☆☆ → ★★★★☆（已通电）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 路由接口 | ✅ | `LLMRouter.route(ctx)`，上下文含 taskType/estimatedComplexity/costBudget：[llm.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/llm.ts)（接口层） |
| 路由器实现 | ✅ 双实现 | `RuleBasedLLMRouter`（规则顺序匹配+实例缓存）、`PassthroughLLMRouter`：[router.ts:102-205](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/router.ts#L102-L205) |
| Provider 注册表 | ✅ 双轨已归一 | 4 个内置 provider 规格（glm/deepseek/gpt/qwen）+ 工厂注入 + 幂等注册、宿主优先：[llm-provider-registry.ts:31-130](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/llm-provider-registry.ts#L31-L130)；注册 API：[registry.ts:251](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts#L251) |
| **接入主链路** | ✅ **真消费** | factory 装配 `_build_llm_router` + `llmRouteResolver`（按 `provider:model` 缓存）：[factory.ts:877-921](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L877-L921)；agent 节点实际调用 resolver：nodes.ts:1155 附近 |
| 策略可替换 | ✅ | 新 provider 走 `registerLLMProvider`，无需改框架；规则由 `llm.router.rules` 配置 |
| 默认状态 | 关闭 | `llm.router.enabled=false`（runtime-config.ts:58），关闭时走 Passthrough，行为零变化 |

**差距**：① 默认关闭，路由信号依赖 `complexityAssessor`（同样受开关控制），启用后才有高质量输入；② 仅在 agent 节点一处路由，planner/judge 等仍用固定模型。

### 3.2 工具协议：★★★★☆（保持合格，并有加固）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 契约框架无关 | ✅ | `BaseTool` 纯 TS 抽象，零 LangChain 依赖：`core/interfaces/action.ts` |
| 三路归一 | ✅ | 内置/MCP/Skill → 同一注册表 → `build_langchain_tools` → ToolNode：[tool-adapter.ts:382](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-adapter.ts#L382) |
| 能力矩阵自动派生 | ✅ **基线扣分项已修复** | `registerTool` 内自动 `ensureToolCapability`：[registry.ts:153](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts#L153) |
| 通用中间件 | ✅ | 重试/限流/缓存在 adapter 层统一应用；工具调用埋点：[tool-adapter.ts:354](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-adapter.ts#L354) |
| 残留 | △ | 审批**执行**仍在 human_review 节点而非中间件；guardrail 预置规则绑定具体工具名 |

### 3.3 记忆：★★☆☆☆ → ★★★★☆（统一契约 + 策略可替换）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 统一契约 | ✅ | `MemoryStrategy { id, supports(taskType), recall, persist }`：`core/interfaces/memory-strategy.ts` |
| 内置实现 | ✅ | `BaseStoreMemoryStrategy`（recall 检索 userId/knowledge 命名空间，persist 写 history）：[base-store-strategy.ts:60](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/memory/base-store-strategy.ts#L60) |
| 注册/解析 | ✅ | register/setDefault/resolveMemoryStrategy（taskType→supports→默认）：[registry.ts:282-341](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts#L282-L341) |
| **接入主链路** | ✅ **真消费** | factory 注册 base_store + memoryStrategyResolver：[factory.ts:680-700](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L680-L700)；memory_query/memory_update 节点以"策略优先、store 直连兜底"消费：nodes.ts:331、nodes.ts:408 |

**差距**：① 内置策略仅 1 个，多态主要停留在结构层面；② `ObservationMemory` 为零调用死代码（待 D-15 决策）；③ embedding/chunking 未配置化（待 D-17）。

### 3.4 编排：★★☆☆☆ → ★★★★☆（拓扑声明化）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 声明式契约 | ✅ | `GraphProfile / NodeSpec / EdgeSpec / SubgraphSpec / GraphSpec`：[spec.ts:50-166](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/spec.ts#L50-L166) |
| 默认拓扑即声明 | ✅ | `composeDefaultGraph(profile)` 产出 18 节点 37 边：[graph.ts:511-778](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts#L511-L778) |
| 构建器 | ✅ | `buildFromSpec`：解析默认+注册扩展 → 挂子图 → 加节点/边 → compile：[spec.ts:259-401](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/spec.ts#L259-L401) |
| 依赖注入 | ✅ | 节点工厂唯一输入 `ModuGraphDeps`（16 项能力）：[spec.ts:77-108](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/spec.ts#L77-L108) |
| 扩展点 | ✅ | registerNodeSpec/EdgeSpec/Subgraph：[registry.ts:507-558](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts#L507-L558)；画像扩展 `profile.extra`（runtime-config.ts:329-333） |
| 兼容回滚 | ✅ | buildModuGraph 16 参签名保留：[graph.ts:353-415](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts#L353-L415) |

**关键限制（影响"策略可替换"评级）**：扩展是**纯增量**——
- 注册节点与内置同名时**内置优先、扩展跳过并告警**（[spec.ts:272-281](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/spec.ts#L272-L281)）；
- 边只能新增，不能删除或重定向内置静态边。

即场景包可以"加挂旁路/子图"，但不能"改写默认主干"。

### 3.5 观测：★★☆☆☆ → ★★★★☆（boot 已接线）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 统一 boot | ✅ | `boot_observability` 进程内幂等，按 structured/tracing/metrics 三开关门控：[boot.ts:55](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/observability/boot.ts#L55)；factory 首步即调用：[factory.ts:505](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L505) |
| 埋点数据源 | ✅ | record_tool_call 已在工具适配器调用：[tool-adapter.ts:354](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-adapter.ts#L354)；LLM tokens/重试/指标在装配链接线：factory.ts:645-654 |
| 持久化事件日志 | ✅ | `start_persistent_event_log_from_config` 已接入：[factory.ts:522](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L522) |

**差距**：三项能力默认全部 false（默认 no-op）；观测"可用且会接线"，但需宿主显式启用。

### 3.6 权限：★☆☆☆☆ → ★★★☆☆（引擎成立，三阶段通一）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 统一契约 | ✅ | PolicyStage（input/tool/output）、PolicySubject/Context、PolicyEffect（allow/deny/require_approval）、PolicyRule、PolicyEngine：[policy.ts:25-152](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/policy.ts#L25-L152) |
| 引擎实现 | ✅ | `DefaultPolicyEngine`（按 stage 分桶、priority 升序、首个非 allow 短路、逐项隔离、默认 allow）；`NoopPolicyEngine`：[policy-engine.ts:38-94](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/policy-engine.ts#L38-L94) |
| 规则收敛 | ✅ 三规则 | tool_approval（**委派** decideToolApprovals，零重写）、input_guard、output_guard（委派 sanitizeOutput）：[policy-rules.ts:58-317](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/security/policy-rules.ts#L58-L317) |
| **接入主链路** | △ **仅 tool 阶段** | human_review 在 `policy.engine.enabled=true` 时经引擎判定，异常/形状不符自动降级直调：[nodes.ts:1848-1991](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts#L1848-L1991)；**input/output 决策已登记但主链路未消费**（刻意避免双实现） |
| 策略可替换 | ✅ | registerPolicyRule/registerPolicyEngine，幂等注册、宿主优先 |

**差距**：① 默认引擎为 Noop 且 `policy.engine.enabled=false`（runtime-config.ts:1973 附近读取处）；② 输入/输出护栏实际仍走感知管道旧路径，PolicyEngine 在这两阶段是"登记面"而非"执行面"，统一判定入口尚未完全闭环。

### 3.7 底座契合度矩阵（实测）

| 能力 | 抽象接口 | 实现多态 | 已接入主链路 | 策略可替换 | 判定 |
|---|:---:|:---:|:---:|:---:|---|
| 模型路由 | ✅ | ✅ | ✅ | ✅ | **合格** |
| 工具协议 | ✅ | ✅ | ✅ | △ | **合格** |
| 记忆 | ✅ | ✅¹ | ✅ | ✅ | **合格** |
| 编排 | ✅ | ✅ | ✅ | △² | **合格** |
| 观测 | ✅ | ✅ | ✅ | ✅ | **合格** |
| 权限 | ✅ | ✅ | △³ | ✅ | **大半完成** |

> ¹ 内置实现仅 1 个；² 扩展纯增量，不能覆盖内置主干；³ 仅 tool 阶段被消费。

---

## 4. 上层场景包验证（四要素）

### 4.1 领域知识：★★☆☆☆ → ★★★☆☆（机制链路已闭环）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 领域注册表 | ✅ | `DOMAIN_ADAPTERS` 默认空（不内置任何领域）、register/get：[domain-adapters.ts:40-62](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/domain-adapters.ts#L40-L62) |
| markdown 装配器 | ✅ **已接线** | `registerDomainsFromMarkdown` 在 factory 中被调用（基线零调用已修复）：[factory.ts:761-768](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L761-L768)；扫描 `<root>/config/domains/*.md`：[markdown-loader.ts:268-298](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/markdown-loader.ts#L268-L298) |
| 四层组装消费 | ✅ | `PromptComposer.compose` 贯通 systemCore/domain/taskSpec/runtimeContext：[prompt-composer.ts:46-72](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/prompt-composer.ts#L46-L72)；factory 调用：factory.ts:773-789 |

**差距**：① 全链路受 `react_optimization.prompt_composer.enabled`（默认 false）门控，且 `config/domains/` 目录实测不存在，默认运行领域仍为空；② 无 pack 目录约定，知识资产无法随包分发；③ 知识索引（knowledge-index）未接入运行时检索。

### 4.2 SOP 流程：★★☆☆☆ → ★★★☆☆（子图可注册，类型仍写死）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 共识策略抽象 | ✅ | `ConsensusStrategy` + `MajorityVoteStrategy`（Jaccard 相似度分组）+ LLM judge，配置选择：[consensus.ts:51-80](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/consensus.ts#L51-L80) |
| 子图可注册 | ✅ **新增能力** | registerSubgraph → 真子图节点挂载（T-20）：[spec.ts:289-330](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/spec.ts#L289-L330) |
| 内置模板集中 | ✅ | 8 类内置 Prompt 模板迁入唯一事实源并可注册：[prompt-templates.ts:102-292](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/prompt-templates.ts#L102-L292)；上下文片段/默认策略：[context-strategies.ts:28-200](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/context-strategies.ts#L28-L200) |
| 角色/步骤可扩展 | ❌ | Plan 步骤类型固定 3 类且 zod 枚举封死：[types.ts:11](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/types.ts#L11)、[:93](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/types.ts#L93)；supervisor 任务类型写死 research/coding/review（default）于提示词：[supervisor.ts:42-60](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/supervisor.ts#L42-L60)；默认拓扑传 null（用内置集合） |

**差距**：SOP 的"角色字典、步骤类型字典"不是注册表，场景化 SOP 无法以声明方式引入新角色/新步骤类型；delegation 模式已 deprecated 但未移除。

### 4.3 业务护栏：★★☆☆☆（基本未变）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 护栏可扩展 | △ | `registerGuardrailRule` 可追加/覆盖，但载体是**模块级可变数组**而非注册表：[tool-guardrails.ts:61-124](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/tool-guardrails.ts#L61-L124) |
| 预置规则硬编码 | ❌ | 5 条规则绑定 file_ops/sql_query/http_request/code_executor 等具体工具名：同上 L61-108 |
| doc_gen 业务内建 | ❌ | `doc_gen_enforce`/`doc_final_answer` 为默认拓扑固定节点：[graph.ts:575-576](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts#L575-L576)；"检测到文档任务必须调 doc_writer"的业务启发式内建于路由：[nodes.ts:686-702](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts#L686-L702) |
| 统一入口 | △ | 工具审批可经 PolicyEngine（tool 阶段），但护栏规则本身未注册为 PolicyRule，默认仍走旧路径 |

### 4.4 评估口径：★★★☆☆（未变）

| 检查项 | 结论 | 证据 |
|---|---|---|
| 口径外置 | ✅ | 数据集/阈值/CI gate/全局配置全部 YAML：[thresholds.yaml](file:///d:/Administrator/Desktop/pioneering/packages/evals/metrics/thresholds.yaml)；加载器：[config-loader.ts:157-189](file:///d:/Administrator/Desktop/pioneering/packages/evals/src/config-loader.ts#L157-L189) |
| 指标实现 | ❌ 写死 | 11 个指标（output 4/process 5/system 2）由内置 `createMetricGroups` 产出：[metrics.ts:243](file:///d:/Administrator/Desktop/pioneering/packages/evals/src/metrics.ts#L243) |
| 按场景切换 | ❌ | CLI 仅 `run --dataset <name>`，无 `--pack`/场景维度：[cli.ts:55](file:///d:/Administrator/Desktop/pioneering/packages/evals/src/cli.ts#L55)；数据集仅 core/edge/regression |

---

## 5. 模块间接口设计

### 5.1 已标准化的部分（评价正面）

1. **契约层纯净**：全部扩展接口位于 `core/interfaces`，零 src 内值依赖（B-6），可被任何上层/宿主独立引用，编译期擦除不引入运行时耦合。
2. **统一注册门面**：新增能力全部收口于 `ComponentRegistry`（LLM provider、memory strategy、policy、context strategy、node/edge/subgraph），命名范式统一为 `registerX / getX / listX / resolveX`，且内置注册普遍遵循"幂等 + 宿主优先 + 逐项隔离"。
3. **依赖注入**：节点不自行构造依赖，统一由 `ModuGraphDeps` 注入（[spec.ts:77-108](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/spec.ts#L77-L108)）；图扩展只声明"我需要什么"，由装配器供给。
4. **开关即回滚手段**：路由/策略/注册表/画像扩展均有单点门控，默认路径行为零变化。

### 5.2 未标准化的部分

| 问题 | 位置 | 影响 |
|---|---|---|
| 护栏规则用模块级数组，绕过注册中心 | tool-guardrails.ts:61 | 无法被 ScenarioLoader 统一调度、无生命周期/多实例隔离 |
| 内置 Prompt 模板为模块常量 | prompt-templates.ts | 虽可注册，但模板集合本身非外部可装载资产 |
| 指标实现无注册点 | evals/metrics.ts:243 | 新指标必须改 evals 源码 |
| 扩展点风格不统一 | 全局单例 registry vs 模块数组 vs 静态类 | 上层接入需记忆多套范式 |

---

## 6. 依赖关系分析（含实测）

### 6.1 自动化边界规则与实测结果

架构测试 [layer-boundaries.test.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/tests/architecture/layer-boundaries.test.ts) 对**值依赖图**（`import type` 不计）执行 7 条不变式，实测 **11/11 通过**：

| 规则 | 内容 | 实测 |
|---|---|---|
| B-0 | 无 ESM 值依赖环（三色 DFS） | ✅ 无环 |
| B-1 | 底座不得 import kernel/packs | ✅（kernel/packs 尚不存在，真空成立） |
| B-2 | 底座不得 import 业务模块 | ✅ |
| B-3 | 仅装配入口（index.ts/factory.ts）可 import kernel | ✅（真空成立） |
| B-4 | packs 不得 import src 内部 | ✅（真空成立） |
| B-5 | runner 不依赖 packs/kernel | ✅ |
| B-6 | core/interfaces 零 src 值依赖 | ✅ |

> 口径备注：扫描器已修复跨行 import 漏检（正则 `[^'";]`）并剥离注释防自环，引用此测试作为证据时仅覆盖值依赖。

### 6.2 依赖方向判定

- **上层 → 底层单向依赖成立**：业务模块（nodes/factory/graph/plan-execute/subgraph 等）依赖底座，反向零边（B-2 实测）。
- **底座内部无环**：`spec.ts ↔ registry.ts` 仅存在 `import type` 类型环，运行时无环（B-0）。
- **"场景包之间耦合"不适用**：当前不存在多个场景包。但前瞻性风险明确——所有注册基于**进程内全局单例**（getRegistry/getPromptRegistry），多场景包并存时共享同一注册空间，同名即覆盖/跳过，**缺少按 pack 的命名空间与激活隔离**，未来易产生包间隐性干扰。
- **宿主侧实测**：仓库内仅 3 个文件消费 modu-agent（backend-ts agent-bridge/agent 路由、desktop agent-runtime），且**全部只用高层 API**（create_agent/get_runner/stream/resume），无任何宿主代码调用 register* 扩展点——说明扩展机制虽完备但尚无真实使用方验证。

### 6.3 编译与测试基线实测复现

| 验证项 | 实施计划声称 | 本次实测 | 结论 |
|---|---|---|---|
| TypeScript 编译（tsconfig.build.json） | 零错误 | **exit 0** | ✅ 一致 |
| 全量 vitest | 884 passed / 7 failed | **884 passed / 7 failed**（70 文件） | ✅ 精确复现 |
| 失败项 | 仅 tests/tools/sql-query.test.ts（better-sqlite3 原生绑定缺失，SQL_003/SQL_004） | 同文件 7 例，错误码因绑定缺失前移 | ✅ 环境问题，非回归 |
| 架构测试 | T-24 全绿 | 11/11 | ✅ |

另实测配置消费审计（G-2/L7）基线：`UNDECLARED_CONSUMED_KEYS=[]`，`DECLARED_UNCONSUMED_KEYS` 为 10 项（6 个 deep_parsing 语义解析键、event_log 2 键、context_reduction、compact_completed_steps）：[capability-registry.ts:363-404](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/capability-registry.ts#L363-L404)，增量门禁有效。

---

## 7. 可扩展性评估

### 7.1 新场景包接入成本（当前实况）

以"接入一个新业务场景（领域 + SOP + 护栏 + 口径）"为例，当前需要：

| 步骤 | 当前方式 | 是否需改框架源码 |
|---|---|---|
| 1. 领域知识 | 手写 `registerDomainAdapter` 或放 `config/domains/x.md` + 打开 prompt_composer | 否（但需改配置/写代码） |
| 2. SOP | 调 registerNodeSpec/registerSubgraph 加节点与子图；**新角色/新步骤类型无法加**（枚举封死） | 加角色需改源码 |
| 3. 护栏 | 手写 `registerGuardrailRule`（模块数组） | 否（写宿主代码） |
| 4. 口径 | evals 加载器接受 filePath 参数，可指向外部 YAML；但无 CLI 入口、新指标需改源码 | 部分 |
| 5. 一键激活 | **不存在**：无 manifest 消费者、无 activate(host) 装配入口 | — |

**结论**：单点扩展成本低（注册式、DI、开关回滚齐全）；但"整包接入"成本高——无统一装载器、无清单驱动、无命名空间隔离，且无法覆盖内置主干（同名内置优先、边不可删改）。当前形态更接近"**可注册的框架**"而非"**可插拔场景包的平台**"。

### 7.2 底层变更对上层的影响面

| 底层变更类型 | 对上层影响 | 原因 |
|---|---|---|
| 新增接口字段/新增注册项 | 低（向后兼容） | 接口普遍全 optional，deps 集中注入 |
| 修改接口签名/内置默认行为 | 中 | 全仓共享全局单例与默认拓扑，影响面靠 tsc + 884 测试兜底，但无 pack 级隔离 |
| 修改默认主干节点/静态边 | 高 | 扩展不可覆盖主干，所有场景共同承担变更 |
| 热替换组件 | 已支持 | swapComponent：registry.ts:646 |

---

## 8. 差距清单（按重要性）

| # | 差距 | 影响的目标 | 证据 |
|---|---|---|---|
| G-1 | **无 packs/ 目录约定与 ScenarioLoader/ScenarioHost**（P3-B/C 未开工） | 上层"可插拔场景包"总目标 | 目录实测不存在；ScenarioHost 仅存于测试注释 |
| G-2 | PluginManifest 无生产消费者，场景包无法声明归属与能力 | 症结③ | 全仓引用仅测试 + re-export |
| G-3 | PolicyEngine 的 input/output 决策未接入主链路 | 权限统一入口 | nodes 仅 tool 阶段消费 |
| G-4 | 护栏规则、SOP 角色/步骤类型写死，非注册表 | 业务护栏/SOP 可插拔 | tool-guardrails.ts:61；types.ts:11；supervisor.ts:42 |
| G-5 | 图扩展纯增量，不能覆盖/裁剪内置主干 | 场景定制深度 | spec.ts:272-281 |
| G-6 | evals 无 pack 维度、指标实现硬编码 | 评估口径按场景切换 | cli.ts:55；metrics.ts:243 |
| G-7 | 全局单例注册无命名空间/激活隔离 | 多场景包并存 | registry.ts 全局单例 |
| G-8 | 死代码/未实现配置残留：ObservationMemory、BaseLLMReasoner、10 个悬挂配置键 | 底座整洁度 | capability-registry.ts:393-404 |
| G-9 | 新能力默认全部关闭且无真实宿主使用 | 机制有效性待验证 | apps 三处消费均不用扩展 API |

---

## 9. 改进建议（按优先级）

### P3-B · 场景包载体（收益最高，建议优先）

1. **落地目录约定与装配层**：新建 `src/kernel/scenario-loader.ts` + `packs/<name>/` 目录（pack.yaml + domain/sop/guardrails/prompts/eval），实现 `ScenarioLoader.activate(packDir, host)`：manifest 驱动、按 capabilities 分派、逐能力 try/catch 隔离（直接复用评估报告 §7.3 已给出的契约设计与 skills/loader 范式）。
2. **激活 PluginManifest**：将现有 parse/load 能力接入 loader，使症结②③同时关闭；B-1/B-3/B-4 由"真空成立"转为实检。
3. **注册表增加命名空间/作用域**：支持按 pack 前缀注册与卸载（deactivate），避免多包共享单例互相污染。

### P3-C · 主链路收口

4. **接通 PolicyEngine 全阶段**：让感知节点/输出节点消费 input/output 决策（或显式废弃这两阶段），消除"登记面 vs 执行面"双轨；护栏规则注册为 PolicyRule，逐步移除模块级数组。
5. **SOP 字典化**：将角色集合、PlanStepTaskType 从硬编码枚举改为可注册字典（zod 校验改为注册表白名单），使新 SOP 类型可由包引入。

### P3-D · 扩展深度与评测联动

6. **允许受控覆盖**：为 NodeSpec/EdgeSpec 增加显式 `override: true` 策略或"边禁用"能力，使场景包能在明确声明下改写主干，而非只能旁路叠加。
7. **evals pack 维度**：CLI 增加 `--pack`，按包加载 datasets/thresholds/gates；为指标实现增加注册点。
8. **清理遗留**：按 D-15~D-18 决策 ObservationMemory/BaseLLMReasoner 去留；处置 10 个悬挂配置键（接线或删除）；构建 better-sqlite3 原生绑定以消除 7 例环境失败。

---

## 10. 结论

1. **底座目标基本达成**：对照基线，模型路由、记忆、编排、观测四项从"半成品/未分离"升至"合格"，权限大半完成；六要素中五个具备"抽象接口 + 实现多态 + 已接入主链路 + 策略可替换"的合格特征，且有层边界测试、配置消费审计、884 项测试与零错误编译作为长期护栏。
2. **场景包目标尚未闭环**：上层四要素的**机制**（注册表/装配器/组装器）已就位并多为真消费，但**载体**（packs 目录、manifest 驱动的 ScenarioLoader、ScenarioHost 隔离）完全缺失；业务护栏与 doc_gen 仍内建于框架，评估口径无法按场景切换。
3. **总体评定**：架构分层解耦设计在代码中的实现度约 **70%**——"分层"已从结构层深入到运行层，"解耦"已在底座侧成立；距离最终目标的关键一跃是 P3-B/C：**把"可注册的框架"升级为"可装载场景包的平台"**。基线报告提出的目标架构与契约（§7）至今仍可直接作为该阶段的实施方案。

---

## 附录：关键证据索引

| 主题 | 位置 |
|---|---|
| GraphSpec 契约与构建 | [spec.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/spec.ts) |
| 默认拓扑声明 | [graph.ts:511-778](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts#L511-L778) |
| 装配入口 create_agent | [factory.ts:492-963](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts#L492-L963) |
| 统一注册中心 | [registry.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/registry.ts) |
| Policy 契约/引擎/规则 | [policy.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/interfaces/policy.ts)、[policy-engine.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/core/policy-engine.ts)、[policy-rules.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/perception/security/policy-rules.ts) |
| 记忆策略 | memory-strategy.ts、[base-store-strategy.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/memory/base-store-strategy.ts) |
| 模型路由/Provider | [router.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/router.ts)、[llm-provider-registry.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/llm-provider-registry.ts) |
| 观测 boot | [boot.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/observability/boot.ts) |
| 领域知识/组装 | [domain-adapters.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/domain-adapters.ts)、[prompt-composer.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/reasoning/prompt-composer.ts) |
| 护栏 | [tool-guardrails.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/tools/tool-guardrails.ts) |
| 架构边界测试 | [layer-boundaries.test.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/tests/architecture/layer-boundaries.test.ts) |
| 配置消费审计基线 | [capability-registry.ts:363-404](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/config/capability-registry.ts#L363-L404) |
| 评测 | packages/evals（thresholds.yaml、metrics.ts、cli.ts、config-loader.ts） |
