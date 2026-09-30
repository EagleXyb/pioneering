# modu-agent 上下文窗口管理策略深度分析报告

> 分析对象：`packages/modu-agent`
> 分析日期：2026-09-30
> 分析方法：源码级静态走读 + 配置交叉验证（`runtime-config.ts` / `capability-registry.ts` / `config.yaml`）

---

## 0. 总体架构概览

modu-agent **没有单一的"ContextWindowManager"类**，而是采用**分布式多层策略**：以 LangGraph `messages` 状态通道为容器，通过"声明式片段注入 + 分级预算截断 + 蒸馏压缩 + 终止引擎兜底"四层机制协同管理上下文。核心链路：

```
工具结果 → Observation蒸馏(压缩) → observation_history(状态)
                                        ↓
Checkpointer(thread级messages持久化) → agentNode(片段注入) → LLM调用
                                        ↑                        ↓
                              字符/token预算截断          usage统计 → 终止引擎token熔断
```

---

## 1. 上下文的创建与初始化机制

**入口**：`src/graph/state.ts` 的 `makeInitialState()`（L437-L511）构建图初始状态，`messages: []` 为空数组，同时初始化所有上下文相关通道（`knowledge: []`、`observation_history: []`、`tool_results: []`、`usage: {prompt_tokens:0,...}`）。

**每轮组装**：`src/graph/nodes.ts` 的 `agentNode`（L1070-L1117）是上下文的"装配车间"，每次 LLM 调用前在**局部副本**上重建上下文：

1. 拷贝 `state.messages`（不污染全局状态）；
2. 空数组时用 `cleaned_text` 补一条 `HumanMessage`；
3. 按 `complexity_assessment.tier` 动态拼接 CoT 锚点，`unshift` 系统提示词；
4. 调用 `applyContextFragments()` 注入 6 段结构化上下文（见 §2）；
5. `anchorIndex = effectiveSystemPrompt ? 1 : 0` 决定锚点位置。

**关键设计**：上下文是**每轮即时重建**的（per-call assembly），而非持久累积的单一对象——注入的 SystemMessage 片段不写回 `state.messages`（reducer 只追加 LLM 响应），避免了重复注入。

---

## 2. 存储结构与数据组织方式

### 2.1 声明式片段模型（P2/T-15 重构核心）

契约定义在 `src/core/interfaces/context.ts`：

- **`ContextFragment`**：`{ id, priority, placement, anchorOffset?, budget?, build(state, ctx) }`——每个上下文来源声明优先级、注入位置与构建函数；
- **`ContextPlacement`**：`'anchor'`（splice 到系统提示词附近）| `'append'`（push 到尾部）；
- **`ContextStrategy`**：一组片段 + `supports(taskType)` 适用判定；
- **`ContextRegistry`**：策略注册表，宿主可替换策略而**不改内核源码**。

内置 6 段片段在 `src/graph/context-strategies.ts`：

| 片段 id | priority | 位置 | 内容来源 |
|---|---|---|---|
| `ctx.perception` | 10 | anchor+0 | `state.perception_result` |
| `ctx.doc_gen_task` | 20 | anchor+1 | 任务类型提醒（仅 document_generation） |
| `ctx.memory_knowledge` | 30 | anchor+0 | `state.knowledge`（长期记忆召回） |
| `ctx.observations` | 40 | append | `observation_history.slice(-5)` |
| `ctx.few_shot` | 45 | append | `DynamicFewShotSelector` 异步检索 |
| `ctx.plan_step` | 50 | append | Plan-and-Execute 当前步骤 |

### 2.2 状态通道分层

`src/graph/state.ts` 通过 LangGraph `Annotation.Root` 定义 reducer 语义：`messages` 用 `messagesStateReducer`（按 id 去重追加）、`observation_history`/`tool_results`/`artifacts` 用追加 reducer、其余 last-write-wins。状态字段按 `CoreState + HITLModeState + MultiAgentModeState + PlanExecuteModeState + FeedbackModeState` 分层组合，防止单状态对象膨胀。

### 2.3 检查点持久化

会话级上下文由 `src/graph/bounded-memory-saver.ts` 的 `BoundedMemorySaver`（`MemorySaver` 子类）承载，`src/graph/factory.ts`（L200-L210）以进程级单例构建，按 `memory.checkpointer_max_threads`（默认 100）做 **thread 粒度 LRU 淘汰**，防止长跑进程 state 无界累积。

---

## 3. 长度限制的判断逻辑

系统采用**字符级 + 粗估 token 级**双轨判断，无真实 tokenizer：

1. **片段级预算**：`src/reasoning/context-builder.ts` L56-L59 —— `budget = fragment.budget ?? ctx.budgets?.[fragment.id]`，超限直接 `content.slice(0, budget)`（字符数）；
2. **工具结果级**：`src/graph/adapters/tool-adapter.ts` 的 `_truncateToolResult`（L134-L161）按 `tools.max_result_chars.{tool_name}` > `default` 优先级截断，追加 `...[truncated]` 标记让 LLM 感知不完整；
3. **蒸馏级**：`src/graph/adapters/observation-distiller.ts` 的 `ObservationDistiller`（L166-L174）以 `maxTokens=500 × charsPerToken=3` 折算字符上限（1 token ≈ 3 字符的中英混合粗略系数）；
4. **token 估算函数**：`src/config/markdown-prompt-aggregator.ts` 的 `estimateTokens`（L78-L80，`ceil(len/4)`）与 few-shot-selector 内部实现保持一致；
5. **全局熔断**：终止引擎（见 §5.3）。

**注意**：`llm.max_tokens=512`（`runtime-config.ts` L23）是**输出**上限，不是输入窗口限制。

---

## 4. 动态更新与维护策略

- **追加式消息流**：LLM 响应经 `{ messages: [response] }` 由 reducer 合并回 state（`nodes.ts` L1233）；ToolNode 自动追加 ToolMessage；
- **蒸馏旁路**：`toolResultProcessor`（`nodes.ts` L1489-L1497）明确**不修改 messages**（避免 reducer 重复追加），蒸馏摘要写入 `observation_history` 作为辅助通道，原始 ToolMessage 保留——形成"原始 + 精简"双视图；
- **Observation 三层蒸馏**（`observation-distiller.ts` L184-L223）：Layer-1 结构化提取（status/records_count/key_metrics）→ Layer-2 按 `current_subtask` 关键词相关性过滤 → Layer-3 与 history 逐行去重的**增量压缩**（重复时输出 `[duplicate of previous observation]`），异常时降级返回原始内容，绝不阻断 ReAct 循环；
- **Plan 步骤基线**：dispatcher 记录 `step_msg_baseline`（`plan-execute/dispatcher.ts` L126），step_finalize 据此截取本步增量消息；
- **失败隔离**：单片段构建异常仅告警跳过（`context-builder.ts` 的 `_buildMessage` L46-L71 try/catch），不中断节点。

---

## 5. 达到长度限制时的处理机制

### 5.1 截断（Truncation）

字符级 `slice` + 标记，应用于片段预算、工具结果、Markdown 注入（`applyCharBudget`）、步骤摘要（`plan-execute/context.ts` 的 `_truncate` L14-L19，`plan_execute.step_summary_max_chars=500`）。

### 5.2 优先级排序（Priority Selection）

- `applyContextFragments`（`context-builder.ts` L81-L123）：先 anchor 后 append，组内按 `priority` 升序（稳定排序），锚点插入位置 `clamp(anchorIndex + anchorOffset, 0, len)`；
- Few-shot 选择：MMR 多样性检索后按 token 预算**贪心装填**，超预算即停止（`skills/few-shot-selector.ts` L300-L310）——预算不足时低序示例整体丢弃而非截半；
- Observation 历史：`slice(-5)` 保留最近 5 条（时间邻近性优先）。

### 5.3 压缩与熔断

- 压缩 = §4 的三层蒸馏 + 前序步骤摘要化（"for reference only, do NOT repeat"约束防复述膨胀）；
- **token 熔断**：`src/graph/termination-engine.ts` 的 `AdaptiveTerminationEngine`（L304-L309）在 `usage.total_tokens >= maxTokens`（默认 12000，场景化 SceneProfile 可调）时返回 `TERMINATE_WITH_CAVEATS`；token 用量优先取真实 `usage`，缺失时按 `messages 总字符/3` 退化估算（L450-L462）；
- **轮数熔断**：`maxRounds=15` + LangGraph `recursionLimit` 双保险。

**重要事实**：`state.messages` 本身**没有滑动窗口/摘要折叠机制**——超长历史只靠蒸馏旁路、工具截断和终止熔断间接控制；若单会话轮数极多，messages 会持续膨胀直至触发 token 熔断。

---

## 6. 与其他核心模块的交互

| 模块 | 交互方式 |
|---|---|
| **记忆系统** | 短期：`memory/short-term-memory.ts` 的 `InMemoryShortTermMemory.query`（L52-L80）以 `contextWindow` 字符串（`last_N_turns`）解析窗口并 `slice(-limit)`，TTL+maxTurns×2 双上限；长期：`makeMemoryQueryNode`（`nodes.ts` L350-L400）从 Store 召回 top-5 知识写入 `state.knowledge`，经 `ctx.memory_knowledge` 片段进窗口；会话历史由 Checkpointer 按 thread_id 管理 |
| **推理引擎** | `complexity_assessment.tier` 决定 CoT 锚点拼接与温度；`reasoning_round_count` 累加计数驱动 `reasoning_budget` 终止；终止引擎消费 `usage`/`information_gain_history` |
| **感知层** | `perception_result`/`cleaned_text` 经 `ctx.perception` 片段注入；敏感度熔断在路由层拦截 |
| **工具层** | `wrap_modu_tool` 出口截断 → ToolMessage 入 messages → toolResultProcessor 蒸馏入 observation_history |
| **Plan-Execute** | `makePlanContextInjector`（`plan-execute/context.ts` L27-L85）产出"当前步骤+前序摘要（截断）"SystemMessage；仅注入本代际（`replan_count` 匹配）结果，防跨代膨胀 |
| **技能层** | Few-shot selector 异步注入，受 `max_tokens_budget=1500` 硬上限 |

---

## 7. 配置参数设计

`src/config/runtime-config.ts` 中的上下文相关参数（均经 `capability-registry.ts` 声明消费点，防"声明与消费脱节"）：

| 参数 | 默认值 | 场景 |
|---|---|---|
| `context.registry.enabled` | true | 策略注册总开关，false=单点回滚到内置策略 |
| `react_optimization.observation_distillation.{enabled,max_tokens}` | true / 500 | 蒸馏开关与 summary 预算 |
| `tools.max_result_chars.{default,limits}` | 0(关) | 大响应防撑爆窗口，按工具名覆盖 |
| `plan_execute.step_summary_max_chars` | 500 | 前序步骤摘要截断 |
| `react_optimization.few_shot.max_tokens_budget` | 1500 | 示例注入硬上限 |
| `react_optimization.markdown_prompt.{system_prompt,runtime_context}_max_chars` | 8000 / 4000 | .md 注入防 Token 膨胀 |
| `memory.checkpointer_max_threads` | 100 | thread 级 LRU 上限 |
| `MemoryQuerySchema.context_window` | `last_5_turns` | 白名单校验（`config/schemas.ts` L127-L139：`last_{1,3,5,10}_turns`/`all`/任意 `last_N_turns`） |

---

## 8. 优势与潜在改进点

### 8.1 优势

1. **声明式可插拔**：片段模型把过程式 splice/push 收敛为 `{priority, placement, budget, build}`，宿主换策略不改内核，且有字符等价测试锁定（`tests/reasoning/context-builder.test.ts`）；
2. **多层防御**：入口截断（工具）→ 过程压缩（蒸馏）→ 组装预算（片段）→ 全局熔断（终止引擎），每层独立降级不阻断主循环；
3. **增量蒸馏去重**是亮点——Layer-3 与历史逐行比对只保留新信息，直接抑制 ReAct 循环中最常见的"重复观察膨胀"；
4. **配置治理**：capability-registry 强制"声明↔消费"配对，历史僵尸配置（`memory.context_window`）已被清理并注明原因。

### 8.2 潜在改进点

1. **messages 无滑动窗口/摘要折叠**（最大缺口）：长会话仅靠 token 熔断兜底，缺少"超限后对旧消息做 LLM 摘要替换"的主动压缩；`MemoryQuerySchema.enableCompression` 字段已声明但**无任何消费代码**，是预留未落地的钩子；
2. **`'all'` 窗口取值行为不一致**：`VALID_CONTEXT_WINDOWS` 允许 `'all'`，但 `_parseContextWindow`（`short-term-memory.ts` L156-L165）对 `'all'` 解析失败后**静默回退 5**，语义应为全量；
3. **token 估算系数不统一**：蒸馏器用 `/3`、estimateTokens 用 `/4`、终止引擎退化用 `/3`，跨模块预算不可比；建议统一到一个工具函数；
4. **`ctx.budgets` 运行时通道未接线**：`ContextRuntime.budgets` 契约已定义、builder 已实现消费，但全库无调用方传入——片段级预算实际只能靠硬编码 `fragment.budget`（内置片段全部缺省），配置化预算（如蒸馏 max_tokens 映射到片段）尚未打通；
5. **截断策略纯尾部丢弃**：`slice(0, budget)` 可能切断 JSON 结构或语义单元，且 anchor 片段超预算时无优先级驱逐机制（低优先级片段超预算仍占位，高优先级内容无法回收空间）；
6. **蒸馏双视图冗余**：原始 ToolMessage 与蒸馏摘要同时进窗口（设计决策如此），工具结果很大时"防撑爆"收益被原始 content 抵消，可考虑对超阈值 ToolMessage 做引用替换。

---

## 9. 四大经典上下文管理策略的落地对照

业界通行的四类上下文窗口管理策略（外部持久化 / 检索选择 / 压缩摘要 / 隔离上下文），modu-agent **都有对应实现**，但成熟度不一。逐项对照：

### 9.1 写入外部持久化（Offload）— 部分实现

| 机制 | 代码位置 | 说明 |
|---|---|---|
| 会话历史写外部 Store | `nodes.ts` `memoryUpdateNode`（L479-L502） | 每轮结束把完整对话文本 `store.put([userId,'history'], key, payload)` 写入 Chroma/策略后端，或经 `MemoryStrategy.persist`；下次会话经 `ctx.memory_knowledge` 片段读回 |
| 长期知识向量库 | `makeMemoryQueryNode`（`nodes.ts` L382-L394） | `store.search([userId,'knowledge'], {query, limit:5})` 语义召回 |
| 短期记忆缓存 | `memory/short-term-memory.ts` | Map + TTL + maxTurns×2 上限，带 sweep 回收 |
| 检查点持久化 | `graph/bounded-memory-saver.ts` `BoundedMemorySaver`（L33） | thread 级 LRU（默认 100），被淘汰 thread 回冷启动语义 |
| 文件产物 | `tools/file-ops.ts` + `state.artifacts` | 工具可写文件，artifacts 仅记录元数据引用，不把内容留在窗口 |

**缺口**：没有"窗口快满时主动把中间结果 dump 到文件/DB、窗口内只留引用句柄"的机制（即 Claude Code 式的 scratchpad offload）。外部化都是**会话边界**触发的，不是**窗口压力**触发的。

### 9.2 检索选择（Retrieve-on-demand）— 实现较完整

- **向量检索**：memory_query 节点语义召回 top-5 知识；
- **Few-shot 示例检索**：`skills/few-shot-selector.ts`（L291-L310）按 query 检索示例库 → MMR 相关性+多样性选择 → token 预算贪心装填，默认不预装；
- **工具描述筛选**：`_filterToolsByTaskType`（`nodes.ts` L2747）按 task_type（及 intent 细筛，`tool_capability_matrix` flag）过滤 bind_tools 集合——不是把全部工具描述塞进 system prompt；
- **记忆策略可插拔**：`MemoryStrategy.recall(query, {userId, taskType})` 允许宿主换成任意检索后端。

**缺口**：没有对 `messages` 历史本身做检索式召回（如把旧消息向量化后按需拉回），检索只覆盖知识/示例/工具三类外挂数据源。

### 9.3 压缩摘要（Compress）— 核心亮点，但只压"增量"不压"存量"

三层蒸馏是最接近的实现（`observation-distiller.ts` L184-L223）：

- **进入前压缩**：Layer-1 结构化提取 → Layer-2 相关性过滤（启发式剪枝）→ Layer-3 与历史去重的增量压缩，超预算截断 summary；
- **滞留时压缩**：`ctx.observations` 片段只取 `slice(-5)`；plan 前序步骤只注入截断摘要（`step_summary_max_chars=500`）且限定本代际（replan 过滤）；
- **字符预算**：工具结果 `max_result_chars`、Markdown 注入 `runtime_context_max_chars`、片段级 `budget`。

**缺口（关键）**：**没有滚动摘要/分层摘要**——`state.messages` 里的旧 HumanMessage/AIMessage/ToolMessage 原文永不折叠。蒸馏是"旁路补充视图"（原始 ToolMessage 仍留在 messages 中，见 `nodes.ts` L1489-L1493 设计决策），不是"替换"。所以压缩只对新产生的 Observation 生效，对存量消息无效，长会话最终仍靠终止引擎 `maxTokens=12000` 熔断。

### 9.4 隔离上下文（Isolate）— 实现完整，回传机制清晰

- **子 Agent 独立状态**：`graph/subgraph/states.ts` 的 `SubAgentState`（L37-L48）明确注释"子 Agent 独立消息历史（不污染主 state）"，子图内 ReAct 循环的 messages 与主图完全分离（`subgraph/builder.ts` L93）；
- **只回传浓缩结论**：`subFinalizeNode` 把子图末条 AIMessage 提取为 `task_output`，主图只收到 `{ subtask_results: {[taskId]: finalResult} }`（`nodes.ts` L2722），子 Agent 的几十轮工具消息不进主窗口；
- **黑板共享**：`blackboard` 合并 reducer 供子 Agent 间传浓缩中间结果（`nodes.ts` L2613-L2658），consensus 节点聚合后仅以一条 AIMessage 回注主 messages；
- **Plan-Execute 分步**：dispatcher 按步骤派发，`step_msg_baseline` 界定每步增量，步骤间靠摘要而非全量消息衔接。

**缺口**：`task_output` 回传时未对结论再做长度约束（子 Agent 长篇大论会整段进主窗口），只有 blackboard 注入是 JSON 全量拼接。

### 9.5 四类策略覆盖度总结

| 策略 | 覆盖度 | 主要载体 | 短板 |
|---|---|---|---|
| 1 外部持久化 | ★★★☆ | Store/Chroma、Checkpointer、artifacts | 非窗口压力驱动，无引用句柄化 |
| 2 检索选择 | ★★★★ | 向量召回、few-shot MMR、工具筛选 | 不检索历史消息本身 |
| 3 压缩摘要 | ★★★☆ | 三层蒸馏、截断、slice(-5) | **无滚动/分层摘要折叠存量 messages** |
| 4 隔离上下文 | ★★★★ | SubAgentState、task_output、blackboard | 回传结论无预算约束 |

四类都做了，其中"隔离"和"检索"最完整；"压缩"只覆盖增量旁路、缺存量消息的摘要折叠（这是与 LangMem/Anthropic compaction 类方案的最大差距）；"外部化"停留在会话级持久化，未与窗口水位联动。

---

## 10. 改进路线建议（按优先级）

| 优先级 | 改进项 | 说明 |
|---|---|---|
| P0 | messages 滚动摘要 | 触发条件接 `usage.total_tokens` 水位（如 70% × maxTokens），对旧消息做 LLM 摘要替换；可复用 `MemoryQuerySchema.enableCompression` 既有字段作为开关 |
| P1 | 蒸馏结果替换原 ToolMessage | 超阈值 ToolMessage 以引用句柄（observation id）+ 摘要替换，原文 offload 到 Store/文件，打通"外部持久化 ↔ 窗口水位"联动 |
| P2 | task_output 回传预算 | 子 Agent 结论回注主图前按字符/token 预算截断或摘要 |
| P2 | 统一 token 估算 | 收敛 `/3` 与 `/4` 两套系数到单一工具函数 |
| P3 | 修复 `'all'` 窗口语义 | `_parseContextWindow` 对 `'all'` 返回全量而非静默回退 5 |
| P3 | 接线 `ctx.budgets` | 把配置化预算（如 `observation_distillation.max_tokens`）映射到片段级 budget，使声明式预算真正可配 |
