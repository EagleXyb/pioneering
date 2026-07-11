# 04 · Agent 能力现状评估

> 对标 Claude Code / Cursor / Devin / OpenAI Assistants API 等成熟 AI Agent 应用，评估当前代码库的 Agent 能力现状与缺失。

## 1. 双轨分裂问题

当前代码库存在**两套并行且互不相通的 Agent 抽象**，这是最核心的架构债务。

```
┌─────────────────────────────────────────────────────────────┐
│  Mock 轨道（闲置）                                          │
│  useAgentStore + AgentPage + AgentStep/AgentExecution       │
│  ─ 步骤驱动、硬编码 mock、零真实 API 调用                   │
│  ─ 入口：/agent 路由（用户不可达真实 Agent）                │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│  生产轨道（真实链路）                                       │
│  chatStore.agentMode + agentService + ToolCall/ContentBlock │
│  ─ 工具调用驱动、SSE 流式、生产可用                         │
│  ─ 入口：主聊天界面 "Agent 模式" 开关                       │
└─────────────────────────────────────────────────────────────┘
```

### 证据对比

| 维度 | Mock 轨道 | 生产轨道 |
|------|-----------|----------|
| Store | `src/renderer/src/stores/useAgentStore.ts` | `src/renderer/src/stores/chatStore.ts` |
| 页面 | `src/renderer/src/pages/AgentPage.tsx`（L20-33 硬编码 4 步 + setTimeout） | ChatPage → ChatArea |
| 类型 | `AgentStep` / `AgentExecution`（`src/shared/types.ts:201-219`） | `ToolCall` / `ContentBlock`（`src/shared/types.ts:79-90,167-177`） |
| 服务 | 无 | `src/renderer/src/services/api/agent.ts` |
| 互引用 | **无** | **无** |

`useAgentStore` 的 `startExecution`/`addStep`/`completeExecution` 从未被真实 API 调用；`AgentPage` 用 `setTimeout` 模拟延时，与 `agentService` 完全脱节。

## 2. 协议层能力盘点

agui.ts 实现了一个通用的 AG-UI SSE 解析器，**chat 与 agent 共用同一套事件类型**，协议层无任务语义。

### 2.1 支持的事件（`src/renderer/src/services/api/agui.ts:134-228`）

| 事件 | 行号 | 处理逻辑 |
|------|------|----------|
| `RUN_STARTED` | L135-137 | 捕获 `threadId` → `capturedSessionId` |
| `THINKING_TEXT_MESSAGE_CONTENT` | L144-151 | 取 `event.delta ?? event.content` → `cb.onThinking(delta)` |
| `TEXT_MESSAGE_START` | L157-159 | 捕获 `messageId` |
| `TEXT_MESSAGE_CONTENT` | L161-168 | 取 `event.delta ?? event.content` → `cb.onChunk(text)` |
| `TOOL_CALL_START` | L173-181 | 注册 `{id, name}` 到 `toolCalls` Map，初始化 `toolArgsBuffer` |
| `TOOL_CALL_ARGS` | L184-192 | 累积分片到 `toolArgsBuffer`，`tryParseToolArgs` 成功后回调 |
| `TOOL_CALL_RESULT` | L195-214 | 回填结果，调用 `onToolCallResult` |
| `RUN_FINISHED` | L216-223 | 回调 `onDone` |
| `RUN_ERROR` | L225-227 | 回调 `onError` |

### 2.2 不支持的事件（对标成熟 Agent 应用所需）

| 缺失事件 | 用途 | 对标 |
|----------|------|------|
| `PLAN_CREATED` / `STEP_STARTED` / `STEP_COMPLETED` | 任务规划与拆解 | Devin Session Plan、Claude Code TodoWrite |
| `TOOL_CALL_APPROVAL_REQUIRED` | 人工确认 | Claude Code permission、Devin action approval |
| `PARALLEL_TOOL_GROUP` | 并行工具编排 | OpenAI Assistants parallel tool calls |
| `CONTEXT_COMPACTED` | 上下文压缩 | Claude Code compaction |
| `MEMORY_UPDATED` | 长期记忆 | Devin long-term memory |
| `CHECKPOINT_CREATED` | 断点恢复 | Devin session resume |

## 3. 类型层僵尸定义

以下类型已定义但未被真实链路消费：

| 类型 | 位置 | 状态 |
|------|------|------|
| `AgentExecuteRequest` | `src/shared/types.ts:138-143` | agent.ts 实际用 `SendMessageRequest`，此类型形同虚设 |
| `AgentStep` / `AgentExecution` | `src/shared/types.ts:201-219` | 仅 mock 使用 |
| `AgentToolExecution` | `src/shared/types.ts:146-159` | `getExecutions`/`getExecutionResult` 接口前端从未调用 |
| `ThinkingBlock.duration` | `src/shared/types.ts:162-165` | 定义了但从未赋值 |
| `ToolCall.startTime` / `endTime` | `src/shared/types.ts:167-177` | store 赋值但 UI 不渲染 |
| `SSEChunk` | `src/shared/types.ts:107-115` | 旧式定义，与 agui.ts 实际事件不一致 |

## 4. chat vs agent 流式差异

两个 service 都调用同一个 `streamAgui` 解析器，**唯一差异是 URL 端点**：

| 维度 | chatService (`chat.ts`) | agentService (`agent.ts`) |
|------|-------------------------|---------------------------|
| 流式端点 | `/chat/completions` (L132) | `/agent/completions` (L33) |
| 请求类型 | `SendMessageRequest` | `SendMessageRequest`（**不是 `AgentExecuteRequest`**） |
| 回调类型 | `AguiStreamCallbacks`（同一套） | `AguiStreamCallbacks`（同一套） |
| 停止端点 | `/chat/completions/stop` (L120) | `/agent/completions/stop` (L54) |
| 会话 CRUD | `/chat/sessions/*` 完整 | `/agent/sessions/*` 仅 create/get，**无 list/update/delete** |
| 工具执行查询 | 无 | `getExecutions(messageId)` (L37-42)、`getExecutionResult(executionId)` (L45-50) —— **前端从未调用** |
| 消息列表 | `getMessages` (L74-87) | 无 |
| 反馈/重生成 | `sendFeedback`/`regenerate` | 无 |

### 关键发现

1. chat 与 agent **共用同一套 SSE 解析与回调**，agent 并未引入任何额外事件类型或字段。Agent 的"工具调用"能力完全依赖后端是否在 `/agent/completions` 流里推送 `TOOL_CALL_*` 事件。
2. agent.ts 的 `sendMessageStream` 形参声明为 `SendMessageRequest`，而 types.ts 里专门定义的 `AgentExecuteRequest`（含 `instruction`/`agentType`）**形同虚设**。
3. Agent 会话管理能力残缺（无列表/更新/删除），且 `getExecutions`/`getExecutionResult` 两个明细查询接口在前端无人调用，等于死代码。

## 5. chatStore agentMode 实现

### 5.1 切换

- 状态定义：`agentMode: boolean`（`chatStore.ts:38`），初值 `false`
- 切换方法：`setAgentMode: (mode) => set({ agentMode: mode })`（L537）
- 唯一分支点：`sendMessage` L284 `(agentMode ? agentService : chatService).sendMessageStream(...)`

### 5.2 请求体完全一致

不会因为 agentMode 附加 tools/plan/systemPrompt 等字段。

### 5.3 工具调用存储

流式期间维护三个临时状态：`streamingContent` / `streamingThinking` / `streamingToolCalls`。`onDone` 时工具调用作为 `Message.toolCalls` 数组平铺存储，挂在 assistant 消息上。

### 5.4 无任务/步骤概念

chatStore 内完全没有 task/step/subtask/plan 概念。工具调用是扁平数组，没有：
- 步骤容器（哪个工具属于哪个步骤）
- 任务 ID 关联
- 规划阶段标记
- 并行/串行分组

## 6. UI 能力盘点

### 6.1 ToolCallCard

- 文件：`src/renderer/src/components/chat/ToolCallCard.tsx`
- 展示：工具名、状态图标、参数（JSON）、结果（2 行截断+展开）、错误信息
- 交互：**仅支持展开/收起结果文本**
- **不支持**：批准/拒绝/编辑参数/重试/取消单个工具/嵌套工具调用/工具分组/耗时/时间戳

### 6.2 ThinkingBlock

- 文件：`src/renderer/src/components/chat/ThinkingBlock.tsx`
- 展示：纯文本流，可折叠
- **不支持**：Markdown/代码高亮/耗时/分阶段标记/与工具调用的关联

### 6.3 ContextPanel 三块

| 组件 | 现状 | 差距 |
|------|------|------|
| `CodePreview.tsx` | 纯文本 `<pre>`，只读，无高亮/行号 | 缺高亮、行号、编辑 |
| `DiffViewer.tsx` | mock（第 1 行硬编码标绿，无真实 diff） | 缺真实 diff/apply/reject/多文件 |
| `TerminalView.tsx` | 100% 静态硬编码 | 缺真实 PTY/输入/输出流 |

## 7. 上下文注入机制

### 7.1 标签语法（`select-file-tags.ts`）

- `<select-file>path</select-file>`（L10）—— XML 形式，发送给后端用
- `@{path}`（L12）—— 内联 Token，编辑器内显示用
- `<select-plugin>{json}</select-plugin>`（L11）—— 插件引用

`buildSendText`（`select-file-editor.ts:247-256`）是 `chatStore.sendMessage` 实际调用的函数，把用户输入里的 `@{path}` 转 `<select-file>`。

### 7.2 单向问题

当前上下文注入**只服务于"用户手动 @ 文件"**：

- 用户在输入框 `@{path}` 引用文件 → 发送时 `buildSendText` 转成 `<select-file>` 标签 → 后端解析
- **Agent 主动读取/引用文件的结果不会回注到上下文**（Agent 工具调用读文件后，文件不会自动出现在 CodePreview 或选中文件列表）
- **无"Agent 工作集"概念**：没有 Agent 当前正在操作的文件集合
- 插件引用 `<select-plugin>` 定义了但**前端无 UI 创建入口**

## 8. 对标分析

对标四款成熟 Agent 应用的核心能力矩阵：

| 能力维度 | Claude Code | Cursor | Devin | OpenAI Assistants | **本项目** |
|----------|-------------|--------|-------|-------------------|------------|
| 多轮对话记忆 | ✅ 自动压缩 | ✅ 长上下文 | ✅ 跨会话 | ✅ Thread | ❌ 无压缩/无窗口管理 |
| 工具调用 Function Calling | ✅ 完整 | ✅ 完整 | ✅ 完整 | ✅ 完整 | ⚠️ 仅展示，无交互 |
| 任务规划与拆解 | ✅ TodoWrite | ✅ Plan | ✅ Session Plan | ⚠️ RunStep | ❌ 无 |
| 人工确认 HITL | ✅ Permission | ✅ Apply/Reject | ✅ Action Approval | ⚠️ Required Action | ❌ 完全缺失 |
| 文件编辑 | ✅ Edit/Write | ✅ Apply Diff | ✅ 完整 | ⚠️ Code Interpreter | ❌ DiffViewer mock |
| 终端执行 | ✅ Bash | ✅ Terminal | ✅ 完整 | ❌ | ❌ TerminalView mock |
| 工具编排（并行/串行） | ✅ 链式 | ✅ | ✅ DAG | ✅ Parallel | ❌ 扁平数组 |
| 长期记忆/知识库 | ⚠️ | ✅ Codebase | ✅ Long-term | ✅ File Search | ❌ 无 |
| 中断/恢复 | ✅ Resume | ⚠️ | ✅ Session Resume | ⚠️ | ⚠️ 仅中断无恢复 |
| 流式输出 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 思考过程 | ✅ 分阶段 | ⚠️ | ✅ Plan/Exec/Observe | ⚠️ | ⚠️ 纯文本流 |
| 多 Agent 协作 | ⚠️ | ❌ | ✅ Multi-agent | ⚠️ Swarm | ❌ |

**结论**：当前项目仅"流式输出"一项达到对标水平，其余 11 项均存在不同程度缺失。

## 9. 缺失能力清单

### P0 — 阻塞 Agent 对接的核心缺失

| # | 能力 | 缺失描述 | 影响面 |
|---|------|----------|--------|
| 1 | **双轨架构统一** | useAgentStore/AgentPage 与 chatStore.agentMode 完全分裂，无法演进 | 全局 |
| 2 | **任务规划事件** | 协议无 PLAN/STEP/SUBTASK 事件，无法展示 Agent 拆解过程 | 协议+Store+UI |
| 3 | **工具调用人工确认** | 无批准/拒绝/编辑参数机制，危险工具无法卡点 | 协议+Store+UI |
| 4 | **文件编辑 Diff 审查** | DiffViewer 是 mock，Agent 产出的文件变更无法审查/应用 | UI+IPC |
| 5 | **Agent 会话管理** | agentService 无 list/update/delete，会话与普通聊天混表 | Service |

### P1 — 严重影响 Agent 可用性

| # | 能力 | 缺失描述 |
|---|------|----------|
| 6 | 终端执行 | TerminalView 100% mock，无 PTY/命令执行 |
| 7 | 工具调用编排 | 无并行/串行/条件/DAG，扁平数组无法表达复杂流程 |
| 8 | 多轮记忆管理 | 无上下文压缩/裁剪/token 窗口估算 |
| 9 | 中断恢复 | 仅中断无恢复，无法从断点继续 |
| 10 | 工具调用 UI 增强 | 无嵌套/耗时/重试/结构化展示 |

### P2 — 提升体验与扩展性

| # | 能力 | 缺失描述 |
|---|------|----------|
| 11 | 思考过程增强 | 无分阶段/耗时/Markdown/工具关联 |
| 12 | 长期记忆/知识库 | 无 Memory 实体/向量库/RAG UI |
| 13 | 多 Agent 协作 | 无 Agent 实体/子 Agent 派发 |
| 14 | 上下文双向注入 | 仅用户@文件→后端，无 Agent 结果→前端面板回注 |
| 15 | 工具执行明细回看 | getExecutions 接口存在但前端无人调用 |

## 10. 关键架构发现汇总

1. **双轨分裂**：存在 mock 轨道（useAgentStore + AgentPage + AgentStep/AgentExecution 类型）与生产轨道（chatStore.agentMode + agentService + ToolCall/ContentBlock 类型），二者完全不互通。`/agent` 页面是死路，真实 Agent 能力藏在主聊天界面的 agentMode 开关里。

2. **协议层无任务语义**：agui.ts 是通用 SSE 解析器，Agent 与普通聊天共用同一套事件，无 Plan/Step/Subtask/Approval 语义。

3. **类型层僵尸定义**：`AgentExecuteRequest`、`AgentStep`、`AgentExecution`、`AgentToolExecution` 的查询接口、`ThinkingBlock.duration`、`ToolCall.startTime/endTime` 等均定义但未被真实链路消费。

4. **ContextPanel 三块全部不可用**：CodePreview 只读无高亮、DiffViewer 是 mock、TerminalView 是静态假终端。

5. **工具调用 UI 无任何人工干预**：ToolCallCard 仅展示，无批准/拒绝/编辑/重试/嵌套。

6. **上下文注入单向**：只支持用户 @ 文件 → 后端，不支持 Agent 工具结果 → 前端上下文面板的回注。
