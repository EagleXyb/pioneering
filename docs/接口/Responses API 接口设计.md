# Responses API 接口设计文档（Agent 接口协议迁移）

> 版本：v0.2（评审稿 · 依据四方向加强：可落地 TS 类型 / 端到端时序 / 请求侧 schema / 结构与位置）
> 状态：设计评审中
> 关联：`docs/云边双模实施方案.md`、`packages/modu-agent/src/orchestration/communication/agui-adapter.ts`、`apps/backend-ts/routes/agent.ts`、`apps/desktop/src/renderer/src/services/api/agui.ts`

---

## 1. 背景与目标

### 1.1 现状

当前 Agent 对外接口使用 **AG-UI 协议**（标准事件流 + 3 个 HITL 扩展事件）：

```
AG-UI 事件流（SSE，data: <json>）
  RUN_STARTED → THINKING_* → TEXT_MESSAGE_* → TOOL_CALL_*
  → RUN_FINISHED / RUN_ERROR
  └─ HITL 扩展：USER_QUESTION_REQUEST / RUN_PAUSED / HITL_ABORTED
```

事件类型全集见 `agui-adapter.ts` 的 `AGUIEventType`（20 种标准 + 3 种 HITL），
payload 结构见 `AGUIEventPayloadMap` 与 `UserQuestionRequestPayload`。

### 1.2 目标

在不改动 modu-agent 图执行内核的前提下，让 Agent 接口同时对外暴露
**OpenAI Responses API 兼容的事件流**：

1. 前端可直接对接 OpenAI Responses 生态（SDK、观测工具、第三方 UI）
2. item-based 输出模型（message / function_call / reasoning 统一抽象）
3. 云边双模（HTTP/SSE 云端 + Electron IPC 本地）共用同一套事件语义

### 1.3 非目标

- 不改动 LangGraph 图执行内核
- 不重构 HITL 的「interrupt 图暂停 / 同消息续写」语义
- 不引入 `previous_response_id` 链式状态依赖（见 §10）
- 不废弃 AG-UI 端点（双协议并存，AG-UI 保留为兼容通道）

---

## 2. 设计原则

| # | 原则 | 落地方式 |
|---|------|----------|
| P1 | 内核零改动 | 只新增 `ResponsesStreamAdapter`，与 `AGUIStreamAdapter` 并存 |
| P2 | 双协议并存 | `/agent/*`（AG-UI）与 `/v1/responses`（Responses）同时可用 |
| P3 | HITL 语义不降级 | interrupt 暂停 → 同消息续写（resume）保持不变 |
| P4 | thread 语义不变 | `thread_id` 即 `session_id`，事件不携带完整状态快照 |
| P5 | 事件流标准化 | 每个事件携带 `response_id` + `sequence_number` + `item_id` |
| P6 | 安全默认 | 新增端点默认关闭，经配置开关启用 |

---

## 3. 协议总览

### 3.1 传输方式

- **SSE（云端）**：`event:` 字段携带事件名 + `data:` 字段携带 JSON 载荷（双字段形式，对齐 OpenAI 官方，便于标准 SSE 客户端解析）

```
event: response.output_text.delta
data: {"event":"response.output_text.delta","sequence_number":6,...}

event: response.completed
data: {"event":"response.completed","sequence_number":40,...}
```

- **IPC（本地）**：沿用 `AgentEventEnvelope { runId, seq, event }`，`event` 为同一 JSON 对象（无 `event:`/`data:` 包装，直接是对象）

### 3.2 事件骨架（每个事件统一顶层字段）

```jsonc
{
  "event": "response.output_text.delta",   // 事件名（§5/§6 枚举）
  "sequence_number": 12,                    // 单调递增，全流唯一
  "response_id": "resp_01J...",             // 本次 run 的响应标识
  "item_id": "msg_01J...",                  // 所属 output item（非 item 事件省略）
  "output_index": 0,                        // item 内多段输出索引（可选）
  "type": "output_text.delta",              // item 类型（output_item 事件必填）
  "thread_id": "sess_01J...",               // = session_id
  "...payload": "事件特有字段"
}
```

### 3.3 顶层字段与 AG-UI 对照

| AG-UI 字段 | Responses 字段 | 说明 |
|-----------|---------------|------|
| `type`（顶层） | `event` | 事件名 |
| `threadId` / `session_id` | `thread_id` | 会话标识，同一值 |
| `runId` | `response_id` | 本次运行标识 |
| `messageId` | `item_id` | 消息项标识 |
| `seq`（IPC envelope 内） | `sequence_number` | 单调递增序号 |
| `toolCallId` | `item_id`（`fc_` 前缀） | 工具调用项标识 |

### 3.4 ID 前缀约定

| 前缀 | 用途 | 对应 AG-UI 字段 |
|------|------|-----------------|
| `resp_` | 响应（run）标识 | `runId` |
| `sess_` | 会话（thread）标识 | `sessionId` / `threadId` |
| `msg_` | 消息 item | `messageId` |
| `fc_` | 工具调用 item | `toolCallId` |
| `fc_out_` | 工具结果 item | —（新增） |
| `re_` | 思考 item | `THINKING_*` 的 messageId |
| `call_` | 工具调用句柄（供 resume/abort 引用） | —（新增） |

### 3.5 协议开关

| 开关 | 默认 | 说明 |
|------|------|------|
| `responses_api.enabled`（后端） | `false` | 是否注册 `/v1/responses` 端点组 |
| `RESPONSES_PROTOCOL`（渲染端） | `'agui'` | 事件分发器格式：`'agui' \| 'responses'` |

---

## 4. 请求 API（完整 schema）

### 4.1 `POST /v1/responses`（SSE 流式）

**请求体全量 schema：**

```jsonc
{
  "thread_id": "sess_01J...",              // 必填，= sessionId
  "input": [                                // 必填，消息数组（结构见 §4.2）
    {
      "role": "user",
      "content": [
        { "type": "input_text", "text": "帮我分析云边双模方案" }
      ]
    }
  ],
  "instructions": "你是 Pioneering Agent，使用中文回复。",  // 可选，系统提示
  "tools": [                                // 可选，工具定义数组（结构见 §4.3）
    { "type": "function", "name": "doc_writer", "description": "..." }
  ],
  "tool_choice": "auto",                    // 'auto' | 'none' | { type:'function', name }
  "model": null,                            // null = 服务端默认（对齐现状）
  "stream": true,                           // true=SSE 流式；省略/false=非流式（§4.4）
  "parallel_tool_calls": true,              // 可选，是否并行工具调用
  "reasoning": { "effort": "medium" },      // 可选，思考强度（映射 deepThink）
  "metadata": {                             // 可选，透传元数据
    "agent_mode": "react_agent"
  }
}
```

**字段与现有请求对照：**

| 现有字段（`SendMessageRequest`） | Responses 字段 | 说明 |
|--------------------------------|---------------|------|
| `sessionId` | `thread_id` | 会话标识 |
| `message` | `input[0].content[0].text` | 单条用户消息 |
| `history`（IPC 本地多轮上下文） | `input` 数组前置追加 | role/content 对转 `input` item |
| `model` | `model` | — |
| `systemPrompt` | `instructions` | 系统提示 |
| `deepThink` | `reasoning.effort` | 思考强度 |
| `netSearch` | 工具 `web_search`（tools 内） | 联网检索 |
| `stream` | `stream` | — |
| `agentMode` | `metadata.agent_mode` | 模式透传 |

### 4.2 `input` 消息结构

```jsonc
// 用户消息
{
  "role": "user",
  "content": [
    { "type": "input_text", "text": "你好" },
    { "type": "input_image", "image_url": "data:image/png;base64,..." }  // 可选，图片
  ]
}

// 本地模式多轮 history（IPC）
{
  "role": "assistant",
  "content": [
    { "type": "output_text", "text": "我是 Agent，可以帮你..." }
  ]
}
```

### 4.3 `tools` 工具定义 schema（对照真实工具清单）

工具定义遵循 OpenAI `function` 工具 JSON Schema 约定，扩展 `requires_approval` 标记审批工具：

```jsonc
{
  "type": "function",
  "name": "code_executor",
  "description": "在沙箱环境中执行 Python/Shell 代码并返回结果",
  "parameters": {
    "type": "object",
    "properties": {
      "code": { "type": "string", "description": "要执行的代码" }
    },
    "required": ["code"]
  },
  "strict": true,
  "requires_approval": true          // 扩展字段：该工具调用需 HITL 审批
}
```

modu-agent 实际工具清单（`packages/modu-agent/src/tools/tool-registry.ts` 的 `TOOL_CAPABILITY_MATRIX`）：

| 工具名 | 能力 | requires_approval |
|--------|------|-------------------|
| `search_engine` | 联网检索 | 否 |
| `http_request` | HTTP 请求 | 是（敏感） |
| `calculator` | 计算 | 否 |
| `code_executor` | 代码执行 | **是** |
| `sql_query` | 数据库查询 | 是（敏感） |
| `datetime` | 时间 | 否 |
| `file_ops` | 文件操作 | 是（敏感） |
| `doc_writer` | 文档写作 | 否 |

> 说明：`requires_approval` 的最终判定不依赖请求体——后端仍走
> `checkGuardrail`（规则匹配 + 能力矩阵回退）动态判定，`requires_approval`
> 仅作为请求侧提示与文档化。HITL 事件是否触发以服务端判定为准。

### 4.4 非流式响应（`stream: false` 或省略）

```jsonc
{
  "id": "resp_01J...",
  "object": "response",
  "thread_id": "sess_01J...",
  "created_at": 1787891400,
  "status": "completed",              // 'completed' | 'failed' | 'paused' | 'aborted'
  "model": "gpt-4o",
  "output": [
    {
      "type": "message",
      "id": "msg_01J...",
      "role": "assistant",
      "status": "completed",
      "output": [
        { "type": "output_text", "text": "分析结果……", "annotations": [] }
      ]
    }
  ],
  "usage": { "input_tokens": 1280, "output_tokens": 512, "total_tokens": 1792 }
}
```

> `status: 'paused'` 时响应体内**不含** HITL 暂停项明细，
> 客户端应改用 `GET /v1/responses/:response_id` 获取（§4.5.3）。

### 4.5 HITL 操作端点

| 操作 | 端点 | 请求体 | 响应 |
|------|------|--------|------|
| 恢复暂停项 | `POST /v1/responses/:response_id/hitl/resume` | §4.5.1 | SSE 事件流（新 response） |
| 中止/拒绝 | `POST /v1/responses/:response_id/hitl/abort` | §4.5.2 | `{ message, aborted }` |
| 查询暂停态 | `GET /v1/responses/:response_id` | — | §4.5.3 |
| 停止生成 | `POST /v1/responses/:response_id/stop` | — | `{ message, aborted }` |

#### 4.5.1 resume 请求体（对齐现有 `ResumeRequest`）

```jsonc
{
  "approved": true,                  // 必填
  "feedback": null,                  // 可选，用户反馈
  "modified_args": null              // 可选，修改后的工具参数
  // modified_args 结构：
  //   { "<call_id>": { "<参数名>": <新值> } }
}
```

#### 4.5.2 abort 请求体

```jsonc
{ "reason": "user_cancel" }          // 'user_cancel' | 'timeout' | 'reject'
```

#### 4.5.3 状态查询响应（对齐现有 `HitlStateResponse`）

```jsonc
{
  "response_id": "resp_01J...",
  "thread_id": "sess_01J...",
  "pending": true,
  "expired": false,
  "next_nodes": ["human_review"],
  "pending_tool_calls": [
    { "id": "call_01J...", "name": "code_executor" }
  ],
  "tool_requires_approval": true,
  "expires_at": "2026-08-25T17:00:00Z"
}
```

---

## 5. 标准事件 Schema

### 5.1 事件全集与映射表

| Responses 事件 | 触发时机 | 对应 AG-UI 事件 | 方向 |
|---------------|---------|-----------------|------|
| `response.created` | run 启动 | `RUN_STARTED` | ✅ |
| `response.in_progress` | 进入执行 | —（新增） | ➕ |
| `response.output_item.added` | 新输出项创建（message / function_call / reasoning） | `TEXT_MESSAGE_START` / `TOOL_CALL_START` / `THINKING_*_START` | ✅ |
| `response.output_text.delta` | 正文增量 | `TEXT_MESSAGE_CONTENT` | ✅ |
| `response.output_text.done` | 正文段落结束 | `TEXT_MESSAGE_END` | ✅ |
| `response.reasoning_summary_text.delta` | 思考摘要增量 | `THINKING_TEXT_MESSAGE_CONTENT` | ✅ |
| `response.reasoning_summary_text.done` | 思考段落结束 | `THINKING_TEXT_MESSAGE_END` | ✅ |
| `response.reasoning_text.delta` | 思考原文增量（可选保留） | `THINKING_TEXT_MESSAGE_CONTENT`（备用） | ➕ |
| `response.function_call_arguments.delta` | 工具参数增量 | `TOOL_CALL_ARGS` | ✅ |
| `response.function_call_arguments.done` | 工具参数完整 | `TOOL_CALL_END` | ✅ |
| `response.output_item.done` | 输出项完成 | `TEXT_MESSAGE_END` / `TOOL_CALL_RESULT` | ✅ |
| `response.function_call_output.delta` | 工具执行结果增量 | `TOOL_CALL_RESULT`（content 分片） | ➕ |
| `response.function_call_output.done` | 工具执行结果完成 | `TOOL_CALL_RESULT` | ➕ |
| `response.plan.delta` | Plan-and-Execute 步骤更新 | `STATE_DELTA`（phase=plan / step_update） | ➕ |
| `response.completed` | run 正常结束 | `RUN_FINISHED` | ✅ |
| `response.failed` | run 异常结束 | `RUN_ERROR` | ✅ |
| `response.error` | 流级错误（非 run 级） | —（新增） | ➕ |
| `response.paused` | 图被 interrupt 暂停 | `RUN_PAUSED` | 🧩 |
| `response.hitl_request` | 暂停时携带待答复暂停项 | `USER_QUESTION_REQUEST` | 🧩 |
| `response.hitl_resolved` | 用户已答复、resume 续写启动 | —（新增） | 🧩 |
| `response.hitl_aborted` | 暂停项被中止 / 超时 | `HITL_ABORTED` | 🧩 |

> ✅ = 直接映射，➕ = 新增，🧩 = HITL 扩展（§6）

### 5.2 关键事件字段级 Schema

#### 5.2.1 `response.created`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `event` | `string` | ✅ | 固定 `response.created` |
| `sequence_number` | `number` | ✅ | 1 |
| `response_id` | `string` | ✅ | `resp_` 前缀 |
| `thread_id` | `string` | ✅ | 会话标识 |

```jsonc
{ "event": "response.created", "sequence_number": 1, "response_id": "resp_01J...", "thread_id": "sess_01J..." }
```

#### 5.2.2 `response.output_item.added`（正文消息）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `item_id` | `string` | ✅ | `msg_` 前缀 |
| `output_index` | `number` | ✅ | 段序号 |
| `type` | `string` | ✅ | `message` |
| `role` | `string` | ✅ | `assistant` |
| `status` | `string` | ✅ | `in_progress` |

```jsonc
{ "event": "response.output_item.added", "sequence_number": 5, "response_id": "resp_01J...", "item_id": "msg_01J...", "output_index": 0, "type": "message", "role": "assistant", "status": "in_progress" }
```

#### 5.2.3 `response.output_text.delta`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `item_id` | `string` | ✅ | 所属消息项 |
| `output_index` | `number` | ✅ | — |
| `type` | `string` | ✅ | `output_text` |
| `delta` | `string` | ✅ | 正文增量 |

```jsonc
{ "event": "response.output_text.delta", "sequence_number": 6, "response_id": "resp_01J...", "item_id": "msg_01J...", "output_index": 0, "type": "output_text", "delta": "你好，我是 Pioneering Agent。" }
```

#### 5.2.4 `response.reasoning_summary_text.delta`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `item_id` | `string` | ✅ | `re_` 前缀 |
| `output_index` | `number` | ✅ | — |
| `type` | `string` | ✅ | `reasoning_summary_text` |
| `delta` | `string` | ✅ | 思考增量（对齐 AG-UI `THINKING_TEXT_MESSAGE_CONTENT` 的 delta 语义） |

```jsonc
{ "event": "response.reasoning_summary_text.delta", "sequence_number": 7, "response_id": "resp_01J...", "item_id": "re_01J...", "output_index": 0, "type": "reasoning_summary_text", "delta": "用户想了解云边双模方案…" }
```

#### 5.2.5 `response.output_item.added`（工具调用）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `item_id` | `string` | ✅ | `fc_` 前缀 |
| `output_index` | `number` | ✅ | — |
| `type` | `string` | ✅ | `function_call` |
| `name` | `string` | ✅ | 工具名 |
| `arguments` | `string` | ✅ | 初始为空串，后续由 `arguments.delta` 补全 |
| `call_id` | `string` | ✅ | `call_` 前缀，供 resume/abort 引用 |
| `status` | `string` | ✅ | `in_progress` |

```jsonc
{ "event": "response.output_item.added", "sequence_number": 12, "response_id": "resp_01J...", "item_id": "fc_01J...", "output_index": 1, "type": "function_call", "name": "code_executor", "arguments": "", "call_id": "call_01J...", "status": "in_progress" }
```

#### 5.2.6 `response.function_call_arguments.delta` / `.done`

```jsonc
{ "event": "response.function_call_arguments.delta", "sequence_number": 13, "response_id": "resp_01J...", "item_id": "fc_01J...", "output_index": 1, "type": "function_call_arguments", "delta": "{\"code\":\"pri" }
{ "event": "response.function_call_arguments.done", "sequence_number": 20, "response_id": "resp_01J...", "item_id": "fc_01J...", "output_index": 1, "type": "function_call_arguments", "arguments": "{\"code\":\"print(1+1)\"}" }
```

#### 5.2.7 `response.function_call_output.delta` / `.done`（工具执行结果）

> ⚠️ **语义差异点**：OpenAI 官方中工具结果由客户端「下一轮提交 function_call_output」
> 产生，**不在同一响应流内**。本项目是 LangGraph agent loop（图内自动执行工具），
> 工具结果在同一 run 内产生，故用 `response.function_call_output.*` 事件承载，
> **发生在同一响应流中**（有意扩展，客户端不可假设「响应已完成才有结果」）。

```jsonc
{ "event": "response.function_call_output.delta", "sequence_number": 21, "response_id": "resp_01J...", "item_id": "fc_out_01J...", "output_index": 2, "type": "function_call_output", "call_id": "call_01J...", "output": "2" }
{ "event": "response.function_call_output.done", "sequence_number": 22, "response_id": "resp_01J...", "item_id": "fc_out_01J...", "output_index": 2, "type": "function_call_output", "call_id": "call_01J...", "output": "2", "status": "completed" }
```

#### 5.2.8 `response.output_item.done`（正文消息 / 工具调用）

```jsonc
// 正文消息
{ "event": "response.output_item.done", "sequence_number": 30, "response_id": "resp_01J...", "item_id": "msg_01J...", "output_index": 0, "type": "message", "status": "completed", "output": [{ "type": "output_text", "text": "你好，我是 Pioneering Agent。", "annotations": [] }] }

// 工具调用
{ "event": "response.output_item.done", "sequence_number": 31, "response_id": "resp_01J...", "item_id": "fc_01J...", "output_index": 1, "type": "function_call", "name": "code_executor", "arguments": "{\"code\":\"print(1+1)\"}", "call_id": "call_01J...", "status": "completed" }
```

#### 5.2.9 `response.plan.delta`（Plan-and-Execute）

```jsonc
// 阶段增量
{ "event": "response.plan.delta", "sequence_number": 15, "response_id": "resp_01J...", "thread_id": "sess_01J...", "phase": "plan", "plan": [{ "id": "step_1", "title": "分析现状", "status": "in_progress" }] }
// 步骤更新
{ "event": "response.plan.delta", "sequence_number": 18, "response_id": "resp_01J...", "thread_id": "sess_01J...", "phase": "execute", "step_update": { "id": "step_1", "status": "completed" } }
```

#### 5.2.10 `response.completed`

```jsonc
{ "event": "response.completed", "sequence_number": 40, "response_id": "resp_01J...", "thread_id": "sess_01J...", "usage": { "input_tokens": 1280, "output_tokens": 512, "total_tokens": 1792 } }
```

#### 5.2.11 `response.failed` / `response.error`

```jsonc
// run 级失败
{ "event": "response.failed", "sequence_number": 38, "response_id": "resp_01J...", "thread_id": "sess_01J...", "error": { "code": "AGENT_ERROR", "message": "LLM 调用失败：rate limit exceeded", "param": null, "type": "server_error" } }
// 流级错误（非 run 级）
{ "event": "response.error", "sequence_number": 0, "response_id": null, "error": { "code": "AUTH_REQUIRED", "message": "未授权", "param": null, "type": "invalid_request_error" } }
```

---

## 6. HITL 扩展事件 Schema（核心）

### 6.1 设计决策：扩展事件 vs function-call 往返

OpenAI 官方的 human-in-the-loop 是 **function-call 往返模式**：

```
模型发 function_call → response.completed（响应结束）
  → 客户端执行工具 → 提交 function_call_output → 新一轮 response
```

本项目现状是 **interrupt() 图暂停模式**：

```
图执行中 interrupt() → 暂停（不触发完成语义）
  → 用户答复 → resume 续写同一条 assistant 消息
```

**选型结论：采用自定义扩展事件，保留 interrupt 语义。**

理由：
1. 若改为 function-call 往返，渲染端消息生命周期（streaming → paused → resuming → done
   **续写同一条消息**）需整体重构，风险高、收益低
2. interrupt 暂停是图级别语义，能冻结任意中间状态（不止工具审批），
   function-call 往返只覆盖工具一种场景
3. 扩展事件可同时承载 `tool_confirm` / `clarifying` / `choice` 三类暂停项
   （对齐现有 `UserQuestionRequestPayload.kind`），向前兼容

### 6.2 扩展事件全集

| 事件 | 触发时机 | 对应 AG-UI | 终态 |
|------|---------|-----------|------|
| `response.paused` | 图被 interrupt 暂停（仅含 thread/response 标识） | `RUN_PAUSED` | ✅ |
| `response.hitl_request` | 暂停时携带待答复暂停项（完整 payload） | `USER_QUESTION_REQUEST` | ✅ |
| `response.hitl_resolved` | 用户已答复、resume 续写启动（新 run 首帧） | —（新增） | ✅ |
| `response.hitl_aborted` | 暂停项被中止 / 超时 | `HITL_ABORTED` | ✅ |

> 说明：
> - `response.paused` 与 `response.hitl_request` **成对出现**（interrupt 时同时下发），
>   对齐 AG-UI 双事件；`paused` 驱动「消息进入 paused 态」，`hitl_request` 驱动弹窗渲染。
> - `response.hitl_resolved` 由后端在 resume 请求受理后于**新 run 流首帧**下发，
>   供前端确认「暂停态已收敛、续写开始」。
> - 四个事件均为终态（收到即当前 response 流结束，IPC 端自动退订）。

### 6.3 状态机

```
┌─────────┐   response.paused +         ┌──────────────┐
│  running │ ── response.hitl_request ──▶ │   paused     │
└─────────┘                              └──────┬───────┘
                                                │
              ┌─────────────────────────────────┼──────────────────┐
              │ POST hitl/resume               │ POST hitl/abort   │ 超时自动拒绝
              ▼                                 ▼                   ▼
        ┌──────────────┐               ┌──────────────┐     ┌──────────────┐
        │   resuming   │               │  aborted     │     │  aborted     │
        │ (新 response) │               └──────────────┘     │ (expired)    │
        └──────┬───────┘                                     └──────────────┘
               ▼
  response.hitl_resolved（首帧）→ running → response.completed
```

### 6.4 `response.paused` — 字段级

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `event` | `string` | ✅ | 固定 `response.paused` |
| `response_id` | `string` | ✅ | 被暂停的 run |
| `thread_id` | `string` | ✅ | 会话标识 |
| `reason` | `string` | ✅ | 固定 `human_review` |
| `next_nodes` | `string[]` | ❌ | 图待恢复节点（对齐 `get_interrupt_state`） |

```jsonc
{ "event": "response.paused", "sequence_number": 25, "response_id": "resp_01J...", "thread_id": "sess_01J...", "reason": "human_review", "next_nodes": ["human_review"] }
```

### 6.5 `response.hitl_request` — 字段级（完整 payload）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `event` | `string` | ✅ | 固定 `response.hitl_request` |
| `response_id` | `string` | ✅ | 被暂停的 run |
| `thread_id` | `string` | ✅ | 会话标识 |
| `kind` | `enum` | ✅ | `'tool_confirm' \| 'clarifying' \| 'choice'` |
| `message` | `string` | ❌ | 弹窗文案 |
| `expires_at` | `string(ISO8601)` | ❌ | 审批超时时刻 |
| `tool_calls` | `Array<HitlToolCall>` | kind=`tool_confirm` 时必填 | 待审批工具列表 |
| `question` | `string` | kind=`clarifying` 时必填 | 澄清问题 |
| `options` | `Array<HitlOption>` | kind=`choice` 时必填 | 多选选项 |

`HitlToolCall`：

```jsonc
{
  "id": "call_01J...",
  "name": "code_executor",
  "args": { "code": "print(1+1)" }
}
```

`HitlOption`：

```jsonc
{ "id": "opt_1", "label": "同意" }
```

完整示例：

```jsonc
{
  "event": "response.hitl_request",
  "sequence_number": 26,
  "response_id": "resp_01J...",
  "thread_id": "sess_01J...",
  "kind": "tool_confirm",
  "message": "以下工具调用需要您的确认：",
  "expires_at": "2026-08-25T17:00:00Z",
  "tool_calls": [
    {
      "id": "call_01J...",
      "name": "code_executor",
      "args": { "code": "rm -rf /tmp/pioneering_cache" }
    }
  ],
  "question": null,
  "options": null
}
```

**与现有 `UserQuestionRequestPayload` 字段映射（严格对齐）：**

| 现有字段（AG-UI） | Responses 字段 | 类型 |
|------------------|---------------|------|
| `kind` | `kind` | `'tool_confirm' \| 'clarifying' \| 'choice'` |
| `session_id` | `thread_id` | `string` |
| `run_id` | `response_id` | `string` |
| `message` | `message` | `string?` |
| `tool_calls[].id` | `tool_calls[].id` | `string` |
| `tool_calls[].name` | `tool_calls[].name` | `string` |
| `tool_calls[].args` | `tool_calls[].args` | `Record<string, unknown>` |
| `question` | `question` | `string?` |
| `options` | `options` | `Array<{id,label}>?` |

### 6.6 `response.hitl_resolved` — 字段级

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `event` | `string` | ✅ | 固定 `response.hitl_resolved` |
| `response_id` | `string` | ✅ | **新** run（resume 产生） |
| `thread_id` | `string` | ✅ | 会话标识 |
| `prev_response_id` | `string` | ❌ | 被恢复的暂停 run（仅诊断，不做状态寻址） |
| `approved` | `boolean` | ✅ | 用户答复 |
| `feedback` | `string?` | ❌ | 用户反馈 |
| `modified_args` | `Record<string, Record<string, unknown>>?` | ❌ | 修改后的参数 |

```jsonc
{ "event": "response.hitl_resolved", "sequence_number": 1, "response_id": "resp_01K...", "thread_id": "sess_01J...", "prev_response_id": "resp_01J...", "approved": true, "feedback": null, "modified_args": null }
```

### 6.7 `response.hitl_aborted` — 字段级

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `event` | `string` | ✅ | 固定 `response.hitl_aborted` |
| `response_id` | `string` | ✅ | 被中止的 run |
| `thread_id` | `string` | ✅ | 会话标识 |
| `reason` | `enum` | ✅ | `'user_cancel' \| 'timeout' \| 'reject'` |

```jsonc
{ "event": "response.hitl_aborted", "sequence_number": 27, "response_id": "resp_01J...", "thread_id": "sess_01J...", "reason": "user_cancel" }
```

---

## 7. 端到端生命周期时序（逐帧事件序列）

> 约定：以下每帧省略了 `response_id` / `thread_id`（保持可读），实际传输始终携带；
> `seq` 为该帧的 `sequence_number`。

### 7.1 场景 A：普通对话 run（无工具）

```
seq  event                                    payload 要点
1    response.created                        thread_id=sess_01J
2    response.in_progress
5    response.output_item.added              type=message, item_id=msg_01J, role=assistant
6    response.output_text.delta              delta="你好"
7    response.output_text.delta              delta="，我是 Pioneering Agent。"
8    response.output_text.done               output_index=0
9    response.output_item.done               type=message, status=completed, output=[...]
40   response.completed                      usage={...}
```

### 7.2 场景 B：工具调用 run（无 HITL）

```
seq  event                                    payload 要点
1    response.created
2    response.in_progress
5    response.output_item.added              type=message, msg_01J
6    response.output_text.delta              delta="我来计算 1+1"
8    response.output_text.done
12   response.output_item.added              type=function_call, fc_01J, name=code_executor, call_id=call_01J
13   response.function_call_arguments.delta  delta="{\"code\":\"pr"
14   response.function_call_arguments.delta  delta="int(1+1)\"}"
20   response.function_call_arguments.done   arguments="{\"code\":\"print(1+1)\"}"
21   response.function_call_output.delta     output="2"
22   response.function_call_output.done      output="2", status=completed
31   response.output_item.done               type=function_call, fc_01J, status=completed
35   response.output_item.added              type=message, msg_02J
36   response.output_text.delta              delta="结果是 2"
37   response.output_text.done
38   response.output_item.done               type=message, status=completed
40   response.completed
```

### 7.3 场景 C：HITL 暂停 → 用户批准 → resume → 完成（核心场景）

```
===== 第一次请求 POST /v1/responses =====
seq  event                                    payload 要点
1    response.created                        response_id=resp_01J
2    response.in_progress
5    response.output_item.added              type=message, msg_01J
6    response.output_text.delta              delta="需要执行代码，请确认："
8    response.output_text.done
12   response.output_item.added              type=function_call, fc_01J, name=code_executor, call_id=call_01J
13   response.function_call_arguments.delta  delta="{\"code\":\"print"
20   response.function_call_arguments.done   arguments="{\"code\":\"print(1+1)\"}"
── 服务端 checkGuardrail 判定需审批 → interrupt() ──
25   response.paused                         reason=human_review, next_nodes=["human_review"]   ← 终态
26   response.hitl_request                   kind=tool_confirm, tool_calls=[{id:call_01J,...}]  ← 终态
    （前端弹窗；消息进入 paused 态）

===== 用户点击「批准」→ POST /v1/responses/resp_01J/hitl/resume =====
    （前端生成新 run 标识；服务端 resume_stream 受理 → 新 response 流）
seq  event                                    payload 要点
1    response.hitl_resolved                  response_id=resp_01K, prev_response_id=resp_01J, approved=true  ← 首帧+终态
2    response.in_progress
21   response.function_call_output.delta     output="2"          ← 工具在图中继续执行
22   response.function_call_output.done      output="2", status=completed
31   response.output_item.done               type=function_call, fc_01J, status=completed
35   response.output_item.added              type=message, msg_02J   ← 续写同一条 assistant 消息
36   response.output_text.delta              delta="执行结果：2"
37   response.output_text.done
38   response.output_item.done               type=message, status=completed
40   response.completed                      ← 终态
```

### 7.4 场景 D：HITL 暂停 → 用户拒绝 / 超时 → abort

```
===== 首次请求（同场景 C 至 seq 26）=====
25   response.paused
26   response.hitl_request

===== 用户点击「拒绝」→ POST /v1/responses/resp_01J/hitl/abort {reason:"reject"} =====
    （服务端 resume_sync(approved=false) 收敛暂停态；无新 response 流）
HTTP 200
{ "message": "aborted", "aborted": true }

===== 若后端同时向原流（若仍存活）下发收尾事件 =====
27   response.hitl_aborted                   reason="reject"     ← 终态

===== 超时场景：服务端 checkInterruptTimeout 判定过期 =====
27   response.hitl_aborted                   reason="timeout"    ← 终态（或前端 GET 状态见 expired=true）
```

---

## 8. 可落地 TS 类型定义（可直接拷入 `apps/desktop/src/shared/types.ts`）

> 以下为完整文件内容，含全部标准事件 + HITL 扩展事件的判别联合。

```typescript
// ============================================================
// Responses Protocol — OpenAI Responses API 兼容事件流（云边双模阶段扩展）
// 对应 docs/接口/Responses API 接口设计.md
// ============================================================

// ---------- 请求 ----------

export interface ResponsesContentPart {
  type: 'input_text' | 'input_image'
  text?: string        // type=input_text 时必填
  image_url?: string   // type=input_image 时必填
}

export interface ResponsesInputItem {
  role: 'user' | 'assistant'
  content: ResponsesContentPart[]
}

export interface ResponsesTool {
  type: 'function'
  name: string
  description?: string
  parameters?: Record<string, unknown> // JSON Schema
  strict?: boolean
  /** 扩展：请求侧提示该工具需审批；最终判定以服务端 checkGuardrail 为准 */
  requires_approval?: boolean
}

export interface ResponsesRequest {
  thread_id: string
  input: ResponsesInputItem[]
  instructions?: string
  tools?: ResponsesTool[]
  tool_choice?: 'auto' | 'none' | { type: 'function'; name: string }
  model?: string
  stream?: boolean
  parallel_tool_calls?: boolean
  reasoning?: { effort?: 'none' | 'low' | 'medium' | 'high' }
  metadata?: Record<string, string>
}

// ---------- HITL 操作 ----------

export interface ResponsesResumeRequest {
  approved: boolean
  feedback?: string | null
  modified_args?: Record<string, Record<string, unknown>> | null
}

export interface ResponsesAbortRequest {
  reason?: 'user_cancel' | 'timeout' | 'reject'
}

export interface ResponsesHitlToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ResponsesHitlOption {
  id: string
  label: string
}

export interface ResponsesHitlStateResponse {
  response_id: string
  thread_id: string
  pending: boolean
  expired?: boolean
  next_nodes?: string[]
  pending_tool_calls?: Array<{ id: string; name: string }>
  tool_requires_approval?: boolean
  expires_at?: string
}

// ---------- 事件 ----------

/** 事件统一骨架 */
export interface ResponsesEventBase {
  event: string
  sequence_number: number
  response_id: string | null
  thread_id?: string
}

export interface ResponsesErrorObject {
  code: string
  message: string
  param: string | null
  type: string
}

/** item 类型：message / function_call / function_call_output / reasoning */
export type ResponsesItemType =
  | 'message'
  | 'function_call'
  | 'function_call_output'
  | 'reasoning'
  | 'reasoning_summary_text'

export interface ResponsesCreatedEvent extends ResponsesEventBase {
  event: 'response.created'
}

export interface ResponsesInProgressEvent extends ResponsesEventBase {
  event: 'response.in_progress'
}

export interface ResponsesOutputItemAddedEvent extends ResponsesEventBase {
  event: 'response.output_item.added'
  item_id: string
  output_index: number
  type: ResponsesItemType
  role?: string
  name?: string
  arguments?: string
  call_id?: string
  status: 'in_progress' | 'completed'
}

export interface ResponsesOutputTextDeltaEvent extends ResponsesEventBase {
  event: 'response.output_text.delta'
  item_id: string
  output_index: number
  type: 'output_text'
  delta: string
}

export interface ResponsesOutputTextDoneEvent extends ResponsesEventBase {
  event: 'response.output_text.done'
  item_id: string
  output_index: number
  type: 'output_text'
  text?: string
}

export interface ResponsesReasoningDeltaEvent extends ResponsesEventBase {
  event: 'response.reasoning_summary_text.delta'
  item_id: string
  output_index: number
  type: 'reasoning_summary_text'
  delta: string
}

export interface ResponsesReasoningDoneEvent extends ResponsesEventBase {
  event: 'response.reasoning_summary_text.done'
  item_id: string
  output_index: number
  type: 'reasoning_summary_text'
}

export interface ResponsesFunctionCallArgumentsDeltaEvent extends ResponsesEventBase {
  event: 'response.function_call_arguments.delta'
  item_id: string
  output_index: number
  type: 'function_call_arguments'
  delta: string
}

export interface ResponsesFunctionCallArgumentsDoneEvent extends ResponsesEventBase {
  event: 'response.function_call_arguments.done'
  item_id: string
  output_index: number
  type: 'function_call_arguments'
  arguments: string
}

export interface ResponsesOutputItemDoneEvent extends ResponsesEventBase {
  event: 'response.output_item.done'
  item_id: string
  output_index: number
  type: ResponsesItemType
  role?: string
  name?: string
  arguments?: string
  call_id?: string
  status: 'completed' | 'incomplete'
  output?: Array<Record<string, unknown>>
}

export interface ResponsesFunctionCallOutputDeltaEvent extends ResponsesEventBase {
  event: 'response.function_call_output.delta'
  item_id: string
  output_index: number
  type: 'function_call_output'
  call_id: string
  output: string
}

export interface ResponsesFunctionCallOutputDoneEvent extends ResponsesEventBase {
  event: 'response.function_call_output.done'
  item_id: string
  output_index: number
  type: 'function_call_output'
  call_id: string
  output: string
  status: 'completed'
}

export interface ResponsesPlanDeltaEvent extends ResponsesEventBase {
  event: 'response.plan.delta'
  phase: 'plan' | 'execute'
  plan?: Array<Record<string, unknown>>
  step_update?: Record<string, unknown>
}

export interface ResponsesCompletedEvent extends ResponsesEventBase {
  event: 'response.completed'
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number }
}

export interface ResponsesFailedEvent extends ResponsesEventBase {
  event: 'response.failed'
  error: ResponsesErrorObject
}

export interface ResponsesErrorEvent extends ResponsesEventBase {
  event: 'response.error'
  error: ResponsesErrorObject
}

// ===== HITL 扩展事件 =====

export interface ResponsesPausedEvent extends ResponsesEventBase {
  event: 'response.paused'
  reason: 'human_review'
  next_nodes?: string[]
}

export interface ResponsesHitlRequestEvent extends ResponsesEventBase {
  event: 'response.hitl_request'
  kind: 'tool_confirm' | 'clarifying' | 'choice'
  message?: string
  expires_at?: string
  tool_calls?: ResponsesHitlToolCall[]
  question?: string | null
  options?: ResponsesHitlOption[] | null
}

export interface ResponsesHitlResolvedEvent extends ResponsesEventBase {
  event: 'response.hitl_resolved'
  prev_response_id?: string
  approved: boolean
  feedback?: string | null
  modified_args?: Record<string, Record<string, unknown>> | null
}

export interface ResponsesHitlAbortedEvent extends ResponsesEventBase {
  event: 'response.hitl_aborted'
  reason: 'user_cancel' | 'timeout' | 'reject'
}

/** 事件判别联合 */
export type ResponsesEvent =
  | ResponsesCreatedEvent
  | ResponsesInProgressEvent
  | ResponsesOutputItemAddedEvent
  | ResponsesOutputTextDeltaEvent
  | ResponsesOutputTextDoneEvent
  | ResponsesReasoningDeltaEvent
  | ResponsesReasoningDoneEvent
  | ResponsesFunctionCallArgumentsDeltaEvent
  | ResponsesFunctionCallArgumentsDoneEvent
  | ResponsesOutputItemDoneEvent
  | ResponsesFunctionCallOutputDeltaEvent
  | ResponsesFunctionCallOutputDoneEvent
  | ResponsesPlanDeltaEvent
  | ResponsesCompletedEvent
  | ResponsesFailedEvent
  | ResponsesErrorEvent
  | ResponsesPausedEvent
  | ResponsesHitlRequestEvent
  | ResponsesHitlResolvedEvent
  | ResponsesHitlAbortedEvent

/** 终态事件（IPC 自动退订依据，与 AG-UI TERMINAL_AGUI_EVENTS 对齐） */
export const TERMINAL_RESPONSES_EVENTS: ReadonlySet<string> = new Set([
  'response.completed',
  'response.failed',
  'response.paused',
  'response.hitl_aborted'
])

/** 通过 event 名从事件对象提取 payload 的辅助类型 */
export type ResponsesPayloadOf<T extends ResponsesEvent['event']> = Extract<
  ResponsesEvent,
  { event: T }
>
```

---

## 9. 错误处理

### 9.1 错误分层

| 层级 | 事件/响应 | 示例 |
|------|----------|------|
| 传输层（4xx/5xx） | HTTP 错误 + `response.error` | 401 未授权、404 无此 response |
| run 执行层 | `response.failed` | LLM 调用失败、工具异常 |
| 流解析层 | 跳过 + 告警 | 非 JSON 分片（对齐 AG-UI 现有行为） |

### 9.2 错误码表（`error.code`）

| code | 含义 | HTTP | 对应 AG-UI |
|------|------|------|-----------|
| `AGENT_ERROR` | 图执行异常 | 200（流内） | `RUN_ERROR` |
| `AUTH_REQUIRED` | 未授权 | 401 | — |
| `INVALID_REQUEST` | 请求体非法 | 400 | — |
| `RESPONSE_NOT_FOUND` | response_id 不存在 | 404 | — |
| `NO_PENDING_INTERRUPT` | 无待答复暂停项 | 409 | — |
| `TIMEOUT_EXPIRED` | 审批超时已自动拒绝 | 200（流内 / 查询） | `HITL_ABORTED(reason=timeout)` |

### 9.3 客户端处理建议

- 收到 `response.error`（流级）：直接展示错误，不创建消息
- 收到 `response.failed`（run 级）：将已累积内容冻结为失败消息（对齐现有 RUN_ERROR 处理）
- 收到 409 `NO_PENDING_INTERRUPT`：幂等忽略（可能已被其他端处理）

---

## 10. 状态与 thread 语义

### 10.1 关键决策：不引入 `previous_response_id` 链

OpenAI Responses 状态在服务端，靠 `previous_response_id` 链式引用回溯上下文；
本项目状态在 **LangGraph checkpointer**，靠 `thread_id` 定位（含中断态）。

若强行套用链式模式，backend-ts 需维护 `response_id → thread_id` 映射表，
且每次 resume 都需串联历史 response，与现有 checkpointer 定位方式冲突。

**决策：`thread_id` 即 `session_id` 不变，`response_id` 仅作为单次 run 标识**
（事件路由/日志诊断用），**不参与状态寻址**。`prev_response_id` 字段仅出现在
`response.hitl_resolved` 中作链路诊断。

### 10.2 `response_id` 生命周期

| 阶段 | 说明 |
|------|------|
| 创建 | `POST /v1/responses` 或 resume 受理时由适配器生成（`resp_` 前缀） |
| 存活 | 流式执行期间；与 AG-UI `runId` 一一对应 |
| 查询 | 仅当存在暂停态（pending）时可 `GET /v1/responses/:response_id` 查询 |
| 清理 | 流结束（completed/failed/aborted）后无保留义务 |

---

## 11. 渲染端消费契约

### 11.1 分发器映射（对齐现有 `createAguiEventDispatcher`）

渲染端新增 `createResponsesEventDispatcher`，将 Responses 事件映射到现有
`AguiStreamCallbacks`（**回调结构不变**，stream-handler / chatStore 零改动）：

| Responses 事件 | 触发回调 |
|---------------|---------|
| `response.output_text.delta` | `onChunk` |
| `response.reasoning_summary_text.delta` | `onThinking` |
| `response.output_item.added`(function_call) | `onToolCallStart` |
| `response.function_call_arguments.delta` | `onToolCallArgs` |
| `response.function_call_output.done` / `response.output_item.done`(function_call) | `onToolCallResult` |
| `response.plan.delta` | `onStateDelta` |
| `response.paused` | `onRunPaused` |
| `response.hitl_request` | `onHumanInputRequest` |
| `response.hitl_aborted` | `onHitlAborted` |
| `response.completed` | `onDone` |
| `response.failed` | `onError` |

### 11.2 传输层

- `AgentTransport` 接口不变（sendMessage / resume / abort / getState / stop）
- `HttpTransport` / `IpcTransport` 的事件分发器从 AG-UI 版替换为 Responses 版即可
- 协议格式由 `RESPONSES_PROTOCOL` 开关控制（默认 `'agui'`，安全默认）

---

## 12. 迁移路径（四阶段，与云边双模阶段解耦）

| 阶段 | 内容 | 验收标准 |
|------|------|----------|
| **A：双协议并存（后端）** | backend-ts 新增 `/v1/responses` 端点组，内部走现有 agent-bridge，新增 `ResponsesStreamAdapter`（AG-UI 事件 → Responses 事件重编码）；`/agent/*` 不动 | curl 冒烟：SSE 输出含 `event:` 字段；§7 时序逐帧正确 |
| **B：渲染端切换** | 新增 `createResponsesEventDispatcher`；transport 增加协议开关；验证全链路（含 HITL 三事件） | 单测覆盖分发映射；HTTP 模式全链路回归通过 |
| **C：IPC 通道同步** | agent-runtime 换用 `ResponsesStreamAdapter`；IPC envelope 承载 Responses 事件对象 | IPC 模式冒烟通过；HITL 暂停/恢复/中止正常 |
| **D：AG-UI 下线（可选）** | 确认稳定后移除 AG-UI 端点与分发器 | 全量回归通过，确认无外部依赖 AG-UI |

### 12.1 改动文件清单

| 文件 | 改动 |
|------|------|
| `packages/modu-agent/src/orchestration/communication/responses-adapter.ts` | **新增**：`ResponsesStreamAdapter`（事件重编码 + ID 生成 + sequence 管理） |
| `apps/backend-ts/routes/responses.ts` | **新增**：`/v1/responses` 端点组（SSE / resume / abort / state / stop） |
| `apps/backend-ts/core/agent-bridge.ts` | 可选：复用/扩展 metadata 收集与工具审批判定 |
| `apps/desktop/src/renderer/src/services/api/responses.ts` | **新增**：Responses 事件分发器 + 流式封装 |
| `apps/desktop/src/renderer/src/services/transport/*` | 分发器替换 + `RESPONSES_PROTOCOL` 开关 |
| `apps/desktop/src/main/agent-runtime.ts` | 适配器切换（阶段 C） |
| `apps/desktop/src/shared/types.ts` | 并入 §8 TS 类型定义 |

---

## 13. 验收清单

- [ ] **事件序列正确性**：单 run 内事件名合法、`sequence_number` 单调递增无跳号
- [ ] **标准事件完整**：message / function_call / reasoning 三类的 added→delta→done 闭环
- [ ] **工具结果同流**：`function_call_output` 在同一 response 流内到达（§5.2.7 语义）
- [ ] **HITL 三场景**：tool_confirm 暂停 → resume 续写同消息（§7.3）；abort 收敛（§7.4）；timeout 自动拒绝
- [ ] **状态查询**：暂停态 `GET /v1/responses/:response_id` 返回 pending=true、expires_at 正确
- [ ] **错误分层**：传输层 `response.error`、执行层 `response.failed` 均可达，错误码符合 §9.2
- [ ] **渲染端回归**：HTTP 模式全链路（含 HITL）与改造前行为一致；IPC 模式冒烟通过
- [ ] **回退**：`RESPONSES_PROTOCOL` 切回 `'agui'`，行为零变化

---

## 附录 A：与现有代码的对照索引

| 现有定义 | 位置 |
|---------|------|
| AG-UI 事件类型全集 | `packages/modu-agent/src/orchestration/communication/agui-adapter.ts`（`AGUIEventType`） |
| AG-UI 事件 payload 映射 | 同文件（`AGUIEventPayloadMap`） |
| HITL 暂停项 payload | 同文件 + `apps/desktop/src/shared/types.ts`（`UserQuestionRequestPayload`） |
| resume 请求体 | `apps/desktop/src/shared/types.ts`（`ResumeRequest`） |
| 暂停态查询响应 | 同文件（`HitlStateResponse`） |
| 工具能力矩阵 | `packages/modu-agent/src/tools/tool-registry.ts`（`TOOL_CAPABILITY_MATRIX`） |
| 工具审批判定 | `packages/modu-agent/src/tools/tool-guardrails.ts`（`checkGuardrail`） |
| 渲染端分发器 | `apps/desktop/src/renderer/src/services/api/agui.ts`（`createAguiEventDispatcher`） |
| 传输层抽象 | `apps/desktop/src/renderer/src/services/transport/types.ts`（`AgentTransport`） |
| 云边双模方案 | `docs/云边双模实施方案.md` |
