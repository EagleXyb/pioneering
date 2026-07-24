# 技术问题与解决方案总结

> 本文档系统化总结 modu-agent 在 plan-execute 模式调试过程中发现的技术问题、根因分析与分类归档。

---

## 问题 1：Plan 输出缺少 requires_tool 字段

### 问题描述

执行 plan-execute 模式时，LLM 生成的 plan 中所有步骤都没有 `requires_tool` 字段，导致后续 `step_finalize` 的工具调用校验逻辑（`requiresTool && toolRefs.length === 0`）永远不触发，无法识别"应该调用工具但未调用"的违规步骤。

### 根本原因分析

[planner.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/planner.ts) 的 `_parsePlan` 函数在使用 `PlanSchema.safeParse` 成功解析 LLM 输出的 JSON 后，通过 `steps.map()` 重新构造步骤对象，但 map 回调中**只显式复制了 `step_id`、`title`、`description`、`depends_on`、`status` 这 5 个字段，遗漏了 `requires_tool`**。即使 LLM 按提示词输出了 `"requires_tool": true`，且 zod 校验通过，最终写入 `state.plan` 的步骤对象中也不存在该字段。

### 问题分类

**逻辑问题** — 数据转换过程中的字段丢失，属于代码实现层面的疏漏。

---

## 问题 2：LLM 声明"无法联网"而非调用 search_engine 工具

### 问题描述

在 plan-execute 模式下执行"获取北京今日天气"步骤时，LLM 没有调用 `search_engine` 工具获取实时数据，而是直接输出"由于我无法实时联网获取最新的天气数据，我无法提供北京今日精确的实时天气信息"，并基于参数化记忆编造天气数据。

### 根本原因分析

三个因素叠加导致：

1. **防幻觉 prompt 第 2 条提供逃生路径**：`_DEFAULT_ANTI_HALLUCINATION_PROMPT` 原第 2 条为"If no tool is available for the requested real-time data, explicitly state 'I don't have real-time data access for this'"。LLM 在不确定是否应该调工具时，把"声明无法获取"当作合规路径而非冒险调工具。
2. **requires_tool 字段未生效（问题 1 连锁）**：`context.ts` 的 `makePlanContextInjector` 本应在 `requires_tool=true` 时追加 "MUST call a tool" 强约束，但由于 `_parsePlan` 丢弃了该字段，强约束从未被注入。
3. **planner 描述未硬性指定工具名**：`prompts.ts` 虽要求 planner 在 description 中引用工具，但这是软约束，弱模型（如 GLM-4-flash）可能不遵守。

### 问题分类

**架构问题** — 防护机制设计存在逃生路径，提示词约束力不足，属于架构层面的防护缺口。

---

## 问题 3：内容重复输出 3 次

### 问题描述

执行 4-5 步的 plan 时，step_1/step_2/step_3 三步输出了几乎相同的"无法联网 + 天气状况 + 穿衣建议"内容，step_4 才输出不同的"出行建议"。

### 根本原因分析

四个相互叠加的因素：

1. **messages 状态在步骤间全量累积（最核心）**：`makeAgentNode` 每次都从 `state.messages` 读取全部消息（使用 `messagesStateReducer` 追加语义）。LLM 在 step_2 看到自己的 step_1 输出，加上 step_2 描述相似，就会复制前一步的输出。
2. **planContextInjector 摘要二次回灌**：`context.ts` 把前序步骤的 output 拼成 `Completed steps summary` 注入 SystemMessage，在已有 messages 累积基础上又显式提炼一遍，进一步诱导重复。
3. **requires_tool 未生效（问题 1 连锁）**：step_1 未调用工具但被判 done，没有触发重规划，继续推进到 step_2/step_3 重复执行。
4. **planner 拆分了语义高度相似的步骤**：planner 把一个本应单步完成的任务拆成多个语义重叠的步骤。

### 问题分类

**架构问题** — 状态管理设计导致上下文膨胀，叠加防护机制失效，属于状态管理与上下文传递的架构缺陷。

---

## 问题 4：GraphRecursionError 递归上限耗尽

### 问题描述

agent 在 plan-execute 模式下陷入工具调用死循环，反复调用 `datetime`（成功）和 `search_engine`（fetch failed）直到触发 `GraphRecursionError: Recursion limit of 25 reached without hitting a stop condition`。

### 根本原因分析

四个缺陷叠加导致：

1. **recursionLimit 配置失效**：`graph.ts` 在 compile 后设置 `compiledAny.recursionLimit`（理论值 131），但 `runner.ts` 调用 `graph.stream(state, lgConfig)` 时 `lgConfig` 不含 `recursion_limit`。LangGraph JS 运行时优先使用 `RunnableConfig.recursion_limit`，回退到默认值 25。
2. **无单步工具调用上限**：`routeAfterAgent` 只看最后一条消息是否有 `tool_calls`，无任何计数器或上限机制。`state.iteration` 是"死字段"（定义了但无人写入）。LLM 在 ReAct 循环中无限重试失败工具。
3. **step_finalize 不识工具失败**：`toolRefs` 只看 ToolMessage 是否存在，不看其内容/状态。datetime 成功 + search_engine 失败时 `toolRefs.length > 0`，判 done 不触发重规划。
4. **process_tool_results 硬编码 success**：所有 ToolMessage 都被硬编码标记为 `status: 'success'`，不读取工具返回 JSON 中的 `status`/`error_code` 字段。即使工具返回 error，processor 仍标记为 success。

### 问题分类

**系统缺陷** — 多层防护机制缺失（配置传递失效 + 循环上限缺失 + 失败识别缺失），属于系统级健壮性缺陷。

---

## 问题 5：Branch condition returned unknown or null destination

### 问题描述

修复问题 4 后，agent 执行时抛出 `Error: Branch condition returned unknown or null destination`，图执行异常终止。

### 根本原因分析

[planner.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/planner.ts) 的 `routeAfterPlan` 函数返回了**节点名** `'finalize_response'`，而 LangGraph 条件边要求返回 **path map 的 key** `'response'`：

```typescript
// graph.ts 第 318 行 path map
{ step_dispatch: 'step_dispatch', response: 'finalize_response' }
```

当 planner 解析失败降级直答时，`routeAfterPlan` 返回 `'finalize_response'`，LangGraph 在 path map 中找不到这个 key，报错。

**为什么之前没触发**：这个 bug 一直存在，但只在 planner 降级路径触发。问题 4 的 `allToolsFailed` 修改导致更多步骤判 failed → 更多重规划 → planner 二次调用 → 解析失败时走降级路径 → 触发此 bug。

### 问题分类

**逻辑问题** — LangGraph 条件边路由函数返回值与 path map key 不匹配，属于 API 使用约定违反。

---

## 问题关联性说明

上述 5 个问题存在强关联链：

```
问题 1（requires_tool 字段丢失）
  ├── 连锁导致 → 问题 2（LLM 不调工具，因强约束未注入）
  ├── 连锁导致 → 问题 3（step_1 未判 failed，重复执行）
  └── 间接导致 → 问题 4（修复 1/2/3 后引入 allToolsFailed → 触发更多重规划）
       └── 间接导致 → 问题 5（重规划导致 planner 降级路径被触发）

问题 4（GraphRecursionError）
  └── 修复后暴露 → 问题 5（routeAfterPlan 返回值 bug）
```

**核心启示**：问题 1 是所有连锁反应的上游根因。在修复时，应优先修复上游根因，再观察下游问题是否自动消失，避免过度修复引入新问题（如问题 4 的修复间接暴露了问题 5）。

---

## 问题 6：INVALID_TOOL_RESULTS — 孤立的 tool_calls 导致 LLM API 400 错误

### 问题描述

修复问题 4（GraphRecursionError）后，agent 在 plan-execute 模式下执行工具调用时抛出 `400 An assistant message with 'tool_calls' must be followed by tool messages responding to each 'tool_call_id'`，图执行异常终止。执行日志显示：step_1（datetime）成功，step_2（search_engine）连续两次 fetch failed 后触发了重规划，随后抛出 400 错误。

### 根本原因分析

[routeAfterAgent](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts#L341) 函数中，问题 4 修复时新增的"单步工具调用上限"逻辑存在致命缺陷：

```typescript
// 问题 4 修复时新增的代码（已移除）
if (state.plan_phase === 'executing' && lastMsg.tool_calls && ...) {
  if (aiMsgCount >= maxIterations) {
    return 'step_finalize'  // ← BUG: 此时 lastMsg 有 tool_calls 但 tools 节点未执行
  }
}
```

当 LLM 输出带 `tool_calls` 的 AIMessage 且已达迭代上限时，路由函数直接返回 `'step_finalize'`，**跳过了 `tools` 节点的执行**。这导致 `state.messages` 中存在一条带 `tool_calls` 的 AIMessage，但没有对应的 ToolMessage 响应每个 `tool_call_id`。

后续流程 `step_finalize → step_dispatch → planner（重规划）→ step_dispatch → agent` 中，agent 节点读取全量 `state.messages` 发送给 LLM API，LLM API 检测到 messages 序列中存在"孤立的 tool_calls"（AIMessage 有 tool_calls 但后续无对应 ToolMessage），返回 400 错误。

**核心约束**：LangChain/LLM API 要求 messages 序列中每条带 `tool_calls` 的 AIMessage **必须**紧跟对应的 ToolMessage（每个 `tool_call_id` 一条）。跳过工具执行会破坏 messages 的完整性约束。

### 问题分类

**逻辑问题** — 路由函数在工具调用未完成时强制跳转，违反了 LangChain messages 序列完整性约束。属于修复过程中引入的回归缺陷（问题 4 修复的副作用）。

### 修复方式

移除 `routeAfterAgent` 中的单步工具调用上限检查，恢复原始路由逻辑（有 tool_calls → tools，无 tool_calls → step_finalize/__end__）。工具调用循环防护由以下已有机制保证：

1. **recursion_limit=131**（问题 4 修复 1）：全局递归上限兜底
2. **allToolsFailed 判定**（问题 4 修复 3）：工具全部失败时 step_finalize 判 failed → 触发重规划
3. **max_replans=2**：重规划次数上限，耗尽后终止

### 教训

在条件路由函数中，**绝不能在有 tool_calls 时跳过 tools 节点**。LangChain 的 messages 状态遵循严格的不变量：每条带 tool_calls 的 AIMessage 必须有对应的 ToolMessage。任何路由逻辑修改都必须尊重此约束。

---

## 问题 7：recursion_limit 配置键名错误 — LangGraph JS 使用 camelCase 而非 snake_case

### 问题描述

问题 4 修复后，`_withRecursionLimit` 函数已将递归限制注入到 stream 调用的 config 中，但 agent 仍持续抛出 `GraphRecursionError: Recursion limit of 25 reached without hitting a stop condition`。日志显示图构建时计算的 `recursionLimit` 为 131（正确），但运行时仍使用默认值 25。

### 根本原因分析

[runner.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts) 的 `_withRecursionLimit` 函数使用了 **snake_case** 键名 `recursion_limit` 注入配置：

```typescript
// 修复前（错误）
return { ...lgConfig, recursion_limit: limit }
```

这是从 Python 版 LangGraph 迁移时遗留的约定差异。**LangGraph JS 使用 camelCase `recursionLimit`** 作为 RunnableConfig 的键名，与 Python 版的 snake_case `recursion_limit` 不同。

证据链（`@langchain/langgraph` 源码）：

1. **`pregel/utils/config.js`**：`ensureLangGraphConfig` 维护一个白名单键列表，仅保留 `recursionLimit`（camelCase），snake_case 键不在白名单中被丢弃：
   ```javascript
   const DEFAULT_RECURSION_LIMIT = 25;
   // 白名单包含: ..., "recursionLimit", "configurable", ...
   ```
2. **`pregel/loop.js`**：运行时从 config 读取 camelCase 键：
   ```javascript
   const stop = step + (config.recursionLimit ?? DEFAULT_LOOP_LIMIT) + 1;
   ```
3. **`pregel/index.js`**：`CompiledStateGraph.stream()` 方法构建 config 时也使用 camelCase：
   ```javascript
   const config = { recursionLimit: this.config?.recursionLimit, ...options };
   ```

由于 `recursion_limit`（snake_case）不在 `ensureLangGraphConfig` 的白名单中，该键在配置合并时被丢弃，运行时回退到 `DEFAULT_RECURSION_LIMIT = 25`。即使 `_withRecursionLimit` 正确读取了图上的 `recursionLimit = 131`，写入 config 时用错了键名，导致值丢失。

### 问题分类

**系统缺陷** — Python → JavaScript 跨语言迁移中的 API 约定差异（snake_case vs camelCase）未被识别，属于跨语言移植缺陷。

### 修复方式

将 `_withRecursionLimit` 中的键名从 `recursion_limit` 改为 `recursionLimit`：

```typescript
// 修复后（正确）
return { ...lgConfig, recursionLimit: limit }
```

### 教训

在跨语言移植（尤其是 Python → JavaScript）时，**必须核实 API 约定的差异**。Python LangGraph 使用 snake_case 键名（`recursion_limit`），而 JavaScript LangGraph 使用 camelCase（`recursionLimit`）。`ensureLangGraphConfig` 的白名单机制会静默丢弃不在白名单中的键，不会报错——这使得此类 bug 极难通过日志发现，只能通过阅读库源码定位。

### 全面排查记录（问题 7 修复后）

为确认同样的跨语言键名差异是否存在于其他地方，对 `packages/modu-agent/src` 全量源码进行了系统性排查，结果如下：

**LangGraph RunnableConfig 白名单键**（`pregel/utils/config.js` 定义，全 camelCase）：
`tags`, `metadata`, `callbacks`, `runName`, `maxConcurrency`, `recursionLimit`, `configurable`, `runId`, `outputKeys`, `streamMode`, `store`, `writer`, `interruptBefore`, `interruptAfter`, `signal`

排查方式：搜索所有在配置对象字面量中使用 snake_case 等价键（`recursion_limit`, `run_name`, `max_concurrency`, `run_id`, `output_keys`, `stream_mode`, `interrupt_before`, `interrupt_after`）的代码。

**排查结论**：

| 类别 | 检查项 | 结论 |
|------|--------|------|
| LangGraph config 顶层键 | `recursion_limit` 等 snake_case 键传递给 `graph.stream()` | ✅ 仅 `runner.ts` 一处（已修复为 `recursionLimit`），无其他实例 |
| LangChain message 属性 | `tool_calls`, `tool_call_id`, `invalid_tool_calls`, `tool_call_chunks`, `usage_metadata` | ✅ LangChain JS 通过 `lc_aliases` 官方保留 snake_case，代码使用正确 |
| MCP 工具属性 | `input_schema` / `inputSchema` | ✅ `discovery.ts` 采用防御性双向兼容（`raw.inputSchema ?? raw.input_schema`），正确 |
| AGUI 协议字段 | `run_id`, `thread_id`, `tool_call_id` | ✅ AGUI 协议规范使用 snake_case，输出时已转 camelCase（`threadId`, `runId`, `toolCallId`），正确 |
| `configurable` 内部键 | `system_prompt`, `plan_execute_enabled`, `llm_provider`, `max_tokens` 等 | ✅ `configurable` 是用户自定义命名空间，不受 LangGraph 白名单限制，`factory.ts` / `agent-bridge.ts` / `nodes.ts` 读写一致，正确 |
| checkpointer 配置 | `configurable: { thread_id: sessionId }` | ✅ `thread_id` 在 `configurable` 内部，是 LangGraph checkpointer 约定的读取路径，正确 |
| 注释/日志文本 | `recursion_limit=%d` 等出现在日志格式串或注释中 | ✅ 无害文本，不影响功能 |

**最终结论**：除已修复的 `runner.ts` `_withRecursionLimit` 外，**未发现其他** Python → JavaScript 跨语言迁移导致的键名约定差异问题。LangChain JS 在 message 属性上故意保留 snake_case（通过 `lc_aliases` 机制声明不转换），与 LangGraph config 键的 camelCase 约定不同——这是两个独立的约定，代码中对两者的使用均正确。

---

## 问题 8：missingToolCall 误判 — 前序步骤已获取工具结果时当前步骤不应判 failed

### 问题描述

执行 plan-execute 模式时，步骤"获取当前日期和时间"（requires_tool=true）被 `step_finalize` 判定为 failed，错误信息为：`Step "获取当前日期和时间" requires tool invocation (requires_tool=true) but no tool was called`。该误判触发重规划，重规划后同样情况重复，最终递归耗尽或重规划预算耗尽。

### 根本原因分析

[dispatcher.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/dispatcher.ts) 的 `step_finalize` 节点中，`missingToolCall` 判定逻辑为：

```typescript
const missingToolCall = requiresTool && toolRefs.length === 0
```

`toolRefs` 仅从**当前步骤的增量消息**（`step_msg_baseline` 之后）中提取。但实际执行中，LLM 在 step_1（获取天气）时同时调用了 datetime（成功）和 search_engine（失败），datetime 的结果已累积在全局 `state.messages` 中。当 step_2（获取日期时间）执行时，LLM 看到 messages 中已有 datetime 结果，合理地不再重复调用，直接基于已有数据回答。

此时 step_2 的增量消息只有 AIMessage（无 ToolMessage），`toolRefs=[]`，`missingToolCall=true` → 判 failed → 触发重规划 → 同样情况 → 递归耗尽。

**核心缺陷**：`missingToolCall` 判定只看当前步骤的增量消息，忽略了前序步骤已获取的工具结果。对于"获取当前日期和时间"这类数据可能被前序步骤覆盖的步骤，会产生误判。

### 问题分类

**架构问题** — 步骤间的工具调用结果会累积在 messages 中，但 `step_finalize` 的失败判定只看当前步骤增量消息，未考虑跨步骤数据复用的合理场景。属于步骤隔离边界设计与失败判定逻辑的架构缺陷。

### 修复方式

在 `missingToolCall` 判定中增加例外：如果同代际前序步骤已成功调用工具（`step_results` 中存在 status='done' 且 tool_refs 非空的记录），且本步骤有实质性 AI 输出，则不判 failed：

```typescript
let missingToolCall = missingToolCallRaw
if (missingToolCallRaw && lastAiContent) {
  const genResults = _currentGenerationResults(state)
  const prevStepHasToolSuccess = genResults.some(
    (r) => r?.['status'] === 'done' &&
           Array.isArray(r?.['tool_refs']) &&
           r['tool_refs'].length > 0,
  )
  if (prevStepHasToolSuccess) {
    missingToolCall = false
  }
}
```

**防幻觉能力保留**：真正的幻觉场景（LLM 完全没调任何工具且前序步骤也没有工具调用）仍会被 `missingToolCall` 拦截，因为前序步骤无 `tool_refs` 时例外不生效。

### 教训

在多步骤执行计划中，**步骤间的数据复用是合理的执行行为**。失败判定逻辑不能仅基于当前步骤的增量消息，必须考虑前序步骤的工具结果是否已提供所需数据。`requires_tool` 的语义应是"这个步骤需要外部数据"，而非"这个步骤必须自己调用工具"——如果前序步骤已获取该数据，当前步骤基于已有结果回答是合理的。

---

## 问题 9：replan_count 永不递增 — isReplan 检测的鸡生蛋问题导致无限重规划循环

### 问题描述

agent 在 plan-execute 模式下执行时，当 `search_engine` 工具持续失败（fetch failed），触发步骤失败 → 重规划 → 同样失败 → 再重规划的**无限循环**。日志中出现了 10+ 次重新规划，每次都生成相似的 6 步计划，但 `max_replans=2` 配置从未生效。

### 根本原因分析

[planner.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/planner.ts#L152-L153) 的 `isReplan` 检测逻辑存在**鸡生蛋问题**：

```typescript
// 修复前（错误）
const replanCount = state.replan_count ?? 0  // 初始 0
const isReplan = replanCount > 0              // 永远 false（因为 replanCount 从未递增）
// ...
replan_count: isReplan ? replanCount + 1 : replanCount,  // 永远返回 0
```

执行流程：
1. **首次规划**：`replanCount = 0`，`isReplan = false` → 返回 `replan_count: 0`
2. **步骤失败** → `stepDispatch` 检查 `replan_count = 0`，`0 < 2` → 路由到 planner
3. **第二次规划（重规划）**：`replanCount = 0`（仍然是 0！），`isReplan = false` → 返回 `replan_count: 0`
4. **步骤再次失败** → `stepDispatch` 检查 `replan_count = 0`，`0 < 2` → 再次路由到 planner
5. **无限循环**

**双重缺陷**：
- `replan_count` 永远是 0 → `max_replans` 上限永远不触发
- `replanContext`（失败步骤原因注入）依赖 `isReplan`，永远是空字符串 → planner 不知道前序失败原因 → 生成相同的计划 → 同样失败

### 问题分类

**逻辑问题** — 状态计数器的递增条件依赖自身值，形成循环依赖。属于状态机设计中的初始状态检测缺陷。

### 修复方式

将 `isReplan` 的检测信号从 `replanCount > 0`（依赖自身递增）改为 `existingPlan.length > 0`（依赖独立的状态信号）：

```typescript
// 修复后（正确）
const existingPlan = state.plan ?? []
const isReplan = existingPlan.length > 0
const newReplanCount = isReplan ? replanCount + 1 : replanCount
```

**正确性验证**：
- 首次规划：`state.plan = []` → `isReplan = false` → `newReplanCount = 0` ✅
- 第 1 次重规划：`state.plan = [old plan]` → `isReplan = true` → `newReplanCount = 1` ✅
- 第 2 次重规划：`state.plan = [new plan]` → `isReplan = true` → `newReplanCount = 2` ✅
- `stepDispatch` 检查 `2 < 2` = false → 路由到 response（终止）✅

**附带修复**：`replanContext` 现在能正确注入失败步骤信息，planner 可以基于失败原因调整计划（如换用 `http_request` 替代失败的 `search_engine`）。

### 教训

状态计数器的递增条件**绝不能依赖计数器自身的值**，否则会形成循环依赖导致计数器永远不递增。检测"是否为首次调用"应使用独立的状态信号（如"是否已有现存计划"），而非计数器值。这是状态机设计的基本原则：状态转移条件应基于可观测的独立状态，而非自引用的计数器。

---

## 问题 10：工具失败 ≠ 步骤失败 — 降级输出被误判为失败触发无意义重规划

### 问题描述

agent 执行"查询北京今日天气"步骤时，`search_engine` 工具因网络故障（fetch failed）连续失败 3 次。LLM 基于工具失败状态生成了合理的降级回应："搜索服务暂时不可用，基于气候常识提供参考..."。但 `step_finalize` 仍将此步骤判定为 failed，触发重规划。重规划后仍使用相同 `search_engine` → 同样失败 → 再次重规划，直到 `max_replans` 耗尽。最终用户的降级输出在重规划过程中被丢失。

### 根本原因分析

[dispatcher.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/dispatcher.ts#L247) 的 `allToolsFailed` 判定逻辑将"工具全部失败"等同于"步骤失败"：

```typescript
// 修复前（错误）
const allToolsFailed = requiresTool && toolRefs.length > 0 && failedToolRefs.length === toolRefs.length
const failed = missingToolCall || allToolsFailed || noOutput
```

当 search_engine 失败 3 次后：
- `toolRefs = [id1, id2, id3]`，`failedToolRefs = [id1, id2, id3]`
- `allToolsFailed = true` → `failed = true` → 步骤标记 failed
- `stepDispatch`：`lastFailed=true` → 路由到 planner（重规划）
- 重规划清空 `step_results` → **LLM 的降级回应被丢失**
- 重规划生成相似计划 → 同样工具失败 → 同样判 failed → 无限循环（受 max_replans 限制后终止）

**核心缺陷**：忽略了 LLM 在工具失败后可能已生成**有用的降级内容**。工具失败是基础设施问题（网络故障），重规划不会改变结果，只是浪费预算并丢失降级输出。

### 问题分类

**架构问题** — 步骤失败判定逻辑未区分"工具失败"与"步骤失败"两种语义。工具是获取数据的手段，步骤是完成目标单元；手段失败不等于目标失败，尤其当 LLM 已基于失败状态生成降级回应时。

### 修复方式

引入"降级模式"判定：工具全部失败但 LLM 有实质性降级输出时，步骤判 done（degraded），不再触发重规划：

```typescript
// 修复后（正确）
let allToolsFailed = allToolsFailedRaw
let degraded = false
if (allToolsFailedRaw && lastAiContent) {
  allToolsFailed = false
  degraded = true  // 标记降级模式
}
```

在 `stepResult` 中记录降级标记，便于后续步骤感知：

```typescript
if (degraded) {
  stepResult['degraded'] = true
  stepResult['error'] = '... tools all failed but AI produced fallback content ...'
}
```

**修复后的执行流程**：
1. step_2（查询天气）：search_engine 失败 3 次 + LLM 降级回应 → `degraded=true` → status=done
2. `stepDispatch`：`lastFailed=false` → 路由到 agent（继续下一步）
3. step_3（总结天气）：基于 step_2 的降级输出继续执行
4. 最终输出包含降级说明，用户明确知道数据来源是气候常识参考

**保留的失败路径**：工具全部失败且 LLM 无任何输出 → 仍判 failed → 触发重规划（换用 http_request 等替代工具）。

### 教训

**工具失败 ≠ 步骤失败**。工具是获取数据的手段，步骤是完成目标的单元。当工具失败时：
1. 如果 LLM 已生成降级回应（告知用户工具不可用 + 提供参考信息），这是合理的执行行为，应判 done（降级模式）
2. 如果 LLM 无输出，才判 failed，触发重规划换用替代工具

将工具失败等同于步骤失败会导致：无意义重规划（相同工具仍会失败）+ 降级输出丢失 + 用户体验下降（从"有参考信息"变成"什么都没有"）。正确的架构应区分"数据获取手段失败"与"目标完成失败"，允许 LLM 在工具不可用时合理降级。
