# 05 · Agent 架构重构与功能扩展方案

> 基于 [04-agent-capability-assessment.md](./04-agent-capability-assessment.md) 的缺失分析，提供具体的代码重构与功能扩展建议，确保前后端 Agent 交互的稳定性与扩展性。

## 1. 目标架构

```
┌──────────────────────────────────────────────────────────────┐
│                        UI Layer                               │
│  ChatArea │ AgentWorkspace │ TaskPlanPanel │ ToolCallCard     │
│  DiffViewer(real) │ TerminalView(real) │ ApprovalDialog       │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────┴─────────────────────────────────────┐
│                     Store Layer (统一)                        │
│  agentStore (合并 useAgentStore + chatStore.agentMode)        │
│  ├─ sessions[] / messages{}                                   │
│  ├─ plan: { steps[]: { id, title, status, toolCalls[] } }    │
│  ├─ pendingApprovals[]: { toolCallId, toolName, args }       │
│  ├─ contextWindow: { used, limit, compactable }              │
│  └─ checkpoints[]: { sessionId, stepId, timestamp }          │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────┴─────────────────────────────────────┐
│                    Service Layer                              │
│  agentService                                                 │
│  ├─ sendMessageStream (SSE)                                   │
│  ├─ approveToolCall / rejectToolCall / editToolArgs           │
│  ├─ listSessions / updateSession / deleteSession              │
│  ├─ getExecutions / getExecutionResult                        │
│  ├─ resumeFromCheckpoint                                      │
│  └─ compactContext                                            │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────┴─────────────────────────────────────┐
│              Protocol Layer (AG-UI v2 扩展)                   │
│  原有: RUN_*/TEXT_MESSAGE_*/THINKING_*/TOOL_CALL_*            │
│  新增: PLAN_CREATED/STEP_*/TOOL_CALL_APPROVAL_REQUIRED/       │
│        PARALLEL_TOOL_GROUP/CONTEXT_COMPACTED/CHECKPOINT_*     │
└──────────────────────────────────────────────────────────────┘
```

## 2. 类型层重构

**目标**：消除僵尸定义，建立统一的 Agent 类型体系。重构 `src/shared/types.ts`。

### 2.1 删除/废弃

```typescript
// ===== 删除/废弃 =====
// - AgentExecuteRequest（未使用）
// - SSEChunk（与 agui.ts 不一致，移除或重命名）
// - AgentStep / AgentExecution（mock 专用，合并到新 Plan 体系）
```

### 2.2 新增：任务规划

```typescript
export interface AgentPlan {
  id: string
  sessionId: string
  goal: string
  steps: AgentPlanStep[]
  status: 'planning' | 'executing' | 'completed' | 'failed' | 'paused'
  createdAt: string
  updatedAt: string
}

export interface AgentPlanStep {
  id: string
  planId: string
  index: number
  title: string
  description?: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'
  toolCallIds: string[]        // 关联的工具调用
  parallelGroupId?: string     // 并行分组
  startedAt?: string
  completedAt?: string
  errorMessage?: string
}
```

### 2.3 扩展 ToolCall

```typescript
export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  result?: unknown
  status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'error' | 'rejected' | 'skipped'
  errorMessage?: string
  startTime?: number
  endTime?: number
  durationMs?: number
  stepId?: string              // 新增：所属步骤
  parentToolCallId?: string    // 新增：嵌套工具调用
  approval?: {
    required: boolean
    prompt?: string
    resolvedAt?: string
    resolvedBy?: 'user' | 'auto'
  }
}
```

### 2.4 新增：上下文窗口与检查点

```typescript
export interface ContextWindowState {
  usedTokens: number
  maxTokens: number
  compactable: boolean
  lastCompactedAt?: string
}

export interface AgentCheckpoint {
  id: string
  sessionId: string
  stepId?: string
  toolCallId?: string
  snapshot: unknown            // 序列化的 store 状态
  createdAt: string
}
```

### 2.5 扩展 ContentBlock

```typescript
export interface ContentBlock {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text_stream'
    | 'plan'                    // 新增：规划块
    | 'step'                    // 新增：步骤块
    | 'approval'               // 新增：审批块
  summary?: string
  toolName?: string
  executionId?: string
  text?: string
  // 新增字段
  stepId?: string
  planId?: string
}
```

## 3. 协议层扩展

**重构 `src/renderer/src/services/api/agui.ts`**。

### 3.1 新增事件类型

```typescript
export type AguiEventType =
  // 原有
  | 'RUN_STARTED' | 'RUN_FINISHED' | 'RUN_ERROR'
  | 'THINKING_START' | 'THINKING_TEXT_MESSAGE_CONTENT' | 'THINKING_END'
  | 'TEXT_MESSAGE_START' | 'TEXT_MESSAGE_CONTENT' | 'TEXT_MESSAGE_END'
  | 'TOOL_CALL_START' | 'TOOL_CALL_ARGS' | 'TOOL_CALL_RESULT'
  // 新增：任务规划
  | 'PLAN_CREATED' | 'PLAN_UPDATED'
  | 'STEP_STARTED' | 'STEP_COMPLETED' | 'STEP_FAILED' | 'STEP_SKIPPED'
  // 新增：人工确认
  | 'TOOL_CALL_APPROVAL_REQUIRED'
  // 新增：编排
  | 'PARALLEL_TOOL_GROUP_START' | 'PARALLEL_TOOL_GROUP_END'
  // 新增：上下文管理
  | 'CONTEXT_COMPACTED' | 'CONTEXT_WINDOW_UPDATE'
  // 新增：检查点
  | 'CHECKPOINT_CREATED'
```

### 3.2 扩展回调

```typescript
export interface AguiStreamCallbacks {
  // 原有回调...
  onChunk: (delta: string) => void
  onThinking?: (delta: string) => void
  onToolCallStart?: (tool: { id; name; arguments? }) => void
  onToolCallArgs?: (tool: { id; arguments }) => void
  onToolCallResult?: (tool: { id; name; result; status?; errorMessage?; arguments? }) => void
  onDone: (meta: { messageId?; sessionId?; model?; tokenCount? }) => void
  onError: (error: string) => void

  // 新增回调
  onPlanCreated?: (plan: { id; goal; steps: AgentPlanStep[] }) => void
  onPlanUpdated?: (plan: { id; steps: AgentPlanStep[]; status?: string }) => void
  onStepStarted?: (step: { id; index; title; parallelGroupId? }) => void
  onStepCompleted?: (step: { id; status; result?; errorMessage? }) => void
  onApprovalRequired?: (req: {
    toolCallId: string
    toolName: string
    arguments: Record<string, unknown>
    prompt?: string
  }) => void
  onParallelGroup?: (group: { id; toolCallIds: string[]; status: 'started' | 'ended' }) => void
  onContextCompacted?: (info: { compactedTokens: number; remainingTokens: number }) => void
  onContextWindowUpdate?: (state: ContextWindowState) => void
  onCheckpoint?: (cp: { id; stepId?; toolCallId? }) => void
}
```

### 3.3 SSE 解析器扩展

agui.ts 的 switch 分支新增：

```typescript
case 'PLAN_CREATED':
  cb.onPlanCreated?.({
    id: event.id,
    goal: event.goal,
    steps: event.steps ?? []
  })
  break

case 'STEP_STARTED':
  cb.onStepStarted?.({
    id: event.id,
    index: event.index,
    title: event.title,
    parallelGroupId: event.parallelGroupId
  })
  break

case 'TOOL_CALL_APPROVAL_REQUIRED':
  cb.onApprovalRequired?.({
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    arguments: tryParseToolArgs(event.arguments) ?? {},
    prompt: event.prompt
  })
  break

case 'CONTEXT_COMPACTED':
  cb.onContextCompacted?.({
    compactedTokens: event.compactedTokens,
    remainingTokens: event.remainingTokens
  })
  break
```

## 4. Store 层重构

**合并 useAgentStore 到 chatStore**，消除双轨。重构 `src/renderer/src/stores/chatStore.ts`。

### 4.1 新增字段

```typescript
interface ChatState {
  // ===== 原有字段保留 =====
  sessions: ChatSession[]
  currentSessionId: string | null
  messages: Record<string, Message[]>
  agentMode: boolean
  streamingContent: string
  streamingThinking: string
  streamingToolCalls: ToolCall[]
  streamingMessageId: string | null
  isStreaming: boolean
  abortController: AbortController | null

  // ===== 新增：任务规划 =====
  plans: Record<string, AgentPlan>           // planId → plan
  activePlanId: string | null                // 当前会话的激活 plan
  steps: Record<string, AgentPlanStep>       // stepId → step（扁平存储，O(1) 查找）

  // ===== 新增：人工确认队列 =====
  pendingApprovals: PendingApproval[]        // 待确认的工具调用

  // ===== 新增：上下文窗口 =====
  contextWindow: ContextWindowState

  // ===== 新增：检查点 =====
  checkpoints: Record<string, AgentCheckpoint[]>  // sessionId → checkpoints

  // ===== 新增方法 =====
  resolveApproval: (toolCallId: string, action: 'approve' | 'reject' | 'edit', editedArgs?: Record<string, unknown>) => Promise<void>
  compactContext: (sessionId: string) => Promise<void>
  resumeFromCheckpoint: (checkpointId: string) => Promise<void>
  retryToolCall: (toolCallId: string) => Promise<void>
  skipToolCall: (toolCallId: string) => void
}
```

### 4.2 resolveApproval 实现

```typescript
resolveApproval: async (toolCallId, action, editedArgs) => {
  const { currentSessionId } = get()
  if (!currentSessionId) return

  // 从 pendingApprovals 移除
  set((state) => ({
    pendingApprovals: state.pendingApprovals.filter((a) => a.toolCallId !== toolCallId)
  }))

  // 更新 ToolCall 状态
  set((state) => {
    const msgs = state.messages[currentSessionId]
    const updated = msgs.map((m) => ({
      ...m,
      toolCalls: m.toolCalls?.map((tc) =>
        tc.id === toolCallId
          ? {
              ...tc,
              status: action === 'approve' ? 'running' : 'rejected',
              arguments: editedArgs ?? tc.arguments
            }
          : tc
      )
    }))
    return { messages: { ...state.messages, [currentSessionId]: updated } }
  })

  // 通知后端
  await agentService.resolveApproval({
    toolCallId,
    action,
    editedArgs
  })
}
```

## 5. Service 层重构

**重构 `src/renderer/src/services/api/agent.ts`**，补齐缺失接口。

```typescript
export const agentService = {
  // ===== 原有 =====
  createSession: ...
  getSession: ...
  sendMessageStream: ...
  stopGeneration: ...

  // ===== 新增：会话管理补齐 =====
  listSessions: async (): Promise<AgentSession[]> => {
    const { data } = await apiClient.get<ApiResponse<AgentSession[]>>('/agent/sessions')
    return data.data
  },
  updateSession: async (id: string, req: UpdateAgentSessionRequest): Promise<void> => {
    await apiClient.put(`/agent/sessions/${id}`, req)
  },
  deleteSession: async (id: string): Promise<void> => {
    await apiClient.delete(`/agent/sessions/${id}`)
  },

  // ===== 新增：人工确认 =====
  resolveApproval: async (req: {
    toolCallId: string
    action: 'approve' | 'reject' | 'edit'
    editedArgs?: Record<string, unknown>
  }): Promise<void> => {
    await apiClient.post('/agent/tool-calls/approve', req)
  },

  // ===== 新增：上下文管理 =====
  compactContext: async (sessionId: string): Promise<{ compactedTokens: number }> => {
    const { data } = await apiClient.post<ApiResponse<{ compactedTokens: number }>>(
      `/agent/sessions/${sessionId}/compact`
    )
    return data.data
  },

  // ===== 新增：检查点恢复 =====
  resumeFromCheckpoint: async (checkpointId: string): Promise<void> => {
    await apiClient.post(`/agent/checkpoints/${checkpointId}/resume`)
  },

  // ===== 激活已有但未用的接口 =====
  getExecutions: ...  // 已存在，接通到 UI
  getExecutionResult: ...  // 已存在，接通到 UI
}
```

## 6. 功能扩展方案

### 6.1 任务规划与拆解

**UI 组件：TaskPlanPanel**（新增，挂在 ChatArea 顶部或 ContextPanel 新 Tab）

```tsx
// components/chat/TaskPlanPanel.tsx
function TaskPlanPanel({ plan }: { plan: AgentPlan }) {
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <ListTodo className="size-4" />
        <span className="font-medium">{plan.goal}</span>
        <StepProgress steps={plan.steps} />
      </div>
      <div className="space-y-1">
        {plan.steps.map((step) => (
          <StepItem key={step.id} step={step} toolCalls={getToolCallsForStep(step.id)} />
        ))}
      </div>
    </div>
  )
}

function StepItem({ step, toolCalls }: { step: AgentPlanStep; toolCalls: ToolCall[] }) {
  return (
    <div className="flex items-start gap-2 pl-4">
      <StepStatusIcon status={step.status} />
      <div className="flex-1">
        <div className="text-sm">{step.title}</div>
        {toolCalls.length > 0 && (
          <div className="ml-4 mt-1 space-y-1">
            {toolCalls.map((tc) => <ToolCallCard key={tc.id} toolCall={tc} compact />)}
          </div>
        )}
      </div>
    </div>
  )
}
```

**数据流**：

```
SSE: PLAN_CREATED → onPlanCreated → store.plans[id] = plan
SSE: STEP_STARTED → onStepStarted → store.steps[id].status = 'in_progress'
SSE: TOOL_CALL_START (含 stepId) → store 关联 toolCall 到 step
SSE: STEP_COMPLETED → store.steps[id].status = 'completed'
```

### 6.2 人工确认机制

**UI 组件：ApprovalDialog**（新增）

```tsx
// components/chat/ApprovalDialog.tsx
function ApprovalDialog({ approval, onResolve }: {
  approval: PendingApproval
  onResolve: (action: 'approve' | 'reject' | 'edit', editedArgs?) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editedArgs, setEditedArgs] = useState(JSON.stringify(approval.arguments, null, 2))

  return (
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>工具调用确认</DialogTitle>
          <DialogDescription>
            Agent 请求执行 <code>{approval.toolName}</code>
            {approval.prompt && <p className="mt-2">{approval.prompt}</p>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>参数</Label>
            {editing ? (
              <Textarea value={editedArgs} onChange={(e) => setEditedArgs(e.target.value)} rows={8} />
            ) : (
              <pre className="text-xs bg-muted p-2 rounded">{editedArgs}</pre>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setEditing(!editing)}>
            {editing ? '完成编辑' : '编辑参数'}
          </Button>
          <Button variant="destructive" onClick={() => onResolve('reject')}>
            拒绝
          </Button>
          <Button onClick={() => onResolve('approve', editing ? JSON.parse(editedArgs) : undefined)}>
            批准执行
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**协议**：后端推送 `TOOL_CALL_APPROVAL_REQUIRED` → 前端弹窗 → 用户操作 → `POST /agent/tool-calls/approve` → 后端继续/中止流。

**ToolCallCard 扩展**（增加批准按钮，内联模式）：

```tsx
// ToolCallCard.tsx 扩展
{toolCall.status === 'awaiting_approval' && (
  <div className="flex gap-2 mt-2">
    <Button size="sm" variant="default" onClick={() => onApprove(toolCall.id)}>
      <Check className="size-3" /> 批准
    </Button>
    <Button size="sm" variant="destructive" onClick={() => onReject(toolCall.id)}>
      <X className="size-3" /> 拒绝
    </Button>
    <Button size="sm" variant="ghost" onClick={() => onEdit(toolCall.id)}>
      编辑参数
    </Button>
  </div>
)}
```

### 6.3 文件编辑与 Diff 审查

**重构 `src/renderer/src/components/context-panel/DiffViewer.tsx`**：

1. 引入 `diff` 库（`npm i diff`）
2. 数据源从 `useActiveFile()` 改为订阅 Agent 工具调用结果

```tsx
// DiffViewer.tsx 重构
import { diffLines } from 'diff'

function DiffViewer({ toolCall }: { toolCall?: ToolCall }) {
  // 从 edit_file / apply_diff 工具调用提取 original vs modified
  const { original, modified, filePath } = parseEditToolResult(toolCall)
  const diffResult = diffLines(original, modified)

  const handleApply = async () => {
    await ipc.file.write(filePath, modified)
    onApplied(filePath)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-2 border-b">
        <span className="text-sm font-medium">{filePath}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="destructive" onClick={onReject}>拒绝</Button>
          <Button size="sm" onClick={handleApply}>应用变更</Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="font-mono text-xs">
          {diffResult.map((part, i) => (
            <div
              key={i}
              className={cn(
                'flex',
                part.added && 'bg-green-500/10',
                part.removed && 'bg-red-500/10'
              )}
            >
              <span className="w-8 text-muted-foreground select-none">
                {part.added ? '+' : part.removed ? '-' : ' '}
              </span>
              <pre className="flex-1 whitespace-pre-wrap">{part.value}</pre>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
```

**工具调用结果与 DiffViewer 联动**：当 `TOOL_CALL_RESULT` 事件返回 `toolName === 'edit_file'` 时，自动切换 ContextPanel 到 Diff Tab 并传入 toolCall。

### 6.4 终端执行能力

**主进程新增 PTY IPC**（`src/main/ipc-handlers.ts` 扩展）：

```typescript
import { spawn } from 'node-pty'

// 新增 IPC 通道
ipcMain.handle(IpcChannel.TERMINAL_SPAWN, (event, command: string, cwd: string) => {
  if (!isTrustedSender(event)) return null
  const pty = spawn(process.env.SHELL || '/bin/bash', ['-c', command], {
    cwd,
    cols: 80,
    rows: 24
  })
  const id = pty.pid.toString()
  terminals.set(id, pty)

  pty.onData((data) => {
    event.sender.send(IpcChannel.TERMINAL_OUTPUT, { id, data })
  })
  pty.onExit(({ exitCode }) => {
    event.sender.send(IpcChannel.TERMINAL_EXIT, { id, exitCode })
    terminals.delete(id)
  })

  return { id }
})
```

**重构 `src/renderer/src/components/context-panel/TerminalView.tsx`**：

- 引入 `xterm.js` + `@xterm/addon-fit`
- 订阅 `TERMINAL_OUTPUT` IPC 事件
- 当 Agent 触发 `run_command` 工具时，自动在此面板展示实时输出

### 6.5 多轮记忆与上下文管理

**新增组件：ContextIndicator**（挂在 InputArea 顶部）

```tsx
// components/chat/input/ContextIndicator.tsx
function ContextIndicator({ state }: { state: ContextWindowState }) {
  const ratio = state.usedTokens / state.maxTokens
  const status = ratio < 0.7 ? 'ok' : ratio < 0.9 ? 'warning' : 'critical'

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <Progress value={ratio * 100} className={cn('h-1 w-24', statusColor[status])} />
      <span>{formatTokens(state.usedTokens)} / {formatTokens(state.maxTokens)}</span>
      {state.compactable && ratio > 0.8 && (
        <Button size="sm" variant="ghost" onClick={onCompact}>
          压缩上下文
        </Button>
      )}
    </div>
  )
}
```

**协议**：后端在每次 `RUN_FINISHED` 时附带 `CONTEXT_WINDOW_UPDATE` 事件，前端更新占用；超 80% 提示用户手动压缩或自动触发。

### 6.6 中断与恢复

**目标**：中断后可从检查点恢复。

**store 新增**：

```typescript
resumeFromCheckpoint: async (checkpointId) => {
  const cp = get().checkpoints[currentSessionId]?.find(c => c.id === checkpointId)
  if (!cp) return

  // 恢复 store 状态
  set(restoreFromSnapshot(cp.snapshot))

  // 通知后端从检查点继续
  await agentService.resumeFromCheckpoint(checkpointId)

  // 重新建立 SSE 流
  // ...
}
```

**协议**：后端在关键节点（如步骤完成、工具调用完成）推送 `CHECKPOINT_CREATED`，前端存储到 `checkpoints[sessionId]`。

## 7. UI 交互重构方案

### 7.1 整体布局重构

```
┌─────────────────────────────────────────────────────────────────┐
│ TitleBar                                                        │
├──────────┬──────────────────────────────────┬───────────────────┤
│          │ ChatArea                         │ ContextPanel      │
│ Sidebar  │ ┌──────────────────────────────┐ │ ┌───────────────┐ │
│          │ │ TaskPlanPanel (新增)          │ │ │ Code | Diff   │ │
│ 会话列表  │ │  ├─ Step 1 ✓ [tool_call]    │ │ │      | Terminal│ │
│ 文件树    │ │  ├─ Step 2 ▶ [tool_call]    │ │ │               │ │
│          │ │  └─ Step 3 ○                │ │ │ DiffViewer    │ │
│          │ └──────────────────────────────┘ │ │ (真实 diff)   │ │
│          │ MessageList                      │ │ + Apply/Reject │ │
│          │  ├─ MessageBubble                │ ├───────────────┤ │
│          │  │   ├─ ThinkingBlock            │ │ TerminalView  │ │
│          │  │   ├─ ToolCallCard             │ │ (真实 PTY)    │ │
│          │  │   │   └─ [批准/拒绝] (新增)    │ │               │ │
│          │  │   └─ ReactMarkdown            │ └───────────────┘ │
│          │  └─ ...                          │                   │
│          ├──────────────────────────────────┤                   │
│          │ ContextIndicator (新增)          │                   │
│          │ InputArea                        │                   │
│          └──────────────────────────────────┘                   │
└──────────┴──────────────────────────────────┴───────────────────┘
```

### 7.2 组件改造清单

| 组件 | 改造类型 | 说明 |
|------|----------|------|
| `TaskPlanPanel` | 新增 | 任务规划展示，步骤树 + 工具调用关联 |
| `ApprovalDialog` | 新增 | 人工确认弹窗 |
| `ContextIndicator` | 新增 | 上下文窗口占用指示 |
| `DiffViewer` | 重写 | 接入 `diff` 库，支持 Apply/Reject |
| `TerminalView` | 重写 | 接入 xterm.js + node-pty |
| `CodePreview` | 增强 | 接入 highlight.js，支持行号 |
| `ToolCallCard` | 增强 | 新增批准/拒绝/编辑/重试/耗时/嵌套 |
| `ThinkingBlock` | 增强 | 分阶段标记、耗时、与工具关联 |
| `AgentPage` | 删除或重写 | 删除 mock，或重写为 Agent 工作台 |

### 7.3 删除/废弃清单

| 文件/类型 | 操作 | 原因 |
|-----------|------|------|
| `src/renderer/src/stores/useAgentStore.ts` | 删除 | mock 专用，合并到 chatStore |
| `src/renderer/src/pages/AgentPage.tsx` | 删除或重写 | 100% mock，误导维护者 |
| `AgentStep` / `AgentExecution` 类型 | 删除 | 合并到 `AgentPlanStep` / `AgentPlan` |
| `AgentExecuteRequest` 类型 | 删除 | 未使用 |
| `SSEChunk` 类型 | 删除 | 与 agui.ts 不一致 |
| `ThinkingBlock.duration` | 实现或删除 | 僵尸字段 |

## 8. 实施路线图

### 阶段一：架构清理（P0 基础）

1. 删除 useAgentStore / AgentPage mock 代码
2. 清理 types.ts 僵尸定义
3. 合并 agentMode 逻辑到统一 chatStore
4. 补齐 agentService 会话管理接口（list/update/delete）
5. 统一 Agent 会话与普通会话的 store 订阅模式

### 阶段二：协议与类型扩展

1. agui.ts 新增 PLAN/STEP/APPROVAL/PARALLEL/CONTEXT/CHECKPOINT 事件解析
2. types.ts 新增 AgentPlan / AgentPlanStep / ContextWindowState / AgentCheckpoint
3. 扩展 ToolCall 类型（stepId / parentToolCallId / approval / awaiting_approval 状态）
4. 扩展 ContentBlock 类型（plan / step / approval 块）

### 阶段三：核心 Agent 能力

1. 实现任务规划 UI（TaskPlanPanel）
2. 实现人工确认机制（ApprovalDialog + ToolCallCard 扩展）
3. 重写 DiffViewer（接入 diff 库 + Apply/Reject）
4. 增强 CodePreview（语法高亮）
5. 接通 getExecutions 到 UI（工具执行明细回看）

### 阶段四：高级能力

1. 重写 TerminalView（xterm.js + node-pty）
2. 实现上下文窗口管理（ContextIndicator + compact）
3. 实现中断/恢复（checkpoint）
4. 工具调用编排（并行分组可视化）
5. ThinkingBlock 增强（分阶段/耗时）

### 阶段五：体验优化

1. 消息列表虚拟化
2. 上下文双向注入（Agent 结果 → ContextPanel）
3. 长期记忆/知识库（RAG UI）
4. 多 Agent 协作
