# 05 · API 调用方式与 IPC 通道

## 1. HTTP 客户端（`services/api/`）

### 1.1 `client.ts`
统一 fetch 封装，所有 HTTP 请求入口。
- **BaseURL**：通过环境变量/配置注入（dev 走代理或直连后端）。
- **请求拦截**：自动注入 `Authorization: Bearer <token>`（来自 `authStore`）。
- **响应处理**：JSON 解析、错误统一抛出。
- **流式**：`post` 支持 `{ stream: true }`，返回 `ReadableStream`，交由 `stream-handler` 消费。
- **错误模型**：统一错误类型，包含 status / message / code。

### 1.2 业务 API 模块
| 文件 | 职责 |
| --- | --- |
| `auth.ts` | 登录、注册、刷新 token、获取用户信息 |
| `chat.ts` | 会话与消息：`sendMessage`（SSE 流）、获取历史、新建/删除会话 |
| `agent.ts` | Agent 相关：发起 Agent 任务、查询状态 |
| `agui.ts` | AGUI 协议相关接口（Agent GUI 交互） |

调用示例：
```ts
// 发送消息（流式）
const stream = await api.chat.sendMessage(sessionId, payload)
streamHandler.handleSSEStream(stream, { onToken, onThinking, onToolCallStart, ... })
```

## 2. SSE 流处理（`services/stream-handler.ts`）

解析后端 SSE 事件流，按事件类型分发回调：

| 事件 | 回调 | 作用 |
| --- | --- | --- |
| 文本 token | `onToken(text)` | 追加到 `streamingContent` |
| 思考 | `onThinking(text)` | 追加到 `streamingThinking` |
| 工具调用开始 | `onToolCallStart(toolCall)` | 加入 `streamingToolCalls` |
| 工具调用结束 | `onToolCallEnd(id, result)` | 更新结果与状态 |
| trace 节点 | `onTraceNode*(node)` | 经 `trace-builder` 构建树 |
| artifact | `onArtifact(artifact)` | 触发 `openArtifactAtom` |
| 结束 | `onDone()` / `onError(err)` | `finalizeMessage` 或回滚 |

## 3. Trace 树构建（`services/trace-builder.ts`）

- 接收流式 trace 节点事件，维护 `Record<string, TraceNode>` 与 `rootOrder: string[]`。
- 通过 `parentId` 建立父子关系，支持任意深度嵌套（为后端未来在 `TOOL_CALL_START` 携带 `parentCallId` 预留）。
- 产出供 `MessageBubble` / `TraceTreeRenderer` / `AgentTimeline` 消费。

## 4. Electron IPC（`services/ipc.ts` + `preload` + `main/ipc-handlers.ts`）

### 4.1 通道定义
通道名常量集中在 `shared/ipc-channels.ts`，主/渲染双方引用，避免拼写错误。

### 4.2 渲染侧封装（`services/ipc.ts`）
对 `window.xxxApi` 做薄封装并补充类型，组件统一从 `services/ipc` 导入：
```ts
import { fileApi, clipboardApi, windowApi, systemApi } from '@/services/ipc'
```

### 4.3 暴露的 API 命名空间
| 命名空间 | 主要方法 |
| --- | --- |
| `fileApi` | `read`、`write`、`selectFile`、`selectDirectory`、`saveDialog` |
| `clipboardApi` | `read`、`write` |
| `windowApi` | `minimize`、`maximize`、`close`、`isMaximized`、`setAlwaysOnTop`、`focus` |
| `systemApi` | `openExternal`、`getPlatform`、`getVersion` |

### 4.4 主进程 handler
`main/ipc-handlers.ts` 用 `ipcMain.handle(channel, handler)` 注册，实现：
- 文件读写：Node `fs`（注意路径校验，防止越权）。
- 对话框：`dialog.showSaveDialog` / `showOpenDialog`。
- 剪贴板：`clipboard.writeText` / `readText`。
- 窗口：`BrowserWindow.fromWebContents` 操作。
- 系统：`shell.openExternal`、`app.getVersion`、`process.platform`。

### 4.5 典型链路
- 复制 artifact：`ArtifactPanel` → `clipboardApi.write` → preload → `ipcRenderer.invoke` → main `clipboard.writeText`。
- 下载 artifact：`ArtifactPanel` → `fileApi.saveDialog`（选路径）→ `fileApi.write`（写盘）。
- 打开外链：`systemApi.openExternal` → `shell.openExternal`。

## 5. 开发期 Mock
`mocks/electron-mock.ts` 在非 Electron 环境（纯浏览器调试）模拟 `window.xxxApi`，使渲染层可脱离 Electron 运行。
