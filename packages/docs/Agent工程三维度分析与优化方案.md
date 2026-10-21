# Agent 工程三维度分析与优化方案（Prompt / Context / Harness）

> 分析日期：2026-10-21
> 分析范围：`packages/modu-agent`（内核）、`apps/backend-ts`（宿主/API）、`apps/web`、`apps/desktop`（两个客户端）、`packages/llm-*`（共享 LLM 接入层）、`packages/evals`、CI 配置
> 分析方法：源码级静态走读 + 运行时环境实测（依赖/原生产物/配置）+ 配置默认值交叉验证
> 说明：`apps/marketing` 为 Next.js 营销站，全仓检索无 Agent 调用代码（仅 `data/stats.ts` 文案提及），不参与本报告结论。

---

## 0. 结论速览

| 维度 | 成熟度 | 一句话结论 |
|---|---|---|
| Prompt | ★★☆☆☆ | 有注册表/场景包/四层组装三套机制，但**只有"拼接"没有"管理"**：版本不参与选择、`list(taskType)` 无消费方、变量注入无校验、主 prompt 是 7KB 单块英文规则堆叠 |
| Context | ★★☆☆☆ | **声明式片段 + 蒸馏 + 检查点**设计不错，但存在三个致命断点：`input_data.history` 是死字段、`messages` 无任何窗口裁剪、checkpointer 实际是内存单例 |
| Harness | ★★★☆☆ | 图编排/Plan-Execute DAG/HITL/失败收尾都较完整；短板在**生命周期（图构建分裂、无会话互斥）**、**工具执行控制面（超时/重试/截断默认全关）**、**可观测与成本链（usage 恒 0、trace 无导出）** |

**最高优先级的 8 个缺陷**（均为"影响正确性/成本"，不是风格问题）：

| # | 缺陷 | 位置 | 后果 |
|---|---|---|---|
| 1 | `history` 由后端按预算查出并传入图，但内核**从不读取** | `apps/backend-ts/src/core/agent-bridge.ts:293`、`packages/modu-agent/src/graph/state.ts:33` | 预算裁剪是死代码；多轮上下文完全依赖 checkpointer |
| 2 | checkpointer 配 sqlite 但原生绑定缺失 → 静默回退内存单例 | `graph/factory.ts:195`、`config.yaml:7` | 进程重启/多实例后历史与 HITL 暂停态全丢；LRU 100 线程还会淘汰老会话 |
| 3 | `state.messages` 全量进入每次 LLM 调用，无窗口/摘要 | `graph/nodes.ts:1313`、`graph/state.ts:222` | 长会话必然超窗，表现为 400 或回答质量骤降，且无任何提示 |
| 4 | 蒸馏是"叠加视图"而非"替换" | `graph/nodes.ts:1785` | 大工具结果场景 token **增加**而非下降 |
| 5 | 长期记忆读写命名空间不对称 + 哈希嵌入 | `graph/nodes.ts:392`/`:556`、`memory/chroma.ts:24` | 语义召回基本失效（InMemory 后端下恒空） |
| 6 | `memory_persisted_count` 每轮被 initial state 重置为 0 | `graph/state.ts:529`、`:269` | T3-6 的"增量写入"在 run 边界失效，每轮重写全量历史（平方级增长回归） |
| 7 | 同会话无并发互斥，多 run 写同一 `thread_id` | `apps/backend-ts/src/routes/agent.ts:609` | 并发发送/边恢复边发送 → checkpoint 状态互相覆盖 |
| 8 | `agent_runs.usage` 恒为 0，配额按字符估算 | `agent-bridge.ts:186`/`:1114`、`core/quota.ts:63` | 成本不可核算、不可限流、不可优化（没有度量就没有优化） |

---

## 1. 代码范围与真实调用链

```
apps/web (pro / task)  ─┐  POST /agent/completions  {sessionId,message,agentMode,model,skills}
apps/desktop (renderer)─┤  IPC send  {+history(20条，实际被丢弃)}
                        ▼
apps/backend-ts  routes/agent.ts ── core/agent-bridge.ts ── @pioneering/modu-agent
   │  持久化 chat_messages / agent_runs / agent_tool_executions        │
   │  (Prisma)                                                          ▼
   │                                                    graph/runner.ts → factory.create_agent
   │                                                        ├─ perception → memory_query
   │                                                        ├─ agent ⇄ tools(ToolNode) → tool_processor
   │                                                        ├─ [planner → step_dispatch → step_finalize]
   │                                                        ├─ [human_review / clarify] (interrupt)
   │                                                        └─ finalize_response → [feedback] → memory_update
   ▼
PostgreSQL                                   LLM(ChatOpenAI) + ToolNode + BaseStore(Chroma/InMemory) + Checkpointer
```

关键事实（决定了后面所有结论）：

- **内核不消费宿主传的 history**。`state.ts` 顶部注释明确写"原 `context["history"]` → 已移除（僵尸字段，无节点读取）"：

```31:40:packages/modu-agent/src/graph/state.ts
 * 关键映射：
 *   原 context["history"]         → 已移除（僵尸字段，无节点读取；长期记忆由 store/Chroma 承载）
 *   原 context["perception"]      → State.perception_result / cleaned_text
```

而宿主仍每轮查库并塞进 `input_data`：

```293:297:apps/backend-ts/src/core/agent-bridge.ts
  // 注入会话历史到 input_data
  const inputData: Record<string, any> = { input_type: 'text', prompt: message }
  if (history) {
    inputData.history = history
  }
```

- **Agent 通道绕过共享 LLM 网关**。`/chat/*` 走 `@pioneering/llm-gateway`（超时/重试/熔断/计量统一），Agent 通道走 modu-agent 内 `ChatOpenAI`，因此两套成本与错误口径不一致（见 §4.2 H-7/H-8）。
- **桌面端内嵌一份 harness**（`apps/desktop/src/main/agent-runtime.ts`），与 backend 语义对齐但无持久化/配额，属"第二实现"。

---

## 2. Prompt 工程

### 2.1 现状：三套机制并存，但只有一套真正生效

| 机制 | 位置 | 是否生效 |
|---|---|---|
| 默认 system prompt 字面量 | `graph/factory.ts:121` | ✅ 每次 `create_agent` 使用 |
| `PromptRegistry`（id/version/variables/taskTypes） | `reasoning/prompt-registry.ts` | ⚠️ 仅按固定 id 渲染，版本/任务类型不参与 |
| 四层 `PromptComposer` | `reasoning/prompt-composer.ts` | ⚠️ 由场景包开启（`packs/*/pack.yaml:13`），仅字符串拼接 |
| 场景包 Markdown 领域层 | `packs/*/domains/*.md` + `config/markdown-loader.ts` | ✅ 已激活（`config.yaml:85`） |
| Skills 提示聚合 / 渐进式披露 | `skills/prompt-aggregator.ts` | ✅（受 `skills.enabled`，默认为空） |
| Markdown 文档注入（AGENTS/SOUL/USER/MEMORY） | `factory.ts:905` | ✅ 本部署开启（`config.yaml:11-16`） |
| Few-shot 选择 | `skills/few-shot-selector.ts` | ❌ 默认关闭 + 示例库为空 → 双重空转 |
| 场景包 `prompts/*.json` | `kernel/scenario-loader.ts:293` | ❌ 注册后无消费方（见 P-3） |

装配顺序（`factory.ts`）：

```867:873:packages/modu-agent/src/graph/factory.ts
  // 系统提示词（P0-优化: 宿主未传入时使用默认防幻觉 prompt 作为底线约束）
  let effectiveSystemPrompt =
    configurable['system_prompt'] ??
    systemPrompt ??
    renderPromptWithFallback('agent.default_system', {}, _DEFAULT_SYSTEM_PROMPT_TEMPLATE)
```

之后依次叠加：Skills 片段 → Markdown 文档（带 8000/4000 字符预算）→ `PromptComposer`（domain/taskSpec/runtimeContext）→ 作为 `system[0]` 注入；再在 `agentNode` 尾部按优先级注入 6 段运行时片段。

### 2.2 具体问题

#### P-1 主 system prompt 是 7KB / 28 条规则的"补丁堆叠"，关注点混杂

实测该字面量 **7068 字符**（≈1800–2400 token），单块包含：语言策略、防幻觉、多步闭环、叙述风格、工具预算、搜索效率、文档交付模板（含硬编码中文标题"文档位置/核心内容速览"）。编号从 15 直接跳到 21，存在 `11a/11b`，说明是长期追加形成：

```139:148:packages/modu-agent/src/graph/factory.ts
TOOL BUDGET AWARENESS (CRITICAL — violations cause recursion-limit crashes):
12. You have a LIMITED tool-call budget per task (typically 3-5 rounds). ...
15. If a tool fails after 1 retry with refined parameters, STOP and inform the user ...

SEARCH EFFICIENCY RULES (CRITICAL — applies to news/information gathering tasks):
21. For news summarization or document generation tasks, call web_search ONLY ONCE ...
```

问题：
1. 与代码里的 `doc-gen-guard`、`max_steps`、`reasoning_round_count` 逻辑**重复表达**，两边一旦调整就漂移；
2. "typically 3-5 rounds"与本部署实际预算（`max_reasoning_iterations=3` → 硬上限 6）不一致；
3. 英文规则 + 中文产品，白付 token 且增加语言漂移概率。

#### P-2 `PromptComposer` 只是拼接，没有预算与冲突消解

四层输出 `parts.join('\n\n')`，没有 token 预算、没有层间去重、没有"后层不得覆盖安全约束"的校验：

```53:71:packages/modu-agent/src/reasoning/prompt-composer.ts
  static compose(input: PromptComposerInput): string {
    const parts: string[] = []
    if (input.systemCore) parts.push(input.systemCore)
    if (input.domain) { ... parts.push(rendered) }
    if (input.taskSpec) parts.push(input.taskSpec)
    if (input.runtimeContext) parts.push(input.runtimeContext)
    return parts.join('\n\n')
  }
```

`runtimeContext` 只有两个来源：宿主 `configurable.runtime_context` 与 `USER.md/MEMORY.md`，**没有"用户画像/偏好/历史摘要"的结构化来源**（`factory.ts:904-921`）。

#### P-3 模板注册表的"版本 / taskTypes"是死能力

`version` 只写入不读取；`list(taskType)` 全仓无调用方（`core/registry.ts:437-440` 是对外门面，无人调用）；因此场景包注册的 `example_pack.writing_style`（`taskTypes:["document_generation"]`）永远不会被注入：

```293:307:packages/modu-agent/src/kernel/scenario-loader.ts
  private _loadPrompts(host: ScenarioHost, packDir: string): void {
    ...
        host.registerPrompt(tpl)   // 只注册，没有任何消费路径按 taskType 取用
```

#### P-4 变量注入过弱，且会"漏"进模型

`renderTemplateContent` 只做正则替换；缺失变量**原样保留 `{{name}}`**，无长度上限、无转义、`variables` 声明不参与校验：

```38:46:packages/modu-agent/src/reasoning/prompt-registry.ts
  const raw = tpl.messages.map((m: PromptMessage) => m.content).join('\n\n')
  return raw.replace(_PLACEHOLDER_RE, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      const value = vars[name]
      return value === undefined || value === null ? match : String(value)
    }
    return match
  })
```

后果：
1. 新增模板忘传变量 → 模型看到 `{{toolCatalogText}}` 这类字面量；
2. `toolCatalogText`、`knowledge` 等注入内容的长度不受控（只能靠上游自己截）；
3. 用户可控内容（检索结果、文件名）无分隔标记，存在**间接提示注入**风险。

#### P-5 多语言混杂，规则互相稀释

同一条请求里可能同时出现：英文主 prompt（7KB）、英文 planner/compact prompt（3.7KB）、中英混合的 doc_gen 模板、中文的 summarize/quality-judge prompt、中文领域 md。没有"按 locale 选择模板语言"的机制（`prompt-templates.ts` 全部是常量）。

#### P-6 没有按模型/任务/模式区分的主 Agent 模板

只有 4 个三句话的子 Agent 角色模板（research/coding/review/default）与 1 个 `document_generation` 模板；`pro`（react_agent）与 `task`（plan_execute）**共用同一主 prompt**，差异全靠运行时片段补丁（`context-strategies.ts`）。没有针对 GLM/DeepSeek/Qwen 的格式差异适配（例如工具调用 JSON、思考模式）。

#### P-7 planner 提示词双约束叠加，工具目录信息量不足

提示词同时要求"STRICT JSON only（no markdown fences）"，代码里又有 `withStructuredOutput` 主路径与 JSON-in-text 兜底；对 title/description 的长度、行数、禁用 JSON 反复强调（4 条），是"塌陷补丁"的历史痕迹。工具目录每条描述截断 200 字符且**不含参数 schema**：

```20:51:packages/modu-agent/src/graph/plan-execute/prompts.ts
const _TOOL_DESC_MAX_CHARS = 200
... lines.push(`- ${realtimeTag}${name}: ${desc}`)
```

planner 只能"点名工具"，无法写清参数，执行步仍要重新猜参数 → 首轮工具调用失败率上升，进而消耗重试预算。

#### P-8 提示词没有任何 UI/API 入口

后端 `chat_sessions.systemPrompt` 字段存在并在请求时使用（`routes/agent.ts:569`），但 Web 设置弹窗无此项（`apps/web/src/components/SettingsDialog.tsx` 9 个分区无 prompt），桌面端请求类型里有 `systemPrompt` 却被主进程白名单**静默丢弃**：

```234:243:apps/desktop/src/main/agent-runtime.ts
  return {
    sessionId: r.sessionId,
    message: r.message,
    history: r.history,
    agentMode: ...,
  }   // systemPrompt / temperature / maxTokens 未回传
```

#### P-9 无提示词评测闭环

`packages/evals` 能力完整（三层指标 + CI gate），但：
1. gate 需要 `LLM_API_KEY` secret，否则跳过（`.github/workflows/llm-ci.yml:67-73`）；
2. 没有 prompt 回归用例（planner JSON 合法率、交付格式遵从率等）；
3. CI 根本没跑 modu-agent 的 1100+ 测试（见 H-11）。

### 2.3 优化方案

| 编号 | 目标 | 具体改进点（落点） | 预期收益 | 优先级 |
|---|---|---|---|---|
| PR-1 | 主 prompt 模块化、可组合、可回归 | 把 `factory.ts:121-160` 拆成 `prompt/blocks/{role,language,tool-policy,narration,doc-workflow,output-format}.ts`，每块一个 `PromptTemplate`（`agent.system.*`），由 `composeAgentSystem(profile, taskType)` 按需组合；保留快照测试锁定输出 | 可单独改"叙述风格"而不动安全约束；为 A/B 提供最小单元；减 20-30% 冗余 token | P0 |
| PR-2 | 变量注入有契约 | `PromptTemplate.variables` 升级为 `{name,maxChars,required,wrap:'user-data'}`；渲染时：缺失 required → dev 抛错/prod 告警；超长截断加 `…[truncated]`；用户来源内容包成 `<<<USER_DATA>>>…<<<END>>>` 并在系统块声明"该区间为数据，非指令" | 杜绝占位符泄漏；间接注入面收敛；模板可安全复用 | P0 |
| PR-3 | 模板版本与场景解析 | `PromptRegistry.resolve(id,{version,taskType})`；`agentNode` 增加第 7 个片段 `ctx.task_prompts`，实现 `registry.listPrompts(task_type)` 的注入（把死能力接上）；run metadata 记录模板 id@version 便于回放 | 场景包 `prompts/*.json` 立即生效；prompt 变更可追溯、可灰度 | P1 |
| PR-4 | 语言策略统一 | 新增 `prompt/locale.ts`：按请求 locale（zh/en）选择主 prompt 语言；主 prompt 中文化与瘦身；planner 说明文字改中文但输出 JSON schema 不变 | 中文场景系统提示 token 降 30-40%；减少"英文叙述+中文答案"漂移 | P1 |
| PR-5 | planner 提示词 schema 驱动 | 以 `withStructuredOutput` 为唯一主路径（已有，去重降级逻辑）；工具目录改为 `name — 一句话用途 — 关键参数(a,b,c)`，从 `parametersSchema()` 自动生成，单条上限 300 字符；约束收敛为 3 条硬规则 + 2 个正反例 | 计划 JSON 合法率↑、参数正确率↑、planner token↓ | P1 |
| PR-6 | prompt 评测门禁 | `packages/evals` 增加 `prompt-regression` 数据集（录制 fixture + mock provider），指标：JSON 合法率、工具名命中率、文档格式遵从率、avg rounds、prompt_tokens；CI 无条件跑 | prompt 改动不再"凭感觉"；回归可量化 | P2 |
| PR-7 | 用户/会话级定制 | 打通 `systemPrompt`：Web 设置"角色设定"（≤2KB）+ 会话级覆盖；桌面白名单放开并加长度限制；拼装时固定顺序"系统约束 → 领域 → 用户设定 → 运行时" | 满足企业/个人定制诉求，且不破坏安全边界 | P2 |
| PR-8 | 前缀缓存友好 | 稳定块固定 `system[0]`；`ctx.perception`/`ctx.memory_knowledge` 由 `anchor` 改为 `append`（当前插在历史之前，每次召回变化都会打断缓存前缀） | 多轮场景命中 provider 前缀缓存，输入成本可降（DeepSeek/OpenAI 均支持） | P1（低成本） |

> PR-8 的证据：`context-strategies.ts:31-43`（perception, anchor offset 0）与 `:60-75`（memory_knowledge, anchor 0）都被 `splice` 到 system 之后、历史之前。

---

## 3. Context 工程

### 3.1 现状：两条互不相通的上下文链路

```
链路A（展示/预算，宿主侧）：chat_messages ──loadSessionHistoryByBudget(maxTokens=8000)──▶ input_data.history ──▶ ✗ 无人读取
链路B（真实推理，内核侧）：checkpointer[thread_id=sessionId].messages ──全量──▶ agentNode ──▶ LLM
                                        ▲
                              BoundedMemorySaver（内存，LRU 100 threads）
```

### 3.2 具体问题

#### C-1 宿主预算链路是死代码（最高优先级）

`loadSessionHistoryByBudget` 设计合理（保留最近 N + 旧→新预算填装），但结果无人消费：

```25:72:apps/backend-ts/src/core/context-budget.ts
export async function loadSessionHistoryByBudget(prisma, sessionId, budget = {}) {
  const maxTokens = budget.maxTokens ?? 8000
  const keepLastN = Math.max(0, budget.keepLastN ?? 6)
  ...
    if (maxTokens > 0 && usedTokens + c > maxTokens) break   // 第一条超预算即丢弃全部更早消息
```

同时该实现本身也有缺陷：
- 硬编码 8000（模型目录已有 `context_window` 却未使用，`core/llm-gateway.ts:26`）；
- `chars/4` 对中文严重低估（1 个汉字≈1 token）；
- `break` 不跳过超大消息；
- 不保证 user/assistant 成对与 tool_call/tool_result 完整性；
- 不计入 system prompt 与输出预算。

#### C-2 `state.messages` 无窗口、无摘要、无裁剪

`messages` 用追加 reducer，`agentNode` 每次全量复制后发给模型；全仓检索 `trim_messages|max_context|token_budget` 无命中：

```222:225:packages/modu-agent/src/graph/state.ts
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => messagesStateReducer(prev, next as any),
    default: () => [],
  }),
```

```1313:1313:packages/modu-agent/src/graph/nodes.ts
    const messages: BaseMessage[] = [...(state.messages ?? [])]
```

现有"防爆"手段只有三条间接路径：工具结果截断（默认 0=关）、Observation 蒸馏（叠加而非替换）、轮次熔断（见 H-4）。长会话**没有任何硬性止损**。

#### C-3 checkpointer 实际不可持久化

`config.yaml:7` 写 `sqlite`，但仓库根 `node_modules/better-sqlite3` 无 `.node` 原生产物、也无 `checkpoints.db`（已实测），动态 import 必失败 → 回退共享 `BoundedMemorySaver`：

```195:220:packages/modu-agent/src/graph/factory.ts
  if (checkpointerType === 'sqlite') {
    if (_sqliteSaverUnavailable) return _getOrCreateSharedMemoryCheckpointer()
    try { const { SqliteSaver } = await import('@langchain/langgraph-checkpoint-sqlite') ... }
    catch (e: any) {
      _sqliteSaverUnavailable = true
      logger.warning('SqliteSaver not available, falling back to MemorySaver: %s', String(e))
      return _getOrCreateSharedMemoryCheckpointer()
    }
```

`BoundedMemorySaver` 还会按 LRU 淘汰线程（默认 100），被淘汰会话的"历史"与"HITL 暂停态"一起消失：

```79:87:packages/modu-agent/src/graph/bounded-memory-saver.ts
  private _evictIfNeeded(): void {
    while (this._threadOrder.size > this._maxThreads) {
      const oldest = this._threadOrder.values().next().value as string | undefined
      this._purgeThread(oldest)
```

#### C-4 编辑重发与模型上下文不一致（数据正确性缺陷）

编辑用户消息时后端硬删后续消息，但 checkpoint 里的 messages 不动：

```85:90:apps/backend-ts/src/core/message-edit.ts
  if (truncateAfter) {
    const deleted = await prisma.chatMessage.deleteMany({
      where: messagesAfterWhere(sessionId, { createdAt: target.createdAt, id: target.id }),
    })
```

用户点"编辑重发"后：UI 与 DB 是新对话，模型却仍能看到被删掉的旧问答——同一会话出现两套"事实"。

#### C-5 长期记忆读写命名空间不对称

写 `[userId,'history']`，读 `[userId,'knowledge']`：

```389:397:packages/modu-agent/src/graph/nodes.ts
        const items = await store.search([userId, 'knowledge'], { query: cleanedText, limit: 5 })
```

```547:560:packages/modu-agent/src/graph/nodes.ts
        if (strategy) { ... await strategy.persist(...) }
        else { await store.put([userId, 'history'], key, payload) }
```

- `InMemoryStoreAdapter.search` 严格按命名空间前缀查（`store-adapter.ts:342-352`）→ **召回恒空**；
- `ChromaStore.search` 只取 `namespace[0]` 当 userId（`store-adapter.ts:174-197`）→ 能召回，但用的是**SHA-256 哈希伪嵌入**（`memory/chroma.ts:24-60`），语义相关性≈随机。

#### C-6 长期记忆是"对话原文块"，且增量写入在 run 边界失效

`memory_update` 把 `role: content` 拼成一段文本（单条上限 8000 字符），无事实抽取、无去重、无时效；错误 run 直接跳过。更严重的是游标被每轮 initial state 重置：

```525:529:packages/modu-agent/src/graph/state.ts
    memory_update_error: '',
    // T3-6：增量写入游标初始值
    memory_persisted_count: 0,
```

而该字段是 last-write-wins（`state.ts:269` 的 `_lw`），每次 `graph.stream(initialState)` 都会把 checkpoint 里的游标覆盖为 0 → 下一轮 `memory_update` 认为"从未持久化"，把**全部历史**再写一遍（T3-6 想解决的平方级增长回归）。

#### C-7 片段预算机制存在但未接线

6 个内置片段全部没有 `budget`，`ctx.budgets` 没有任何调用方；且有预算时也只是字符截断：

```56:62:packages/modu-agent/src/reasoning/context-builder.ts
      const budget = fragment.budget ?? ctx.budgets?.[fragment.id]
      if (typeof budget === 'number' && budget > 0 && content.length > budget) {
        content = content.slice(0, budget)
      }
```

`observationHistory.slice(-5)` 固定条数，不看单条成本；没有全局 token 预算仲裁、没有低优先级驱逐。

#### C-8 蒸馏是"双视图"，大结果场景反而更贵

```1785:1789:packages/modu-agent/src/graph/nodes.ts
    // 设计决策：不修改 messages（避免 messagesStateReducer 追加导致重复），
    // 仅写入 observation_history 供 agentNode 读取作为上下文 SystemMessage。
    // 原始 ToolMessage content 保留在 messages 中，LLM 仍可见；
    // 蒸馏后的精简版本通过 observation_history 在 agentNode 中作为辅助上下文注入。
```

即：原始工具结果 + 摘要同时进窗口。对 `web_search` 50 条结果这种场景，蒸馏完全没有节省 token。

#### C-9 plan 上下文线性膨胀

每步都把**全部已完成步骤**的摘要（500 字/步）注入；10 步≈5k 字符，且每步重复整段历史。收敛时 `plan_summarize` 再按 3k/步、24k 总拼一次大请求，**调用前不做 token 预检**：

```68:85:packages/modu-agent/src/graph/plan-execute/summarize.ts
    const perStep = Number(config.get('plan_execute.summarize_max_chars_per_step', 3000))
    const totalMax = Number(config.get('plan_execute.summarize_max_total_chars', 24000))
    ...
      const take = Math.max(0, Math.min(perStep, budget))
```

#### C-10 前端上下文能力缺口

- Web 请求体无 history/messages（`apps/web/src/api/agent.ts:45-67`），仅"加载最近 30 条用于展示"（`api/message.ts` 默认 `limit=30`）；
- 附件以 Markdown 链接拼进正文（`hooks/useAttachments.ts:119-141`），**不抽取文件内容**，模型无法阅读上传文档；
- 桌面端图片只存本地对象、从不发送；`history` 只带 20 条（`chatStore.ts:86-101`）且内核不读；
- 无任何"上下文占用/剩余"展示（`agent_runs.usage` 恒 0，见 H-8）。

### 3.3 优化方案

| 编号 | 目标 | 具体改进点 | 预期收益 | 优先级 |
|---|---|---|---|---|
| CT-1 | 上下文只有一个真源 | 二选一并加测试：**(推荐)** checkpoint 为唯一真源，删掉 `loadSessionHistoryByBudget` 调用与 `input_data.history` 契约；或反之在 `agentNode` 前把 history 转 messages。禁止两套并存 | 消除"以为有预算其实没有"的错觉；少一次 DB 查询 | P0 |
| CT-2 | 真正的窗口管理 | 新增 `graph/context-window.ts`：预算 = 模型 `context_window` × 0.6 − max_tokens；CJK=1 token/字、ASCII=/4 的统一估算器；按"完整轮次"从旧到新丢弃，保证 user/assistant 与 tool_call/tool_result 配对；超出后对更老轮次做摘要（先规则后 LLM） | 长会话不再 400/静默截断；预算可解释 | P0 |
| CT-3 | 检查点持久可用 | 把 `@langchain/langgraph-checkpoint-sqlite` 声明为 modu-agent 依赖并预编译（CI `npm rebuild`），或改用 Postgres saver 复用现有 DB；启动时**fail-fast**：HITL 开启 + memory checkpointer → 拒绝启动（而非 warning） | 重启/多实例后历史与暂停态可恢复 | P0 |
| CT-4 | 记忆读写闭环 | 统一命名空间（写 `knowledge` 或读 `history`）；`makeInitialState` 不再重置 `memory_persisted_count`（改为缺省不写）；Chroma 接真实 embedding（`bge-m3`/网关 embedding），失败时降级并**显式标记**为低置信召回 | 召回从"恒空/随机"变为可用；记忆写入量回到增量级 | P0 |
| CT-5 | 蒸馏替换原文 | 超过阈值（建议 4000 字符）的 ToolMessage：`content` 替换为 `{summary, ref}`，原文落 Store/文件；保留 `tool_call_id`/`name` 保证可继续引用；保留"完整结果"到 `agent_tool_executions` | 单轮 token 降 30-60%（搜索/抓取类最明显） | P1 |
| CT-6 | 编辑重发同步上下文 | 编辑后调用 `graph.updateState(thread, {messages: 截断到目标})`；或直接删除该 thread 的 checkpoint 并写审计日志 | 修复"模型看到已删除内容"的正确性缺陷 | P1 |
| CT-7 | plan 上下文预算化 | 已完成步骤只注入最近 3 步 + 关键产物引用；`plan_summarize` 前用 CT-2 估算器裁剪；单步输出只进引用，不进全量 | 10 步任务输入 token 降 40%+，减少汇总溢出 | P1 |
| CT-8 | 上下文水位可见 | 每次 LLM 调用把 `prompt_tokens/budget` 写入 run metadata，并新增 AG-UI 事件 `CONTEXT_USAGE`；前端显示占用条，≥80% 触发摘要并在 UI 提示 | 把"突然变笨/超窗"变成可解释、可干预 | P1 |
| CT-9 | 附件真正进上下文 | 上传后服务端解析（pdf/docx/txt/md）生成结构化摘要块（`attachment://id` + 目录 + 前 N 字符）；图片走多模态 content parts；桌面端补齐发送 | 文档分析类场景从"看链接"变为"看内容" | P2 |
| CT-10 | 会话级滚动摘要 | 每 N 轮（或水位触发）生成 `session_summary` 存 `chat_sessions.metadata`，重启后作为 `ctx.session_summary` 片段恢复 | 降低对内存 checkpoint 的强依赖，跨实例可用 | P2 |

> 说明：`packages/docs/modu-agent上下文窗口管理策略分析报告.md` 已指出"messages 无滚动摘要"等问题，本报告在此基础上补充了**三个新发现的正确性断点**（history 死字段、游标重置、编辑重发不一致）与**checkpointer 实测不可用**。

---

## 4. Harness 工程

### 4.1 现状

图拓扑声明化（`graph/spec.ts` + `graph/graph.ts`），默认 ReAct 环为 `agent → (human_review) → tools → tool_processor → agent`：

```840:842:packages/modu-agent/src/graph/graph.ts
  // 工具执行后处理结果，再回到 agent（ReAct 循环）
  edges.push({ from: 'tools', to: 'tool_processor' })
  edges.push({ from: 'tool_processor', to: 'agent' })
```

Plan-Execute 为独立主环 `planner → step_dispatch → agent ⇄ tools → step_finalize → step_dispatch`，收敛走 `plan_summarize → finalize_response`（`graph.ts:726-760`）；预算触顶走 `force_finalize` 再回 `step_finalize`（`graph.ts:786-800`）。工具中间件链为"限流 → 缓存 → 重试 → 指标"（`graph/adapters/tool-adapter.ts`）。

**已具备且质量不错的部分**（不应推倒）：
- 孤儿 `tool_calls` 全局净化（`nodes.ts:689-770`）；
- 装配期 fail-closed 裁剪高风险工具（`factory.ts:762-807`）；
- per-tool 指标埋点（`tool-adapter.ts:340-362`）；
- HITL 澄清/审批超时自动收敛（`runner.ts:1398-1529`）；
- 暂停/错误/中止都落库续写（`routes/agent.ts:695-745`）。

### 4.2 具体问题

#### H-1 图生命周期分裂，三处各自缓存

- 内核 `get_runner()` 按配置 hash 缓存（`runner.ts:770-797`）；
- backend 另建 LRU16，按 `JSON.stringify(configurable)` 缓存（`agent-bridge.ts:59-93`）；
- desktop **每次 plan_execute 发送都 `create_agent`**（`agent-runtime.ts:347-349`）。

后果：
1. plan_execute 每请求重建图（MCP 发现、工具注册、LLM 客户端、store 全重来）；
2. `graphCacheKey` 只纳入 6 个字段，`runtime_context`/`scopes` 等不在 key 内，存在"串配置"隐患；
3. 不同图共享同一 checkpointer，拓扑与状态耦合（历史上多次 resume 崩溃的根因）。

#### H-2 同会话无互斥、无幂等

`agentRunningRuns` 只服务于 `/completions/stop`，允许同 session 并发 run；stop 线性扫描全表：

```609:613:apps/backend-ts/src/routes/agent.ts
          const stopController = new AbortController()
          const stopRunId = genId('arun_')
          agentRunningRuns.set(stopRunId, { sessionId, userId, controller: stopController })
```

```812:817:apps/backend-ts/src/routes/agent.ts
        for (const run of agentRunningRuns.values()) {
          if (run.sessionId === dto.sessionId && run.userId === req.user.id) {
            run.controller.abort()
```

`core/idempotency.ts` 只在 `/chat/*` 使用，Agent 通道无幂等键 → 网络重试会重复执行、重复扣配额、重复写同一 thread。

#### H-3 工具执行控制面默认几乎全关

| 能力 | 状态 | 证据 |
|---|---|---|
| 工具超时 | 无统一策略（MCP 30s / code 10s / 内置工具无） | `mcp-tool-adapter.ts:141-158`、`code-executor.ts:469` |
| 重试 | 只对**抛异常**生效；业务 `{status:'error'}` 不重试 | `adapters/retry.ts:102-156` |
| 结果截断 | `max_result_chars.default = 0`（不截断） | `runtime-config.ts:163-165` |
| 缓存 / 限流 | 默认关闭，且需 per-tool 配置 | `runtime-config.ts:179-198` |
| 并行编排 | 自研 orchestrator 是死代码，仅打日志 | `tool-orchestrator.ts:15-19`、`nodes.ts:909-923` |

#### H-4 循环预算刚性，自适应能力未启用

`complexity_assessment.enabled=false` → 走固定 `max_reasoning_iterations + 3 = 6` 轮；`adaptive_termination` 只写 state 不参与路由：

```1566:1602:packages/modu-agent/src/graph/nodes.ts
        const decision = engineForAssessment.shouldTerminate(tempState)
        update.termination_advice = { action: decision.action, ... }
        // 仅采集指标，不改变路由
```

`recursionLimit` 由公式估算（`spec.ts:448-468`），与实际步数/工具轮次无联动；触顶后只能 `force_finalize` 交一份"半成品"。

#### H-5 默认无 LLM 超时

`llm.request_timeout_ms` 默认 0，主循环靠 `_invokeWithTimeout` 包装但传 0 即不限制；`recursionLimit` 无法终止"单步挂起"（注释也承认）：

```31:34:packages/modu-agent/src/config/runtime-config.ts
    // 主 LLM 调用超时（毫秒）。0 = 不限制。
    // 仅作用于 graph/nodes.ts 中 agentNode / plannerNode 的 invoke 包装
    request_timeout_ms: 0,
```

#### H-6 错误语义被压平

所有流内异常统一成 `RUN_ERROR code=AGENT_ERROR`：

```348:353:apps/backend-ts/src/core/agent-bridge.ts
    ctx.hasError = true
    ctx.errorInfo = { code: 'AGENT_ERROR', message: String(e) }
    const errEventDict = AGUIEncoder.toEventDict(AGUIEventType.RUN_ERROR, {...})
```

工具异常原文还会进入模型上下文（靠字符串嗅探 `'Error:'` 判定失败）：

```1704:1711:packages/modu-agent/src/graph/nodes.ts
          if (typeof content === 'string' && (
              content.includes('did not match expected schema') ||
              content.includes('Please fix your mistakes') ||
              content.includes('Error:')
            )) {
            toolStatus = 'failed'
            parsedContent = { status: 'error', error_code: 'SCHEMA_ERROR', ... }
```

planner 失败静默降级直答（`planner.ts:744-756`），用户只看到"没有任务面板的直接回答"。

#### H-7 可观测性"半开"

- metrics 开（`config.yaml:94-96`），tracing 关且**即使打开也无 exporter**（`tracing.ts:176-214` + `boot.ts:109-120` 需 `otlp_endpoint`），结构化日志关（`config.yaml:100-101`）；
- span 只覆盖 `run_sync`/`resume_sync`（`runner.ts:669`/`:1076`），流式主路径只有 `elapsed` 日志（`runner.ts:569-588`），**无节点级/工具级 span**；
- Agent 通道未接 `RunEventHub`（仅 `routes/chat.ts` 使用），断线不能 `Last-Event-ID` 回放。

#### H-8 成本与审计链断点

- `StreamContext.promptTokens/completionTokens` 无赋值点 → `agent_runs.usage` 恒 0；
- 配额用字符估算（`quota.ts:63-71`，Agent 路由调用时还不传 usage）；
- `agent_tool_executions` 不写 `durationMs/errorMessage`，`toolCallId` 落随机 UUID（`routes/agent.ts:366-383`），无法与 provider `tool_call_id` 对账；
- 三档截断阈值不一致（500 / 800 / 不截断）。

#### H-9 桌面端 harness 是"第二实现"，必然漂移

`agent-runtime.ts` 自述阶段 1 缺持久化、缺 model/systemPrompt 透传；plan_execute 每请求建图；history 死字段；无配额/限流/幂等。两端行为差异只能靠人工对齐。

#### H-10 安全默认偏松

`action_guardrails.enabled=false`、`policy.engine.enabled=false`；`code_executor` 的真实约束只有 timeout(10s)+maxBuffer(64KB)+正则黑名单（macOS rlimit 无效、Windows 完全跳过）；工具能力矩阵派生条目一律 `requires_confirmation:true`，但 guardrail 第二层又显式排除派生条目（`tool-guardrails.ts:220-232`）——语义上正确，但意味着"MCP/Skill 工具默认不触发审批"。

#### H-11 CI 不覆盖内核

`llm-ci.yml` 只跑 backend/web 测试 + eval gate（需 secret），**未跑 modu-agent（1100+ 用例）与 desktop**；prompt/上下文的回归没有任何门禁。

### 4.3 优化方案

| 编号 | 目标 | 具体改进点 | 预期收益 | 优先级 |
|---|---|---|---|---|
| HX-1 | 图只构建一次 | 把 `getCachedGraph` 下沉进 modu-agent（`create_agent` 内部按完整 configurable hash 做 LRU），backend/desktop 只传参数；`graphCacheKey` 覆盖全部 build 期字段；进程启动预热 react + plan 两张图 | 首 token 延迟下降、MCP 重复发现消除、内存可控 | P0 |
| HX-2 | 会话串行化 + 幂等 | `routes/agent.ts` 维护 `runningBySession`：同 session 已有 run → 409（或排队）；`/completions` 接 `core/idempotency.ts`（`Idempotency-Key`）；resume 校验 `agent_runs.status=paused` 且 thread 归属 | 消除并发覆盖与重复计费 | P0 |
| HX-3 | 统一工具执行策略 | 新增 `tool-execution-policy.ts`：默认 30s 超时（per-tool 覆盖）、结果默认截断 8k 并全量落 artifact、`error_code` 白名单重试（如 `TOOL_002/RATE_LIMITED`）、结构化错误（禁止原文进上下文）；用自定义 tool node 包住 ToolNode 以写 span/耗时/DB | 工具失败率与排查成本显著下降；单轮 token 可控 | P0 |
| HX-4 | 预算自适应 | 默认开启 complexity_assessment（规则化 tier 即可，避免额外 LLM 调用）；termination_advice 进入路由（用 `modu_termination_advice_total` 的误判率做准入门槛）；`recursionLimit` 改为"步数×轮数"显式预算，触顶时给用户明确提示 | 减少"6 轮就断"的假失败，也避免长尾烧钱 | P1 |
| HX-5 | 超时与取消闭环 | `llm.request_timeout_ms` 默认 60s；工具统一超时；AbortSignal 全链路（路由→图→provider），并区分 `timeout/cancel` 错误码 | 消除"卡死占资源"，前端可正确区分中止原因 | P1 |
| HX-6 | 错误分类透出 | `RUN_ERROR` 增加 `code ∈ {LLM_TIMEOUT, TOOL_FAILED, PLAN_INVALID, CONTEXT_OVERFLOW, QUOTA}` + `retryable`；前端按 code 给 CTA（重试/缩小范围/提高预算） | 用户可自助恢复；客服/研发定位成本下降 | P1 |
| HX-7 | 可观测性补齐 | 开发默认 local exporter、生产 OTLP；span 覆盖每个 node + 每个工具 + 每次 LLM（`gen_ai.*` 语义）；结构化日志默认开；Agent 通道接 `RunEventHub` 支持断线回放 | 从"看日志猜"到"看 trace 定位"；SSE 断线不再丢回复 | P1 |
| HX-8 | 成本链打通 | 从 LLM 回调/AG-UI 事件采集真实 usage → `StreamContext`；`recordUsage` 用真实 token；`agent_tool_executions` 写 `duration/error/provider tool_call_id`；`/observability/cost` 接真实数据 | 成本可核算、可按会话/模型限流，为优化提供度量 | P1 |
| HX-9 | 桌面端收敛 | 把持久化/配额/限流/鉴权抽成 `packages/agent-host` 或复用 `apps/backend-ts/src/core`，桌面只实现 transport（IPC） | 一套 harness，两端行为天然一致 | P2 |
| HX-10 | 安全默认收紧 | `action_guardrails` 默认开（仅写操作）；Windows 禁用 `code_executor` 或要求容器沙箱；能力矩阵按 effect（read/write/network/exec）分类而非一律 requires_confirmation | 默认安全，可审计 | P1 |
| HX-11 | CI 门禁 | 增加 `npm test -w @pioneering/modu-agent`（按仓库约定限并发）、desktop typecheck；eval gate 用 mock provider + 固定 fixture，保证无 secret 也能跑 | 内核 1100+ 用例真正成为护栏 | P0 |

---

## 5. 跨应用协作关系与契约断点

| 契约 | 生产方 | 消费方 | 现状 |
|---|---|---|---|
| `history` | backend `loadSessionHistoryByBudget` / desktop `buildIpcHistory` | 内核 | ❌ **断点**：内核零消费（`state.ts:33`），两端白算白传 |
| `systemPrompt` | backend 会话表 / desktop 类型 | 内核 `configurable.system_prompt` | ⚠️ 半断：Web 无入口、desktop 白名单丢弃，仅老会话/API 直调可用 |
| `skills` | web `skillSelectionStore` → 请求 | `factory.create_agent` → 图缓存 key | ✅ 已打通（含 resume 回读 DB `metadata.skills`） |
| `usage` | 内核 LLM 调用 | `agent_runs.usage` / 配额 | ❌ **断点**：字段恒 0，配额用字符估算 |
| `tool_call_id` | provider | `agent_tool_executions` | ❌ **断点**：落随机 UUID，无法对账 |
| plan 步骤 | 内核 `step_finalize` | `chat_messages` + `plan_steps` + 前端面板 | ✅ 已打通（含 resume 续写、跨代际 replan） |
| HITL 暂停态 | 内核 checkpointer | `GET /agent/state` → 前端 hitlStore | ⚠️ 逻辑通，但**内存态**导致重启即失效 |
| 流式事件 | `AGUIStreamAdapter` | web `parseAguiStream` / desktop `stream-handler` | ✅ 已打通（TAO 块、STATE_DELTA、RUN_PAUSED） |
| 收益评估 | `feedback/quality-monitor` | `EvolutionOrchestrator` | ⚠️ 默认 rule 模式，LLM judge 需配置；反馈结果未回灌 prompt |

**结论**：真正的"协作断裂"集中在 **上下文传递（history）、成本计量（usage）、工具审计（tool_call_id）、持久化（checkpointer）** 四处；其余链路设计是通的。

---

## 6. 优先级总路线（建议按此顺序落地）

### P0（先修正确性，预计 2 个迭代）

1. **CT-1** 确定唯一上下文真源（删死链或接上），加"history 是否被消费"的契约测试。
2. **CT-2** 引入 `context-window.ts`（token 估算 + 轮次对齐裁剪 + 超限摘要）。
3. **CT-3** 修复 checkpointer（装依赖/换 Postgres），HITL + memory → 启动 fail-fast。
4. **CT-4** 修 `memory_persisted_count` 重置与命名空间；Chroma 换真嵌入。
5. **CT-6** 编辑重发同步 checkpoint。
6. **HX-2** 会话串行化 + 幂等键。
7. **HX-11** CI 补 modu-agent 测试。
8. **PR-1/PR-2** 主 prompt 分层 + 变量注入契约（与 CT 并行，风险低）。

**验收指标**：长会话（>50 轮）无 400；重启后历史与暂停态可恢复；同一 session 并发请求返回 409；`agent_runs.usage > 0`。

### P1（提质与降本，2–3 个迭代）

- **HX-1** 图生命周期统一；**HX-3** 工具执行策略；**HX-8** 成本链；**HX-7** trace/日志/回放；**HX-5/HX-6** 超时与错误码。
- **CT-5** 蒸馏替换；**CT-7** plan 上下文预算；**CT-8** 水位可见。
- **PR-3/PR-4/PR-5/PR-8** 模板解析、中文化、planner 瘦身、缓存友好布局。

**验收指标**：单步工具调用 token 中位数 −30%；10 步任务输入 token −40%；planner JSON 合法率 >98%；首 token P95 −20%；工具失败可归因（trace 可见 tool span）。

### P2（能力扩展）

- **CT-9** 附件/多模态进上下文；**CT-10** 会话级滚动摘要。
- **PR-6** prompt 评测门禁；**PR-7** 用户级 prompt 定制。
- **HX-9** 桌面端 harness 收敛；**HX-10** 安全默认收紧。

---

## 7. 需要补的测试与度量（否则无法验证优化）

| 类别 | 建议用例 |
|---|---|
| 契约测试 | `history` 是否被消费、`usage` 是否非 0、`tool_call_id` 是否等于 provider id、编辑重发后 checkpoint 是否截断 |
| 上下文 | 50/100 轮长会话不超窗；裁剪后 user/assistant 与 tool_call/tool_result 成对；CJK token 估算误差 <15% |
| 记忆 | 写入后同会话/跨会话可召回；命名空间一致；游标在 run 边界不重置（写入条数不随轮次平方增长） |
| Prompt | 模板变量缺失不泄漏；planner JSON 合法率；文档交付格式遵从率；prompt 快照 diff |
| Harness | 同会话并发 → 409；停流后上游真中止；超时错误码正确；重启后 HITL 可恢复 |
| 成本 | 每 run 的 prompt/completion token 与 provider 账单误差 <5% |

---

## 8. 附：验证基线与实测记录

| 项 | 结果 |
|---|---|
| `better-sqlite3` 原生产物 | 仓库根 `node_modules/better-sqlite3` 下无任何 `.node` 文件 → `SqliteSaver` 动态 import 失败 |
| `checkpoints.db` | `packages/modu-agent/checkpoints.db` 不存在（未成功写入过） |
| 默认 system prompt 体积 | 7068 字符（`factory.ts:121-160`） |
| planner system prompt 体积 | 3705 字符（`prompt-templates.ts:37-75`） |
| 当前生效的可观测开关 | `metrics.enabled=true`、`tracing.enabled=false`、`logging.structured=false`（`config.yaml:94-101`） |
| 当前生效的 HITL / 澄清 | 均开启（`config.yaml:35-56`），但依赖内存 checkpointer |
| 当前生效的上下文优化开关 | `observation_distillation=true`、`complexity_assessment=false`、`few_shot=false`、`cot_anchor=false`（`runtime-config.ts:35/427-478`） |

---

### 8.1 现有实现的阶段性结论

这套系统的**架构骨架（声明式图、片段化上下文、Plan-Execute DAG、HITL）是合格的**，问题不在"缺少设计"，而在**"设计了但没接线/默认关/两套并存"**：Prompt 有注册表却按 id 硬编码调用，Context 有预算器却喂给了没人读的字段，Harness 有指标却拿不到真实 usage、有 checkpointer 却落不了盘。因此优化重点应是**把已有能力接线并加门禁**，而不是再引入新框架——P0 的 8 项几乎都是"接线 + 一行默认值"级别的改动，但直接决定长会话、重启恢复、并发安全与成本核算能否成立。

---

## 9. 方法论视角下的纯文字优化方案

### 9.1 提示工程、上下文工程与驾驭工程的核心原则

要讨论优化，先要承认这三件事并不是并列的工具箱，而是同一条执行链上三个不同高度的工程问题。提示工程处理的是"模型被要求做什么、按什么标准判断自己做完了"，它的产物是一份行为契约；上下文工程处理的是"模型在这一步应当看到哪些信息、以什么形态看到"，它的产物是一次受预算约束的信息装配；驾驭工程处理的是"模型之外的那套执行机构如何把一次决策变成可重复、可恢复、可观测的运行"，它的产物是一条能长期演进的生产流水线。业界近两年对三者的共识大体收敛：提示工程从"咒语式措辞"转向"结构化指令与指令层级"，上下文工程从"把资料都塞进去"转向"注意力预算与最小充分集"，驾驭工程从"调用一次模型"转向"循环、工具、状态、护栏、追踪与评估的整体设计"。这三个转向背后是同一个经验事实：Agent 的失败大多不是模型能力不足，而是契约不清、信息不对、过程不可控。

提示工程的核心原则可以概括为五点，且都必须落到可检验的形式上。其一是分层，把角色定位、任务目标、硬约束、输出格式、示例分开书写，而不是揉成一段长文；其二是指令层级，明确系统安全约束高于平台策略、平台策略高于领域规范、领域规范高于会话设定、会话设定高于用户输入的数据，并且在文本上把"用户数据"与"指令"分隔开，否则任何一段检索结果或文件名都可能变成一次越权指令；其三是可验证性，每一条约束都应能被判定是否满足，例如"必须包含温度数值且落在合理区间"优于"请准确回答"；其四是示例的质量优先于数量，少量覆盖边界与反例的示例，比大量同质示例更能稳定行为；其五是工具描述本身就是提示，工具名、用途、参数含义、失败语义与调用时机共同决定了模型会不会选对工具、传对参数。提示工程最适合的场景是单轮或短链路任务、格式敏感的输出、工具选择与拒答边界、以及需要低成本快速试错的早期阶段。它的边界也很清楚：当失败来自"模型根本不知道这件事"或"系统根本没有这个能力"时，继续改提示词只是把问题藏起来。

上下文工程的核心原则是把上下文视为一种会衰减的注意力预算，而不是一个容量无限的仓库。它的第一条原则是最小充分集，即只放"让下一步可解"所必需的信息，信息越多并不越好，长上下文中的关键信息会被稀释，检索与推理精度会随输入变长而下降，这一现象通常被称为上下文腐化。第二条原则是四类操作要配套：写入，把长期重要的状态外化到文件、记忆库或日志，窗口内只留引用；选择，按当前子目标检索或裁剪，而不是预加载全部；压缩，把历史折叠为高保真摘要，保留计划、关键状态、失败原因与待办；隔离，把独立的子问题交给拥有独立上下文的子 Agent，主上下文只接收结论。第三条原则是结构优先于堆砌，同样一组事实，以稳定的段落结构、明确的标题与字段呈现，比以 JSON 字符串塞进系统提示更容易被遵循。第四条原则是状态与消息分离，任务状态、计划进度、工具产物应当有独立的承载通道，而不是全部混进消息数组。第五条原则是窗口水位驱动，压缩与淘汰应由预算占用触发，而不是固定条数或固定轮次。上下文工程适用于长会话、多工具、长文档、跨会话记忆与子任务委派等场景，它决定模型"看见什么"，但不决定模型"看见之后怎么判断"。

驾驭工程的核心原则是把模型之外的一切显式化。第一条原则是状态机与可恢复性，一次运行应当有明确阶段、可持久化的检查点，任何中断都能从断点继续，而不是从头再来。第二条原则是工具调用是一等公民，需要 schema 校验、超时、重试策略、幂等键、结果截断与沙箱边界，缺一项都会在生产环境放大成事故。第三条原则是失败必须被分类，模型超时、工具业务失败、参数不合法、上下文溢出、配额不足是五种完全不同的故障，恢复手段也不同，把她们统一成一句"执行失败"等于放弃恢复能力。第四条原则是预算是四维的，轮次、token、成本、时间必须同时受限，只限轮次会让单步长时间挂起，只限 token 会让任务被迫中途收尾。第五条原则是可观测性闭环，轨迹先于评估，评估先于改动，没有逐节点、逐工具、逐次模型调用的追踪，任何"优化"都只是猜测。第六条原则是人在环是一等能力而不是弹窗，审批、澄清、改参、中断、恢复都应有明确语义与持久化状态。第七条原则是默认安全，无法判断风险时选择更严格的路径。驾驭工程适用于多步任务、有副作用的工具、需要审计与合规的生产场景，它提供能力与边界，上下文工程在其边界内分配预算，提示工程在其之上表达策略。

### 9.2 三者的协同关系与失效诊断

三者的关系可以用一句更朴素的话概括：驾驭工程是底座，上下文工程是供给，提示工程是契约。底座决定"能做哪些动作、动作失败怎么办、状态存在哪里"，供给决定"这一步拿到哪些信息、花多少预算"，契约决定"拿到信息后应当如何判断、如何输出、何时停手"。任何一层缺失都会以另外两层的形式表现出来，这也是实践中大量误判的来源。只做提示工程，最典型的症状是提示词不断膨胀，规则越加越多、彼此重复甚至冲突，本产品那份七千多字符、编号从十五条跳到二十一条的系统提示就是活证据；只做上下文工程，常见症状是上下文很干净、检索很精准，但模型不知道优先级与交付格式，回答正确却不可用；只做驾驭工程，常见症状是流程完整、日志齐全，但回答空洞、工具选错，因为契约没有写清楚。

因此诊断应当按症状归因，而不是按习惯归因。当问题表现为格式不符、该拒答没拒、该调工具没调、参数传错，优先归到提示工程；当问题表现为答非所问、遗忘前文、重复劳动、越跑越慢、长任务后期质量骤降，优先归到上下文工程；当问题表现为卡死、同一工具反复失败、暂停后无法恢复、并发互相覆盖、出了问题查不到原因、成本算不清，优先归到驾驭工程。三者还有一个共同的出口，就是评估：提示工程的改动需要评测来判断是否真的更好，上下文工程的裁剪策略需要评测来验证是否丢了关键信息，驾驭工程的预算与重试需要评测来校准阈值。没有评估，三者都会退化为经验主义。

### 9.3 本产品在提示设计、上下文管理与人类反馈评估上的主要问题

在提示设计上，当前最突出的不是"写得不好"，而是"没有管理"。主系统提示是一块七千余字符、二十八条规则的单体文本，语言策略、防幻觉、工具预算、搜索效率、文档交付格式混在一起，编号出现断裂与补丁式追加，说明它是长期迭加而非设计出来的；其中"通常三到五轮"的表述与本部署实际六轮的硬上限并不一致，规则与代码里的文档守卫、步数上限重复表达，任何一边调整都会造成漂移。四层组装机制存在，但只是把四段字符串用双换行拼起来，没有预算、没有去重、没有"后层不得覆盖安全约束"的校验，运行时上下文也只来自宿主参数与少量 Markdown 文档，缺少用户画像、偏好与会话摘要这类结构化来源。模板注册表具备标识、版本、变量与任务类型四个字段，但版本从不参与选择，按任务类型列出模板的能力没有任何消费方，场景包里注册的写作风格模板因此永远不会生效。变量注入是纯正则替换，缺失变量会把占位符原样留给模型，没有长度上限、没有转义、也没有把用户来源内容包成"数据区"，这既会泄漏模板细节，也给间接提示注入留了口子。规划器的提示词同时要求严格 JSON 又保留了结构化输出通道，对标题与描述的字数、行数、禁止嵌套反复强调，是典型的"补丁叠加"；而给规划器的工具目录每条只有两百字符且不含参数信息，导致计划只能点名工具、无法约束参数。更现实的问题是，产品没有任何提示词入口，会话表里的系统提示字段前端从不写入，桌面端甚至在主进程白名单里把它静默丢弃，所谓"角色设定"能力实际上不存在。

在上下文管理上，问题集中体现为"两套链路、一个真源缺失"。宿主侧有一套按 token 预算挑选历史的实现，保留了最近若干条并在预算内向前扩展，设计本身是合理的，但它的结果被放进图输入的一个字段里，而内核早在重构时就删除了对该字段的读取，于是预算逻辑成了死代码，多轮上下文实际上完全依赖检查点中的消息数组。检查点配置写的是本地数据库，但原生绑定并未构建，动态导入必然失败并静默回退到进程内内存单例，还会按最近使用淘汰线程，这意味着"多轮对话"与"人工审批暂停"两项能力都被绑定在进程寿命上，重启即失忆，多实例即分裂。真正进入模型的消息数组没有任何窗口管理，既没有按模型上下文窗口计算的预算，也没有滚动摘要，长会话只能靠工具结果截断、观察蒸馏与轮次熔断三条间接路径兜底，而工具结果截断默认是关闭的。蒸馏机制的设计是把摘要写进独立的历史通道，原始工具结果仍然留在消息里，于是大结果场景下窗口里同时存在原文与摘要，token 不减反增。片段级预算的接口存在，但六个内置片段都没有配置预算，运行时预算通道也没有任何调用方，即便配置了也只是按字符尾部截断，可能切断结构化内容。长期记忆的读写命名空间并不一致，写入落在历史命名空间、召回却查知识命名空间，内存实现严格按命名空间过滤因而召回恒为空，向量实现忽略命名空间但使用的是哈希伪嵌入，语义相关性接近随机；同时增量写入的游标被每轮初始状态重置为零，使"只写新增"的优化在每个新回合失效，历史被反复整段写入。编辑重发时数据库里的后续消息被硬删除，检查点里的消息却没有同步截断，于是界面是新对话、模型仍看得见被删掉的旧问答。计划执行场景里，每一步都会注入全部已完成步骤的摘要，十步任务的上下文线性增长，收敛阶段的汇总请求也没有做调用前的预算预检。前端侧同样缺一块：网页端请求根本不带历史，只加载最近三十条用于展示；附件以 Markdown 链接拼进正文，文件内容从未被解析进上下文；桌面端的图片从未发送；上下文占用比例也没有任何可见入口。

在人类反馈与评估上，问题不是"没有人工环节"，而是"人工环节没有被当作数据"。审批与澄清两条链路已经打通，能够暂停、能够恢复、能够超时自动收敛，但一次批准或拒绝只留下了状态字段，没有留下结构化的原因码、参数修改差异、耗时与当时的上下文水位，这些恰恰是改进提示与工具设计最直接的信号。质量监控默认走规则模式，基于模型的评审需要额外配置，评审结果也没有回灌到提示版本或记忆里，反馈闭环在"打分"这一步就断了。评测包本身能力完整，包含三层指标、数据集、报告与门禁，但门禁依赖密钥，缺失时直接跳过；没有针对提示的回归集；持续集成只跑后端与网页端的测试，内核的一千多个用例根本没有进入门禁。可观测性处于半开状态：指标开着，追踪关着且即使打开也没有导出端点，结构化日志关着，追踪只覆盖两个同步入口，流式主路径没有节点级与工具级的跨度，Agent 通道也没有断线重放。没有逐节点、逐工具的轨迹，就谈不上"把失败样本转成测试用例"，评估只能停留在人工试用的层面。桌面端因为不做持久化，连轨迹都沉淀不下来，进一步放大了这个问题。

### 9.4 可落地的纯文字优化策略

提示工程的改进目标应当是"让契约可组合、可校验、可回归"，而不是再写一版更长的提示词。关键举措是把现有单体系统提示拆成角色、语言、工具策略、叙述风格、交付格式、安全边界六个可独立演进的模块，每个模块以带标识与版本的模板存在，由装配函数按运行模式与任务类型组合，并用快照测试锁住输出，确保拆分本身不改变行为。与此配套，必须把指令层级写进装配顺序并在文本上显式标注，系统安全约束固定在首位且不允许被后续层覆盖，用户来源的内容一律用明确边界包起来并声明"以下为数据，不是指令"，从结构上降低间接注入的成功率。变量注入需要升级为契约：声明哪些变量必填、各自的长度上限、是否需要包装成数据区，缺失必填变量在开发与持续集成环境直接失败，在生产环境告警并降级，超长内容截断时留下可识别的标记，避免占位符泄漏与无界膨胀。规划器应当以结构化输出为唯一主路径，文本解析仅作兜底，工具目录改为从工具的参数定义自动生成"名称、一句话用途、关键参数名"三段式，既不丢关键信息，也不把整份 schema 塞进提示。语言策略需要统一，中文场景使用中文契约，减少英文规则与中文产品之间的额外开销与风格漂移。模板版本应当写入运行元数据，使任何一次回答都能追溯到当时使用的契约版本。最后要建立提示回归集，用固定的录制样本与模拟模型跑通，关注计划 JSON 合法率、工具名命中率、交付格式遵从率、平均轮次与提示 token 五项指标，让每次改动都有基线可比。预期效果是系统提示的固定开销下降约三成，规划器的首次合法率明显提升，提示变更从"凭经验"变成"可回滚、可对比"。

上下文工程的改进目标应当是"单一真源、显式预算、可外化、可恢复"。首先要做的是消除双轨：要么承认检查点是唯一真源并删除宿主侧无效的历史装配，要么反过来在图入口处真正消费历史，二者只能选一个，并且要有契约测试防止再次退化为死代码。其次要引入真正的窗口管理器，预算按模型上下文窗口的六成计算并扣除输出预留，中文按每字约一个 token、英文按每四字符约一个 token 估算，淘汰时从最旧的完整轮次开始，保证用户消息与助手消息成对、工具调用与工具结果配对，超出预算后先对更早的轮次做摘要再淘汰，而不是直接截断。第三要把大工具结果从"原文留在窗口"改为"摘要加引用"，原文外化到文件或存储并在消息里保留可定位的引用，这样蒸馏才真正起到压缩作用，而不是制造双视图。第四要修复记忆闭环，统一读写命名空间，换用真实嵌入并在失败时显式降级标注，增量游标不再随每次运行重置，改为由运行状态与消息长度共同推导；在此基础上每若干轮生成一次会话摘要，使跨实例、跨重启的连续性不再完全依赖检查点。第五要把计划上下文改为预算化，只注入最近若干步的摘要与关键产物引用，汇总前先做预算预检。第六要让水位可见，把每次模型调用的输入 token 与预算占用写入运行元数据并通过事件推给前端，占用超过八成时触发摘要并在界面上提示。第七要补齐前端的信息入口，附件在服务端解析后以结构化摘要块进入上下文，图片走多模态消息，而不是继续把链接拼在正文里。预期效果是长会话不再因为超窗而失败或质量骤降，单步工具调用的 token 中位数下降三到六成，长期记忆从"恒空或随机"变为可用，上下文问题从"事后猜"变为"事前可见"。

驾驭工程的改进目标应当是"可恢复、可串行、可度量、可定位"。首先统一图的构建与缓存，把按配置指纹缓存图的逻辑下沉到内核，宿主与桌面端只负责传参，计划执行图与常规图在进程启动时各预热一次，避免每个请求重复做工具注册与远程工具发现。其次建立会话级串行与请求幂等，同一会话已有运行中的任务时拒绝或排队，写操作带幂等键，恢复请求校验运行状态与线程归属，杜绝两个运行同时写同一个线程。第三收敛工具执行策略，统一默认超时并允许按工具覆盖，业务级失败按错误码白名单决定是否重试，结果默认截断并把完整结果外化，工具异常统一转换为结构化错误而不是把原始异常文本送进模型，同时在执行层写入耗时与状态，形成可对账的记录。第四把预算做成四维并允许自适应，轮次、token、成本、时间同时约束，复杂度评估可以用规则化的档位实现而不必额外调用模型，终止建议在误判率达标后真正参与路由，而不是只写状态。第五补齐超时与取消的全链路，模型调用默认有超时，取消信号从路由一路传到模型提供方，并区分超时与用户取消。第六把错误分类透出到前端，至少区分模型超时、工具失败、计划不合法、上下文溢出与配额不足，并标注是否可重试，让用户能自助恢复。第七建立可观测闭环，节点、工具、模型调用三个层级都要有跨度，结构化日志默认开启，Agent 通道接入断线重放，真实 token 用量落库并与账单对账，工具记录使用提供方返回的调用标识以便与消息对齐。第八把人在环从"弹窗"升级为"决策点"，审批、澄清、改参、中断、恢复都记录语义与状态，暂停态必须持久化，否则不应向用户承诺可恢复。第九收紧安全默认值，写操作默认需要审批，代码执行在没有可靠沙箱的平台上默认不可用。预期效果是重启后历史与暂停任务可恢复，并发请求不再互相覆盖，成本可以按会话与模型核算，故障可以在轨迹上定位到具体节点与工具。

人类反馈与评估环节的改进目标应当是"让每一次人工干预都变成可复用的数据，让每一次改动都经过同一套门禁"。关键举措是把审批与澄清的每一次交互结构化，记录决策类型、原因码、涉及的工具与参数差异、等待时长以及当时的上下文水位，独立成表并按会话、工具、任务类型聚合。在此之上建立两层评估：离线层把线上失败轨迹转成回归用例，覆盖计划合法性、工具选择、参数正确性、交付格式与成本；线上层用窄口径的模型评审做抽样打分，问题要问得具体，例如"在给出结论前是否取到了所需数据"，而不是笼统地打一个质量分。评估结果要回灌两个地方，一是提示版本库，标记哪一版契约在哪类用例上更优；二是驾驭策略，用于校准预算、超时与重试阈值。发布门禁应当覆盖提示与驾驭两类变更，用固定样本与模拟模型跑回归，关键指标回退超过阈值即阻断，避免"改一句提示词上线后整体变差"这类不可见退化。还需要建立固定的失败复盘机制，把高频失败按提示、上下文、驾驭三类归因，明确"这一类问题不该靠改提示词解决"，从流程上防止所有问题都堆到提示层。预期效果是失败模式可以被计数、被排序、被回归覆盖，优化从个人经验变成组织能力。

### 9.5 实施次序、风险边界与预期效果

实施次序应当遵循"先可信、再省、再好"的顺序，而不是按三个方法论的重要性排序。第一步做驾驭工程里的持久化、串行、幂等与可观测，因为这三件事决定后面所有结论是否可信：没有持久化就无法验证长会话，没有幂等与串行就无法复现并发问题，没有轨迹就无法判断一次改动是变好还是变坏。第二步做上下文工程的单一真源与窗口管理，因为它决定模型输入是否正确，也决定成本曲线；在这一步里同时修复记忆命名空间与游标问题，否则压缩带来的收益会被重复写入抵消。第三步做提示工程的分层与契约化，此时已经有了稳定的输入与可测的基线，提示改动的收益才能被准确归因。第四步把三者接入同一个评估闭环，形成"轨迹、用例、门禁、灰度"的循环。这个顺序也解释了为什么本报告把上下文与驾驭的修复放在提示优化之前：当前提示层的很多"坏味道"，本质上是在替上下文缺失与驾驭能力不足打补丁。

风险边界同样需要事先说清楚。不能用提示词去补驾驭工程的洞，例如用"不要重复调用工具"这样的规则去替代幂等与去重，短期看似有效，长期一定漂移；不能把摘要当作无损压缩，关键决策、失败原因与待办必须显式保留；不能用自动评估完全替代人工抽检，尤其在涉及事实正确性与业务口径的场景；不能在内存态的检查点上向用户承诺暂停可恢复；不要一次性重写全部提示词，应当先拆分、再逐块替换，并用快照与灰度控制影响面；中文的 token 估算、不同模型供应商的工具调用格式差异、以及长上下文精度的衰减，都需要在预算与提示设计里留出余量；评估集必须私有化，公共基准只能说明模型的一般能力，不能代表本产品的真实任务分布。

把三条主线合起来看，它们服务的是同一个判据：让下一次请求比这一次更可能成功，并且更便宜。提示工程让意图变得可执行，上下文工程让信息刚好够用，驾驭工程让过程可控可恢复，而人类反馈与评估让这三件事的改进能够被累积而不是被遗忘。对本产品而言，这意味着不需要再引入一套新框架，而是把已经存在的注册表、片段、预算、检查点、指标与评测包逐一接线，给默认值加上安全边界，给关键路径加上门禁。当"契约、预算、闭环"三件事同时成立时，Agent 的表现才会从"演示可用"走向"日常可依赖"。
