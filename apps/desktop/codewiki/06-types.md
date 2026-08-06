# 06 · 关键类型定义

> 定义集中在 `src/shared/types.ts`（主/渲染共享）与各 store/组件内。以下仅列核心类型与字段语义，完整字段以源码为准。

## 1. 消息与会话

### `Session`
```ts
interface Session {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  // ...其它会话元信息
}
```

### `Message`
```ts
type MessageRole = 'user' | 'assistant' | 'system'

interface Message {
  id: string
  role: MessageRole
  content: string
  thinking?: string                 // 助手思考内容
  toolCalls?: ToolCall[]            // 扁平工具调用（旧路径）
  traceNodes?: Record<string, TraceNode>  // trace 树（历史）
  traceRootOrder?: string[]
  images?: string[]                 // 用户图片（dataUrl）
  attachments?: Attachment[]        // 文件附件
  feedback?: 'none' | 'up' | 'down'
  status?: 'streaming' | 'done' | 'error'
  createdAt: number
  // 流式期间临时字段（仅 assistant 占位消息）
  streamingContent?: string
  streamingThinking?: string
  streamingToolCalls?: ToolCall[]
  streamingTraceNodes?: Record<string, TraceNode>
  streamingTraceRootOrder?: string[]
}
```

## 2. 工具调用

### `ToolCall`
```ts
interface ToolCall {
  id: string
  name: string                 // 工具名（如 web_search）
  args?: Record<string, unknown>
  result?: unknown
  status: 'running' | 'success' | 'error'
  startTime?: number
  endTime?: number
  durationMs?: number
}
```

## 3. Trace 树

### `TraceNode`
```ts
type TraceNodeKind = 'text' | 'thinking' | 'tool_call' | 'observation' | 'agent' | ...

interface TraceNode {
  id: string
  kind: TraceNodeKind
  parentId?: string
  children: string[]           // 子节点 id
  status?: 'running' | 'completed' | 'error'
  startTime?: number
  endTime?: number
  durationMs?: number
  // 按 kind 携带不同载荷
  text?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  observation?: unknown
  // ...
}
```

- `traceNodes`：`id → node` 映射。
- `traceRootOrder`：根节点 id 有序列表。
- `TraceTreeRenderer` 递归渲染；`text` 节点不渲染外壳，仅递归其子节点。

## 4. Artifact

### `ArtifactType`
```ts
type ArtifactType =
  | 'html' | 'svg' | 'code' | 'image' | 'markdown' | ...
```

### `Artifact`
```ts
interface Artifact {
  id: string
  type: ArtifactType
  title?: string
  language?: string            // 代码类产物语言
  content: string
  sourceMessageId?: string     // 源消息（用于高亮回溯）
}
```

- `activeArtifactAtom` 持有当前预览 artifact。
- `highlightMessageAtom` 触发源消息高亮。

## 5. 输入区文档模型（`lib/input/select-file-editor.ts`）

```ts
type EditorDocumentNode =
  | EditorTextNode
  | EditorFileNode
  | EditorPluginNode

interface EditorTextNode   { type: 'text';   id: string; text: string }
interface EditorFileNode   { type: 'file';   id: string; fileId: string; fallbackText: string }
interface EditorPluginNode { type: 'plugin'; id: string; pluginId: string; label: string; prompt: string }

interface SelectedFileItem { id: string; path: string; name: string }
```

- 文档模型与序列化文本（含 `@{}` 标签）互转，是 token 计算、光标定位、发送与草稿持久化的统一中间表示。
- 标签解析见 `lib/input/select-file-tags.ts`：`createSelectFileToken`、`createSelectPluginTag`、`parseSelectFileText`、`SelectPluginPayload`。

## 6. Store State 关键形态

### `chatStore` State（节选）
```ts
{
  sessions: Session[]
  currentSessionId: string | null
  // actions 见 04-state-management.md
}
```

### `authStore` State（节选）
```ts
{
  token: string | null
  user: User | null
  isAuthenticated: boolean
}
```

## 7. 组件 Props（关键）

### `MessageBubbleProps`
```ts
interface MessageBubbleProps {
  message: ChatMessage
  isStreaming?: boolean
  streamingContent?: string
  streamingThinking?: string
  streamingToolCalls?: ToolCall[]
  streamingTraceNodes?: Record<string, TraceNode>
  streamingTraceRootOrder?: string[]
}
```

### `TraceTreeRendererProps`
```ts
interface TraceTreeRendererProps {
  nodes: Record<string, TraceNode>
  rootIds: string[]
  depth?: number
}
```

### `AgentTimelineProps`
```ts
interface AgentTimelineProps {
  nodes: Record<string, TraceNode>
  rootOrder: string[]
  isStreaming?: boolean
}
```

### `ConversationListProps`
```ts
interface ConversationListProps {
  selectionEnabled?: boolean  // 功能页路由传 false，避免双高亮
}
```

## 8. IPC 相关类型
- `shared/ipc-channels.ts`：通道名常量（字符串字面量联合）。
- `preload/index.d.ts`：`window.fileApi` / `clipboardApi` / `windowApi` / `systemApi` 全局类型声明。
