# Agent HITL（Human-in-the-Loop）机制业务流程分析报告

> **分析范围**：`packages/modu-agent`、`packages/agent-protocol`、`packages/evals`、`apps/backend-ts`、`apps/web`、`apps/desktop`
> **分析日期**：2026-10-09
> **关联文档**：`docs/code-wiki/12-需求澄清HITL机制实施方案.md`、`docs/code-wiki/13-HITL可用性修复说明.md`

---

## 目录

- [0. 全景架构：一条中断链，四种载荷，两个宿主](#0-全景架构一条中断链四种载荷两个宿主)
- [一、HITL 触发条件与判定规则](#一hitl-触发条件与判定规则)
- [二、人工介入的交互方式与入口](#二人工介入的交互方式与入口)
- [三、Agent 与人工之间的数据流转与消息传递](#三agent-与人工之间的数据流转与消息传递)
- [四、状态管理与持久化](#四状态管理与持久化)
- [五、审批/确认流程的设计与执行](#五审批确认流程的设计与执行)
- [六、异常处理与恢复机制](#六异常处理与恢复机制)
- [七、四阶段实现位置与做法（核查结论）](#七四阶段实现位置与做法核查结论)
- [八、六个澄清维度覆盖核查](#八六个澄清维度覆盖核查)
- [九、模块协作关系与职责边界](#九模块协作关系与职责边界)
- [十、关键缺口与风险清单](#十关键缺口与风险清单)
- [附录 A：关键文件与符号索引](#附录-a关键文件与符号索引)
- [附录 B：配置项速查](#附录-b配置项速查)

---

## 0. 全景架构：一条中断链，四种载荷，两个宿主

```
用户输入
  ↓
┌─ 内核层 packages/modu-agent ──────────────────────────────────────┐
│ perception → [clarify]  ← 事前澄清   (interrupt kind=clarifying/choice)
│    ↓                                                              │
│ memory_query → agent → [human_review]  ← 事中审批 (kind=tool_confirm)
│                          ↓ 拒绝/超时 → finalize_response           │
│                          ↓ 批准     → tools → agent（ReAct 环）     │
│ [plan_confirm] ← 事后确认门（协议已留，无生产者）                    │
└──────────────────────────────────────────────────────────────────┘
  ↓ AG-UI 事件 USER_QUESTION_REQUEST + RUN_PAUSED（checkpointer 挂起）
┌─ 协议层 orchestration/communication/agui-adapter.ts ──────────────┐
│ 事件编码 + kind 归一 + interrupt 载荷提取                          │
└──────────────────────────────────────────────────────────────────┘
  ↓ SSE / Electron IPC
┌─ 编排层 apps/backend-ts（云端） │ apps/desktop/src/main（本地）──────┐
│ /agent/resume /state/:threadId /abort │ IPC agent:resume/abort/state │
│ 落库边界：paused 不落库；agent_run.status=paused；TTL sweep 60s      │
└──────────────────────────────────────────────────────────────────┘
  ↓
┌─ UI 层 apps/web │ apps/desktop renderer ─────────────────────────┐
│ hitlStore 队列 + 输入框上方内联卡（审批/澄清/选项）                 │
└──────────────────────────────────────────────────────────────────┘
```

### 中断类型总览

| kind | 语义 | 生产者 | UI 分支 | 状态 |
|---|---|---|---|---|
| `tool_confirm` | 敏感工具执行前审批 | `makeHumanReviewNode` | 工具列表 + 改参 + 批准/拒绝 | ✅ 上线 |
| `clarifying` | 需求不明确时自由文本追问 | `makeClarifyNode` | 问题 + textarea + 跳过 | ✅ 上线 |
| `choice` | 需求存在方向分叉时选项式消歧 | `makeClarifyNode` | 问题 + 编号选项 | ✅ 上线 |
| `plan_confirm` | 方案/文档生成后的"是否基于产物继续"确认门 | **无** | 产物列表 + 确认按钮 | ⚠️ 协议预留 |

```43:47:packages/modu-agent/src/orchestration/communication/agui-adapter.ts
  // ===== HITL（Human-in-the-Loop）事件（阶段零 D3 收敛的最小集合）=====
  USER_QUESTION_REQUEST: 'USER_QUESTION_REQUEST',
  RUN_PAUSED: 'RUN_PAUSED',
  HITL_ABORTED: 'HITL_ABORTED',
```

---

## 一、HITL 触发条件与判定规则

### 1.1 事前触发：需求明确度检测（clarify 通道）

判定分**两级**，原因是「图路由是同步的、节点是异步的」：

| 级别 | 函数 | 位置 | 作用 |
|---|---|---|---|
| 粗筛（同步） | `assessClarificationCoarse` | `perception/clarity-detector.ts:163-189` | 决定 `perception` 路由是否分叉到 `clarify` 节点 |
| 精判（异步） | `detectClarification` | `perception/clarity-detector.ts:314-400` | 节点内决定是否真 `interrupt()` |

#### 粗筛规则信号（任一命中即需要澄清）

```124:153:packages/modu-agent/src/perception/clarity-detector.ts
  if (!conf['enabled']) {
    return { needed: false, reason: 'disabled', question, options: [] }
  }

  const round = Number(state.clarification_round ?? 0)
  const maxRounds = Number(conf['max_clarify_rounds'] ?? 2)
  if (round >= maxRounds) {
    return { needed: false, reason: 'round_limit_reached', question, options: [] }
  }

  const input = extractUserInputText(state)
  if (!input) {
    return { needed: false, reason: 'empty_input', question, options: [] }
  }

  const minChars = Number(conf['min_input_chars'] ?? 10)
  if (input.length < minChars) {
    return { needed: true, reason: 'input_too_short', question, options }
  }

  const patterns = Array.isArray(conf['insufficient_patterns'])
    ? (conf['insufficient_patterns'] as string[])
    : []
  const lowered = input.toLowerCase()
  const hit = patterns.find((p) => p && lowered.includes(String(p).toLowerCase()))
  if (hit) {
    return { needed: true, reason: `insufficient_pattern:${hit}`, question, options }
  }

  return { needed: false, reason: 'sufficient', question, options: [] }
```

四级判定顺序：

1. 开关关闭（`enabled=false`）→ 不澄清；
2. 已达 `max_clarify_rounds` → 不再追问（**防无限追问死循环**）；
3. 输入 `< min_input_chars`（代码默认 10；`config/init-defaults.ts:124` 落盘为 3）→ 表达不充分的强信号；
4. 命中 `insufficient_patterns`（"帮我弄一下"/"帮我搞一下"/"搞个东西"/"弄个东西"/"随便弄"/"你看着办"/"you know what i mean"）。

#### LLM 复判（默认关闭，零 LLM 成本）

规则未命中（`sufficient`）且输入长度 ≤ `llm_judge.max_input_chars`（60）时调用 LLM，输出 `clarity_score` + `missing_slots`，`score < clarity_threshold`（0.4）才澄清。**判定失败保守放行**（宁漏勿扰）：

```362:366:packages/modu-agent/src/perception/clarity-detector.ts
  const judged = await llmJudgeClarity(input, llm)
  if (judged === null) {
    // 复判失败：保守放行（不因判定异常打扰用户）
    return notNeeded('llm_judge_failed', rule)
  }
```

LLM 同时负责生成**语境化的候选方向**（`CLARITY_JUDGE_PROMPT`，`clarity-detector.ts:195-204`）：仅当目标产出物存在明显分叉（网页/文档/数据分析/Agent 等）时给 2-4 个选项，否则输出空数组 `[]`（走纯自由文本 `clarifying`）。

#### 高影响门控（默认关闭，防打扰）

`high_impact_only=true` 时仅对命中 `high_impact_keywords` 的请求澄清。默认关键词集为写操作/外发/生产类：

```63:79:packages/modu-agent/src/perception/clarity-detector.ts
export const DEFAULT_HIGH_IMPACT_KEYWORDS: readonly string[] = [
  '删除',
  '发布',
  '部署',
  '上线',
  '生产',
  '批量',
  '支付',
  '转账',
  '覆盖',
  '清空',
  'delete',
  'drop',
  'deploy',
  'publish',
  'rollback',
]
```

#### 路由接线

```519:527:packages/modu-agent/src/graph/graph.ts
  const perceptionRouter = profile.clarifyEnabled
    ? (state: ModuAgentState): string => {
        const base = routeAfterPerception(state)
        if (base !== 'memory_query') return base
        // 阶段3：粗筛（规则命中，或 llm_judge 启用且输入在候选区间）→ 进 clarify 节点精判。
        // 规则未命中且未启用 LLM 复判时与迁移前逐条等价（零回归）。
        return assessClarificationCoarse(state).needed ? 'clarify' : 'memory_query'
      }
    : routeAfterPerception
```

关键设计：**路由/节点判定条件必须保持一致**，否则会出现"路由不进节点、复判永远不执行"的静默失效。

### 1.2 事中触发：工具审批判定（human_review 通道）

判定已**收敛为单一纯函数入口** `decideToolApprovals`，三级优先：

| 优先级 | 条件 | source |
|---|---|---|
| 1 | `ACTION_GUARDRAILS` 规则命中 | `guardrail` |
| 2 | 工具名 ∈ `tools.human_in_loop.sensitive_tools` | `sensitive_list` |
| 3 | 工具实例 `requiresApprovalFor(args, ctx)` | `tool_policy` |
| — | 均未命中 | `none` |

```388:437:packages/modu-agent/src/tools/tool-guardrails.ts
export function decideToolApprovals(
  toolCalls: Array<Record<string, any>>,
  opts: DecideToolApprovalsOptions,
): ToolApprovalDecision[] {
  const guardrailHits = opts.guardrailsEnabled
    ? checkGuardrailsForToolCalls(toolCalls, opts.guardrailDryRun)
    : []
  const hitByCallId = new Map<string, string | undefined>()
  for (const h of guardrailHits) {
    hitByCallId.set(String(h.toolCall['id'] ?? ''), h.guardrailResult.rule?.rule_id)
  }

  const decisions: ToolApprovalDecision[] = []
  for (const tc of toolCalls) {
    const id = String(tc['id'] ?? '')
    const name = String(tc['name'] ?? '')

    if (hitByCallId.has(id)) {
      decisions.push({ toolCallId: id, toolName: name, requiresApproval: true, source: 'guardrail', ruleId: hitByCallId.get(id) })
      continue
    }

    if (opts.sensitiveTools.includes(name)) {
      decisions.push({ toolCallId: id, toolName: name, requiresApproval: true, source: 'sensitive_list' })
      continue
    }
    ...
```

#### 预置 guardrail 规则（5 条）

`ACTION_GUARDRAILS`（`tools/tool-guardrails.ts:61-108`）：

| rule_id | tool_name | 匹配条件 | 说明 |
|---|---|---|---|
| `guard_file_ops_write` | `file_ops` | `op =write` | 文件写入需审批 |
| `guard_file_ops_delete` | `file_ops` | `op =delete` | 文件删除需审批（不可逆） |
| `guard_sql_query_write` | `sql_query` | `query` 含 INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE/REPLACE | SQL 写操作需审批 |
| `guard_http_request_sensitive` | `http_request` | `method =POST|=PUT|=PATCH|=DELETE` | HTTP 写请求需审批 |
| `guard_code_executor_network` | `code_executor` | `code` 含 fetch/requests/urllib/axios/http/socket/net./node:net | 带网络访问的代码执行需审批 |

匹配语义（`_matchParamCondition`，`:150-161`）：候选以 `=` 前缀 → 精确匹配（枚举型参数，避免子串误判）；否则子串匹配（自由文本，如 SQL/代码）；多候选以 `|` 分隔，任一命中即可。

#### 动态敏感性判定（fail-closed）

工具自身实现 `requiresApprovalFor(args, context)`，**异常时一律走审批**，绝不静默旁路 HITL：

```319:347:packages/modu-agent/src/tools/tool-guardrails.ts
export function toolRequiresApproval(
  toolName: string,
  registry: any,
  sensitiveTools: string[],
  args?: Record<string, any>,
  context?: Record<string, any>,
): boolean {
  if (sensitiveTools.includes(toolName)) {
    return true
  }
  if (registry !== null && registry !== undefined) {
    const moduTool = registry.getTool(toolName)
    if (moduTool) {
      try {
        return Boolean(moduTool.requiresApprovalFor(args ?? {}, context ?? {}))
      } catch (e) {
        // P1-1：fail-closed —— 动态敏感性判定异常时一律走人工审批，
        // 绝不能因工具内部错误静默旁路 HITL（warning 保留可观测性）。
        console.warn(
          '[tool-guardrails] requiresApprovalFor for tool %s threw; failing closed (approval required): %s',
          toolName,
          String(e instanceof Error ? e.message : e),
        )
        return true
      }
    }
  }
  return false
}
```

工具基类契约（`core/interfaces/action.ts`）：

- `requiresApproval()`（`:39-41`）静态判定，默认 `false`
- `requiresApprovalFor(params, context)`（`:56-61`）参数级动态判定，默认回退静态
- `onApprovalRejected(params)`（`:67-73`）拒绝时的降级结果，默认返回 `TOOL_APPROVAL_REJECTED` 标准错误结构

已覆写审批契约的工具：

| 工具 | 审批策略 |
|---|---|
| `code_executor` | `requiresApproval=true`（弱沙箱 + 强审批） |
| `sql_query` | 参数级：写语句需审批 |
| `file_ops` | 参数级：仅 write/delete + `requiresApproval=true` |
| `http_request` | 参数级：内网 IP / 非白名单域名需审批 |
| `doc_writer` | 参数级：仅写入类需审批 |

#### 策略引擎旁路（默认关闭，零行为漂移）

`policy.engine.enabled=true` 时，`ToolApprovalPolicyRule` 委派同一内核（**零重写**），异常或 `details` 长度不符自动降级直调：

```2099:2104:packages/modu-agent/src/graph/nodes.ts
    // P1（T-10）：策略引擎优先（gated by policy.engine.enabled）。
    // 判定内核仍是 decideToolApprovals（由 ToolApprovalPolicyRule 委派），
    // 故两条路径逐工具逐字段一致（等价矩阵见 tests/graph/policy-hitl-equivalence.test.ts）。
    const approvalDecisions: ToolApprovalDecision[] = policyEngineEnabled
      ? await _decideToolApprovalsViaPolicy(toolCalls, approvalOpts)
      : decideToolApprovals(toolCalls, approvalOpts)
```

策略契约见 `core/interfaces/policy.ts`：`PolicyEffect = 'allow' | 'deny' | 'require_approval'`（`:77`），`ToolApprovalDetail` 与 `ToolApprovalDecision` **结构兼容**（`:86-93`），使引擎结果可被 `human_review` 直接消费，无需二次映射。设计边界明确为「**只登记规则、不迁执行**」（D-18 决策，避免双实现）。

### 1.3 关闭态（零回归保证）

| 开关 | 默认值 | 关闭时行为 |
|---|---|---|
| `tools.human_in_loop.enabled` | `false` | `human_review` 节点不存在，`agent → tools` 直连 |
| `perception.clarification.enabled` | `false` | `clarify` 节点不存在，感知路由不分叉 |
| `react_optimization.action_guardrails.enabled` | `false` | guardrail 判定短路为空，仅走 sensitive_list + tool_policy |
| `policy.engine.enabled` | `false` | 走 `decideToolApprovals` 直调，不经过策略引擎 |
| `perception.clarification.llm_judge.enabled` | `false` | 不产生任何 LLM 调用，粗筛 === 规则判定 |

配置默认值：`config/runtime-config.ts:143-148`（human_in_loop）、`:268-307`（clarification）；能力登记：`config/capability-registry.ts:62-89`。

---

## 二、人工介入的交互方式与入口

### 2.1 主入口：输入框上方内联卡（两端一致的设计）

#### desktop 端

`renderer/src/components/chat/input/InputArea.tsx`：

| 分支 | 渲染内容 | 行号 |
|---|---|---|
| `tool_confirm` | `HitlToolConfirmPanel`：工具列表（编号 + 名称 + 参数摘要，点击展开完整 JSON）、逐工具"修改参数" textarea、`拒绝` / `批准并继续`、右上 × 放弃整个 run、`resolving` 防重复提交 | `295-471` |
| `plan_confirm` | 产物文件列表 + "是的，执行此方案" | `1125-1181` |
| `clarifying` / `choice` | 澄清问题 + 编号选项列表（点击即作答）+ 跳过按钮 + textarea | `1182-1235` |

装配层 `components/chat/ChatArea.tsx:145-180` 把交互映射为 resume 载荷：

| UI 动作 | resume 载荷 |
|---|---|
| `onHitlApprove(modifiedArgs)` | `{approved: true, modifiedArgs}` |
| `onHitlReject` | `{approved: false, feedback: '用户拒绝了该工具调用'}` |
| `onHitlAnswer(text)` | `{approved: true, answer: text, feedback: text}` |
| `onHitlSelectOption(id)` | `{approved: true, answerId: id}` |
| `onHitlDismiss` / 输入框 × | `hitlStore.dismiss()` → `abortHitl` |
| `onHitlConfirmPlan` | `{approved: true, answer: <确认文案>}` |

HITL 态下同时隐藏 ModelSelect、`/` 命令、技能入口，并禁用草稿持久化（`InputArea.tsx:509-545, 1029, 1249-1350`）。

#### web 端

共享组件 `packages/agent-protocol/src/components/HitlInlineCard.tsx`：

- 外壳（图标/标题/`index/total`/X「取消并中止本次执行」）：`:89-116`
- `choice` 分支（`role="listbox"` 候选方向）：`:118-142`
- `clarifying` 分支（textarea + 跳过 + 提交回答）：`:144-172`
- `tool_confirm` 分支：委托 `HitlToolConfirmBody.tsx`（工具列表折叠展开、逐工具 JSON 改参、非法 JSON 禁用批准、两段式拒绝）

挂载点：`apps/web/src/modes/pro/components/AnalysisInput.tsx:116-148`、`apps/web/src/modes/task/components/TaskInput.tsx:101-133`；样式 `.chat-input-hitl`（`apps/web/src/styles/conversation.css:414-417`）。

### 2.2 交互语义矩阵（不可越界的约束）

| kind | 可自由文本 | 可选项 | 可跳过 | 可改参 | 输入框 |
|---|---|---|---|---|---|
| `tool_confirm` | ✗（锁定编辑区） | ✗ | ✗（必须显式批准/拒绝） | ✓ | 隐藏模型选择/命令/技能 |
| `clarifying` | ✓ | ✗ | ✓（空回答继续） | ✗ | 提交内容作为答案回传 |
| `choice` | ✓ | ✓（点选即作答） | ✓ | ✗ | 同上 |

desktop 侧 `hitlStore.skip()` 对 `tool_confirm` 直接返回 `false`；web 侧同约束内建于 `HitlToolConfirmBody`（不渲染跳过入口）。

### 2.3 其它入口

| 入口 | 位置 | 说明 |
|---|---|---|
| 消息气泡暂停徽标 | `apps/desktop/.../chat/MessageBubble.tsx:62-90` `HitlPausedHeader` | 按 `pausedKind` 显示"等待你确认该操作 / 等待你补充信息 / 等待你选择" + 已耗时计时 |
| 停止按钮语义切换 | `chatStore.stopStreaming` | 暂停态下"停止"等价"取消待确认"→ `hitlStore.dismiss()` |
| 工具级审批开关（web） | `apps/web/src/components/more-menu/McpSection.tsx:112-123` | 切换 `sensitiveTools` 名单 → `PUT /mcp/policy` |
| 云端 / 本地运行模式 | `apps/desktop/src/renderer/src/services/transport/index.ts:108-116` | 决定 resume/abort/getState 走 HTTP 还是 IPC |
| 回退组件（desktop，无挂载点） | `components/hitl/HitlHost.tsx:27-30` | 现恒 `return null`；三个 `Hitl*Dialog.tsx` 保留作模板 |

> ⚠️ 注意：desktop 的 `components/hitl/*Dialog.tsx` 与 `HitlHost.tsx` **已无生产渲染路径**（`HitlHost` 恒返回 `null`），修改它们无效。真正的渲染开关在 `ChatArea → InputArea` 的 `pro-input-hitl-panel`。

---

## 三、Agent 与人工之间的数据流转与消息传递

### 3.1 中断载荷（Agent → 人工）

`interrupt(value)` 的载荷即前端恢复所需的全部信息。**权威来源是 checkpointer 中 pending task 的 `interrupts[].value`，不是 `state.values`**——LangGraph 暂停时节点未返回，channels 通常为空：

```1179:1193:packages/modu-agent/src/graph/runner.ts
export function extractInterruptValue(state: Record<string, any> | null | undefined): Record<string, any> | null {
  const tasks = Array.isArray(state?.['tasks']) ? (state!['tasks'] as Record<string, any>[]) : []
  for (const task of tasks) {
    const interrupts = Array.isArray(task?.['interrupts'])
      ? (task['interrupts'] as Record<string, any>[])
      : []
    for (const item of interrupts) {
      const value = item?.['value']
      if (value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, any>
      }
    }
  }
  return null
}
```

| kind | 载荷字段 | 位置 |
|---|---|---|
| `tool_confirm` | `{kind, tool_calls, trace_id, session_id, user_id, message}` | `nodes.ts:2152-2159` |
| `clarifying` / `choice` | `{kind, question, options, session_id, user_id, trace_id, message, reason}` | `nodes.ts:2380-2389` |

### 3.2 事件编码（内核 → 前端）

AG-UI 适配器检测到 `__interrupt__` 后，跳过全部"完成"语义（`RUN_FINISHED` / flush / `TEXT_MESSAGE_END`），改发事件对：

```1176:1185:packages/modu-agent/src/orchestration/communication/agui-adapter.ts
    if (interrupted) {
      logger.debug('transform.interrupt_branch, emitting USER_QUESTION_REQUEST + RUN_PAUSED')
      const pauseEvents = AGUIStreamAdapter._process_interrupt_event(
        interruptValue,
        this._trace_id,
        this._message_id,
      )
      if (pauseEvents) {
        yield pauseEvents.userQuestionEvent
        yield pauseEvents.runPausedEvent
```

**两种中断探测形状**（兼容不同 LangGraph 版本/流模式）：

- `updates` 形状：`event.node === '__interrupt__'`，`event.data` 即 `Interrupt[]`（`agui-adapter.ts:1129-1136`）
- `values` 形状：`data['__interrupt__']` 数组（`agui-adapter.ts:1143-1152`）

`_process_interrupt_event`（`agui-adapter.ts:1526-1606`）职责：

1. **kind 白名单归一**：显式声明 `tool_confirm | clarifying | choice | plan_confirm` 原样透传，**其余保守兜底 `tool_confirm`**（避免异常载荷触发澄清 UI）；
2. `question` / `options` / `artifacts` 逐字段类型校验后再下发（过滤非法元素）；
3. 生成 `USER_QUESTION_REQUEST`（携带 kind 与对应字段）+ `RUN_PAUSED`（终态）。

### 3.3 事件与端点契约

| 方向 | 载体 | 定义位置 | 命名风格 |
|---|---|---|---|
| ↓ `USER_QUESTION_REQUEST` | AG-UI SSE（**终态前**） | `agui-adapter.ts:69-86` | snake_case |
| ↓ `RUN_PAUSED` | AG-UI SSE（**终态**） | `agui-adapter.ts:130` | snake_case |
| ↓ `HITL_ABORTED` | AG-UI SSE（类型已定义，**当前无发射方**） | `agui-adapter.ts:131` | snake_case |
| ↑ `POST /agent/completions` | REST → SSE | `apps/backend-ts/src/routes/agent.ts:317-544` | camelCase |
| ↑ `POST /agent/resume` | REST → SSE | `routes/agent.ts:570-729` | camelCase |
| ↑ `GET /agent/state/:threadId` | REST | `routes/agent.ts:731-764` | snake_case（响应） |
| ↑ `POST /agent/abort` | REST | `routes/agent.ts:766-820` | camelCase |
| ↑ `POST /agent/completions/stop` | REST | `routes/agent.ts:548-563` | camelCase |

resume 请求体 schema：

```123:134:apps/backend-ts/src/schemas/agent.ts
export const AgentResumeRequestSchema = z.object({
  sessionId: z.string(),
  approved: z.boolean(),
  feedback: z.string().nullable().optional(),
  // 改参批准：按 tool_call_id 覆盖原参数（v1.2 §4.3 建议3）
  modifiedArgs: z.record(z.record(z.unknown())).nullable().optional(),
  // 需求澄清回答：自由文本 answer / 多选选项 id answerId（kind='clarifying' | 'choice'）
  answer: z.string().nullable().optional(),
  answerId: z.string().nullable().optional(),
  // T5.5：首次 /completions 创建的 runId；提供则 resume 完成后把该 run 收尾
  runId: z.string().nullable().optional(),
})
```

abort 请求体：

```138:142:apps/backend-ts/src/schemas/agent.ts
export const AgentAbortRequestSchema = z.object({
  sessionId: z.string(),
  reason: z.enum(['user_cancel', 'timeout', 'reject']).default('user_cancel'),
})
```

> **命名是硬约束**：AG-UI 事件载荷用 snake_case，REST 请求体用 camelCase，转换在前端 `payloadToHitlInput` 完成（见 `packages/agent-protocol/README.md:5-10`）。

### 3.4 后端把 REST 载荷翻译成 `Command(resume)`

```971:988:packages/modu-agent/src/graph/runner.ts
  const resumePayload: Record<string, any> = {
    approved: Boolean(approved),
    feedback: String(feedback || ''),
  }
  if (options?.timeout === true) {
    resumePayload['timeout'] = true
  }
  // v1.2 §4.3 建议3：改参批准（modified_args），与 resume_stream 对齐
  if (options?.modifiedArgs && Object.keys(options.modifiedArgs).length > 0) {
    resumePayload['modified_args'] = options.modifiedArgs
  }
  // 澄清回答（clarify 节点消费）：自由文本 answer + 选项 id answer_id
  if (options?.answer !== undefined && options?.answer !== null) {
    resumePayload['answer'] = String(options.answer)
  }
  if (options?.answerId !== undefined && options?.answerId !== null) {
    resumePayload['answer_id'] = String(options.answerId)
  }
```

**完整链路**：

```
routes/agent.ts:626  streamAgentResume({sessionId, userId, approved, feedback, modifiedArgs, answer, answerId, signal, ctx})
        ↓
core/agent-bridge.ts:259-296  resume_stream(graph, sessionId, approved, feedback, trace, {modifiedArgs, answer, answerId}, signal)
        ↓
graph/runner.ts:1077-1154  graph.stream(new Command({resume: resumePayload}), {configurable: {thread_id: sessionId}})
        ↓
AGUIStreamAdapter.transform_langgraph_events(...)  → 复用同一套事件归一化
```

**两个易错点（均已在代码中显式注释锁定）**：

1. **必须复用同一 checkpointer 单例**，否则读不到中断 checkpoint（`graph/factory.ts:196-229`）；
2. **Plan-Execute 会话 resume 必须透传 `extraConfigurable: {plan_execute_enabled: true}`**，否则 `clarify→memory_query` 之后会被 `routeAfterMemoryQuery` 错误路由到 `agent` 而非 `planner`（`runner.ts:951-958`）。

### 3.5 desktop 本地模式：Electron IPC 同构通道

```70:76:apps/desktop/src/shared/ipc-channels.ts
  AGENT_SEND / AGENT_RESUME / AGENT_ABORT / AGENT_STATE / AGENT_STOP / AGENT_EVENT
```

主进程 `src/main/agent-runtime.ts` 直接调用内核原语（`stream_response` / `resume_stream` / `resume_sync` / `get_interrupt_state` / `checkInterruptTimeout`），语义对齐 backend-ts REST。三处关键修复：

```247:302:apps/desktop/src/main/agent-runtime.ts
export function validateResumeRequest(...)
  // 253-257 是 P0 修复：保留澄清载荷 answer / answerId
  // （原来被丢弃导致本地模式答案永远 undefined）
```

```308:326:apps/desktop/src/main/agent-runtime.ts
ensureSensitiveToolsRegistered  // 只有 tools.human_in_loop.enabled === true 才注册 code_executor
                                // 等需审批工具；否则敏感工具会绕过审批直接执行
```

```383:424:apps/desktop/src/main/agent-runtime.ts
executeResume  // resume_stream(graph, sessionId, approved, feedback, traceId,
               //   {modifiedArgs, answer, answerId, extraConfigurable})
```

**会话图 LRU**（`agent-runtime.ts:84-120` `resolveSessionGraph`）：`plan_execute` 会话的 resume/abort/getState 必须复用 send 时的 plan 图，否则批准续跑会命中不存在的节点。

**透传抽象**（`src/renderer/src/services/transport/`）：

| 方法 | HTTP 实现 | IPC 实现 |
|---|---|---|
| `resume` | `POST /agent/resume`（SSE） | `invoke('agent:resume')` + 订阅 `agent:event` |
| `abort` | `POST /agent/abort` | `invoke('agent:abort')` |
| `getState` | `GET /agent/state/:threadId` | `invoke('agent:state')` |

模式解析优先级：`localStorage['agent.transportMode']` > `VITE_AGENT_TRANSPORT` > `http`（`transport/index.ts:24-44`）；`local` 会话恒走 IPC（`:87-97`）。

---

## 四、状态管理与持久化

### 4.1 图状态（内核）

`graph/state.ts:100-114` 声明 HITL 字段，`:267-287` 注册 Annotation，`:478-488` 给初值，`HITLModeState:582-597` 提供模式视图：

| 字段 | 语义 |
|---|---|
| `pending_tool_calls` / `tool_requires_approval` | 待审批工具（**暂停期间通常为空**，权威在 checkpoint） |
| `approval_status` | `skipped` / `no_tool_calls` / `not_required` / `approved` / `rejected` / `timeout` |
| `approval_feedback` | 审批反馈备注 |
| `interrupt_kind` / `approval_message` | kind 回填 + 提示文案（供 `get_interrupt_state` 兜底） |
| `needs_clarification` / `clarification_question` / `clarification_options` | 澄清判定与载荷回填 |
| `clarification_answers` | 已答记录数组（含 `question/answer/answer_id/answer_label/round/reason`） |
| `clarification_round` | 轮次上限控制（防无限追问） |

全部使用 last-write-wins reducer（`_lw`），新增字段不改变既有 reducer 语义。

### 4.2 Checkpointer（HITL 的物理载体）

`graph/factory.ts:171-230` `build_checkpointer`：

| 类型 | 行为 |
|---|---|
| `memory`（默认） | **模块级惰性单例 `BoundedMemorySaver`**（LRU 淘汰，按 `memory.checkpointer_max_threads`，默认 100） |
| `sqlite` | 可选依赖 `@langchain/langgraph-checkpoint-sqlite`；缺失时告警并降级回 MemorySaver |
| `none` | 返回 `null`（无持久化，HITL 不可用） |

```196:214:packages/modu-agent/src/graph/factory.ts
  // 默认：内存检查点（模块级单例）
  // HITL 依赖：interrupt 状态保存在 checkpointer 中，跨请求 resume 需要复用
  // 同一个 MemorySaver 实例——若每次 create_agent() 新建，中断状态会随实例销毁丢失。
  // 改为惰性单例后，所有图实例共享同一份 checkpoint 数据（与 get_runner 缓存语义一致）。
  //
  // P1-7：使用 BoundedMemorySaver（MemorySaver 子类），按 memory.checkpointer_max_threads
  // 做 LRU 淘汰，防止长跑多会话进程中 checkpoint state 无界增长。
  if (_sharedMemoryCheckpointer === null) {
    ...
    // 能力边界显式告警：HITL 暂停态（interrupt 载荷 + 待答复项）只存在于本进程内存。
    // 进程重启 / 多实例部署后 GET /agent/state 将返回 pending=false，
    // 前端无法恢复待答复项（表现为"暂停项已失效"）。生产环境请改用 sqlite 检查点。
```

**递归预算**需按 HITL 节点动态增加，否则多轮澄清/审批会撞 `GraphRecursionError`：

```448:457:packages/modu-agent/src/graph/spec.ts
export function computeRecursionLimit(deps: ModuGraphDeps, has: NodePredicate): number {
  const config = deps.runtimeConfig ?? getConfig()
  const maxIterations = config.get('llm.max_reasoning_iterations', 3)
  const effectiveIterations = maxIterations + 2
  let baseLimit = effectiveIterations * 3 + 15
  if (has('human_review')) baseLimit += 2
  if (has('clarify')) {
    const maxRounds = Number(config.get('perception.clarification.max_clarify_rounds', 2))
    baseLimit += 2 + Math.max(0, maxRounds) * 2
  }
```

### 4.3 后端数据库（持久化边界）

| 表 | HITL 相关约定 | 位置 |
|---|---|---|
| `chat_messages` | **paused 的 run 不落库**（半截 assistant 消息），resume 终态才落库 | `routes/agent.ts:463-496`、`agent-bridge.ts:54-61` |
| `agent_run` | `status ∈ {running, completed, error, cancelled, paused}`；paused 时 `endedAt/durationMs/usage` 留空，等 resume 收尾 | `agent-bridge.ts:620-677` |
| `agent_run.events` | resume 时按 `runId` 合并首次 + resume 事件时间轴，`seq` 延续 | `routes/agent.ts:695-726` |
| `chat_messages.userRating / userFeedback` | 事后评价（1-5 星 + 文本） | `routes/agent.ts:985-1013` |
| `plan_steps` + `chat_messages.metadata` | `plan_phase` / `plan_error` / `collapsed_steps`，供事中/事后回放 | `routes/agent.ts:867-930` |

持久化边界的关键判定：

```514:520:apps/backend-ts/src/core/agent-bridge.ts
  } else if (eventType === 'RUN_PAUSED') {
    // HITL（阶段零 D3）：run 被 interrupt 暂停——标记 ctx，路由层据此跳过空消息持久化
    ctx.paused = true
    ctx.runPaused = true
  } else if (eventType === 'HITL_ABORTED') {
    // HITL：超时/用户取消后收尾——同样视为非正常完成，不持久化空消息
    ctx.paused = true
  }
```

`StreamContext` 的 HITL 字段（`agent-bridge.ts:54-61`）：`paused`（本次 run 是否被暂停）、`runPaused`（仅 `RUN_PAUSED` 为 true，`HITL_ABORTED` 不跟踪 TTL）、`abortReason`（`user_cancel | timeout | reject`，有值时不持久化半截消息）。

### 4.4 前端状态（两条独立实现）

| 端 | 文件 | 内容 |
|---|---|---|
| desktop | `renderer/src/stores/hitlStore.ts` | `HitlStatus = 'idle'\|'paused'\|'awaiting'\|'resolving'`；`pendingQueue` / `currentItem` / `error`；`enqueue / dequeue / resolve / dismiss / skip / recover / refresh / reset`；`itemKey()` 去重键；`HITL_STATE_POLL_MS = 15000` |
| desktop | `renderer/src/stores/chatStore.ts` | `hitlPending` / `hitlPausedSessionId` / `hitlPausedMessageId` / `selectIsHitlPaused`；`pauseStreamingMessage` / `resumeHitl` / `abortHitl` / `restoreHitlPause` / `finalizeHitlStale` |
| desktop | `renderer/src/stores/hitl-bridge.ts` | 单向桥接 `bindHitlStore` / `getHitlStore`，切断 store 间 ESM 循环依赖 |
| desktop | `renderer/src/services/clarify-metrics.ts` | 澄清指标（`triggered/answered/skipped/expired/answerLatencyMsTotal`，派生 `skipRate` / `avgAnswerLatencyMs`），localStorage + `window.__clarifyStats()` |
| web | `packages/agent-protocol/src/hitlStore.ts` | 同源移植版；靠 `host.ts` 的 `HitlHost` 契约做**依赖注入** |
| web | `packages/agent-protocol/src/hitl-bridge.ts` | 同款单向桥接 |
| web | `apps/web/src/lib/agent-host.ts:33-45` | `bindHitlHost({...})`：`getCurrentSessionId → conversationStore.activeId`、`selectSession → activate(id)`、`getState → fetchHitlState`、`abortHitl → abortAgentHitl`、`resumeHitl/restoreHitlPause/finalizeHitlStale → activeRuntime` |
| web | `apps/web/src/store/planExecuteStore.ts` | **web 独有的 HITL 互斥锁** `hitlLocked` |
| web | `apps/web/src/modes/pro/hooks/useAgentChat.ts` / `task/hooks/usePlanExecuteChat.ts` | 模式级 HITL 接线（见下） |

#### hitlStore 队列状态机核心行为

| 动作 | 行为 | 位置（desktop） |
|---|---|---|
| `enqueue` | 去重（`itemKey`）；无展示项且非 `resolving` → 直接展示；`resolving` 中排队（**避免被 dequeue 丢弃**） | `:129-147` |
| `dequeue` | 展示下一项 | `:149-157` |
| `resolve` | **跨会话归属**（先 `chat.selectSession` 切回对应会话）→ `chat.resumeHitl` → 失败回滚 `status:'paused'` + 写 `error`（可见）→ 成功记澄清指标 | `:159-194` |
| `dismiss` | 清项 → `chatStore.abortHitl(sid, reason)` → `dequeue` | `:196-205` |
| `skip` | `tool_confirm` 不可跳过（返回 `false`）；澄清类以空回答继续 | `:207-213` |
| `recover` | `getState(threadId)` 三态恢复（见 §6.3） | `:215-283` |
| `refresh` | 15s 轮询检测超时/失效并收敛 | `:285-305` |

#### chatStore 暂停容器生命周期

| 动作 | 行为 |
|---|---|
| `pauseStreamingMessage` | 保留 `streamingMessageId` 供续写；消息标 `paused: true` + `pausedKind`；**不 finalize**；停 idle 计时 |
| `resumeHitl` | 前置校验（无暂停容器 → 返回可展示 reason）→ 清暂停标记转 streaming → 以 `initialState`（暂停消息 trace 树）建 handler → **续写同一条 assistant 消息** |
| `abortHitl` | abort 在途流 + `transport.abort(sid, reason)` best-effort + `buildHitlAbortedPatch` 收尾 + 清暂停标记 |
| `restoreHitlPause` | 补 `paused: true` 占位 assistant 消息，写 `hitlPausedSessionId/MessageId/streamingMessageId` |
| `finalizeHitlStale` | 追加 `[已失效] reason` 文案、解除 paused、清暂停状态 |

#### 关键防串线设计

- **暂停标记按会话归属**（`hitlPausedSessionId`，而非全局布尔），`resolve` 前自动切回对应会话；
- **暂停态禁止发新消息**（否则 `streamingMessageId` 被覆盖、与后端未收敛的 interrupt 并存，破坏 pause/resume 状态机）：
  - desktop：`chatStore.sendMessage` 守卫段
  - web pro：`useAgentChat.ts:404-405`；web task：`usePlanExecuteChat.ts:237-238`
- **web task 模式的 plan 互斥锁**：

```105:106:apps/web/src/store/planExecuteStore.ts
  // HITL 暂停互斥锁：锁定时禁止 toggleStep，且 STATE_DELTA 不得推进 phase
  applyPlanDelta: (delta, seq) => set((state) => { if (state.hitlLocked) return state; ... })
```

### 4.5 澄清回答的数据闭环

澄清结果既写入状态、又注入消息流，让下游 agent 基于"补充后的需求"继续：

```2419:2446:packages/modu-agent/src/graph/nodes.ts
    const answerRecord = {
      question,
      answer: answerText,
      answer_id: answerId || null,
      answer_label: answerLabel || null,
      round: Number(state.clarification_round ?? 0) + 1,
      reason: decision.reason,
    }

    // 把澄清结果注入消息流：下游 agent 基于"补充后的需求"继续执行
    const injectionParts = [`澄清问题：${question}`]
    if (answerLabel) injectionParts.push(`用户选择：${answerLabel}`)
    if (answerText) injectionParts.push(`用户补充：${answerText}`)
    const clarifiedMessage = injectionParts.join('\n')

    const messages = Array.isArray(state.messages) ? (state.messages as BaseMessage[]) : []
    const injectedMessages =
      answerText || answerLabel ? [...messages, new HumanMessage(clarifiedMessage)] : messages

    return {
      needs_clarification: false,
      clarification_answers: [...(state.clarification_answers ?? []), answerRecord],
      clarification_round: Number(state.clarification_round ?? 0) + 1,
      clarification_question: '',
      clarification_options: [],
      interrupt_kind: '',
      messages: injectedMessages,
    }
```

澄清完成后回到 `memory_query` 主链路（`graph.ts:663`）。

---

## 五、审批/确认流程的设计与执行

### 5.1 完整时序

```
1. Agent 产出 AIMessage.tool_calls
2. routeAfterAgent → human_review（edge: graph.ts:728-743）
3. decideToolApprovals 筛出 pending[]
   └─ 同时发布审计事件 tool_approval_required（带去重表，防 resume 重执行重复上报）
4. interrupt(payload) → checkpointer 挂起
   └─ 发 USER_QUESTION_REQUEST + RUN_PAUSED
5. 前端入队展示 → 用户操作 → POST /agent/resume（SSE）
6. resume_sync/stream：Command(resume) → 节点从头重执行 → 解析 approved/feedback/modified_args
   └─ 发布审计事件 tool_approval_approved / tool_approval_rejected
7. routeAfterHumanReview：approved → tools；rejected/timeout/error → finalize_response
```

图拓扑接线：

```599:612:packages/modu-agent/src/graph/graph.ts
    // P3-12.3.2: 人工审批节点（HITL 开启时插入 agent → tools 之间）
    {
      name: 'human_review',
      factory: () => makeHumanReviewNode(),
      when: (p) => p.hitlEnabled,
    },
    // 需求澄清节点（perception.clarification.enabled=true 时插入）
    {
      name: 'clarify',
      // 阶段3：注入未绑定工具的原始 LLM（供 use_llm 润色 / llm_judge 复判；
      // 两者默认关闭时不产生任何 LLM 调用）
      factory: (deps) => makeClarifyNode(null, deps.rawLlm ?? deps.llm),
      when: (p) => p.clarifyEnabled,
    },
```

```728:752:packages/modu-agent/src/graph/graph.ts
  // Agent 后条件路由：
  // - HITL 关闭: 有 tool_calls → tools，无 tool_calls → finalize_response（原行为）
  // - HITL 开启: 有 tool_calls → human_review，无 tool_calls → finalize_response
  edges.push({
    from: 'agent',
    to: {
      router: routeAfterAgent,
      targets: (has) => ({
        tools: has('human_review') ? 'human_review' : 'tools',
        __end__: 'finalize_response',
        ...
      }),
    },
  })
  // human_review 后条件路由：通过 → tools，拒绝/错误 → finalize_response
  edges.push({
    from: 'human_review',
    to: {
      router: routeAfterHumanReview,
      targets: { tools: 'tools', finalize_response: 'finalize_response' },
    },
    when: (p) => p.hitlEnabled,
  })
```

### 5.2 审计事件去重（因"resume 时节点从头重执行"）

LangGraph 的 interrupt 语义是 **resume 时节点从头重执行**，`interrupt()` 之前的代码（含审计发布块）会执行两次。为保证同一审批在审计日志中只出现一次：

```1999:2017:packages/modu-agent/src/graph/nodes.ts
export function _shouldPublishApprovalRequired(state: ModuAgentState, pending: any[]): boolean {
  const key = [
    state.session_id ?? '',
    state.trace_id ?? '',
    String((state.messages ?? []).length),
    pending.map((tc) => String(tc['name'] ?? '') + ':' + String(tc['id'] ?? '')).sort().join(','),
  ].join('|')
  if (_approvalRequiredAuditKeys.has(key)) {
    return false
  }
  _approvalRequiredAuditKeys.set(key, true)
  if (_approvalRequiredAuditKeys.size > 4096) {
    const oldest = _approvalRequiredAuditKeys.keys().next().value
    if (oldest !== undefined) {
      _approvalRequiredAuditKeys.delete(oldest)
    }
  }
  return true
}
```

去重键设计说明：

- `resume` 重执行时 state 未变 → 同键跳过；
- 同会话的新审批请求因 `messages` 增长（新增 AIMessage/ToolMessage）→ 异键正常发布；
- 表有界（容量上限 4096，LRU 淘汰），防长进程内存增长。

审计事件共三处发布：`tool_approval_required`（`nodes.ts:2130-2146`）、`tool_approval_approved` / `tool_approval_rejected`（`nodes.ts:2187-2211`），`details` 含 `call_id / feedback / timeout / modified_args`。

### 5.3 四种结果分支

| 分支 | 处理 | 位置 |
|---|---|---|
| **批准** | `approval_status='approved'`，路由到 `tools` 执行 | `nodes.ts:2244-2249` |
| **改参批准** | 按 `tool_call.id` 覆盖 args，**构造新 AIMessage 替换原消息**，让 ToolNode 按修改后参数执行 | `nodes.ts:2216-2243` |
| **拒绝** | 每个待审批工具生成降级 ToolMessage（调工具的 `onApprovalRejected` 钩子），路由 `finalize_response`（**不等于中止 run**） | `nodes.ts:2252-2300` |
| **超时** | 同上但错误码用 `TOOL_APPROVAL_TIMEOUT`，`approval_status='timeout'` | `nodes.ts:2254, 2295` |

改参批准的关键实现：

```2214:2243:packages/modu-agent/src/graph/nodes.ts
      // v1.2 §4.3 建议3：若审批者提供了 modified_args，则用修改后的参数覆盖原 AIMessage 的 tool_calls
      //   生成新的 AIMessage 替换原消息，让下游 ToolNode 按修改后参数执行
      if (modifiedArgs && Object.keys(modifiedArgs).length > 0) {
        const updatedToolCalls = toolCalls.map((tc: Record<string, any>) => {
          const callId = tc['id'] ?? ''
          const mod = modifiedArgs![callId]
          if (mod && typeof mod === 'object') {
            logger.info('HITL modified_args applied: tool=%s call_id=%s', tc['name'] ?? '', callId)
            return { ...tc, args: { ...tc['args'] ?? {}, ...mod } }
          }
          return tc
        })
        const newLastMsg = new AIMessage({
          content: lastMsg.content ?? '',
          tool_calls: updatedToolCalls as any,
          additional_kwargs: lastMsg.additional_kwargs ?? {},
        })
        const newMessages = [...messages.slice(0, -1), newLastMsg]
        return {
          approval_status: 'approved',
          approval_feedback: feedback,
          tool_requires_approval: false,
          pending_tool_calls: [],
          messages: newMessages,
        }
      }
```

注意：`modified_args` **仅在 `approved=true` 时生效**；`approved=false` 时忽略（拒绝路径用原 args 调 `onApprovalRejected`）。

分支路由：

```2313:2323:packages/modu-agent/src/graph/nodes.ts
export function routeAfterHumanReview(state: ModuAgentState): string {
  const approvalStatus = state.approval_status ?? ''
  if (
    approvalStatus === 'rejected' ||
    approvalStatus === 'timeout' ||
    approvalStatus === 'error'
  ) {
    return 'finalize_response'
  }
  return 'tools'
}
```

### 5.4 澄清的"确认"语义（与审批解耦）

| 维度 | 工具审批 | 澄清 |
|---|---|---|
| 恢复字段 | `approved` / `feedback` / `modified_args` | `answer` / `answer_id` |
| 通过分支 | 执行工具 | 写 `clarification_answers` + 注入 messages |
| 拒绝分支 | 降级 ToolMessage + 跳工具 | 不适用（澄清无"拒绝"，只有"跳过"= 空回答） |
| 轮次控制 | 无 | `clarification_round` + `max_clarify_rounds` |
| 超时错误码 | `TOOL_APPROVAL_TIMEOUT` | 无错误码，`continue_with_defaults` 静默继续 |

---

## 六、异常处理与恢复机制

### 6.1 超时治理（双策略，按 kind 分流）

`checkInterruptTimeout`（`runner.ts:1307-1438`）：

| kind | 超时阈值来源 | 超时动作 |
|---|---|---|
| `tool_confirm` | `tools.human_in_loop.approval_timeout_seconds`（默认 300s） | `auto_reject_on_timeout=true`（默认）→ `resume_sync(approved=false)`，携带 `timeout=true`，走 `TOOL_APPROVAL_TIMEOUT` 降级路径 |
| `clarifying` / `choice` | `perception.clarification.timeout_seconds`（默认 120s） | `on_timeout='continue_with_defaults'` → 按现有信息继续，**不写答案记录、不消耗澄清轮次**；`on_timeout='abort'` → 仅标记 `expired`，不自动 resume |

返回值语义（`:1301-1305`）：`'active' | 'expired' | 'no_interrupt' | 'no_config' | 'resume_failed'`。

分支实现：

```1322:1341:packages/modu-agent/src/graph/runner.ts
  // 阶段1：按 interrupt 类型分流超时治理——
  //   澄清（clarifying/choice）读取 perception.clarification 的独立配置；
  //   工具审批维持 tools.human_in_loop 原语义（零回归）。
  const kind = state['kind'] as string | undefined
  const isClarify = kind === 'clarifying' || kind === 'choice'
  const effectiveTimeout = isClarify
    ? Number(clarifyCfg['timeout_seconds'] ?? 120)
    : timeoutSeconds
  const onTimeout = String(clarifyCfg['on_timeout'] ?? 'continue_with_defaults')

  // timeout<=0 视为禁用超时检查
  if (!(effectiveTimeout > 0)) {
    return 'no_config'
  }

  const createdAt = state['created_at']
  if (!createdAt) {
    // 缺少 created_at（旧 checkpoint 或 LangGraph 版本差异），保守不触发
    return 'active'
  }
```

**一个被测试回归锁定的易错点**：澄清超时 resume 时 `feedback` **必须留空**——因为 clarify 节点对"回答"存在 `answer ?? feedback` 回退，塞入描述性文本会被误判为用户回答：

```1373:1389:packages/modu-agent/src/graph/runner.ts
    // continue_with_defaults：按现有信息继续执行。
    // resume 携带 timeout 标记，clarify 节点据此不写入答案记录、不消耗澄清轮次。
    // feedback 必须留空：clarify 节点对"回答"存在 `answer ?? feedback` 回退，
    // 若在此塞入描述性文本会被误判为用户回答（测试回归锁定）。
    try {
      const result = await resume_sync(
        graph, sessionId, false, '',
        `clarify-timeout-${sessionId}-${Math.floor(nowMs)}`,
        { timeout: true },
      )
```

clarify 节点侧的对应处理（**只看显式 answer/answer_id 字段**）：

```2391:2417:packages/modu-agent/src/graph/nodes.ts
    const answerPayload = (resumePayload ?? {}) as Record<string, any>
    // 阶段1：超时（on_timeout='continue_with_defaults'）恢复——
    // 不消耗澄清轮次、不写入答案记录，仅清除暂停标志后按现有信息继续执行。
    // 判定只看显式 answer/answer_id 字段：feedback 是"只读 feedback 后端"的兼容通道，
    // 超时自动恢复可能携带系统生成的 feedback 文本，不得误判为用户回答。
    const timedOut = answerPayload['timeout'] === true
    const answerText = String(answerPayload['answer'] ?? answerPayload['feedback'] ?? '').trim()
    const answerId = String(answerPayload['answer_id'] ?? '').trim()
    const hasExplicitAnswer =
      String(answerPayload['answer'] ?? '').trim().length > 0 ||
      String(answerPayload['answer_id'] ?? '').trim().length > 0
    ...
    if (timedOut && !hasExplicitAnswer) {
      return {
        needs_clarification: false,
        clarification_question: '',
        clarification_options: [],
        interrupt_kind: '',
      }
    }
```

### 6.2 主动清理：TTL 调度器

```1:9:apps/backend-ts/src/core/agent-scheduler.ts
/**
 * Agent TTL 清理调度器（T2.2）
 *
 * 周期 sweep 已注册的待答复会话：
 *   - 超时（approval_timeout）→ 自动拒绝
 *   - 已无中断（用户已处理 / checkpointer 丢失）→ 自动注销
 *
 * 会话在 run 暂停（ctx.runPaused）后由路由层 trackInterruptSession。
 */
```

- 扫频：60s（`DEFAULT_INTERVAL_MS = 60_000`，`agent-scheduler.ts:17`）
- 启动：`apps/backend-ts/src/index.ts:12` `startInterruptScheduler()`；SIGINT/SIGTERM 时 `stopInterruptScheduler()`
- 注册时机：**仅 `ctx.runPaused`（真暂停等待答复）才注册**，`HITL_ABORTED` 不跟踪（`routes/agent.ts:494-495`）
- 自动剔除：结果为 `expired | no_interrupt | resume_failed` 时从 tracked 集合移除
- 批量内核入口：`sweepExpiredInterrupts`（`runner.ts:1451-1468`）

### 6.3 前端恢复三态

`hitlStore.recover(threadId)`（desktop `hitlStore.ts:215-283` / web `agent-protocol/hitlStore.ts:179-246`）：

| 后端状态 | 处理 |
|---|---|
| `expired` / `!pending` | `finalizeHitlStale`（消息追加"[已失效] reason"）+ 清残留项 + 写全局 error + `trackClarifyExpired` |
| 仍 `pending` | 归一化 kind（`st.kind ?? (toolCalls \|\| tool_requires_approval ? 'tool_confirm' : 'clarifying')`）→ `restoreHitlPause` **重建 paused 容器** → `enqueue({origin: 'recover'})` |
| 查询持续异常 | 静默保持现状（**不主动收敛**） |

挂载时机：`selectSession` **先 `loadMessages` 再 `recover`**（避免重建容器被加载结果覆盖）：

```669:674:apps/desktop/src/renderer/src/stores/chatStore.ts
      // 进页/切会话/重连恢复：查询后端是否仍有待答复项，若有则补挂内联卡
      ...
      void getHitlStore().getState().recover(sessionId, session?.runtime)
```

### 6.4 轮询兜底

暂停项展示期间每 15s `refresh` → `GET /agent/state/:threadId`，检测超时/失效并收敛。

**为什么用轮询**：暂停发生时原 SSE 流已终结（`RUN_PAUSED` 为终态），**不存在可推送的长连接**，因此"超时通知"以前端轮询实现等价效果（`docs/code-wiki/13-HITL可用性修复说明.md:128-129`）。

服务端侧，`GET /agent/state/:threadId` 查询前**先**检查超时，超时则自动拒绝并返回 `{pending: false, expired: true}`：

```742:757:apps/backend-ts/src/routes/agent.ts
        // 超时治理：查询前先检查是否超时（超时则自动拒绝并返回已过期）
        try {
          const timeoutStatus = await checkInterruptTimeout(
            await get_runner(),
            threadId,
          )
          if (timeoutStatus === 'expired') {
            return {
              session_id: threadId,
              pending: false,
              expired: true,
            }
          }
        } catch (e: any) {
          fastify.log.debug({ err: e, threadId }, '[agent.state] timeout check skipped')
        }
```

### 6.5 失败回滚与可见错误

| 场景 | 处理 |
|---|---|
| `hitlStore.resolve` 失败 | 回滚 `status: 'paused'` + 写 `error`（卡片内可见），**而非静默吞掉**（P0-2 历史修复） |
| `resumeHitl` 前置校验失败 | 返回可展示 reason（无暂停容器 / 会话不匹配） |
| `abortHitl` | abort 在途流 + `transport.abort(sid, reason)` best-effort + `buildHitlAbortedPatch` 收尾 + 清暂停标记 |
| `POST /agent/abort` 的 `resume_sync` 返回 error | 返回 `{message: 'abort_failed', aborted: false, error}`，日志记录 `error_code` |
| 落库失败 | 不影响已发送的 SSE 流（`routes/agent.ts:485-488`） |
| 窗口销毁 | `main/ipc-handlers.ts:1068-1075` `abortRunsForSender` 防僵尸 run |

### 6.6 用户主动取消 / 放弃整轮 run

```766:819:apps/backend-ts/src/routes/agent.ts
      // POST /agent/abort —— 对中断执行拒绝/取消语义（超时/用户取消后收尾）
      app.post('/abort', ...)
        // 会话归属校验（防 IDOR）
        await verifySessionOwner(fastify.prisma, dto.sessionId, userId)
        // 确认存在待答复项
        const pending = await getPendingAgentState(dto.sessionId, userId)
        if (pending === null) {
          return { message: 'no_pending_interrupt', aborted: false }
        }
        // 复用 resume_sync(approved=false) 触发拒绝路径（时间语义与超时自动拒绝一致）
        const result = await resume_sync(
          graph, dto.sessionId, false,
          `user ${dto.reason}`,
          `hitl-abort-${dto.sessionId}-${Date.now()}`,
        )
        ...
        // T5.5：拒绝后把该会话下属于当前用户的 paused run 收尾为 cancelled
        await fastify.prisma.agentRun.updateMany({
          where: { sessionId: dto.sessionId, userId, status: 'paused' },
          data: { status: 'cancelled', endedAt: new Date() },
        })
```

### 6.7 观测埋点

desktop 有 `renderer/src/services/clarify-metrics.ts`：

| 指标 | 含义 |
|---|---|
| `triggered` | 澄清触发次数 |
| `answered` | 用户作答次数 |
| `skipped` | 跳过次数（含空回答） |
| `expired` | 超时/失效次数 |
| `answerLatencyMsTotal` | 作答延迟累计（派生 `avgAnswerLatencyMs`） |
| 派生 `skipRate` | 跳过率 |

持久化在 localStorage `pioneering.clarify.metrics`，控制台出口 `window.__clarifyStats()`。**web 侧未实现**（`agent-host.ts` 未提供 `trackAnswered/trackSkipped/trackExpired`）。

---

## 七、四阶段实现位置与做法（核查结论）

| 阶段 | 是否落地 | 触发/判定 | 交互入口 | 后端契约 | 状态与持久化 |
|---|---|---|---|---|---|
| **事前 Pre-execution**<br/>（澄清、明确度） | ✅ 完整 | `clarity-detector.ts:114-154`（规则）<br/>`:314-400`（LLM 复判）<br/>`:163-189`（同步粗筛） | 内联卡 `clarifying` / `choice` 分支 | `interrupt` 载荷 `nodes.ts:2380-2389`；SSE `USER_QUESTION_REQUEST` | `state.clarification_*`；checkpointer；`timeout_seconds=120` |
| **事中 Active interrupt**<br/>（工具审批） | ✅ 完整 | `decideToolApprovals` `tool-guardrails.ts:388-437`；guardrail 规则 `:61-108` | `HitlToolConfirmPanel`（批准/改参/拒绝） | `POST /agent/resume` → `Command(resume)` | `state.approval_*`；`agent_run.status=paused`；paused 不落库 |
| **事后 Post-execution review** | ⚠️ **部分** | 无中断式复核门（`plan_confirm` 无生产者） | 仅"评价"入口：`MessageBubble` 评分/反馈 | `POST /agent/messages/:messageId/feedback`（rating 1-5 + feedbackText）<br/>`GET /agent/messages/:messageId/plan`（回放） | `chat_messages.userRating/userFeedback`；`plan_steps` + `metadata` |
| **异常升级 Escalation** | ⚠️ **部分/未接线** | `TerminationAction = 'ESCALATE'`，条件"连续 N 轮信息增益停滞 + 置信度不达标"（`termination-engine.ts:32, 331-335`） | 无 UI 入口 | 无 resume/interrupt 路径 | **仅 advisory**：写 `state.termination_advice` + Prometheus 计数 |

### 7.1 Escalation 的确切现状（关键结论）

`ESCALATE` 目前是**建议值**，第一阶段 advisory 模式明确"不改变 `routeAfterAgent` 路由行为（仅采集指标）"：

```259:272:packages/modu-agent/src/graph/termination-engine.ts
/**
 * 自适应终止判定引擎。
 *
 * 第一阶段：advisory 模式
 *   - shouldTerminate() 返回 TerminationDecision
 *   - 调用方（routeAfterAgent）写入 state.termination_advice，但不改变路由
 *   - 仅采集 confidence_history / information_gain_history 供监控分析
 *
 * 第二阶段（待指标稳定后启用）：
 *   - shouldTerminate() 结果影响 routeAfterAgent 路由
 *   - TERMINATE / TERMINATE_WITH_CAVEATS → '__end__'
 *   - ESCALATE → '__end__'（携带 escalation 标记）
 *   - CONTINUE → 走原有 tool_calls 逻辑
 */
```

**即使第二阶段启用，`ESCALATE` 也只是 `'__end__'`（携带标记），不经过人工审批链路。** 即：**当前不存在"自动升级到人类处理队列/更高权限审批人"的实现**——转人工只发生在反向（人类拒绝 Agent 的方案）。

### 7.2 其它异常回退（非升级语义）

| 机制 | 位置 | 说明 |
|---|---|---|
| 工具拒绝降级 | `action.ts:67-73` `onApprovalRejected` | 返回标准错误结构，敏感工具可覆写为更友好的降级响应 |
| 审批判定 fail-closed | `tool-guardrails.ts:334-343` | 工具判定异常 → 一律走审批 |
| 权限受限提示 | `graph/adapters/observation-distiller.ts:97` | 生成"request privilege escalation"**文本提示**，不触发流程 |
| 澄清判定失败 | `clarity-detector.ts:363-366` | 保守放行（宁漏勿扰） |
| 策略引擎异常 | `nodes.ts:1984-1995` | 降级直调 `decideToolApprovals` |
| 澄清超时 | `runner.ts:1367-1404` | 按 `on_timeout` 继续或标记过期 |
| 审批超时 | `runner.ts:1407-1437` | 自动拒绝（`TOOL_APPROVAL_TIMEOUT`） |

---

## 八、六个澄清维度覆盖核查

| 维度 | 覆盖度 | 证据与位置 | 缺口 |
|---|---|---|---|
| **意图歧义 Intent** | ✅ **完整** | 规则两信号（`input_too_short`、`insufficient_patterns`，`clarity-detector.ts:139-151`）<br/>LLM 复判 `clarity_score` / `missing_slots`（`:231-269`）<br/>最高 2 条槽位追问拼接（`:370-374`）<br/>选项式消歧（`choice` + LLM 语境化候选方向 `:202-203`）<br/>评测集有 `expect_clarify` / `llm-required` 标签与精度/召回门禁（`packages/evals/src/clarification-eval.ts`、`data/cases/clarification.yaml`） | 无 |
| **风险等级 Risk** | ✅ 较强 | 三级判定 `guardrail → sensitive_list → tool_policy`<br/>5 条写操作/敏感数据 guardrail 规则<br/>`high_impact_only` + 默认高影响关键词集（写/外发/生产类）<br/>安全护栏独立 `risk_level`（仅注入检测，`perception/security/guard.ts:121`）<br/>`action_guardrails.dry_run_enabled` 预检 | **无分级风险模型**：没有 low/medium/high 映射到不同审批形态（如"低风险免确认/高风险双人复核"），是二元开关；`guard.ts` 的 `risk_level` 与工具审批判定**不互通** |
| **主体与权限 Authority** | ⚠️ 仅归属校验 | `authGuard`（全端点）<br/>`verifySessionOwner`（防 IDOR，`routes/agent.ts:49-61`）<br/>`getPendingAgentState` 二次 `user_id` 比对（`agent-bridge.ts:315-318`）<br/>中断载荷带 `user_id/session_id/trace_id`<br/>`POST /agent/abort` 先校验待答复项归属 | **无角色/权限模型**：审批人 = 会话所有者本人，没有 `approver_role`、多级审批、代审批、`required_permissions`；`sensitive_tools` 是**全局名单**（`PUT /mcp/policy` 无角色维度）；web 端 `sensitive` 徽标 prop 实际未传（仅单测覆盖） |
| **任务边界 Scope** | ❌ 未覆盖 | 边界由机制而非澄清确立：`plan_execute.max_steps`、`recursionLimit`（`spec.ts:448-457`）、工具白名单（会话 `modelConfig.tools`，`routes/agent.ts:274-276`） | 澄清判定**不询问范围**（做多少、做哪些、交付边界）；无"范围超限时反问"的门控 |
| **约束条件 Constraints** | ❌ 未覆盖 | 只有工具侧硬约束：`file_ops` 的 `allowed_root` + 路径穿越/symlink 校验<br/>`code_executor` 限时 10s + `maxBuffer` + `-I` 模式<br/>`http_request` 域名白名单 + SSRF 防护 | 澄清不询问约束（格式/长度/兼容性/不可动资源/时间窗）；约束冲突只能靠工具报错后自然语言往返，无结构化沉淀 |
| **时效与数据新鲜度 Freshness** | ⚠️ 部分（机制侧有、澄清侧无） | `BaseTool.providesRealtimeData()`（`core/interfaces/action.ts:92-94`）<br/>→ Planner 元数据驱动 `requires_tool` 推断（`plan-execute/planner.ts:116-165, 222-308`）<br/>→ `step_finalize` 校验未调用即判失败触发重规划<br/>工具清单标 `[realtime]` 标签<br/>HITL 自身时效治理完善（`created_at` 比对、双超时阈值、TTL sweep、前端 15s 轮询） | 澄清问题**不问"数据要多新"**；反问超时也**不提示数据可能过期**；无"数据新鲜度声明"随回答注入 messages |

### 结论

> **Intent 与 Risk 已系统性覆盖；Authority / Freshness 只在"机制侧"部分覆盖；Scope / Constraints 完全未被澄清维度覆盖。**

---

## 九、模块协作关系与职责边界

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 内核 packages/modu-agent                                                  │
│  perception/clarity-detector ──判定──┐                                     │
│  tools/tool-guardrails ──判定内核────┤                                     │
│  graph/nodes ──interrupt/resume分支──┼── graph/state ── graph/spec        │
│  graph/runner ──resume/超时/getState─┘   graph/factory ── checkpointer     │
│  core/policy-engine + perception/security/policy-rules ──只判定不执行      │
│  orchestration/communication/agui-adapter ──事件编码                       │
└───────────────────────────────────────────────────────────────────────────┘
                 ↓ 事件（AG-UI）              ↑ 载荷（Command(resume)）
┌───────────────────────────────────────────────────────────────────────────┐
│ 协议 packages/agent-protocol（web 专享）                                   │
│  types.ts（单一事实源） hitlStore.ts（队列状态机） host.ts（DI 契约）        │
│  components/HitlInlineCard + HitlToolConfirmBody                          │
└───────────────────────────────────────────────────────────────────────────┘
        ↓                                   ↑
┌──────────────────────────────┐  ┌────────────────────────────────────────┐
│ 云端 apps/backend-ts          │  │ 本地 apps/desktop/src/main             │
│  routes/agent.ts（4 端点）     │  │  agent-runtime.ts（内核直调 + LRU）     │
│  core/agent-bridge.ts（落库边界）│  │  ipc-handlers.ts（信任校验 + 防僵尸）   │
│  core/agent-scheduler.ts（TTL）│  │  local-store.ts（暂停不落库）           │
└──────────────────────────────┘  └────────────────────────────────────────┘
        ↓ SSE                              ↓ IPC
┌──────────────────────────────┐  ┌────────────────────────────────────────┐
│ apps/web                      │  │ apps/desktop/src/renderer              │
│  parseAguiStream + 模式 hook   │  │  hitlStore + chatStore + InputArea     │
│  agent-host（宿主注入）         │  │  clarify-metrics（观测）                │
│  planExecuteStore.hitlLocked  │  │  components/hitl/*（回退组件，未挂载）   │
└──────────────────────────────┘  └────────────────────────────────────────┘
```

### 职责边界明细

| 层 | 模块 | 职责 | 边界（不该做什么） |
|---|---|---|---|
| 内核 | `perception/clarity-detector.ts` | 纯判定（同步粗筛 + 异步精判），零副作用可单测 | 不 import `graph/*`（防循环依赖）；不渲染、不发网络请求 |
| 内核 | `graph/nodes.ts` | `interrupt()` 发起、resume 载荷解析、批准/拒绝/改参/超时分支、状态写入、审计发布 | 不含 HTTP / UI 逻辑 |
| 内核 | `graph/runner.ts` | resume 入口（sync/stream）、中断载荷提取、kind 归一、超时判定、批量 sweep | 不做归属校验（由宿主做） |
| 内核 | `tools/tool-guardrails.ts` | **审批判定唯一内核**（`decideToolApprovals`）；guardrail 注册表 | 不执行工具、不发 interrupt |
| 内核 | `core/policy-engine.ts` + `perception/security/policy-rules.ts` | 三层策略统一判定入口；`ToolApprovalPolicyRule` **委派**而非重写内核 | 「只登记规则、不迁执行」（D-18）；不改写响应文本 |
| 内核 | `orchestration/communication/agui-adapter.ts` | LangGraph 事件 → AG-UI 事件；中断探测与事件对生成 | 不感知 UI 语义（只做 kind 白名单归一） |
| 内核 | `graph/factory.ts` | checkpointer 单例（HITL 的物理前提）、能力边界告警 | 不管理暂停项业务状态 |
| 协议 | `packages/agent-protocol` | HITL 类型单一事实源 + `useHitlStore` + `HitlHost` DI 契约 + 复用卡片 | **chat(`/chat`) 栈不引本包**；场景包不得直接 import 宿主内核源码；样式只用 CSS 变量 |
| 云端编排 | `apps/backend-ts` `routes/agent.ts` | 归属校验、配额、SSE 转发、**落库边界**、`agent_run` 生命周期、运行注册表（stop） | 不重写判定；`getPendingAgentState` 只做透传 + 兜底归属 |
| 云端编排 | `apps/backend-ts` `core/agent-scheduler.ts` | 60s TTL sweep + 自动注销 | 不做用户提示（前端轮询负责） |
| 本地编排 | `apps/desktop/src/main/agent-runtime.ts` | 内核直调 + 会话图 LRU（plan_execute 必须复用原图）+ 模式白名单 + 敏感工具注册闸门 | 不落库（`local-store.ts` 约定：暂停消息不落库，resume 终态由渲染端聚合落库） |
| UI | `apps/desktop/src/renderer` | `hitlStore`（队列/去重/resolving 保护）+ `chatStore`（暂停容器/续写同一条消息）+ `InputArea` 内联卡 + 澄清指标 | 队列变更唯一入口是 `hitlStore`；`chatStore` 流回调只调 `dequeue()` |
| UI | `apps/web` | `parseAguiStream` + 模式 hook（pro/task）+ `agent-host` 注入 + `planExecuteStore.hitlLocked` 互斥 | 三模式边界由 `modes-boundary.test.ts` 机械化断言（chat 栈不得出现 `useHitlStore`/`HitlInlineCard`） |
| 评测 | `packages/evals` | 澄清判定精度/召回门禁（`CLARIFY_GATE`） | 不参与运行时 |

### 共享关系澄清（易误解点）

> **web 与 desktop 不共用 HITL 组件/store 代码。** web 使用 `@pioneering/agent-protocol`（依赖注入、可摘除，`apps/web/package.json` 依赖 `"@pioneering/agent-protocol": "*"`）；desktop 保留私有实现（硬编码依赖 `../services/transport`、`../services/clarify-metrics`、`./chatStore`），**对 `agent-protocol` 的引用为 0 命中**。两者是"同源移植 + 反向抽象"关系：`packages/agent-protocol/src/types.ts:4` 注释明示"从 `apps/desktop/src/shared/types.ts` 摘取"。

---

## 十、关键缺口与风险清单

### 协议层

1. **`HITL_ABORTED` 是死协议**：类型已定义（`agui-adapter.ts:131`）、两端已处理（desktop `agui.ts:307-315` / web `parseAguiStream.ts:173-176`），但**内核无发射方**。超时/取消由前端轮询或 abort 响应承载。
2. **`plan_confirm` 缺生产节点**：类型 / SSE 透传 / store / recover / Dialog / 内联卡 / `artifacts` 全链路就绪，唯一缺 `interrupt({kind:'plan_confirm', artifacts})` 的发射者 → **事后复核门缺失**。

### 能力层

3. **无"自动升级到人工"**：`ESCALATE` 仅 advisory，第二阶段设计亦为直接结束而非转人工。
4. **无角色化权限**：无 `approver_role`、双人复核、审批配额、代审批；`sensitive_tools` 全局单值。
5. **Scope / Constraints 两个澄清维度完全空白**；**Freshness 无澄清入口**（仅 Planner 侧 `providesRealtimeData` 间接约束）。

### 工程层

6. **`memory` checkpointer 下暂停态不跨进程**（重启/多实例失效），已有显式告警但默认未改 `sqlite`（`@langchain/langgraph-checkpoint-sqlite` 与 `better-sqlite3` 未安装）。
7. **暂停标记为单值而非按会话 Map**：极端并发下（会话 A 暂停期间在新会话再次触发暂停）A 的标记会被覆盖，此时点 A 的答复会得到**可见错误提示**（非静默失败），切回 A 重新发起即可。
8. **web 侧接线缺口**：未实现 `setGlobalError` / `trackAnswered|Skipped|Expired` / `getSessionRuntime`；`sensitive` 徽标与 `index/total` 队列序号 prop 未传 → 高危徽标、队列进度不显示，澄清灰度观测数据在 web 缺口（desktop 有 `clarify-metrics`）。
9. **前端超时依赖 15s 轮询**（无服务端推送通道）；`getState` 持续抛错时静默保持现状，**不主动收敛**。
10. **desktop 回退组件已失效**：`components/hitl/*Dialog.tsx` 与恒 `null` 的 `HitlHost.tsx` 无生产渲染路径，修改它们无效（真正开关在 `ChatArea → InputArea` 的 `pro-input-hitl-panel`）。

---

## 附录 A：关键文件与符号索引

### packages/modu-agent（内核）

| 文件 | 关键符号 | 行号 |
|---|---|---|
| `src/perception/clarity-detector.ts` | `ClarifyDecision` / `ClarityDetectionResult` / `DEFAULT_HIGH_IMPACT_KEYWORDS` / `assessClarificationNeed` / `assessClarificationCoarse` / `detectClarification` / `isHighImpactInput` / `CLARITY_JUDGE_PROMPT` / `llmJudgeClarity` | `41-60` / `63-79` / `114-154` / `163-189` / `314-400` / `90-100` / `195-204` / `231-269` |
| `src/graph/nodes.ts` | `makeHumanReviewNode` / `routeAfterHumanReview` / `makeClarifyNode` / `_decideToolApprovalsViaPolicy` / `_shouldPublishApprovalRequired` | `2031-2304` / `2313-2323` / `2350-2450` / `1961-1996` / `1999-2017` |
| `src/graph/runner.ts` | `resume_sync` / `resume_stream` / `INTERRUPT_NODE_NAMES` / `NODE_DEFAULT_KIND` / `extractInterruptValue` / `resolveInterruptKind` / `get_interrupt_state` / `checkInterruptTimeout` / `sweepExpiredInterrupts` | `938-1062` / `1077-1154` / `1162` / `1165-1168` / `1179-1193` / `1196-1208` / `1225-1282` / `1307-1438` / `1451-1468` |
| `src/graph/graph.ts` | `perceptionRouter` / `human_review` 节点 spec / `clarify` 节点 spec / HITL 条件边 | `519-527` / `599-604` / `605-612` / `647-664, 728-752` |
| `src/graph/spec.ts` | `computeRecursionLimit`（HITL 预算） | `448-457` |
| `src/graph/state.ts` | HITL 状态字段 / Annotation / 初值 / `HITLModeState` | `100-114` / `267-287` / `478-488` / `582-597` |
| `src/graph/factory.ts` | `build_checkpointer` / `_sharedMemoryCheckpointer` / 能力边界告警 | `171-230` / `91` / `212-227` |
| `src/tools/tool-guardrails.ts` | `ACTION_GUARDRAILS` / `checkGuardrail` / `toolRequiresApproval` / `decideToolApprovals` | `61-108` / `176-251` / `319-347` / `388-437` |
| `src/core/interfaces/action.ts` | `requiresApproval` / `requiresApprovalFor` / `onApprovalRejected` / `providesRealtimeData` | `39-41` / `56-61` / `67-73` / `92-94` |
| `src/core/interfaces/policy.ts` | `PolicyEffect` / `ToolApprovalDetail` / `PolicyDecision` / `PolicyRule` / `PolicyEngine` | `77` / `86-93` / `96-111` / `118-130` / `141-159` |
| `src/perception/security/policy-rules.ts` | `ToolApprovalPolicyRule` / `registerDefaultPolicyRules` | `58-98` / `317-336` |
| `src/orchestration/communication/agui-adapter.ts` | `AGUIEventType` / `UserQuestionRequestPayload` / `_process_interrupt_event` / 中断探测 | `43-47` / `69-86` / `1526-1606` / `1129-1136, 1143-1152` |
| `src/config/runtime-config.ts` | `tools.human_in_loop` 默认值 / `perception.clarification` 默认值 | `143-148` / `268-307` |
| `src/config/capability-registry.ts` | `clarification` 能力登记 | `62-89` |
| `src/graph/termination-engine.ts` | `TerminationAction('ESCALATE')` / 升级判定 | `28-32` / `330-335` |

### packages/agent-protocol（web 协议层）

| 文件 | 关键符号 |
|---|---|
| `src/types.ts` | `HitlKind` / `UserQuestionRequestPayload` / `ResumeRequest` / `AbortRequest` / `HitlStateResponse` / `HitlStatus` / `HitlItem` / `HitlResolveInput` |
| `src/hitlStore.ts` | `useHitlStore`（`enqueue/dequeue/resolve/dismiss/skip/recover/refresh`）、`itemKey`、`HITL_STATE_POLL_MS` |
| `src/host.ts` | `HitlHost`（DI 契约）、`bindHitlHost` / `getHitlHost` |
| `src/hitl-bridge.ts` | `bindHitlStore` / `getHitlStore` |
| `src/components/HitlInlineCard.tsx` | 内联卡（clarifying / choice） |
| `src/components/HitlToolConfirmBody.tsx` | 审批卡主体（工具列表 + JSON 改参） |
| `README.md` | 命名硬约束 + 新增 HITL 类别 5 步扩展指引 |

### apps/backend-ts（云端编排）

| 文件 | 关键符号 | 行号 |
|---|---|---|
| `src/routes/agent.ts` | `/completions` / `/completions/stop` / `/resume` / `/state/:threadId` / `/abort` / `/runs` / `/messages/:id/plan` / `/messages/:id/feedback` / `persistAssistantMessage` / `verifySessionOwner` | `317-544` / `548-563` / `570-729` / `731-764` / `766-820` / `824-859` / `867-903` / `985-1013` / `157-243` / `49-61` |
| `src/core/agent-bridge.ts` | `StreamContext` / `streamAgentCompletion` / `streamAgentResume` / `getPendingAgentState` / `collectMetadataFromEvent` / `startAgentRun` / `finishAgentRun` | `44-64` / `~100-200` / `259-296` / `306-335` / `430-527` / `593-613` / `620-677` |
| `src/core/agent-scheduler.ts` | `trackInterruptSession` / `sweepOnce` / `startInterruptScheduler` / `checkSessionInterrupt` | `26-28` / `41-59` / `62-69` / `80-85` |
| `src/schemas/agent.ts` | `AgentResumeRequestSchema` / `AgentAbortRequestSchema` | `123-135` / `138-142` |
| `src/routes/mcp.ts` | `GET /mcp/policy` / `PUT /mcp/policy` | `147-167` / `169-211` |
| `src/index.ts` | `startInterruptScheduler()` | `12` |

### apps/desktop（本地编排 + UI）

| 文件 | 关键符号 | 行号 |
|---|---|---|
| `src/shared/types.ts` | `UserQuestionRequestPayload` / `HitlArtifact` / `ResumeRequest` / `AbortRequest` / `HitlStateResponse` / `Message.paused` | `306-328` / `331-334` / `337-347` / `349-353` / `356-377` / `243-246` |
| `src/shared/ipc-channels.ts` | `AGENT_SEND/RESUME/ABORT/STATE/STOP/EVENT` | `70-76` |
| `src/main/agent-runtime.ts` | `resolveSessionGraph` / `validateResumeRequest` / `ensureSensitiveToolsRegistered` / `executeSend` / `executeResume` / `abortPending` / `getHitlState` / `abortRunsForSender` | `84-120` / `247-302` / `308-326` / `334-381` / `383-424` / `490-516` / `518-557` / `559-566` |
| `src/main/ipc-handlers.ts` | `AGENT_RESUME` / `AGENT_ABORT` / `AGENT_STATE` / `AGENT_STOP` / `isTrustedSender` | `695-710` / `712-729` / `731-744` / `746-756` / `~680` |
| `src/main/local-store.ts` | interrupt 暂停消息不落库约定 | `15-17` |
| `src/renderer/src/stores/hitlStore.ts` | `HitlStatus` / `HitlItem` / `HitlResolveInput` / `itemKey` / 队列动作 / `recover` / `refresh` | `31` / `34-51` / `57-65` / `71-77` / `129-213` / `215-283` / `285-305` |
| `src/renderer/src/stores/chatStore.ts` | `hitlPending` / `hitlPausedSessionId` / `selectIsHitlPaused` / `pauseStreamingMessage` / `resumeHitl` / `abortHitl` / `restoreHitlPause` / `finalizeHitlStale` | `131-141` / `81-84` / `308-349` / `1128-1277` / `1280-1315` / `1324-1359` / `1365-1385` |
| `src/renderer/src/services/api/agui.ts` | `onHumanInputRequest` / `onRunPaused` / `onHitlAborted` / `TERMINAL_AGUI_EVENTS` / dispatcher | `70-76` / `126-131` / `144`, `283-315` |
| `src/renderer/src/services/stream-handler.ts` | `paused` 状态位 / 三个 HITL 回调 | `99-101` / `588-615` |
| `src/renderer/src/services/api/agent.ts` | `resumeStream` / `abortHitl` / `getHitlState` | `103-105` / `108-114` / `117-120` |
| `src/renderer/src/services/transport/` | `AgentTransport` 接口 / `http-transport` / `ipc-transport` / 模式解析 | `types.ts:27-66` / `http-transport.ts:23-50` / `ipc-transport.ts:76-158` / `index.ts:24-97` |
| `src/renderer/src/components/chat/input/InputArea.tsx` | `HitlToolConfirmPanel` / HITL 渲染分支 / 提交路径 | `295-471` / `1112-1235` / `~892-905` |
| `src/renderer/src/components/chat/ChatArea.tsx` | HITL 订阅与回调映射 | `58-68` / `127-180` |
| `src/renderer/src/components/chat/MessageBubble.tsx` | `HitlPausedHeader` | `62-90` / `167-171` |
| `src/renderer/src/services/clarify-metrics.ts` | `trackClarifyTriggered/Answered/Skipped/Expired` / `getClarifyMetrics` | `115-172` |
| `src/renderer/src/components/hitl/` | `HitlHost`（恒 null）/ 三 Dialog（无挂载点） | `HitlHost.tsx:27-30` |

### apps/web（UI）

| 文件 | 关键符号 | 行号 |
|---|---|---|
| `src/lib/parseAguiStream.ts` | `AguiStreamHandlers` / `TERMINAL_AGUI_EVENTS` / `parseAguiStream` / HITL 事件分支 | `29-62` / `72-77` / `96-274` / `166-176` |
| `src/api/agent.ts` | `streamResume` / `fetchHitlState` / `abortAgentHitl` | `83-98` / `103-105` / `110-115` |
| `src/lib/agent-host.ts` | `bindHitlHost` / `AgentModeRuntime` | `33-45` / `18-24` |
| `src/modes/pro/hooks/useAgentChat.ts` | `payloadToHitlInput` / HITL handlers / `resumeHitl` / `restoreHitlPause` / `finalizeHitlStale` / `bindAgentModeRuntime` | `59-72` / `311-336` / `485-526` / `566-582` / `585-595` / `598-607` |
| `src/modes/task/hooks/usePlanExecuteChat.ts` | HITL handlers（含 `setHitlLock`）/ `resumeHitl` | `151-174` / `292-333` |
| `src/store/planExecuteStore.ts` | `hitlLocked` / `applyPlanDelta` 守卫 / `toggleStep` 守卫 | `71-72` / `105-106` / `167-168` |
| `src/modes/pro/components/AnalysisInput.tsx` | HITL 卡渲染 | `116-148` |
| `src/modes/task/components/TaskInput.tsx` | HITL 卡渲染 | `101-133` |
| `src/components/more-menu/McpSection.tsx` | 工具级审批开关 | `112-123` / `216-218` |

### packages/evals（评测）

| 文件 | 关键符号 |
|---|---|
| `src/clarification-eval.ts` | `runClarificationEval` / `checkClarifyGate` / `CLARIFY_GATE`（precision/recall 门禁） |
| `data/cases/clarification.yaml` | `expect_clarify` / `expect_no_clarify` / `short-command` / `llm-required` 用例标签 |

---

## 附录 B：配置项速查

### tools.human_in_loop（工具审批）

| 配置键 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `false` | 总开关；关闭时 `human_review` 节点不存在 |
| `approval_timeout_seconds` | `300` | 审批超时秒数；`<=0` 禁用超时检查 |
| `auto_reject_on_timeout` | `true` | 超时是否自动拒绝（`false` 时仅标记 `expired`） |
| `sensitive_tools` | `['code_executor', 'sql_query', 'file_ops_write']` | 敏感工具名单（`PUT /mcp/policy` 可改） |

### perception.clarification（需求澄清）

| 配置键 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `false` | 总开关；关闭时 `clarify` 节点不存在，零回归 |
| `max_clarify_rounds` | `2` | 澄清轮次上限（防无限追问） |
| `min_input_chars` | `10`（`init-defaults` 落盘 `3`） | 短输入阈值 |
| `insufficient_patterns` | 7 条模糊短语 | 语义模糊短语（确定性信号） |
| `question_template` | "你的需求还不太明确，方便补充一下具体想做什么吗？" | LLM 不可用时的兜底问题 |
| `default_options` | `[]` | 静态候选选项（空 = 纯自由文本） |
| `timeout_seconds` | `120` | 澄清超时（独立于审批超时）；`<=0` 禁用 |
| `on_timeout` | `'continue_with_defaults'` | 超时策略；另一值为 `'abort'` |
| `use_llm` | `false` | 是否用 LLM 润色澄清问题（失败回退模板） |
| `llm_judge.enabled` | `false` | 是否启用 LLM 复判（语义歧义兜底） |
| `llm_judge.clarity_threshold` | `0.4` | 低于此分触发澄清 |
| `llm_judge.max_input_chars` | `60` | 仅对该长度内的输入复判 |
| `high_impact_only` | `false` | 高影响门控（防打扰） |
| `high_impact_keywords` | `[]`（空 = 用内置默认集） | 高影响关键词 |

### 其它相关开关

| 配置键 | 默认值 | 说明 |
|---|---|---|
| `react_optimization.action_guardrails.enabled` | `false` | guardrail 判定总开关 |
| `react_optimization.action_guardrails.dry_run_enabled` | `true` | guardrail 预检模式 |
| `policy.engine.enabled` | `false` | 统一策略引擎（`ToolApprovalPolicyRule` 委派） |
| `memory.checkpointer_type` | `'memory'` | HITL 持久化载体；生产建议 `'sqlite'` |
| `memory.checkpointer_max_threads` | `100` | `BoundedMemorySaver` LRU 上限 |
| `memory.sqlite_path` | `'checkpoints.db'` | sqlite 检查点文件路径 |
| `llm.max_reasoning_iterations` | `3` | 参与 `computeRecursionLimit` 计算 |
| `plan_execute.max_steps` / `max_replans` | `10` / `2` | 参与 Plan-Execute 递归预算 |

---

> **报告结束。** 如需针对某一环节（例如"事后复核门 `plan_confirm` 的落地设计"或"Scope/Constraints 澄清维度扩展方案"）继续深入，可基于本报告的缺口清单直接展开。
