# `apps/desktop` 任务指令流转与事件通信链路分析

> 分析对象：`apps/desktop`（Electron 前端 + 主进程）如何通过后端 `apps/backend-ts` 对接 `packages/modu-agent`，并渲染推理过程中的「思考 / 工具调用 / 观察」等事件。

## 一、整体链路（指令 → 推理 → 渲染）

```
InputArea (输入框)
  → chatStore.sendMessage()                      // stores/chatStore.ts:255
  → agentService.sendMessageStream()             // services/api/agent.ts
  → streamAgui(url='/agent/completions', ...)    // services/api/agui.ts:69
  → apiClient.stream()  ── HTTP POST SSE ──▶  backend-ts :8088
        │
        ▼  routes/agent.ts:275  POST /agent/completions
     streamAgentCompletion()                     // core/agent-bridge.ts:77
        → create_agent() + stream_response()     // @pioneering/modu-agent
        → AGUIStreamAdapter.transform_langgraph_events()  // 把 LangGraph 事件转 AG-UI 事件
        → reply.raw.write(`data: ${eventDict.data}\n\n`)  // routes/agent.ts:369 透传 SSE
        │
        ▼  (SSE 回流)
  agui.ts 解析 SSE → AguiStreamCallbacks          // services/api/agui.ts:134 switch
  → createStreamHandler 回调累积成 TraceNode 树    // services/stream-handler.ts
  → chatStore.onFlush → streamingTraceNodes       // chatStore.ts:348 (rAF 批量)
  → MessageList → MessageBubble                    // components/chat/MessageList.tsx:186
  → TraceTreeRenderer / TraceTextNode / TraceNodeView  // 中间栏渲染
```

**关键结论：主干链路（普通 ReAct 模式的「思考 / 工具调用 / 观察」）已完全打通**，但存在若干**未接通/断点**，主要集中在 **Plan-Execute 模式** 与 **历史状态恢复**。

---

## 二、三类事件如何在中间栏展示

推理事件的载体是前端自建的 **TraceNode 树**（`stream-handler.ts` 累积，`MessageBubble` 消费）。渲染分两条路径（`MessageBubble.tsx:126`）：`useTrace` 为真时走树形渲染（`TraceTreeRenderer` + `TraceTextNode`），否则回退到扁平的 `ThinkingBlock` + `ToolCallCard`。

| 事件类型（modu-agent 发出） | 前端解析 (`agui.ts`) | 树节点 (`stream-handler.ts`) | 渲染 |
|---|---|---|---|
| `THINKING_TEXT_MESSAGE_CONTENT` | `onThinking` (兼容 `delta`/`content`, agui.ts:144) | `kind:'thinking'` 节点 (:121) | 「思考过程」节点 |
| `TOOL_CALL_START` / `TOOL_CALL_ARGS` | `onToolCallStart` / `onToolCallArgs` (:173/:184) | `kind:'tool-call'` 节点 (:187) | 工具卡片 |
| `TOOL_CALL_RESULT` | `onToolCallResult` (:195) | `finishToolCall` **自动派生** `kind:'observation'` 子节点 (:227-242) | 挂在工具节点下的「观察结果」 |
| `TEXT_MESSAGE_CONTENT` | `onChunk` (:161) | `kind:'text'`「最终回答」 | 气泡正文 |

**要点：「观察(observation)」不是独立后端事件**，而是前端在收到 `TOOL_CALL_RESULT` 时从 `content` 字段派生出来挂到工具节点下的子节点（`stream-handler.ts:226-242`）。这一环在普通模式下是**闭合的**。

---

## 三、明确的断点 / 未接通部分

### 🔴 断点 1：Plan-Execute 的 `STATE_DELTA`（任务步骤时间轴）前端完全未消费

这是**最明确的断点**。

- modu-agent 在 Plan-Execute 模式下会发出 `STATE_DELTA` 事件（`phase:'plan'` 携带 `plan` 数组、`phase:'execute'` 携带 `step_update`）。
- backend-ts **原样透传**该事件到前端 SSE（`agent-bridge.ts:122-133` → `routes/agent.ts:369`），同时 `collectMetadataFromEvent` 收集它用于持久化（`agent-bridge.ts:251-258`）。
- **但前端 `agui.ts` 的事件 `switch` 根本没有 `STATE_DELTA`/`STATE_SNAPSHOT` 分支**（agui.ts:134-228）。事件到达后 `JSON.parse` 成功、`type` 匹配不到任何 case，被**静默丢弃**（连 `console.warn` 都不会触发）。

**验证证据**：在 `apps/desktop/src/renderer` 全量搜索 `STATE_DELTA|step_update|plan_created|planStore|usePlan|hydrateFromHistory` → **0 匹配**。

**后果**：即便后端跑 `plan_execute` 图，desktop 中间栏在流式过程中**看不到任何计划步骤、步骤进度更新**。后端为此专门准备了 `GET /agent/messages/:messageId/plan` 恢复端点和 `POST .../plan/collapsed` 折叠状态端点（`routes/agent.ts:441-504`），但**前端没有任何代码调用它们**，恢复闭环在前端侧断开。

### 🔴 断点 2：历史消息的 TraceNode 树无法恢复

- 流结束时 `traceNodes`/`traceRootOrder` 写入 message 对象（`chatStore.ts:373-375`）——仅**内存中**。
- 但从后端重新加载历史时，`chatMessageToMessage` → `mapContentBlocks` **只把 `contentBlocks` 还原为扁平的 `thinking` + `toolCalls`**（`chatStore.ts:72-131`），**不重建 traceNodes 树**。
- 因此切换会话/刷新后，历史 assistant 消息 `traceRootOrder` 为空 → `useTrace=false`（`MessageBubble.tsx:126`）→ 回退到扁平渲染，**树形轨迹（含 observation 层级、Plan 时间轴）全部丢失**。

### 🟠 断点 3：工具级错误状态语义不对齐

- 前端已完整准备工具失败渲染：`agui.ts` 读取 `event.toolCallStatus` 和 `event.errorMessage`（:209-210），`stream-handler` 支持 `status:'error'`（:433）。
- **但 modu-agent 的 `emit_tool_result` 固定发 `status:'success'` 且从不带 `errorMessage`**；工具执行失败会转成独立的 `RUN_ERROR` 事件并**终止整个 run**。
- 结果：工具级「失败」状态在前端**永远不会被点亮**，任何工具错误都表现为整轮对话报错。这是前后端契约的语义断点。

### 🟠 断点 4：`RUN_FINISHED` 不携带 model / tokenCount

- `agui.ts` 的 `onDone` 从 `event.model` / `event.tokenCount` 取值（:216-222）。
- 但 modu-agent 的 `RUN_FINISHED` payload 只有 `{threadId, runId}`；且 `StreamContext.promptTokens/completionTokens` 始终为 0（`agent-bridge.ts` 未回填）。
- 结果：流式结束时消息底部的 **model 标签与 token 统计拿不到值**（`MessageBubble.tsx:346-351`），需重新加载才可能有（而后端持久化的 token 也是 null）。

### 🟡 疑点 5：思考内容在 LangGraph 原生路径可能为空

`transform_langgraph_events` 中，LangGraph 原生 `messages` 事件不触发 thinking，仅 SSE 细粒度 `thinking` 事件调用 `emit_thinking('')`（传空串，只开 `THINKING_START` 帧）。这意味着**思考增量是否真正流出，取决于底层是否走细粒度事件路径**。前端已做 `delta`/`content` 双字段兼容（agui.ts:148），接收侧没问题，但**发出侧在部分路径下可能只有空的思考框架**——建议实际运行验证。

### 🟡 疑点 6：`TOOL_CALL_ARGS` 依赖 LangGraph 路径

modu-agent 仅在 `updates/agent` 节点（args 非空时）发 `TOOL_CALL_ARGS`；SSE 细粒度 `tool_call_start` 路径传 `'{}'` **不发**参数增量。因此工具参数能否在卡片上展示，取决于运行时命中哪条 streamMode 路径。

---

## 四、结论

| 能力 | 链路状态 |
|---|---|
| ReAct 模式：思考 / 工具调用 / 观察 / 正文（流式展示） | ✅ 已打通 |
| observation 派生与树形渲染 | ✅ 已打通（前端派生） |
| Plan-Execute 步骤时间轴（实时） | ❌ 断开（前端不消费 `STATE_DELTA`） |
| Plan 时间轴历史恢复（`/plan` 端点） | ❌ 断开（前端无调用） |
| TraceNode 树历史恢复 | ❌ 断开（仅还原扁平结构） |
| 工具级错误状态 | ⚠️ 语义未对齐 |
| 流式 model / token 统计 | ⚠️ 未回填 |
| 思考内容 / 工具参数 | ⚠️ 依赖底层事件路径，需验证 |

**核心判断**：desktop 前端与 modu-agent 之间的**基础 ReAct 事件通信链路已完全打通**；后端（backend-ts）对 Plan-Execute 的采集、持久化、恢复端点也已就绪；**唯独 desktop 前端缺失 Plan-Execute 的实时消费（`STATE_DELTA`）与历史恢复（`/plan`、traceNodes 重建）这一整块**，是当前数据流与状态同步的主要断点。从 `chatStore` 里保留的 `streamingTraceNodes`、后端的 `/plan` 系列端点、以及代码中大量 `P4`/`M1-M6` 注释可见，这是一个**正在推进但前端侧尚未接完**的特性。

### 后续可落地的改造点（补齐前端侧缺口）

1. **消费 `STATE_DELTA`**：在 `agui.ts` 的 switch 中新增 `STATE_DELTA` / `STATE_SNAPSHOT` 分支，将 `phase:'plan'` 的 `plan` 数组与 `phase:'execute'` 的 `step_update` 转换为前端的计划步骤节点（新增 `kind:'plan'` TraceNode 或独立 PlanStore）。
2. **历史恢复**：新增对 `GET /agent/messages/:messageId/plan` 的调用与 `POST .../plan/collapsed` 折叠状态读写；在 `chatMessageToMessage`/`mapContentBlocks` 中重建 `traceNodes` 树，避免历史消息回退为扁平渲染。
3. **错误语义对齐**：推动 modu-agent 的 `emit_tool_result` 在失败时带上 `toolCallStatus:'error'` 与 `errorMessage`，使前端工具卡片能点亮失败态。
4. **统计回填**：在 `agent-bridge.ts` 中把 `StreamContext` 的真实 `promptTokens/completionTokens` 回填到 `RUN_FINISHED`（或单独事件），让前端得到 model / token 数据。
