# modu-agent 业务逻辑 · 技术架构 · 产品业务架构分析报告

> 分析对象：`packages/modu-agent`（npm 包名 `@pioneering/modu-agent`，v0.1.0）
> 分析方式：通读 `src/` 全部 14 个业务模块的源码，结合 `config.yaml`、`packs/` 示例场景包与 `tests/` 测试结构进行交叉验证
> 文档定位：回答三个问题——**这套代码在做什么（业务逻辑）、它是怎么组织的（技术架构）、它作为产品提供什么能力（产品业务架构）**

---

## 0. 结论速览

1. **modu-agent 是一个以 LangGraph 为执行内核的「模块化、可插拔智能体运行时」**。它把一个原本 1000 余行的"上帝类"协调器（Coordinator）重构为「感知 → 记忆 → 推理 → 行动 → 反馈」的认知循环状态图，并在此底座之上提供安全护栏、人工介入、多智能体协作、规划执行与自我进化等企业级能力。
2. **代码结构与设计理念高度一致**：顶层是 14 个职责单一的模块；所有核心组件面向抽象接口编程，经由一个全局 `ComponentRegistry` 注册和查找；图拓扑本身也被"数据化"为 `NodeSpec / EdgeSpec` 声明，由统一的 `buildFromSpec` 装配。
3. **"底座 + 可插拔场景包"是产品架构的主线**：稳定的通用底座（`core/config/graph/...`）与可变的业务场景（`packs/<name>/`，由 `kernel` 层加载）严格分离。场景包以 `pack.yaml` 声明能力，经 `ScenarioHost` 统一注册，`deactivate()` 时可逆序回滚——业务场景因此成为可独立开发、独立分发、运行时热插拔的单元。
4. **工程上有鲜明的"灰度与安全"纪律**：几乎所有增强能力都以 feature flag 控制且**默认关闭**（默认路径行为零变化），安全策略统一为 **fail-open**（策略引擎故障绝不阻断正常对话），高危工具采用"弱沙箱 + 强审批"的纵深防御。

---

# 第一部分 · 业务逻辑分析

## 1.1 项目定位与业务目标

modu-agent 要解决的核心业务问题是：**让一个 LLM 能够可靠、安全、可观测地完成需要"多步推理 + 外部工具调用"的真实任务**，而不是只做单轮问答。典型任务如：

- "帮我总结今天的 AI 行业热点新闻，整理成一份 Markdown 日报"（需要：获取日期 → 联网搜索 → 结构化写作 → 落盘成文档）；
- "计算一下这个表达式 / 查询这个数据库 / 抓取这个网页"（需要：参数校验 → 安全执行 → 结果回传）；
- 复杂任务下由多个专职子 Agent 分头处理、再汇总共识。

为实现这一目标，代码把智能体抽象为一条认知流水线，并为每一段提供可替换的组件实现：

```
感知 Perception  →  记忆 Memory  →  推理 Reasoning  →  行动 Action/Tools  →  反馈 Feedback
       ↑                                                                          │
       └────────────────────────  进化 Evolution（参数调优/组件替换）  ←──────────────┘
```

## 1.2 模块全景

`src/` 下共 14 个模块，按层次可归为四组：

| 分组 | 模块 | 业务职责 |
|---|---|---|
| **内核底座** | `core` | 组件注册中心 + 全部抽象接口契约（BaseTool / BasePerception / ModuLLM / PolicyEngine 等） |
| | `config` | 运行时配置（点路径读写、热更新、来源溯源）、Schema 校验、YAML/Markdown 配置加载 |
| **认知链路** | `graph` | **项目核心**。LangGraph 状态、节点、声明式拓扑、装配工厂、运行器及各类适配器 |
| | `perception` | 输入预处理、多模态感知、安全检测（注入/PII/密钥）、多路融合 |
| | `reasoning` | 复杂度分层、上下文构建、思维链锚点、四层 Prompt 组装、模型路由 |
| | `tools` | 9 个内置工具 + 工具能力矩阵 + 审批护栏 |
| | `memory` | 短期记忆、Chroma 长期向量记忆、可替换记忆策略 |
| **扩展接入** | `mcp` | 接入外部 MCP Server，发现并调用远程工具 |
| | `skills` | 技能加载（技能 → 工具 + 提示片段）、Few-shot 示例选择 |
| | `kernel` | 场景包宿主（统一注册面 + 作用域回滚）与 `pack.yaml` 加载器 |
| **质量保障** | `feedback` | 质量监控（规则/LLM/混合）、反馈循环、准确性与效率指标 |
| | `evolution` | 进化编排、参数调优、组件热替换、版本快照、回滚机制 |
| | `observability` | OpenTelemetry 链路追踪、Prometheus 指标、结构化日志 |
| | `orchestration` | 事件总线（发布订阅）、AG-UI/SSE 协议、共识模式、传感器与 SOP 管理 |

## 1.3 核心业务流程（一次请求的生命周期）

默认模式（单 Agent + ReAct 循环）下，图的主干流转如下：

```
START
  │
  ▼
perception  ── 运行感知管线：输入路由 → 处理器链（清洗/安全检测/语种/截断）→ 多路融合
  │            同时可做：复杂度评估（tier_1/2/3）、PolicyEngine 输入策略判定
  ▼
[routeAfterPerception]  ── 熔断判定
  │        ├─ 敏感级超阈值 / 注入 / PII（且配置阻断）/ 输入策略 deny
  │        │        └──────────────────────────────▶ finalize_response（输出错误）
  │        └─ 正常
  ▼
memory_query  ── 按 user_id 检索长期知识（Store/Chroma，top 5）
  │
  ▼
agent  ── 组装消息（SystemPrompt + 上下文片段：感知/知识/Observation/示例…）→ 调用 LLM
  │
  ▼
[routeAfterAgent]  ── 检查末条消息是否含 tool_calls
  │        ├─ 无 tool_calls
  │        │        ├─ Plan-Execute 执行中 → step_finalize
  │        │        ├─ 文档生成任务但未成功调 doc_writer → doc_gen_enforce（强制回退）
  │        │        └─ 否则 ──────────────────────────▶ finalize_response
  │        └─ 有 tool_calls（推理预算/轮次上限校验）
  ▼
[human_review]  ── HITL 开启时：识别需审批工具 → interrupt() 暂停，等待人工批准/拒绝/改参
  │        ├─ 拒绝/超时 → 构造降级 ToolMessage ──────▶ finalize_response
  │        └─ 通过
  ▼
tools (ToolNode)  ── 真正执行工具（可并行执行同一轮的多个调用）
  │
  ▼
tool_processor  ── 提取 tool_results；Observation 蒸馏；追踪 artifacts；标记 doc_writer 成败
  │
  └──▶ agent（回到 ReAct 循环，直至无 tool_calls）
            │
            ▼
finalize_response  ── 从末条 AIMessage 提取正文（缺正文时按工具结果程序化合成）
  │                    可选：输出护栏（密钥/内网 IP/PII 脱敏）+ PolicyEngine 输出策略
  ▼
[feedback]  ── 质量评估，决定是否触发进化；产出 per-session config_overrides
  │
  ▼
memory_update  ── 将本轮对话历史写入长期记忆（success/skipped/error 可观测）
  │
  ▼
END
```

这条链路对应 `graph/graph.ts` 中 `composeDefaultGraph()` 声明的节点与边；图注释中明确写道：其目标是用图编排替代原 `coordinator.py` 的"上帝类"，删除手写 ReAct 循环与手写工具调用解析。

## 1.4 各模块业务逻辑详解

### 1.4.1 `core` —— 组件注册中心与接口契约

**职责**：定义"有哪些组件类型、它们必须实现什么契约"，并提供全局唯一的注册/查找入口。

- **`ComponentRegistry`（`core/registry.ts`）** 是全系统的组件中枢，采用单例（`getRegistry()`）。它管理 11 类基础组件——推理引擎、推理策略、记忆、存储适配器、感知器、传感器、反馈循环、进化信号、工具、动作执行器、技能，并扩展承载 LLM Provider、策略规则、Prompt、上下文策略、图拓扑节点/边等注册表。
  - `registerTool()` 会触发工具能力自动同步（`ensureToolCapability`）；
  - `registerSkill()` 自动把技能内含的工具经隔离包装后注册；
  - `getPolicyEngine()` 懒构造策略引擎；
  - `swapComponent()` 保留运行时热替换能力，供进化策略使用。
- **接口契约**（`core/interfaces/`）采用抽象基类形式：
  - `BaseTool`：`name / description / parametersSchema / invoke`，并内置 HITL 钩子 `requiresApproval / requiresApprovalFor / onApprovalRejected`，以及工具元数据 `version / providesRealtimeData / followUpTools`；
  - `BasePerception / BaseSensor`：`perceive / capture`；
  - `BaseMemory / BaseStorageAdapter`、`BaseReasoningEngine / BaseReasoningStrategy`、`BaseFeedbackLoop`、`BaseSkill`；
  - `ModuLLM / LLMRouter`：统一的大模型接口（`invoke / stream / bindTools` 与结构化 `LLMMessage / LLMResult`），消除自研 reasoner 与 LangChain 模型之间的"双轨抽象"；
  - `PolicyEngine / PolicyRule`：三阶段（input/tool/output）统一策略判定契约，输出 `allow / deny / require_approval`。

> 设计要义：**全系统面向这些抽象编程，具体实现可替换、可插拔**，注册中心负责装配与生命周期。

### 1.4.2 `config` —— 运行时配置

**职责**：承载所有可调参数，支持分层来源、热更新、类型安全与溯源。

- **`RuntimeConfig`（`config/runtime-config.ts`）**：
  - 以点路径读写（`get('llm.temperature') / update(...)`），嵌套对象读取返回浅拷贝防止外部篡改；
  - 通过 `EventEmitter` 提供变更回调（`registerChangeCallback`），支撑 runner 缓存的主动失效；
  - `getSources()` 记录配置来源（内置默认 / YAML 文件 / 环境变量）。
- **配置分层**：内置 `DEFAULT_CONFIG`（同文件，单一事实源）→ 包根目录 `config.yaml` → 环境变量（`MODU_*`），后者深度合并覆盖前者。
- **零依赖 YAML 加载器（`yaml-loader.ts`）**：内置一个最小 YAML 子集解析器（缩进分块 + 递归下降，支持嵌套 map、块列表、标量、引号与注释），避免引入 `js-yaml`；解析失败一律降级默认配置。加载时对照基准做**类型安全校验**，类型不符的字段丢弃并记录到 `droppedKeys`。
- **Markdown 配置文档（`markdown-loader.ts`）**：解析约定的 `AGENTS.md`（行为准则/SOP）、`SOUL.md`（人格/边界）、`USER.md`（用户画像）、`MEMORY.md`（长期经验，默认 lazy），识别 YAML frontmatter（注入目标、eager/lazy、cascade 层级）。
- 其余：数据校验 `schemas.ts`、Markdown Prompt 聚合器（含字符预算截断）、MEMORY 经验的 Markdown 持久化、知识库索引、插件 manifest 校验、`/debug/config` 脱敏快照、首次安装模板初始化、环境变量注册表（名称/类别/是否敏感/消费点）、配置能力注册表（配置键 → 能力 → 消费点清单）。

### 1.4.3 `graph` —— 智能体执行内核（项目核心）

这是体量最大、最关键的模块，内部再分六层：

**① 状态层 `state.ts`**
- `ModuAgentState`：60 余个字段，覆盖消息、会话标识、感知结果、记忆、工具、HITL、多智能体、Plan-Execute、反馈进化、产物追踪、文档生成保护等；
- `ModuAgentStateAnnotation`：为每个字段声明 reducer——`messages` 用 LangGraph 内置 `messagesStateReducer`；`tool_results / observation_history / artifacts / confidence_history` 等为"追加"；`subtask_results / blackboard` 为"按键合并"；计数器为"累加"；doc_writer 标志位为"置位永不重置"；
- 字段按模式拆分为 `CoreState` 与 `HITL / MultiAgent / PlanExecute / Feedback` 各 `ModeState`，避免核心状态持续膨胀；
- 提供 `makeInitialState()` 与 `migrate_state()`（按 `state_schema_version` 迁移历史 checkpoint，如移除僵尸 `history` 字段）。

**② 节点层 `nodes.ts`（全包最大文件，近 3000 行）**
实现全部图节点与路由函数（工厂模式创建，依赖注入）：

| 节点/路由 | 业务逻辑 |
|---|---|
| `perception`（`makePerceptionNode`） | 调感知管线，融合结果；可挂复杂度评估；消费输入策略（deny → 写错误码） |
| `memory_query` | 经记忆策略或 `store.search([user_id,'knowledge'])` 取知识 |
| `agent`（`makeAgentNode`） | 组装 SystemPrompt 与上下文片段 → 调 LLM；按 tier/置信度/config_overrides 动态调温；支持模型路由、调用超时 |
| `tools` | LangGraph 预置 `ToolNode`（无工具时用 noop 节点兜底） |
| `tool_processor` | 提取增量 `tool_results`（带去重守卫）、Observation 蒸馏、artifacts 收集、doc_writer 成败标记 |
| `finalize_response`（`responseNode`） | 从末条 AIMessage 提取正文与 usage；无正文时程序化合成兜底回复 |
| `human_review` | 工具审批：guardrail → 敏感工具列表 → 工具自身策略三级判定，需审批则 `interrupt()`；支持批准/拒绝/超时/改参 |
| `clarify` | 需求澄清：对过短输入或模糊短语 `interrupt()` 追问，回答注入消息流 |
| `supervisor / subagent_run / consensus` | 多智能体：任务拆分、Send 并行执行、共识聚合（详见 1.5） |
| `planner / step_dispatch / step_finalize` | Plan-Execute：规划、分步派发、单步收尾（详见 1.5） |
| `doc_gen_enforce / doc_final_answer` | 文档生成闭环保护（详见 1.5） |
| `feedback / memory_update` | 反馈评估接入、长期记忆写入 |
| 路由函数 | `routeAfterPerception`（熔断）、`routeAfterAgent`（ReAct 退出 + 预算/文档保护）、`routeAfterMemoryQuery`（agent/supervisor/planner 分叉，规则可配置）、`routeAfterHumanReview` |

**③ 拓扑规格层 `spec.ts`**
- 把硬编码的建图过程数据化为 `NodeSpec / EdgeSpec / SubgraphSpec / GraphSpec / GraphProfile`；
- `buildFromSpec(spec, deps)` 统一执行：按 `when` 条件过滤节点 → `addNode / addEdge / addConditionalEdges` → 计算递归预算 → `compile({checkpointer, store})`；
- 宿主经注册中心注册的节点/边**追加**在默认声明之后，同名内置节点默认优先，`override: true` 时方可受控替换；
- `computeRecursionLimit()` 按模式（HITL/clarify/supervisor/Plan-Execute）动态计算递归预算，防止 `recursionLimit` 崩溃。

**④ 装配工厂 `factory.ts`**
- **`create_agent()` 是总装配入口**（async）：启动观测 boot → 注册记忆策略/审计落盘/内置 LLM Provider/（可选）内置感知器/内置 Prompt 与上下文策略 →（可选）加载技能 → 构建 ChatModel → 注册默认工具 →（可选）MCP 工具发现 → 构建 LangChain 工具并 `bindTools` + 重试 + 指标包装 → 构建 checkpointer 与 store → 接线记忆策略解析器 → 解析系统提示词（默认防幻觉 prompt，可被技能/Markdown/PromptComposer 增强）→ 构建进化编排器与策略规则 →（可选）构建复杂度评估器、Observation 蒸馏器、模型路由解析器 → `buildModuGraph(...)` → 包成 `ModuGraph` 返回。
- `build_checkpointer()`：memory（进程级单例 `BoundedMemorySaver`，LRU 上限）/ sqlite（可选，失败回退）/ none；
- `build_store()`：chroma / in_memory / none。

**⑤ 运行器 `runner.ts`**
- `stream_response()`：流式执行，`streamMode=['messages','updates','values']`，经归一化器把 `[mode, chunk]` 元组转为统一对象，再交 `LangGraphEventBridge` 消费；
- `run_sync()`：收集末个 `values` 得到完整结果；
- `get_runner()`：返回缓存图实例，配置 hash 变化时重建；并注册配置变更回调做**主动失效**（100ms debounce；温度等仅影响 LLM 行为的键走"软失效"，不触发重建）；
- `resume_sync() / resume_stream()`：以 `Command({ resume: payload })` 恢复 interrupt；
- `get_interrupt_state()`：从 checkpoint 的 pending task 中提取 interrupt 权威载荷（kind/文案/待批工具）；
- `checkInterruptTimeout()`：审批超时自动拒绝（`auto_reject_on_timeout`）。

**⑥ 适配器层 `adapters/`**
- `llm-adapter`：`build_chat_model()` 经 Provider 工厂构造 `ChatOpenAI`（GLM/DeepSeek/Qwen/GPT 均兼容 OpenAI 协议），覆盖 SDK fetch 为内置 undici 以规避流式 "Premature close"；
- `tool-adapter`：`wrap_modu_tool()` 把 `BaseTool` 包成 LangChain `DynamicStructuredTool`（JSON Schema → Zod），并在调用路径上串接限流、缓存、重试、截断、指标；
- `store-adapter`：把 `ChromaLongTermMemory` 适配为 LangGraph `BaseStore`（ChromaStore / InMemoryStoreAdapter），含安全的批量操作判别；
- `mcp-tool-adapter`、`modu-llm-adapter`（ChatModel ↔ ModuLLM）、`retry`（指数退避）、`rate-limiter`（token bucket）、`llm-metrics`（token 埋点）、`event-bridge`（图事件 → EventBus/SSE）、`observation-distiller`（多层蒸馏）、`tool-result-cache`、`tool-orchestrator`（依赖分析/并行编排）、`llm-provider-registry`（内置 Provider 规格的纯数据事实源）。
- 子目录 `subgraph/`（子 Agent 独立子图：`builder` / `supervisor` / `states`）与 `plan-execute/`（`planner` / `dispatcher` / `prompts` / `types` / `context`）。

**`ModuGraph`（`graph.ts`）**：用 **Proxy** 包装编译图，把 `stream / invoke / getState ...` 透明委托给底层，同时以普通属性显式持有 `orchestrator`（替代在第三方对象上 monkey-patch），并提供基于状态历史的 `rollback()`。

### 1.4.4 `perception` —— 感知与安全

- **`pipeline.ts`**：按 `input_type` 从 `perception.routing` 解析处理器链，依次执行（前一处理器文本可传递给后一处理器），多结果经融合器合并；提供并行版本（首个处理器建立文本基线，后续独立处理器 `Promise.all`，默认关闭）。
- **`fusion.ts`**：`PerceptionFusion` 加权平均多路结果。
- **文本处理器**：
  - `text/rule-based.ts` 的 **`TextPreprocessor`**（核心）：控制/零宽/双向控制字符清洗、句子边界截断、Unicode 区间语种检测、0–5 级细粒度敏感词分级（含安全上下文降级与白名单）、调用安全守卫、置信度与输入质量评估；
  - `text/llm-parser.ts` 的 `LLMParser`：用 LLM 做意图/实体/情感的深度解析（TS 版无 spaCy/SnowNLP，本地方法降级为空，由 LLM 填充）。
- **多模态**：`vision/`（Camera/Timer/Microphone 传感器、ImageProcessor）、`audio/`（ASR AudioProcessor）。
- **安全（`security/`）**：
  - `guard.ts` 的 **`SecurityGuard`**：Prompt 注入/越狱正则库（0–3 风险级，支持 LLM 二次判定）、PII 识别（手机/身份证/银行卡/邮箱/IPv4）、HTML/SQL/Shell 注入风险、密钥凭证模式（AWS/GitHub Token/JWT/PEM/Bearer）、内网 IP 模式、综合安全评分；
  - `output-guard-node.ts`：以节点装饰方式对输出正文做脱敏（密钥/内网 IP/PII → `[REDACTED]`）；
  - `policy-consumers.ts`：PolicyEngine 的 input（deny 熔断）与 output（deny 拦截 / sanitizedText 替换）消费层，统一 gated + fail-open；
  - `audit.ts`：把 14 类安全事件（拦截/审批/拒绝/限流/熔断…）发布到 `SECURITY` 域做审计；`policy-rules.ts`：注册三层默认护栏规则（判定层委派既有 guard，执行层不变）。

### 1.4.5 `reasoning` —— 推理增强

- **`complexity-assessor.ts`**：把任务评估为 `tier_1`（快速响应，预算 1、高温）、`tier_2`（标准推理，预算 2–4）、`tier_3`（深度推理，预算 5+、低温、高置信阈值）；LLM 评估失败时用 `assessByRule()`（长度 + 关键词）兜底。
- **`context-builder.ts`**：按 `ContextStrategy` 声明的片段（位置 anchor/append + 优先级 + 锚点偏移 + 预算）统一注入消息，复刻原 agentNode 的过程式 `splice/push`。
- **`cot-anchors.ts`**：结构化思维链"锚点模板"（目标/已知/缺失/下一步/预期/风险）与行动前"反思后缀"，按 tier 启用。
- **`prompt-composer.ts`**：四层 Prompt 解耦——`systemCore（通用）→ domain（领域适配）→ taskSpec（任务规格）→ runtimeContext（运行时上下文）`，空层跳过、双换行分隔。
- **`domain-adapters.ts`**：领域适配器注册表（领域定位/术语表/推理模式/输出要求），可由 `config/domains/*.md` 自动加载。
- **`prompt-registry.ts`**：可注册 Prompt 模板（支持 `{{var}}` 渲染、缺失变量保留占位、注册表优先 + 字面量兜底）。
- **`llm/router.ts`**：`RuleBasedLLMRouter` 按任务类型/复杂度/成本预算匹配命名路由（简单问题用 flash、复杂问题用 pro），另有 `PassthroughLLMRouter`；`llm/cost-tracker.ts` 负责成本事件；`symbolic/rule-engine.ts` 为符号推理规则引擎。

### 1.4.6 `tools` —— 内置工具与护栏

9 个内置工具均继承 `BaseTool`，返回统一的 `{status, error_code, data}` 结构：

| 工具 | 能力 | 安全要点 |
|---|---|---|
| `calculator` | 算术表达式 | 白名单字符 + 受限求值 |
| `search_engine` | 实时信息检索 | Tavily（需 key，质量最高）→ Bing HTML（国内可达，默认兜底）→ DuckDuckGo 三级回退 |
| `datetime` | 当前时间/格式化/时区/解析 | 纯计算、无 IO，免审批 |
| `http_request` | 发起 HTTP 请求 | 协议/方法限制、**SSRF 防护**（IPv4 CIDR + IPv6 展开判定，禁重定向到内网）、响应大小与超时限制 |
| `file_ops` | read/write/list/delete | 工作目录约束、路径穿越与符号链接检测、按操作类型动态审批、单次读取限量 |
| `doc_writer` | 生成 Markdown 文档 | 自动命名 `{title}_{YYYY-MM-DD}.md`、写后校验、产物元信息；默认落盘 `~/.pioneering/documents` |
| `code_executor` | 执行 Python 脚本 | **弱沙箱 + 强审批**：标识符/属性/片段三级黑名单（堵 `__getattribute__` 等元编程逃逸）、子进程隔离、超时与输出截断 |
| `sql_query` | 只读查询 SQLite | 仅 SELECT（黑名单 + 连接 readonly）、`LIMIT` 限量下推、表名白名单、动态加载 better-sqlite3 |
| `synchronous-executor` | 兼容用动作执行器 | 已被 ToolNode 取代，仅向后兼容保留 |

另有 **`tool-registry.ts` 的工具能力矩阵**（工具 → 适用任务类型/意图/是否需确认/降级链，支持 task_type 粗筛 + intent 细筛两级管道）与 **`tool-guardrails.ts` 的审批护栏**（`ACTION_GUARDRAILS` 规则 + `decideToolApprovals()` 单一判定入口：guardrail 命中 → 敏感工具列表 → 工具 `requiresApprovalFor`）。

### 1.4.7 `memory` —— 记忆系统

- `short-term-memory.ts`：`InMemoryShortTermMemory`，按用户保留最近 N 轮、TTL 过期、低频全量 sweep；
- `chroma.ts`：`ChromaLongTermMemory`，三级嵌入降级（TS 无 SentenceTransformer/ONNX → 默认确定性 hash embedding），支持持久化路径与外部注入嵌入函数；
- `memory-strategy.ts`：按 `memory.default_strategy` 注册记忆组件（`cache` 等别名），并把主链路 BaseStore 路径注册为可替换策略；
- `base-store-strategy.ts`：`BaseStoreMemoryStrategy` 实现统一 `MemoryStrategy` 契约（recall 对应 `store.search([user_id,'knowledge'])`、persist 对应 `store.put([user_id,'history'])`），使记忆后端可被宿主替换。

> **checkpointer 与 store 的分工**：短期/中断态由 LangGraph Checkpointer 按 `thread_id`（= session_id）管理整份 State；长期知识与历史由 BaseStore（Chroma）承载。

### 1.4.8 `mcp` —— 外部工具生态接入

- `client.ts`：`MCPClient`（单例）管理多个 Server 连接，每个连接对应一个 `MCPSession`（握手、工具缓存、意外断连通知与懒重连）；
- `transport.ts`：基于 `@modelcontextprotocol/sdk` 的 `Stdio / SSE / WebSocket` 三种传输，统一 `request/notify` 接口，握手带超时与失败清理；
- `discovery.ts`：`ToolInfo` 从 `tools/list` 解析工具元信息，全限定名 `server__tool` 防冲突；
- `lifecycle.ts`：Server 生命周期管理；`errors.ts`：分类错误（连接/超时/未找到/协议）。
- 发现的 MCP 工具经 `MCPToolAdapter` 适配为 `BaseTool` 注册，与内置工具同链路。

### 1.4.9 `feedback` 与 `evolution` —— 质量反馈与自我进化

- `feedback/quality-monitor.ts`：`QualityMonitor` 支持 **rule / llm / hybrid** 三模式（LLM 失败自动回退规则）；
- `feedback/loop-controller.ts`：`FeedbackLoop` 评估相关性/完整性/准确性/工具效用，累计最近 N 个样本并判定是否应进化；
- `feedback/evolution-signal.ts`：进化信号及其收集器；`metrics/accuracy.ts`（成功率/错误率）、`metrics/efficiency.ts`（token/迭代效率、吞吐）；
- `evolution/evolution-orchestrator.ts`：**`EvolutionOrchestrator` 接通"反馈 → 进化"闭环**，`evaluateAndEvolve()` 返回 `{evaluation, should_evolve, evolution_action}`；
- 三类进化策略：`parameter-tune`（低准确性→降温等，**返回 per-session config_overrides 而非改全局配置**）、`component-swap`（按版本质量对比热替换）、`versioned-store`（组件版本快照）+ `rollback-mechanism`（质量低于阈值自动回滚）。

### 1.4.10 `observability` 与 `orchestration` —— 可观测性与编排通信

- `observability/`：`tracing`（OTel Span，未启用时降级为日志）、`metrics`（指标注册：请求/工具/进化计数，对接 Prometheus）、`logging-config`（结构化 JSON 日志）、`trace-context`（上下文传播）、`exporters`（OTLP/Prometheus）、`boot`（统一、按开关门控的启动入口）；
- `orchestration/communication/`：
  - `message-bus.ts`：**`EventBus` 发布订阅核心**（域级订阅者 ∪ 全局订阅者，`allSettled` 安全分发），`PersistentEventLog` 负责审计落盘（滚动/TTL/域过滤）；
  - `protocol.ts`：`AgentEvent`、`EventDomain/EventAction/EventPriority`、`ErrorCode` 及 LLM/记忆/感知/工具各 DTO；
  - `agui-adapter.ts`：20 余种 **AG-UI 事件类型**（RUN/TEXT/THINKING/TOOL/STATE/ARTIFACT/HITL）与编码器、状态机；
  - `streaming.ts`：SSE 编码与 `StreamPublisher`；`event-bus-adapter.ts`：分布式（Redis）后端；
- `orchestration/sensor-manager.ts`：传感器采集循环；`sop-registry.ts`：Supervisor 角色与 Plan 步骤类型的可注册字典；
- `orchestration/patterns/`：`consensus.ts`（共识抽象 + 多数表决[Jaccard 相似度分组]、加权聚合、LLM 裁决，含 quorum 校验与失败信号）、`delegation.ts`（委派模式）。

### 1.4.11 `skills` 与 `kernel` —— 技能子系统与场景包内核

- `skills/`：
  - `adapter.ts`：`SkillAdapter` 把 `BaseSkill` **降解**为"工具名列表 + system prompt 片段（含 examples）"，`SkillToolWrapper` 做执行隔离（异常标准化，不波及图）；
  - `loader.ts`：目录扫描（`<dir>/<skill>/skill.{js,ts}`）与配置驱动两种加载，逐个隔离；
  - `prompt-aggregator.ts`：合并多个技能提示；`few-shot-selector.ts`：`DynamicFewShotSelector`（MMR 算法、token 预算、质量门槛、内存/Chroma 库）；`math-skill.ts`：示例技能。
- `kernel/`：
  - `scenario-host.ts`：**`ScenarioHost` 是场景包与内核交互的唯一门面**，收口全部扩展注册 API（领域/Prompt/护栏/SOP/工具/策略/拓扑/配置），每次注册记录反向操作，`deactivate()` 逆序执行实现作用域回滚；
  - `scenario-loader.ts`：**`ScenarioLoader` 读取 `pack.yaml`**，校验 manifest，按 `capabilities` 把领域/Prompt/护栏/SOP/配置/代码型拓扑自动分发到各注册表；支持 `extends` 依赖（含环检测）、`entry.js` 代码型扩展（带路径沙箱断言）。

## 1.5 关键业务机制专题

### ① 人工介入（Human-in-the-Loop）
- **工具审批**：`human_review` 节点对敏感工具调用 `interrupt()`，图暂停并把权威载荷写入 checkpoint；前端据 `kind='tool_confirm'` 弹确认框，经 `Command(resume={approved, feedback, modified_args})` 恢复；支持**改参批准**、**拒绝降级**（工具 `onApprovalRejected` 钩子）、**超时自动拒绝**。
- **需求澄清**：`clarify` 节点对过短/模糊输入以 `kind='clarifying'/'choice'` 追问，回答注入消息后继续。
- 中断态跨请求恢复依赖同一 checkpointer（内存单例适用于开发；生产建议 sqlite）。

### ② 多级熔断
`routeAfterPerception` 在进入推理前依次判定：输入策略 deny → 敏感度超阈值 → 注入阻断 → PII 阻断，命中则短路到 `finalize_response` 并发布审计事件。

### ③ 文档生成闭环（防 LLM "光说不写"）
- 感知层识别"动作词 + 目标词 / 紧耦合短语"判定 `task_type='document_generation'`；
- 若 LLM 试图在未成功调用 `doc_writer` 时结束 → `doc_gen_enforce` 注入强提醒并回退（最多 2 次）；
- `doc_writer` 成功后若无正文 → `doc_final_answer` 清除悬挂 tool_calls 并注入"终答模板"（确认语 + 文档位置 + 核心内容速览）；
- 配套保护：成功后阻止重复写、连续失败强制终止、产物去重。

### ④ 多智能体协作
`supervisor` 把任务拆为子任务（规则化多视角或 LLM 驱动的带依赖子任务），经 **Send API** 并行派发到 `subagent_run`（子 Agent 按 task_type 过滤工具、可独立 ReAct、带超时/重试/`need_help` 信号、共享黑板），结果由 `consensus` 按 quorum 与策略（多数表决/加权/LLM 裁决）聚合，失败则发布进化信号。

### ⑤ Plan-and-Execute
`planner` 用未绑工具的 LLM 产出结构化 `PlanStep[]`（带 schema 校验与降级），`step_dispatch` 按依赖推进游标并派发（就绪步骤可并行 Send），`agent ⇄ tools` 处理单步，`step_finalize` 收尾并支持步骤级重试；失败且仍有 replan 预算时带上下文**部分重规划**，全部完成则进入响应。

### ⑥ 反馈—进化闭环
`finalize_response → feedback → （达标样本后）进化判定 → 参数调优/组件替换 → config_overrides 作用于同会话后续请求`，并把结果指标回灌，形成数据驱动的自适应。

---

# 第二部分 · 项目技术架构

## 2.1 分层架构

```
┌──────────────────────────────────────────────────────────────┐
│  产品/业务层    packs/<name> 场景包（domain/prompt/guardrail/  │
│                sop/eval/entry，pack.yaml 声明）               │
├──────────────────────────────────────────────────────────────┤
│  装配层         kernel（ScenarioHost 门面 / ScenarioLoader）   │
│                graph/factory（create_agent 总装配）           │
├──────────────────────────────────────────────────────────────┤
│  认知链路层     graph（state/nodes/spec/runner + adapters +    │
│                subgraph + plan-execute）                      │
│                perception · reasoning · tools · memory        │
├──────────────────────────────────────────────────────────────┤
│  横切能力层     orchestration（EventBus/AGUI/SSE）            │
│                observability（trace/metrics/log）             │
│                feedback · evolution · mcp · skills           │
├──────────────────────────────────────────────────────────────┤
│  底座/契约层    core（ComponentRegistry + 抽象接口）           │
│                config（RuntimeConfig + loaders/schemas）      │
└──────────────────────────────────────────────────────────────┘
```

**依赖方向严格向下**：上层依赖下层的抽象，下层不知会上层。`tests/architecture/layer-boundaries.test.ts` 以架构测试强制这一边界（例如场景包不得绕过 host 直接 import 内核源码）。

## 2.2 核心设计模式

| 模式 | 应用位置 |
|---|---|
| **单例 Singleton** | `getRegistry / getConfig / get_event_bus / getMcpClient / get_runner`、共享 checkpointer |
| **注册表 Registry** | ComponentRegistry、工具能力矩阵、DOMAIN_ADAPTERS、PolicyEngine 规则、Prompt 注册表、SOP 字典 |
| **工厂 Factory** | `create_agent`、`build_chat_model / checkpointer / store`、节点工厂（依赖注入）、`create_consensus_strategy`、LLM Provider 工厂 |
| **适配器 Adapter** | LangChain 工具/模型/存储适配、MCP 工具适配、ModuLLM 适配 |
| **门面 Facade** | `ScenarioHost`（场景包唯一交互面） |
| **代理 Proxy** | `ModuGraph` 透明委托编译图 |
| **装饰器/包装器 Decorator** | 输出护栏节点、retry、metrics、限流、SkillToolWrapper |
| **策略 Strategy** | 共识策略、参数调优/组件替换、上下文策略 |
| **观察者/发布订阅 Observer** | EventBus + 配置变更回调 |
| **管道/责任链 Pipeline** | 感知管线、ReAct 循环 |
| **建造者 Builder** | StateGraph 声明式构建、子图构建 |
| **命令 Command** | `Command({ resume })` 恢复中断 |

## 2.3 技术栈与工具链

- **语言/模块**：TypeScript 5.5（`strict: true`）、原生 ESM（`"type": "module"`）、目标 ES2022，模块解析 Bundler；
- **核心依赖**：
  - `@langchain/core` + `@langchain/langgraph`：状态图编排（StateGraph、reducer、ToolNode、interrupt、Send、checkpointer/store）；
  - `@langchain/openai`：以 OpenAI 兼容协议对接多家模型；
  - `@modelcontextprotocol/sdk`：MCP 客户端（stdio/SSE/WebSocket）；
  - `zod`：工具入参与结构化输出校验；
- **可选依赖（按需降级）**：`better-sqlite3`（SQL 查询/持久化）、`chromadb`（向量记忆）、`prom-client`（Prometheus）、`@opentelemetry/*`（追踪/导出）；
- **工具链**：TypeScript 编译（生成 `dist/` 与 .d.ts）、Vitest（单元/集成/架构测试，自定义插件把源码中的 `.js` 引用解析到 `.ts`）；
- **包出口**：`. / ./core / ./graph / ./mcp / ./skills`，宿主可按需引入。

## 2.4 数据流（请求级）

1. **入口**：宿主应用（HTTP/SSE 等）构造 `input_data`（input_type/prompt/sensitivity_level）；
2. **图获取**：`get_runner()` 返回（或按配置 hash 重建）缓存的编译图；
3. **执行**：图按节点推进，状态经各 reducer 合并；跨节点的副作用统一走 EventBus；
4. **输出**：token 级（messages）与节点级（updates）事件经 EventBridge → AG-UI 编码 → 前端；末个 values 给出完整结果；
5. **中断/恢复**：interrupt 载荷存 checkpointer，前端据 `get_interrupt_state` 渲染弹窗，resume 后继续；
6. **收尾**：记忆写入、指标记录、审计落盘、（可选）反馈进化。

## 2.5 关键技术决策与权衡

1. **增强能力全部 feature flag 化、默认关闭**：保证"默认路径行为零变化"，可灰度、可 A/B、可即时回滚（如 `policy.engine.enabled`、`perception.builtin_processors.enabled`）。
2. **零外部依赖的最小 YAML 解析器**：以"仅支持配置所需子集"换取零依赖与安装稳定性，复杂/非法输入安全降级。
3. **安全策略 fail-open**：策略引擎异常或返回形状不符时回退原路径——可用性优先，安全事件另走审计旁路；高危操作则以"弱沙箱 + 强审批"做纵深防御（代码执行器明确声明其静态黑名单只能抬高逃逸成本，真正边界是人工审批）。
4. **配置软失效 + 图缓存**：温度等仅影响 LLM 行为的参数走 per-request `configurable` 注入并 debounce，避免频繁重编译；hash 检测兜底保证最终一致。
5. **checkpointer / store 双存储分工**：短期会话与中断态 vs 长期知识，职责清晰。
6. **拓扑数据化（GraphSpec）**：默认图与扩展图同走 `buildFromSpec`，使"加一个节点"从改源码变为注册一条声明，并以等价性快照测试锁定默认行为。
7. **自研推理器家族退场**：删除自研 BaseLLMReasoner，统一到 LangChain 模型 + `ModuLLM` 接口，消除双轨维护成本。

---

# 第三部分 · 产品业务架构

## 3.1 产品定位

modu-agent 的产品形态是一个 **可嵌入宿主应用的智能体引擎 SDK**：它本身不绑定具体 UI 或业务，而是把"可靠地用工具完成任务"做成标准能力，供桌面端、服务端等宿主集成，并通过"场景包"让不同业务领域复用同一底座。

一句话概括：**通用智能体底座（稳定、可复用） + 场景化业务包（可变、可插拔）**。

## 3.2 角色与诉求

| 角色 | 与系统的关系 | 核心诉求 |
|---|---|---|
| **终端用户** | 发起自然语言任务、接收流式结果、在中断时审批/补充 | 任务被真正完成；过程可见、可控；隐私与安全 |
| **宿主应用** | 集成 SDK、提供入口与 UI、挂载 `/debug` 等处理器 | 接入简单、行为可预期、可按需裁剪能力 |
| **场景包/领域开发者** | 以 `pack.yaml` + 目录约定交付业务能力 | 不改内核即可扩展；可独立开发、分发、回滚 |
| **运维/平台工程师** | 配置、观测、审计 | 全链路可观测、审计可追溯、故障可回滚、资源可控 |

## 3.3 功能能力地图（产品视图）

| 能力域 | 产品化能力 |
|---|---|
| **感知理解** | 多模态输入（文本/图像/语音）、文本清洗与截断、语种检测、意图/实体/情感分析、输入质量评估 |
| **安全合规** | Prompt 注入/越狱防护、PII 识别与脱敏、SSRF/路径穿越/SQL 注入防护、密钥与内网拓扑防泄漏、统一安全审计 |
| **人工治理** | 敏感操作审批、改参批准、需求澄清追问、超时自动处理、暂停态跨会话恢复 |
| **记忆** | 短期会话记忆、长期向量知识库、对话历史沉淀、可替换记忆后端 |
| **推理** | 复杂度自适应分层、思维链锚点与反思、四层 Prompt 组装、多模型路由（成本/质量平衡） |
| **工具与执行** | 计算/搜索/时间/HTTP/文件/文档/代码/SQL 内置工具、结果缓存与限流、外部 MCP 工具生态 |
| **协作与编排** | 多智能体分工与共识、共享黑板、Plan-and-Execute 规划与重规划、DAG 并行 |
| **反馈进化** | 规则/LLM/混合质量评估、参数自动调优、组件热替换、版本管理与自动回滚 |
| **可观测性** | 分布式追踪、Prometheus 指标、结构化日志、配置溯源与脱敏快照 |

## 3.4 可插拔业务单元：场景包

场景包是产品业务架构的核心载体。一个包的标准结构为：

```
packs/<name>/
  pack.yaml              manifest：name/version/capabilities/entry/extends/config_profile
  domains/<domain>.md    能力 domain：领域知识（frontmatter）
  prompts/*.json         能力 prompt：PromptTemplate
  guardrails/rules.yaml  能力 guardrail：护栏规则
  sop/roles.yaml         能力 sop：角色与步骤类型字典
  eval/                  能力 eval：评估口径（由 evals 包 --pack 消费）
  entry.js               代码型扩展：activate(host)
```

- **声明即装配**：`ScenarioLoader` 按 `capabilities` 自动分发；`config_profile` 可覆盖配置与图画像开关；`extends` 支持包间依赖；
- **作用域自洽**：所有注册经 `ScenarioHost` 收口并记录 undo，`deactivate()` 逆序回滚——安装即生效、卸载即恢复，对底座零侵入；
- 仓库内的 `packs/example-pack`（research_writer 领域 + 五类能力声明）即为参考模板。

## 3.5 模块协作关系（产品视角）

```
终端用户 ──任务──▶ 宿主应用 ──▶ ┌──────────────  modu-agent 引擎  ──────────────┐
                               │ perception → memory → reasoning → tools        │
                               │     ▲                              │          │
                               │  kernel 场景包 注入：领域/Prompt/护栏/SOP/工具   │
                               │     │                              ▼          │
                               │ evolution ◀ feedback ◀ 质量/指标（observability）│
                               │ EventBus/AGUI/SSE ── 流式事件与审计 ──▶ 宿主/前端 │
                               └────────────────────────────────────────────────┘
外部工具生态（MCP Server）◀──── mcp 客户端 ────┘
```

---

# 第四部分 · 总体评价

## 4.1 架构特质

1. **认知循环建模清晰**：感知—记忆—推理—行动—反馈的划分贯穿状态、节点、模块目录与产品能力，概念在各层保持一致，认知负担低。
2. **抽象到位、面向契约编程**：14 个模块均依赖 `core/interfaces` 抽象，具体实现可替换；新能力多以"注册一条声明"而非"修改内核"接入，符合开闭原则。
3. **可插拔业务模型闭环完整**：从 `pack.yaml` 约定、加载器、统一门面到作用域回滚，场景包真正做到了可独立开发与运行时热插拔，而非停留在目录约定层面。
4. **工程纪律成熟**：feature flag 默认关闭、fail-open、纵深防御、架构边界测试、拓扑等价性快照、配置溯源、全面的可观测与审计，体现了对"把智能体用于真实生产"的风险认知。
5. **演进路径留有余地**：状态/协议均带版本号与迁移逻辑；可选依赖全部按需降级（无 chroma/better-sqlite3/OTel 也能运行）。

## 4.2 已知取舍（代码中明确声明）

- 代码执行器为"弱沙箱"，强安全边界依赖人工审批，中期目标是 AST 白名单、长期目标是容器/Job 隔离；
- 内存型 checkpointer 的中断态在进程重启/多实例下会失效，生产持久化需切换 sqlite；
- TS 版缺乏语义嵌入与本地 NER 等库，向量记忆默认用 hash embedding、深度解析依赖 LLM；
- `max_reasoning_iterations` 等参数的运行时调整对 LLM 立即生效，但 recursionLimit 更新依赖下次图的惰性重建（最终一致）。

## 4.3 结语

modu-agent 不是一个"把 LLM 调用包一层"的薄封装，而是一个**围绕智能体认知循环、以 LangGraph 为内核、以注册表和声明式装配为骨架、以场景包为业务交付单元、并内建安全/治理/观测/进化能力的完整智能体运行时**。其业务逻辑、技术架构与产品业务架构三者高度自洽：**稳定的底座保障通用性与可靠性，可插拔的场景包承载业务差异性**——这正是该项目最核心的架构价值。

---

*附：本报告结论均可回溯至 `packages/modu-agent/src/` 对应源码；图拓扑与节点职责分别以 `graph/graph.ts` 的 `composeDefaultGraph()` 与 `graph/nodes.ts` 为权威来源，场景包机制以 `kernel/scenario-loader.ts`、`kernel/scenario-host.ts` 与 `packs/example-pack/pack.yaml` 为准。*
