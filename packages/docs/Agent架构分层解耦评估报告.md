# Agent 架构分层解耦评估报告

> **评估对象**：`packages/modu-agent`（326 个 TS 文件 / 约 3.5 万行）+ `packages/evals`
> **评估标准**：底层六要素（模型路由、工具协议、记忆、编排、观测、权限）应做成**通用底座**；上层四要素（领域知识、SOP 流程、业务护栏、评估口径）应做成**可插拔场景包**。
> **评估日期**：2026-09-29
> **评估方式**：逐文件精读 + 全仓引用检索（证据均标注 `文件:行号`）

---

## 1. 总体结论

### 1.1 一句话判定

**当前架构"分层存在、解耦未完成"。** 目录与模块边界已经按六要素/场景包切分（`src/{reasoning,tools,memory,graph,observability,perception/security}` + `packages/evals`），但**层与层之间的接口契约只有一小部分成立**：

- **真正合格的通用底座只有 1 个**：**工具协议**（`BaseTool` 统一契约 + 三套工具归一 + 通用中间件）。
- **半成品 3 个**：记忆、编排、观测——有抽象但策略不可替换或存在大量死配置/未接线 API。
- **未分离 2 个**：模型路由、权限——接口/规则已写，但**未接入主链路**或规则散落无统一判定入口。
- **上层场景包 0 个真正成立**：全部为"半可插拔（有机制、默认关闭、覆盖不全）"或"硬编码在源码"。

### 1.2 分层契合度总览

| # | 层 | 归属 | 判定 | 契合度 | 一句话理由 |
|---|---|---|---|---|---|
| 1 | 模型路由 | 底座 | **未分离** | ★☆☆☆☆ | `LLMRouter` 接口+实现+配置齐全，但 `build` 函数**零调用**；provider 双轨硬编码映射表 |
| 2 | 工具协议 | 底座 | **合格** | ★★★★☆ | `BaseTool` 框架无关；内置/MCP/Skill 三路归一到同一协议+注册表+中间件 |
| 3 | 记忆 | 底座 | **半成品** | ★★☆☆☆ | 三套并行抽象（`BaseMemory`/`BaseStore`/`ObservationMemory`）；策略无消费点 |
| 4 | 编排 | 底座 | **部分分离** | ★★☆☆☆ | 18 节点拓扑硬编码于 `buildModuGraph`；模式靠 if/else 增删节点 |
| 5 | 观测 | 底座 | **半成品** | ★★☆☆☆ | 协议选型正确（OTel/prom-client），但 5 个死配置 + 大量 API 无消费者 |
| 6 | 权限 | 底座 | **未分离** | ★☆☆☆☆ | 无 `PolicyEngine`；规则散落 4 处；输出护栏与 11/12 审计事件未接线 |
| 7 | 领域知识 | 场景包 | **半可插拔** | ★★☆☆☆ | `DOMAIN_ADAPTERS` 注册表默认空且装配器未接线；知识索引未接入运行时 |
| 8 | SOP 流程 | 场景包 | **半可插拔** | ★★☆☆☆ | consensus 是 `if` 工厂非注册表；角色/步骤类型写死，角色集合无法扩展 |
| 9 | 业务护栏 | 场景包 | **半可插拔** | ★★☆☆☆ | `registerGuardrailRule` 可扩但规则硬编码且默认关闭；`doc_gen` 无开关 |
| 10 | 评估口径 | 场景包 | **已外置（口径）/ 硬编码（实现）** | ★★★☆☆ | 数据集/阈值/gate 全 YAML 化，但指标实现写死、无"按场景切换口径" |

### 1.3 核心症结：三层"混淆"

```
        ┌──────────────────────────────────────────────┐
        │  上层场景包（领域/SOP/护栏/口径）              │
        │  现状：绝大部分 = 源码内硬编码，无统一加载器    │  ← 症结③ 场景包无处声明
        ├──────────────────────────────────────────────┤
        │  能力层（Skill / Prompt / Context）            │
        │  现状：半成品，机制存在但默认关闭且覆盖不全      │  ← 症结② 装配靠"手动接线"
        ├──────────────────────────────────────────────┤
        │  通用底座（路由/工具/记忆/编排/观测/权限）      │
        │  现状：工具合格，其余半成品或未接线              │  ← 症结① "已实现未接线"
        └──────────────────────────────────────────────┘
```

- **症结①「已实现未接线」**：框架里存在大量"接口 + 实现 + 配置项"三件套齐全、但**没有任何生产调用点**的能力（见第 6 节清单）。这是"看起来分层了、实际没通电"的根因。
- **症结②「装配靠手动」**：`registerDomainAdapter`、`registerGuardrailRule`、`registerToolCapability`、`registerDomainsFromMarkdown` 都只能由宿主**手写代码调用**，没有"从场景包目录自动装配"的加载器。
- **症结③「场景包无处声明」**：`PluginManifest` 已定义（`config/plugin-manifest.ts:24-126`）却**无任何消费者**（全仓引用仅自身 + `config/index.ts` re-export）。场景包无法声明"我属于哪个 domain、用哪套 SOP/护栏/评估口径"。

---

## 2. 评估方法与口径

- **分层标准**：底层能力应对上层**零业务假设**，可独立替换而不改上层；上层能力应能在**不改框架源码**的前提下新增/切换。
- **判定等级**：
  - **合格通用底座**：接口清晰 + 实现多态 + 已接入主链路 + 策略可替换。
  - **半成品**：有抽象或已接线，但存在"未接线 / 默认关闭且覆盖不全 / 死配置"。
  - **未分离**：能力未进入运行时，或与具体业务/实现强耦合、无抽象接口。
- **证据规则**：所有结论必须能定位到 `文件:行号`；对"未接线"类结论做**全仓引用检索**交叉验证。

---

## 3. 底层通用底座评估（六要素）

### 3.1 模型路由 —— 未分离（最弱环）★☆☆☆☆

**应有形态**：`LLMRouter.route(ctx) → ModuLLM`，按 task_type/复杂度/成本选模型，provider 可注册。

**现状**：

| 检查项 | 结论 | 证据 |
|---|---|---|
| 路由接口 | ✅ 定义清晰 | `core/interfaces/llm.ts:202-205`（`route(ctx)`）；上下文 `:180-191`（含 `taskType/estimatedComplexity/costBudget`） |
| 规则匹配 | ✅ 支持 task_type/复杂度/成本预算 | `reasoning/llm/router.ts:27-32`（`RouteRuleCondition`）、`:57-71`（`_matchCondition`） |
| **是否接入运行时** | ❌ **零调用** | `_build_llm_router` 定义于 `graph/factory.ts:312`、导出 `graph/index.ts:67`，**全仓无调用点**；`create_agent` 从不构造 router |
| 默认状态 | 关闭且规则为空 | `llm.router.enabled=false`（`config/runtime-config.ts:56`）；`rules` 默认 `[]`（`:62-66`） |
| provider 扩展 | ❌ 双轨 + 硬编码 | LangChain 路径映射表 `graph/adapters/llm-adapter.ts:22-51`；自研路径硬导出 `reasoning/llm/index.ts:8-12` |
| 双轨一致性 | ❌ 同 provider 两套约定 | `llm-adapter.ts:37-42`（`OPENAI_API_KEY`/`gpt-4o-mini`）vs `reasoning/llm/gpt.ts:23-25`（`MODU_OPENAI_API_KEY`/`gpt-4o`） |
| 成本追踪 | ✅ 干净解耦 | `reasoning/llm/cost-tracker.ts:36-57` 只接收 `usage`+上下文，不 import provider |

**次要问题**：`BaseLLMReasoner`（`reasoning/llm/base-llm.ts:56`）已标 `@deprecated`，其 `_buildMessages`（`:627-664`）承担 system prompt 组装——**上层 prompt 职责下沉到传输层**；新路径 `invoke(messages)`（`:168`）已剥离该污染。

**判定**：**未分离**。能力"写好但没插上电"，且新增 provider 需改 2 处硬编码。

---

### 3.2 工具协议 —— 合格通用底座（本框架最扎实环节）★★★★☆

**应有形态**：框架无关的 `BaseTool` 契约 + 统一注册表 + 通用中间件（审批/重试/限流/缓存），新增工具零胶水。

**现状**：

| 检查项 | 结论 | 证据 |
|---|---|---|
| 契约框架无关 | ✅ 纯 TS 抽象类，零 LangChain 依赖 | `core/interfaces/action.ts:25-138`（`name/description/parametersSchema/invoke`） |
| 审批契约 | ✅ 静态 + 动态 + 拒绝回调 | `action.ts:39`（`requiresApproval`）、`:56`（`requiresApprovalFor`）、`:67`（`onApprovalRejected`） |
| 三套工具归一 | ✅ 内置/MCP/Skill 同一协议同一注册表 | 内置 `registry.ts:115`；MCP `mcp-tool-adapter.ts:38`；Skill `registry.ts:206-236`；统一出口 `tool-adapter.ts:326` → `ToolNode`（`graph.ts:502`） |
| 重试/限流/缓存 | ✅ adapter 层通用中间件 | `retry.ts:102`、`rate-limiter.ts:33`、`tool-result-cache.ts:39`，统一在 `tool-adapter.ts:253-306` 应用 |
| 新增工具成本 | ✅ 实现 4 方法 + 一行注册 | `registry.ts:115` |

**扣分项（半分离残留）**：
- 能力矩阵 `TOOL_CAPABILITY_MATRIX` 只硬编码 7 个内置工具（`tools/tool-registry.ts:61-133`），MCP/Skill 工具**不会自动同步**，需宿主手动 `registerToolCapability`（`:140`）——第三方工具默认"能力未知"。
- Guardrail 预置规则绑定具体工具名（`tools/tool-guardrails.ts:61-108`）。
- 审批**执行**分散在 `human_review` 图节点（`graph/nodes.ts:1803-1915`）而非 adapter 中间件。

**判定**：**合格底座**（建议将能力矩阵随注册自动同步、审批判定收敛为中间件）。

---

### 3.3 记忆 —— 半成品 ★★☆☆☆

**应有形态**：统一 `BaseMemory` 契约 + 可替换的 namespace/embedding/chunking + 按任务挂载策略。

**现状**：

| 检查项 | 结论 | 证据 |
|---|---|---|
| 接口存在 | ✅ `BaseMemory`（query/update）+ `BaseStorageAdapter` | `core/interfaces/memory.ts:8-20,26-32` |
| 短期/Chroma 实现 | ✅ 遵守接口 | `memory/short-term-memory.ts:19`、`memory/chroma.ts:62` |
| **抽象不统一** | ❌ 三套并行 | `ObservationMemory`（`memory/observation-memory.ts:94`）**不继承** `BaseMemory`；LangGraph `BaseStore` 桥（`graph/adapters/store-adapter.ts:113,327`）为第三套 |
| 策略可配置 | ❌ 死配置 | `memory.default_strategy` 已声明（`config/runtime-config.ts:70`）但**运行时无消费点**；`context_window/enable_compression` 亦无读取 |
| 命名空间 | ❌ 硬编码 | `memory/chroma.ts:199`（`${collectionPrefix}_${userId}`）；查询侧 `nodes.ts:331`（`[userId,'knowledge']`） |
| chunking | ❌ 无切分层 | `memory/chroma.ts:280` 直接 `text = newData.text` |
| embedding | △ 可代码注入，非配置驱动 | `memory/chroma.ts:186-191`（`setEmbeddingFunction`），默认为哈希降级 |
| 知识索引/MD 持久化 | ❌ 未接线 | `config/knowledge-index.ts:9-11`、`config/memory-md-persistence.ts:9-11` 自述"不接入运行时路径" |

**判定**：**半成品**。记忆是"三套并行实现 + 未消费的配置"，无法按场景包挂载差异化记忆策略。

---

### 3.4 编排 —— 部分分离 ★★☆☆☆

**应有形态**：图拓扑由 `GraphSpec`（节点/边可注册）驱动；模式组合是"声明"而非"分支"。

**现状**：

| 检查项 | 结论 | 证据 |
|---|---|---|
| 拓扑来源 | ❌ 命令式硬编码 | `graph/graph.ts:349-762` `buildModuGraph`；18 节点静态 `import`（`:26-48`）、`addNode` 于 `:492-534` |
| 模式切换 | ❌ if/else 增删节点 | `graph.ts:371-395`（4 个布尔）、`:557-620`（三套并列建图分支） |
| 子图 | △ plan-execute 非真子图 | `planner/step_dispatch/step_finalize` 内联进同一 `StateGraph`（`graph.ts:530-534`），共享主 state；对比真子图 `graph/subgraph/builder.ts:98-211` |
| 节点/子图注册表 | ❌ 无 | `graph/index.ts` 全为具名导出，无注册入口 |
| 组件注册表 | ✅ 存在但不含拓扑 | `core/registry.ts:43`（11 类组件 + `swapComponent:270`） |
| 大函数 | △ 扩展阻力 | `agentNode`（`graph/nodes.ts:879-1240`）、`buildModuGraph`（约 400 行）、`create_agent`（`graph/factory.ts:450-717`，14 位置参数） |

**判定**：**部分分离**。运行器（`graph/runner.ts`）职责清晰、无需重构；但建图与拓扑是"封闭的声明式"，外部无法注册节点/子图。

---

### 3.5 观测 —— 半成品 ★★☆☆☆

**应有形态**：标准协议 + 自动/低侵入埋点 + 可整体关闭 + 配置全部有消费者。

**现状**：

| 检查项 | 结论 | 证据 |
|---|---|---|
| 协议选型 | ✅ OTel + prom-client（可选依赖 + 动态降级） | `observability/tracing.ts:179-181,207-213`；`metrics.ts:59-64,119-126` |
| 可整体关闭 | ✅ no-op 降级完整 | `tracing.ts:38-72,235-237`；`metrics.ts` 各 `record_*` 立即 return |
| 埋点侵入度 | ✅ 极低 | 全 `src` 仅 `graph/runner.ts` 真正调用：`_span()` `:148-175`，使用点 `:581,:977`；metrics 仅 `:496,:547`；**`nodes.ts`/`graph.ts` 零埋点** |
| **死配置** | ❌ 5 个 | `observability/tracing.otlp_endpoint`（`runtime-config.ts:281`）、`service_name`(`:282`)、`sampling_rate`(`:283`)、`metrics.prometheus_port`(`:287`)、`path`(`:288`) 均无消费者 |
| **未接线 API** | ❌ 大量 | `configure_otlp_exporter`（`exporters.ts:34`）、`start_prometheus_server`（`:159`）、`configure_structured_logging`（`logging-config.ts:201`）**零调用**；`record_tool_call`(`metrics.ts:212`)、`record_llm_tokens`(`:237`)、`record_evolution`、`record_consensus_failure` 等**零消费者** |
| 事件总线 | △ 仅单进程 | `message-bus.ts:60-166` 内存实现；`event-bus-adapter.ts:70` 跨进程仅有接口无实现；`PersistentEventLog`（`message-bus.ts:192`）**从未实例化** |

**判定**：**半成品**。协议与降级设计正确、侵入度低，但**指标基本无数据源**，观测模块从未被框架 boot 调用（无启用入口）。

---

### 3.6 权限 —— 未分离 ★☆☆☆☆

**应有形态**：统一 `PolicyEngine.decide(action, context)`，输入/工具/输出三层护栏共用判定入口，审计可替换 sink。

**现状**：

| 检查项 | 结论 | 证据 |
|---|---|---|
| 统一判定入口 | ❌ 无 | 规则散落 4 处：`perception/security/guard.ts` 正则库、`tools/tool-guardrails.ts:61-108` 规则数组、`graph/nodes.ts:1803-1827` 内联函数、各工具 `requiresApproval*` |
| 输入护栏 | △ 已接入但只评分不阻断 | `perception/security/guard.ts:96`，集成 `perception/text/rule-based.ts:234-236` |
| 输出护栏 | ❌ 未接线（死代码） | `guard.ts:312`（`detectOutputSensitive`）、`:369`（`sanitizeOutput`）**零调用** |
| 工具审批 | △ 契约统一、执行分散、默认关闭 | 契约 `action.ts:39/56`；执行 `nodes.ts:1842-1937`；开关默认 `false`（`runtime-config.ts:134`） |
| 审计 | ❌ 12 类仅接线 1 类、无落盘 | `audit.ts:25-37` 定义 12 类事件，仅 `rate-limiter.ts:120` 发布；`PersistentEventLog` 无实例化 |
| HITL 路由 | ❌ 硬编码 | 节点插入 `graph.ts:517`、路由目标 `graph.ts:627-628`、`routeAfterHumanReview` `graph.ts:645-652` |

**判定**：**未分离**。安全能力是"散落的规则函数 + 硬编码图节点"，无策略抽象，且大部分护栏未接线。

---

## 4. 上层可插拔场景包评估（四要素）

### 4.1 领域知识 —— 半可插拔 ★★☆☆☆

| 检查项 | 结论 | 证据 |
|---|---|---|
| 领域适配注册表 | ✅ 存在且被消费 | `reasoning/domain-adapters.ts:40`（`DOMAIN_ADAPTERS`）+ `prompt-composer.ts:59-61`；接线 `factory.ts:598-605` |
| 内置领域 | ❌ 默认空 | `domain-adapters.ts:40` 无任何内置项 |
| 批量装配器 | ❌ 未接线 | `registerDomainsFromMarkdown`（`:103`）仅定义+导出，**运行时未调用**（`factory.ts` 未引用） |
| 总开关 | ❌ 默认关闭 | `prompt_composer.enabled=false`（`runtime-config.ts:336-338`） |
| 知识库 | ❌ 未接入运行时 | `config/knowledge-index.ts:9-11` 自述"不接入运行时路径"；与运行时 `state.knowledge`（`nodes.ts:998-1012`）为两套平行实现 |
| namespace/embedding/chunking | ❌ 不可配 | `chroma.ts:199`（硬编码集合名）、`:280`（无切分）、`:186`（embedding 仅代码注入） |

**判定**：**半可插拔**——注册表范式正确，但"默认空 + 装配器未接线 + 开关默认关"，等于**实际未启用**。

---

### 4.2 SOP 流程 —— 半可插拔 ★★☆☆☆

| 检查项 | 结论 | 证据 |
|---|---|---|
| 共识策略 | △ 工厂非注册表 | `orchestration/patterns/consensus.ts:287-304`（`if` 分支）；使用于 `nodes.ts:2661-2669` |
| 委托模式 | ❌ 已废弃 | `orchestration/patterns/delegation.ts:16-20` `@deprecated`（"从未集成到主图"） |
| Planner 模板 | ❌ 硬编码 | `graph/plan-execute/prompts.ts:59-107,122-154` |
| 步骤类型 | ❌ 固定三类 | `graph/plan-execute/types.ts:11`（`reasoning\|tool_use\|delegation`，zod enum `:93`） |
| 子 Agent 角色模板 | △ 文本可覆盖、角色集合写死 | `graph/subgraph/builder.ts:27-39` 硬编码；`:54-70` 支持 `agents.<task_type>.prompt` 覆盖（该键未在 `DEFAULT_CONFIG` 声明）；`supervisor.ts:42`（`_DEFAULT_TASK_TYPES` 写死） |
| 角色配置通路 | ❌ 断链 | `graph.ts:467` `make_supervisor_node(null, null, ...)` 传 `null` → 永远走默认三元组 |

**判定**：**半可插拔（覆盖不全）**。要新增任务角色/步骤类型**必须改源码**。

---

### 4.3 业务护栏 —— 半可插拔 ★★☆☆☆

| 检查项 | 结论 | 证据 |
|---|---|---|
| 工具护栏注册 | ✅ 有接口 | `tools/tool-guardrails.ts:115-124`（`registerGuardrailRule`） |
| 预置规则 | ❌ 硬编码 5 条 + 绑定具体工具 | `tool-guardrails.ts:61-108` |
| 默认状态 | ❌ 关闭 | `react_optimization.action_guardrails.enabled=false`（`runtime-config.ts:348-351`） |
| 运行时接线 | ✅ 已接入 human_review | `nodes.ts:1892-1900` |
| 输入护栏规则 | ❌ 正则硬编码无注册表 | `perception/security/guard.ts:19-78` |
| 防幻觉 prompt | ✅ 可整体替换 | `factory.ts:75-114` 常量，替换点 `:546-547`（宿主传参即可） |
| doc_gen 强制流程 | ❌ 完全硬编码 | 判定 `nodes.ts:709-763`、节点 `:774-801`、注册 `graph.ts:506`，**无任何开关** |

**判定**：**半可插拔**。护栏有注册接口（可用于场景包），但预置规则耦合内建工具、默认关闭；`doc_gen` 业务流程是纯硬编码。

---

### 4.4 评估口径 —— 口径已外置 / 实现硬编码 ★★★☆☆

| 检查项 | 结论 | 证据 |
|---|---|---|
| 数据集 | ✅ YAML 外置 | `evals/data/datasets.yaml`（smoke/full/regression/dev + `sources/include/sample/filter`） |
| 指标口径 | ✅ 三层 + 阈值 YAML 外置 | `evals/metrics/thresholds.yaml:19-80`（output/process/system，含 weight/threshold/gate） |
| 门禁 | ✅ YAML 外置 | `evals/gates/ci_gates.yaml:17-84`（ci/release，`block\|warn`） |
| Judge 口径 | ✅ 可配 | `evals/config/global.yaml:43-50`（`rule\|llm\|hybrid`） |
| **指标实现** | ❌ 硬编码 TS | `evals/src/metrics.ts:92-249`（key 固定、`createMetricGroups:243-249` 硬组装、`SystemMetricGroup` 阈值 `0.5/0.6` 写死 `:218,221`） |
| **按场景切口径** | ❌ 无机制 | `evals/src/config-loader.ts:22,158,183` 固定单份 `thresholds.yaml`/`ci_gates.yaml`；CLI 仅能覆盖 global（`cli.ts:113`） |
| 与框架耦合 | △ 真实图实例 + 全局配置单例 | `evals/src/agent-executor.ts:18-25` import `create_agent/overrideConfig`，`overrideConfig` 覆盖 `getConfig()` 单例（`:64-72`） |

**判定**：**口径层已可插拔、实现层硬编码、缺场景维度**。是四类上层中**最接近场景包的一类**，可作为其余三类的范式参考。

---

## 5. 分层解耦契合度矩阵

| 能力 | 抽象接口 | 实现多态 | 已接入主链路 | 策略可替换 | 判定 |
|---|:---:|:---:|:---:|:---:|---|
| 模型路由 | ✅ | ✅ | ❌ | ✅ | 未分离 |
| 工具协议 | ✅ | ✅ | ✅ | △ | **合格** |
| 记忆 | ✅ | ✅ | ✅ | ❌ | 半成品 |
| 编排 | ❌ | — | ✅ | ❌ | 部分分离 |
| 观测 | ✅ | ✅ | △ | △ | 半成品 |
| 权限 | ❌ | ❌ | △ | ❌ | 未分离 |
| 领域知识 | ✅ | △ | ❌ | △ | 半可插拔 |
| SOP 流程 | ❌ | △ | ✅ | ❌ | 半可插拔 |
| 业务护栏 | ✅ | ✅ | △ | △ | 半可插拔 |
| 评估口径 | ✅ | △ | ✅ | △ | 口径合格/实现硬编码 |

> **图例**：✅ 成立 / △ 部分 / ❌ 不成立。理想状态下"抽象接口 / 实现多态 / 已接入 / 策略可替换"四列**全部为 ✅** 才构成合格分层。

**读法**：**没有任何一层的四列全绿**——最接近的是工具协议（仅"策略可替换"为部分）；模型路由缺"已接入"与"策略可替换"；编排缺"抽象接口"。

---

## 6. 关键发现：八类"已实现未接线"清单（本次评估最重要的产出）

以下能力**代码完整、有配置项、有导出，但全仓无生产调用点**（已用全仓引用检索交叉验证）。这是"看似分层、实未通电"的直接证据：

| # | 能力 | 定义位置 | 状态 |
|---|---|---|---|
| 1 | **LLM 路由器** | `graph/factory.ts:312` `_build_llm_router`（导出 `graph/index.ts:67`） | 零调用；`create_agent` 从不装配 → **模型路由完全未生效** |
| 2 | **OTLP / Prometheus 导出** | `observability/exporters.ts:34`、`:159` | 零调用 → 指标无法外发 |
| 3 | **结构化日志配置** | `observability/logging-config.ts:201` | 零调用 → 观测模块从未 boot |
| 4 | **指标记录 API** | `observability/metrics.ts:212,237`（`record_tool_call`/`record_llm_tokens`）等 8+ 个 | 零消费者 → 指标无数据源 |
| 5 | **输出护栏 / 审计事件** | `perception/security/guard.ts:312,369`；`perception/security/audit.ts:25-37` | 输出护栏零调用；审计 12 类仅 1 类有发布者 |
| 6 | **插件 manifest** | `config/plugin-manifest.ts:59,95,112` | 仅自身 + `config/index.ts` re-export → **场景包加载器不存在** |
| 7 | **领域批量装配器** | `reasoning/domain-adapters.ts:103` | 零调用 → 领域需宿主手写注册 |
| 8 | **跨进程事件总线 / 持久化日志** | `orchestration/communication/event-bus-adapter.ts:70`；`message-bus.ts:192` | 仅接口无实现 / 从未实例化 |

> **结论**：框架的"分层蓝图"在代码中**基本画完**，但**缺少一个统一的 boot/装配层**把各层接起来。这解释了为什么"目录分层清晰"却"实际耦合严重"——**解耦停留在结构层面，未到运行层面**。

---

## 7. 目标架构建议：符合"六底座 + 四场景包"的落地设计

### 7.1 目标分层

```
┌───────────────────────────────────────────────────────────────┐
│ 场景包层 (Scenario Pack)  —— 可插拔，不改内核                    │
│   pack.yaml + pack/*.md                                        │
│   ├─ domain/       领域知识与适配                                │
│   ├─ sop/          SOP 流程（角色/步骤/子图 spec）                │
│   ├─ guardrails/   业务护栏规则                                  │
│   └─ eval/         评估口径（dataset/thresholds/gates）           │
├───────────────────────────────────────────────────────────────┤
│ 内核装配层 (Kernel Boot)  —— 新增，解决"未接线"                   │
│   ScenarioLoader.activate(packDir) → 分发到各注册表              │
│   PromptRegistry / ContextRegistry / PolicyEngine / GraphSpec   │
├───────────────────────────────────────────────────────────────┤
│ 通用底座层 (Base Layer)  —— 六要素，对上层零业务假设              │
│   模型路由 │ 工具协议 │ 记忆 │ 编排 │ 观测 │ 权限                  │
├───────────────────────────────────────────────────────────────┤
│ 运行时层 (Runtime)  —— 基本复用现有                                  │
│   StateGraph / Checkpointer / Runner / EventBus                 │
└───────────────────────────────────────────────────────────────┘
```

### 7.2 分层改造要点

#### 底座 1｜模型路由（未分离 → 合格）

```ts
// 1) 统一 provider 注册表，废除双轨映射表
//    src/core/interfaces/llm.ts
export interface LLMProviderFactory {
  readonly id: string
  create(cfg: LLMProviderConfig): ModuLLM
}
registry.registerLLMProvider(factory)   // 新增到 ComponentRegistry

// 2) 在 create_agent 中真正装配 router（修复零调用）
const router = _build_llm_router(rawLlm, runtimeConfig)   // factory.ts:312 已有
// 关键：把 router 用于 per-node / per-task 的模型选择
```
**动作**：① 合并 `llm-adapter.ts:22-51` 与 `reasoning/llm/index.ts:8-12` 为注册表；② 在 `create_agent` 调用 `_build_llm_router` 并接入节点；③ 删除废弃 `BaseLLMReasoner` 的 prompt 组装职责。

#### 底座 2｜工具协议（合格 → 保持 + 补齐）

- 能力矩阵随注册**自动同步**：`registry.registerTool()` 内自动生成默认 `ToolCapability`，替代手动 `registerToolCapability`（`tool-registry.ts:140`）。
- 审批判定收敛为 adapter 中间件（复用 `retry/rate-limiter/cache` 同位置），从 `human_review` 节点抽离。

#### 底座 3｜记忆（半成品 → 合格）

```ts
// src/core/interfaces/memory.ts —— 统一契约，强制异步
export interface MemoryStrategy {
  readonly id: string
  supports(taskType?: string): boolean
  recall(query, ctx): Promise<MemoryItem[]>
  persist(items: MemoryItem[]): Promise<void>
}
// 配置驱动，激活死配置 memory.default_strategy
registry.registerMemoryStrategy(strategy)
```
**动作**：① 让 `ObservationMemory` 实现统一契约；② 统一 `BaseMemory` 与 `BaseStore`（`store-adapter.ts`）为同一读模型；③ 开放 `namespace/embedding/chunking` 为配置项。

#### 底座 4｜编排（部分分离 → 合格）

```ts
// src/graph/spec.ts —— 拓扑可注册
export interface NodeSpec  { name: string; factory: (deps) => NodeFn; when?: (cfg) => boolean }
export interface EdgeSpec  { from: string; to: string | RouterFn; targets?: Record<string,string> }
export interface GraphSpec { nodes: NodeSpec[]; edges: EdgeSpec[] }

registry.registerNode(spec)         // 新增
buildFromSpec(composeDefaultGraph(profile), deps)   // 取代 buildModuGraph 的硬编码 addNode
```
**动作**：① 把 `graph.ts:492-534` 的 `addNode` 循环化为 spec；② plan-execute / multi-agent 导出为**可注册子图 spec 片段**，取代 `graph.ts:557-620` 的并列分支；③ 模式布尔（`:371-395`）退化为 profile 声明。

#### 底座 5｜观测（半成品 → 合格）

- 在 `create_agent` 中调用 `configure_structured_logging` / `configure_otlp_exporter` / `start_prometheus_server`（修复未接线）。
- 删除或接线 5 个死配置键（`tracing.otlp_endpoint` 等）。
- 在 adapter 中间件层补 `record_tool_call` / `record_llm_tokens` 埋点（保持低侵入，不污染 `nodes.ts`）。
- `PersistentEventLog` 默认实例化以承载审计落盘。

#### 底座 6｜权限（未分离 → 合格）

```ts
// src/core/interfaces/policy.ts —— 统一策略引擎
export type PolicyDecision = { effect: 'allow' | 'deny' | 'require_approval'; reason?: string }

export interface PolicyRule {
  readonly id: string
  readonly stage: 'input' | 'tool' | 'output'      // 三层护栏统一入口
  evaluate(subject: PolicySubject, ctx): Promise<PolicyDecision>
}

export interface PolicyEngine {
  use(rule: PolicyRule): void
  decide(stage, subject, ctx): Promise<PolicyDecision>
}
registry.registerPolicyRule(rule)
```
**动作**：① 把 `guard.ts` 正则、`tool-guardrails.ts` 规则、`nodes.ts:1803-1827` 内联判定收敛为 `PolicyRule`；② 接线输出护栏（`guard.ts:312,369`）；③ 审计事件全量发布 + `PersistentEventLog` 落盘；④ HITL 节点插入位置由 profile 声明，不硬编码在 `graph.ts:517,627`。

### 7.3 场景包契约（上层的统一载体）

**目录约定**：

```
packs/<pack-name>/
├── pack.yaml              # 场景包 manifest
├── domain/
│   └── <domain>.md        # 领域适配（复用 markdown-loader frontmatter）
├── sop/
│   ├── roles.yaml         # 角色定义（取代 _SYSTEM_PROMPT_TEMPLATES）
│   └── graph.yaml         # 可选：本场景专属节点/子图 spec
├── guardrails/
│   └── rules.yaml         # 业务护栏规则（registerGuardrailRule 数据源）
├── prompts/
│   └── *.md               # 任务级 prompt 模板
└── eval/
    ├── datasets.yaml
    ├── thresholds.yaml
    └── gates.yaml
```

**manifest 契约**（激活现有 `plugin-manifest.ts`）：

```ts
// config/plugin-manifest.ts 扩展（当前无消费者）
export interface ScenarioPackManifest {
  name: string
  version: string
  capabilities: Array<'domain' | 'sop' | 'guardrail' | 'prompt' | 'context' | 'eval'>
  entry?: string                     // 可选：activate(host)
  extends?: string[]                 // 继承其他场景包
  configProfile?: Record<string, unknown>   // 注入 profiles.<task_type>
}

export interface ScenarioHost {       // 装配层提供给场景包
  registry: ComponentRegistry
  prompts: PromptRegistry
  contexts: ContextRegistry
  policy: PolicyEngine
  graph: GraphSpecBuilder
  eval?: EvalRegistry
}
```

**加载器**：

```ts
// src/kernel/scenario-loader.ts（新增）—— 解决症结②③
export class ScenarioLoader {
  async activate(packDir: string, host: ScenarioHost): Promise<void> {
    const manifest = loadManifestFromFile(packDir)   // 复用现有实现
    if (!manifest) return
    // 按 capabilities 分派到对应注册表；逐能力独立 try/catch 隔离（复用 skills/loader.ts 范式）
    if (manifest.capabilities.includes('prompt'))  await this.loadPrompts(packDir, host)
    if (manifest.capabilities.includes('domain'))  await this.loadDomains(packDir, host)
    if (manifest.capabilities.includes('sop'))     await this.loadSop(packDir, host)
    if (manifest.capabilities.includes('guardrail')) await this.loadGuardrails(packDir, host)
    if (manifest.capabilities.includes('eval'))    await this.loadEval(packDir, host)
  }
}
```

### 7.4 四类上层场景包的落地映射

| 上层 | 现状 | 落地方式（不改内核） |
|---|---|---|
| **领域知识** | 注册表默认空、装配器未接线 | `pack/domain/*.md` → `registerDomainsFromMarkdown`（`:103` 已有）→ `DOMAIN_ADAPTERS` |
| **SOP 流程** | 角色/步骤类型硬编码 | `pack/sop/roles.yaml` → 注入 `make_supervisor_node(taskTypes)`（`supervisor.ts:218`，当前 `graph.ts:467` 传 null）；`graph.yaml` → `registerNode` |
| **业务护栏** | 规则硬编码 + 默认关 | `pack/guardrails/rules.yaml` → `registerGuardrailRule`（`tool-guardrails.ts:115`）+ `PolicyEngine.use` |
| **评估口径** | 口径外置但单份、实现硬编码 | `pack/eval/*.yaml` → 扩展 `evals/src/config-loader.ts` 支持按 pack 目录加载；指标实现补注册点（`metrics.ts:243`） |

---

## 8. 实施路线图与优先级

| 阶段 | 目标 | 关键交付 | 优先级 |
|---|---|---|---|
| **阶段一·通电** | 消除"已实现未接线" | ① `create_agent` 装配 router + 观测 boot + 审计落盘；② 删除 5 个死配置键；③ 接线输出护栏 | **P0（最高）** |
| **阶段二·收口** | 底座抽象合格 | ① `PolicyEngine`（权限）；② `MemoryStrategy`（记忆）；③ provider 注册表（路由）；④ 能力矩阵自动同步（工具） | **P0** |
| **阶段三·可注册** | 拓扑与能力可扩展 | ① `GraphSpec` + `buildFromSpec`；② `PromptRegistry`；③ `ContextRegistry`；④ 节点/子图注册入口 | **P1** |
| **阶段四·场景包** | 上层可插拔 | ① `ScenarioLoader` + manifest 消费；② `packs/` 目录约定；③ 四类上层改造迁移；④ 评估口径按 pack 加载 | **P1** |
| **阶段五·验证** | 双向解耦验证 | ① 新增一个"数据分析"场景包不改内核；② 替换一个底座实现不改上层；③ 回归保证默认行为零变化 | **P2** |

> **本节为路线图概览；第 10 节给出其细化版本**（19 项具体任务 + P0~P3 优先级总表 + M1~M5 里程碑排期 + 风险控制），实施时以第 10 节为准。

**硬约束**：
- 所有改造以"**默认路径行为零变化、开关可回退**"为前提，沿用现有 `react_optimization.*` 门控与字符等价回归范式（参考 `prompt-composer.ts:9-12`）。
- `graph/runner.ts`、`perception/*`（已插件化，可作范式）、`observability` 的协议选型**不需要重构**，只需接线。
- 场景包加载须**逐能力隔离**，单个场景包失败不得影响框架启动（复用 `skills/loader.ts:93,141` 的隔离范式）。

---

## 9. 结论

1. **是否符合"底层通用底座 + 上层可插拔场景包"？**
   **部分符合，程度约 35%**。目录分层与模块边界已经按该标准建立，但**运行时的解耦不足**：10 个能力中仅"工具协议"达到合格底座标准，0 个上层达到真正场景包标准。

2. **最大障碍不是"设计缺失"，而是"装配缺失"。**
   第 6 节的 8 类"已实现未接线"清单证明：框架的能力**大多已写好**，缺的是一个统一的 **boot/装配层**（`ScenarioLoader` + 各注册表）把它们接起来。这是投入产出比最高的改造点。

3. **最优先的三件事**：
   - 修 **模型路由零调用**（`factory.ts:312` 接入 `create_agent`）——否则"多模型/多任务选模型"名存实亡；
   - 建 **`PolicyEngine`**（权限）——这是唯一完全无抽象接口的底座，也是安全场景包的必备前提；
   - 建 **`ScenarioLoader` + 消费 `PluginManifest`**——这是"上层做成场景包"的唯一抓手，可一次性解决症结②与③。

4. **可复用的既有范式**（改造时应以其为模板）：
   - **感知层**（`perception/pipeline.ts:86,154`）——已实现"注册表 + 多策略 + 配置驱动"的完整闭环，是所有底座改造的**参照标准**；
   - **工具协议层**（`action.ts` + `tool-adapter.ts:326`）——已实现"统一契约 + 三路归一"；
   - **评估口径层**（`evals/*.yaml`）——已实现"口径外置"。

---

## 10. 优化方案与优先级排序

### 10.1 排序原则

决定优化顺序的三条逻辑：

1. **先通电，后抽象**：评估已证明框架的能力**大多已写好、只是没接线**（第 6 节 8 类"已实现未接线"）。补偿性的「接线」成本极低、收益立竿见影，必须先做——否则任何新抽象都会叠加在"假的解耦"之上。
2. **先收口底座，再开放场景包**：上层场景包**依赖**底座的抽象接口存在（无 `PolicyEngine` 就做不了护栏包，无 `GraphSpec` 就做不了 SOP 包）。倒过来做会返工。
3. **按"场景包依赖链"倒排**：从目标（场景包）反推前置条件，得到严格的先后顺序，而非按模块重要性排序。

**推导出的依赖链**：

```
场景包(上层)
   ↑ 依赖
PolicyEngine / GraphSpec / PromptRegistry / ContextRegistry   ← 扩展点
   ↑ 依赖
MemoryStrategy / ProviderRegistry / 统一契约                   ← 底座抽象
   ↑ 依赖
通电修复（router/观测/审计/护栏/矩阵/装配器）                   ← 让现有能力真正运行
```

### 10.2 优先级总表

| 优先级 | 任务 | 层 | 依赖 | 成本 | 收益 | 为什么在这个位置 |
|---|---|---|---|---|---|---|
| **P0** | ① 观测 boot 接线 | 观测 | 无 | 低 | 高 | 能力已实现，纯装配；独立可做 |
| **P0** | ② 审计落盘 + 全量事件发布 | 权限 | 无 | 低 | 中 | 同上；是权限包前置 |
| **P0** | ③ 输出护栏接线 | 权限 | 无 | 低 | 中 | 同上 |
| **P0** | ④ 工具能力矩阵自动同步 | 工具 | 无 | 低 | 中 | 第三方工具能力可被利用 |
| **P0** | ⑤ 领域装配器接线 | 领域知识 | 无 | 低 | 高 | `registerDomainsFromMarkdown` 已实现，一行接线激活领域包 |
| **P0** | ⑥ 死配置清理/接线 | 全局 | 无 | 低 | 中 | 8 个死配置造成"配置存在但不生效"的认知陷阱 |
| **P0** | ⑦ 模型路由接入 `create_agent` | 模型路由 | 需 task_type 流转 | 中 | 高 | 不做则"多模型/多任务选模型"名存实亡 |
| **P1** | ⑧ `PolicyEngine` 统一权限判定 | 权限 | P0②③ | 中高 | 高 | 唯一无抽象接口的底座；安全场景包前提 |
| **P1** | ⑨ `MemoryStrategy` 统一记忆 | 记忆 | P0⑥ | 中 | 中 | 三套并行抽象；按任务挂载记忆的前提 |
| **P1** | ⑩ `LLMProviderRegistry` | 模型路由 | P0⑦ | 中 | 中 | 消除双轨 + 硬编码映射表 |
| **P2** | ⑪ `GraphSpec` + `buildFromSpec` | 编排 | P1 | 高 | 高 | SOP 场景包的**硬前提**（自定义节点/子图） |
| **P2** | ⑫ `PromptRegistry` | Prompt | P1 | 中 | 高 | 任务级 prompt 外置的载体（13 处内联） |
| **P2** | ⑬ `ContextRegistry` + `ContextBuilder` | 上下文 | P1 | 中 | 高 | 上下文工程插件化（`agentNode:939-1065`） |
| **P3** | ⑭ `ScenarioLoader` 消费 manifest | 装配 | P1+P2 | 中 | 极高 | 一次性解决"装配靠手动 + 场景包无处声明" |
| **P3** | ⑮ `packs/` 目录约定 + 四类上层迁移 | 场景包 | ⑭ | 高 | 极高 | 最终目标 |
| **P3** | ⑯ 评估口径按 pack 加载 | 评估口径 | ⑭ | 低 | 中 | 唯一已外置的上层，收尾即可 |

### 10.3 P0 · 通电（成本最低、必先做）

> 目标：让已实现的能力真正进入运行时。**全部为"接线"或"清理"，不引入新抽象，回归风险可控。**

| # | 改动 | 具体位置 | 动作 |
|---|---|---|---|
| ① | 观测 boot | `graph/factory.ts:450-717` | 在 `create_agent` 中调用 `configure_structured_logging`（`logging-config.ts:201`）、`configure_otlp_exporter`（`exporters.ts:34`）、`start_prometheus_server`（`:159`），按 `observability.*.enabled` 门控 |
| ② | 观测埋点补齐 | `tool-adapter.ts:253-306` | 在通用中间件层补 `record_tool_call`/`record_llm_tokens`（`metrics.ts:212,237`），**不要污染 `nodes.ts`** |
| ③ | 审计落盘 | `message-bus.ts:192` | 默认实例化 `PersistentEventLog` 并订阅 `EventDomain.SECURITY` |
| ④ | 审计事件补齐 | `graph/nodes.ts:1803-1937` | human_review 审批结果发布 `tool_approval_*`；输入护栏命中发布 `pii_detected` 等（现仅 1/12 有发布者） |
| ⑤ | 输出护栏接线 | `perception/security/guard.ts:312,369` | 在 `finalize_response` 节点前调用 `detectOutputSensitive`/`sanitizeOutput` |
| ⑥ | 能力矩阵自动同步 | `core/registry.ts:115` | `registerTool` 内自动生成默认 `ToolCapability`，替代手动 `registerToolCapability`（`tool-registry.ts:140`） |
| ⑦ | 领域装配器接线 | `graph/factory.ts` | 调用 `registerDomainsFromMarkdown`（`domain-adapters.ts:103`），扫描 `config/domains/*.md` |
| ⑧ | 死配置清理 | `runtime-config.ts:70,281-288,315-320` | `memory.default_strategy`、`observability.tracing.{otlp_endpoint,service_name,sampling_rate}`、`metrics.{prometheus_port,path}` —— **接线或删除**（二选一，不留悬挂） |
| ⑨ | 模型路由接入 | `factory.ts:312` → `:450-717` | 在 `create_agent` 构造并装配 `_build_llm_router`；确保 `task_type` 从 `state` 流转到路由点 |

**P0 验收**：`OBSERVABILITY` 指标有数据、审计有落盘文件、模型路由 `enabled=true` 时生效、`CAPABILITY_REGISTRY` 中 `status: implemented` 的键**全部有真实消费者**。

### 10.4 P1 · 底座收口（抽象合格化）

> 目标：让六底座达到"接口清晰 + 实现多态 + 策略可替换"。

| # | 改动 | 新接口 | 取代对象 | 关键动作 |
|---|---|---|---|---|
| ⑩ | **PolicyEngine** | `PolicyRule{stage:'input'\|'tool'\|'output', evaluate()}` + `PolicyEngine.decide()` | 4 处散落判定：`guard.ts` 正则、`tool-guardrails.ts:61-108`、`nodes.ts:1803-1827`、各工具 `requiresApproval*` | 收敛判定入口；HITL 节点插入位置改为 profile 声明（解 `graph.ts:517,627` 硬编码） |
| ⑪ | **MemoryStrategy** | `MemoryStrategy{id, supports(taskType), recall, persist}` | 三套抽象：`BaseMemory`、`BaseStore`（`store-adapter.ts:113`）、`ObservationMemory` | 让 `ObservationMemory` 实现统一契约；激活 `memory.default_strategy`；开放 `namespace/embedding/chunking` 配置（`chroma.ts:199,280`） |
| ⑫ | **LLMProviderRegistry** | `LLMProviderFactory{id, create()}` | 双轨映射表（`llm-adapter.ts:22-51` + `reasoning/llm/index.ts:8-12`） | 合并为注册表；删除废弃 `BaseLLMReasoner` 的 prompt 组装职责（`base-llm.ts:627-664`） |

**P1 验收**：可替换一个底座实现（如换记忆后端）而**不改上层代码**；`grep` 确认无"声明但无消费者"的配置键。

### 10.5 P2 · 可注册化（开放扩展点）

> 目标：让拓扑、prompt、上下文可被外部注册——这是场景包的**直接前提**。

| # | 改动 | 新接口 | 取代对象 |
|---|---|---|---|
| ⑬ | **GraphSpec** | `NodeSpec/EdgeSpec/GraphSpec` + `buildFromSpec` + `registry.registerNode` | `buildModuGraph` 硬编码拓扑（`graph.ts:349-762`）；plan-execute/multi-agent 内联节点（`graph.ts:530-534`）→ 导出为**可注册子图 spec** |
| ⑭ | **PromptRegistry** | `PromptTemplate{id,version,taskTypes,messages}` + `render()` | 13 处内联 prompt（`plan-execute/prompts.ts:59`、`factory.ts:75-114`、`nodes.ts:979-996`、`quality-monitor.ts:50`、`consensus.ts:201`、`builder.ts:27-39` 等） |
| ⑮ | **ContextRegistry** | `ContextStrategy` + `ContextFragment{priority,budget}` + `ContextBuilder` | `agentNode` 过程式注入（`nodes.ts:939-1065` 的 7 段 splice/push） |

**关键约束**：`PromptRegistry`/`ContextBuilder` 必须保证**字符等价回归**（沿用 `prompt-composer.ts:9-12` 的范式），默认路径行为零变化。

**P2 验收**：可通过注册新增一个节点、一个任务级 prompt 模板、一个上下文策略，**不改 `graph.ts`/`nodes.ts`**。

### 10.6 P3 · 场景包落地（最终目标）

| # | 改动 | 说明 |
|---|---|---|
| ⑯ | **`ScenarioLoader`** | 消费现有 `PluginManifest`（`plugin-manifest.ts:24-126`，当前**零消费者**）；按 `capabilities` 分派到各注册表；逐能力 `try/catch` 隔离（复用 `skills/loader.ts:93,141` 范式）；提供 `activate(host)` 生命周期 |
| ⑰ | **`packs/` 目录约定** | `pack.yaml` + `domain/*.md` + `sop/{roles.yaml,graph.yaml}` + `guardrails/rules.yaml` + `prompts/*.md` + `eval/*.yaml` |
| ⑱ | **四类上层迁移** | 领域→`registerDomainsFromMarkdown`；SOP→`make_supervisor_node(taskTypes)`（修 `graph.ts:467` 传 `null` 的断链）；护栏→`registerGuardrailRule` + `PolicyEngine.use`；口径→`evals/src/config-loader.ts:22` 支持按 pack 目录加载 |
| ⑲ | **评估口径按 pack 加载** | 扩展 `evals` 支持 `dataset ↔ 场景包 ↔ thresholds/gates` 映射（当前固定单份，`config-loader.ts:158,183`） |

**P3 验收（双向解耦验证）**：
- **纵向**：新增一个"数据分析"场景包，**零改动内核源码**（仅新增 `packs/` 目录）；
- **横向**：替换一个底座实现（如换 LLM provider / 换记忆后端），**不改上层场景包**。

### 10.7 里程碑与排期建议

| 里程碑 | 内容 | 依赖 | 建议节奏 |
|---|---|---|---|
| **M1 · 通电** | P0（①~⑨） | 无 | 第 1 迭代，可 2~3 人并行（接线任务间无耦合） |
| **M2 · 底座收口** | P1（⑩⑪⑫） | M1 | 第 2~3 迭代，⑩ 为主，⑪⑫ 可并行 |
| **M3 · 可注册** | P2（⑬⑭⑮） | M2 | 第 4~5 迭代，⑬ 成本最高、建议单独立项 |
| **M4 · 场景包闭环** | P3（⑯~⑲） | M3 | 第 6~7 迭代，以一个真实场景包驱动验收 |
| **M5 · 验证** | 双向解耦验证 + 回归 | M4 | 贯穿，与 M4 重叠 |

> **可并行机会**：M1 的 9 项接线互不依赖；M2 的 ⑪⑫ 与 ⑩ 无依赖；P2 的 ⑭⑮ 可在 ⑬ 完成前先做接口定义。

### 10.8 回归与风险控制（硬约束）

1. **默认行为零变化**：所有改造以"默认关闭/默认等价"为前提，沿用现有 `react_optimization.*` 门控与字符等价回归测试。
2. **不重构的部分**：`graph/runner.ts`（职责清晰）、`perception/*`（已插件化）、`observability` 协议选型、`tool-adapter` 中间件——**只接不改**。
3. **主要风险**：
   - **GraphSpec 改造破坏 Checkpointer 兼容** → 需 `state_schema_version` + 迁移函数（旧会话按需迁移）；
   - **PromptRegistry 迁移引发回归** → 分文件逐个迁移，每迁一处跑等价性测试（当前有 `tests/reasoning/prompt-composer.test.ts` 可扩展）；
   - **场景包加载失败影响启动** → 强制逐能力隔离 + 失败降级到内置默认。
4. **明确不做（避免过度设计）**：
   - 暂不追求跨进程 EventBus（`event-bus-adapter.ts:70` 仅有接口）；
   - 暂不引入插件市场/热更新（`manifest` 的 `version` 先只做静态校验）；
   - 暂不做分布式 Checkpointer。

### 10.9 一句话总结

> **P0 通电（让已有能力生效）→ P1 收口（让底座抽象合格）→ P2 可注册（让扩展点存在）→ P3 场景包（让上层可插拔）。**

前两步是**"还债 + 打地基"**，投入小、风险低、收益确定；后两步是**"建能力"**，成本高但直接指向目标。**任何跳过 P0 直接做 P3 的方案都会失败**——因为场景包的加载器最终要调用注册表，而当前大量注册表要么不存在、要么无消费者。

---

## 附录 A：证据索引（按层）

| 层 | 核心文件 | 关键行 |
|---|---|---|
| 模型路由 | `core/interfaces/llm.ts`；`reasoning/llm/router.ts`；`graph/adapters/llm-adapter.ts`；`graph/factory.ts` | `llm.ts:202`；`router.ts:27,57`；`llm-adapter.ts:22-51`；`factory.ts:312` |
| 工具协议 | `core/interfaces/action.ts`；`graph/adapters/tool-adapter.ts`；`tools/tool-registry.ts` | `action.ts:25-138`；`tool-adapter.ts:253-326`；`tool-registry.ts:61-140` |
| 记忆 | `core/interfaces/memory.ts`；`memory/*.ts`；`config/runtime-config.ts` | `memory.ts:8-32`；`chroma.ts:186,199,280`；`observation-memory.ts:94`；`runtime-config.ts:70` |
| 编排 | `graph/graph.ts`；`graph/state.ts`；`graph/subgraph/builder.ts` | `graph.ts:349-762,492-534,557-620`；`builder.ts:98-211` |
| 观测 | `observability/*.ts`；`graph/runner.ts` | `tracing.ts:179,235`；`metrics.ts:59,212,237`；`exporters.ts:34,159`；`runner.ts:148,581,977` |
| 权限 | `perception/security/*.ts`；`tools/tool-guardrails.ts`；`graph/nodes.ts` | `guard.ts:96,312,369`；`audit.ts:25-37`；`tool-guardrails.ts:61-124`；`nodes.ts:1803-1937` |
| 领域知识 | `reasoning/domain-adapters.ts`；`config/knowledge-index.ts`；`memory/chroma.ts` | `domain-adapters.ts:40,103`；`knowledge-index.ts:9-11`；`chroma.ts:186,199,280` |
| SOP 流程 | `orchestration/patterns/*.ts`；`graph/plan-execute/*.ts`；`graph/subgraph/*.ts` | `consensus.ts:287`；`delegation.ts:16`；`prompts.ts:59`；`types.ts:11`；`builder.ts:27-70`；`supervisor.ts:42` |
| 业务护栏 | `tools/tool-guardrails.ts`；`perception/security/guard.ts`；`graph/factory.ts`；`graph/nodes.ts` | `tool-guardrails.ts:61-124`；`guard.ts:19-78`；`factory.ts:75-114,546`；`nodes.ts:709-801` |
| 评估口径 | `packages/evals/*`；`feedback/*.ts` | `evals/src/metrics.ts:92-249`；`config-loader.ts:22,158,183`；`agent-executor.ts:18-72`；`thresholds.yaml:19-80` |

## 附录 B：逐层判定速查

| 层 | 抽象接口 | 实现多态 | 已接入 | 策略可替换 | 判定 |
|---|:---:|:---:|:---:|:---:|---|
| 模型路由 | ✅ | ✅ | ❌ | ✅ | **未分离** |
| 工具协议 | ✅ | ✅ | ✅ | △ | **合格** |
| 记忆 | ✅ | ✅ | ✅ | ❌ | **半成品** |
| 编排 | ❌ | — | ✅ | ❌ | **部分分离** |
| 观测 | ✅ | ✅ | △ | △ | **半成品** |
| 权限 | ❌ | ❌ | △ | ❌ | **未分离** |
| 领域知识 | ✅ | △ | ❌ | △ | **半可插拔** |
| SOP 流程 | ❌ | △ | ✅ | ❌ | **半可插拔** |
| 业务护栏 | ✅ | ✅ | △ | △ | **半可插拔** |
| 评估口径 | ✅ | △ | ✅ | △ | **口径合格 / 实现硬编码** |
