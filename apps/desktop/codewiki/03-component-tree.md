# 03 · 组件树与数据流

## 1. 顶层组件树

```
App.tsx (RouterProvider + createHashRouter)
└── RootLayout
    ├── Sidebar
    │   ├── SidebarNav                      # 顶部导航
    │   └── ConversationList                # 会话历史（虚拟化）
    │       └── SessionActionsDropdown
    ├── <Outlet/> → 各 Page
    │   └── ChatPage
    │       └── ChatArea
    │           ├── MessageScrollerList
    │           │   └── MessageBubble       # 单条消息
    │           │       ├── MarkdownRenderer
    │           │       ├── ThinkingBlock
    │           │       ├── ToolCallCard
    │           │       ├── TraceTreeRenderer → TraceNodeView
    │           │       ├── AgentTimeline → ObservationResult
    │           │       └── AttachmentList
    │           └── InputArea               # 输入区（文档模型 + @引用）
    ├── ContextPanel (可选显隐)
    ├── ArtifactPanel (可选显隐)
    │   └── ArtifactRender
    └── SettingsDialog (全局浮层)
```

## 2. 数据流总览

桌面端数据流分两类：**远端数据**（HTTP/SSE）与**本地能力**（Electron IPC）。

### 2.1 发送消息（写流）

```
InputArea (用户输入 + @引用)
  └─ chatStore.sendMessage(text, attachments, pluginRefs)
       ├─ 乐观追加 user Message 到 sessions[current].messages
       ├─ 追加 assistant 占位 Message（status: streaming）
       ├─ api/chat.sendMessage(sessionId, payload)
       │     └─ client.post('/chat/...', { stream: true })
       │           └─ fetch + ReadableStream (SSE)
       ├─ stream-handler.handleSSEStream(stream, callbacks)
       │     ├─ onToken        → chatStore.appendToken
       │     ├─ onThinking     → chatStore.appendThinking
       │     ├─ onToolCallStart/End → chatStore.updateToolCall
       │     ├─ onTraceNode*   → traceBuilder + chatStore.updateTrace
       │     └─ onArtifact     → artifactStore.openArtifact
       └─ 完成 → chatStore.finalizeMessage
```

### 2.2 接收流式数据（读流）

`services/stream-handler.ts` 解析 SSE 事件流，按事件类型分发到 `chatStore` 的回调，更新 `messages` 中的对应字段：
- 文本 token → `streamingContent`
- 思考 → `streamingThinking`
- 工具调用 → `streamingToolCalls`
- trace 节点 → `streamingTraceNodes` / `streamingTraceRootOrder`（由 `trace-builder.ts` 构建树）
- artifact → 触发 `openArtifactAtom`

`MessageBubble` 根据 `isStreaming` 读取 `streamingXxx` 字段实时渲染。

### 2.3 本地能力（IPC 数据流）

```
组件 (ArtifactPanel / InputArea / ...)
  └─ services/ipc.ts (fileApi / clipboardApi / windowApi / systemApi)
       └─ window.xxxApi (contextBridge)
            └─ preload/index.ts
                 └─ ipcRenderer.invoke(channel, ...args)
                      └─ main/ipc-handlers.ts (ipcMain.handle)
                           └─ 原生 fs / dialog / clipboard / shell
```

示例：
- `ArtifactPanel.handleDownload` → `fileApi.saveDialog` → 主进程弹出另存为对话框 → `fileApi.write` 写盘。
- `ArtifactPanel.handleCopy` → `clipboardApi.write` → 主进程写剪贴板；失败回退 `navigator.clipboard`。

### 2.4 状态联动

- `ContextPanel` 显隐 ↔ `contextPanelVisibleAtom`（Jotai）。
- `ArtifactPanel` 显隐 ↔ `activeArtifactAtom`（Jotai），打开 artifact 时联动 `highlightMessageAtom` 高亮源消息。
- 侧边栏导航高亮 ↔ 路由 + `ConversationList.selectionEnabled`（功能页时禁用会话行高亮，避免双高亮）。
- 消息列表滚动 ↔ `highlightMessageIdAtom`（跳转到源消息并短暂描边）。

## 3. 关键组件数据来源

| 组件 | 主要数据来源 |
| --- | --- |
| `ConversationList` | `chatStore.sessions` / `currentSessionId` |
| `MessageScrollerList` | `chatStore` 当前会话 `messages` + `streamingXxx` |
| `MessageBubble` | props.message + streaming props（由父级从 store 传入） |
| `AgentTimeline` | `traceNodes` / `traceRootOrder`（流式快照或历史） |
| `ArtifactPanel` | `activeArtifactAtom`（Jotai） |
| `ContextPanel` | `contextPanelVisibleAtom` + 当前会话上下文 |
| `InputArea` | 本地文档模型 + `selectedFiles` + 插件引用 |
| `SettingsDialog` | `useAppStore`（设置项）+ `settingsConfig` |

## 4. 组件复用与一致性

- `MarkdownRenderer` 为唯一 Markdown 渲染入口，`MessageBubble`（非 trace 路径）与 `TraceNodeView`（trace 路径）共用，保证安全策略与渲染一致。
- `TraceTreeRenderer` 递归渲染任意深度 trace，`AgentTimeline` 提供时间线视图，二者均消费 `TraceNode`。
- `MessageScrollerList` 基于 shadcn `MessageScroller`（content-visibility），替代旧 `@tanstack/react-virtual` 虚拟化方案；`ConversationList` 仍用 `react-virtual`（固定行高长列表）。
