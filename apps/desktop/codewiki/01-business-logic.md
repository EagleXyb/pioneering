# 01 · 业务逻辑概述

## 1. 项目定位

Pioneering Desktop 是基于 **Electron 42 + React 19 + TypeScript + Tailwind v4** 的桌面 AI Agent 应用，采用 `electron-vite` 构建。提供聊天对话、Agent 任务执行、工作区文件编辑三大能力。

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  Main Process (src/main)                                    │
│  index.ts ─ 窗口创建 / CSP / 平台分支                        │
│  ipc-handlers.ts ─ 26 个 ipcMain.handle + 3 个 on            │
│  menu.ts ─ macOS 原生菜单                                   │
│  window-config.ts ─ 平台窗口样式                             │
└──────────────┬──────────────────────────────────────────────┘
               │ contextBridge (preload/index.ts)
               │ 暴露 window.api + window.electron
┌──────────────┴──────────────────────────────────────────────┐
│  Renderer (src/renderer)                                    │
│  ├─ services/api ─ axios(REST) + fetch(SSE 流式)             │
│  ├─ stores ─ Zustand(业务) + Jotai(UI)                       │
│  ├─ pages ─ Chat / Home / Agent / Workspace                  │
│  ├─ components ─ chat / sidebar / context-panel / settings   │
│  └─ hooks / lib / platform / menu                            │
└─────────────────────────────────────────────────────────────┘
               │
┌──────────────┴──────────────────────────────────────────────┐
│  Shared (src/shared)                                         │
│  types.ts / ipc-channels.ts / menu-template.ts               │
└─────────────────────────────────────────────────────────────┘
```

## 3. 路由与页面结构

入口 `main.tsx` 以 `React.StrictMode` 挂载 `App`。路由在 `App.tsx` 使用 `HashRouter`（Electron 桌面应用的合理选择，避免 file:// 协议下的 history 问题）：

| 路由 | 组件 | 说明 |
|------|------|------|
| `/`（index） | `ChatPage` | 默认落地页，直接进入聊天 |
| `/home` | `HomePage` | 欢迎页/功能导航 |
| `/agent` | `AgentPage` | Agent 执行页（当前为 mock 占位） |
| `/workspace` | `WorkspacePage` | 文件编辑工作区 |

所有路由共用 `RootLayout` 作为父布局。

## 4. 核心功能模块

### 4.1 窗口管理

- 1440×900 窗口，最小 1024×700，平台分支样式（mac `hiddenInset` / win-linux frameless）
- 窗口状态广播（maximize/unmaximize/fullscreen）
- `setWindowOpenHandler` 强制外部浏览器打开新窗口

### 4.2 IPC 通信

| 模式 | 用途 | 示例 |
|------|------|------|
| `ipcMain.handle` + `invoke` | 请求-响应 | 窗口控制、文件读写、store KV |
| `ipcMain.on` + `send` | fire-and-forget | 拖拽（避免 invoke 往返延迟） |
| 主进程 → 渲染端 `send` | 事件推送 | 窗口状态变化、菜单动作 |

26 个 `handle` + 3 个 `on`（拖拽），所有 `handle` 入口校验 `isTrustedSender`，路径相关操作额外做 `isValidFilePath` + `isPathAllowed` 校验。

### 4.3 API 服务层

项目使用两种通信方式，无 WebSocket：

1. **axios**（`client.ts`）：常规 REST 请求（GET/POST/PUT/DELETE）。单例 `apiClient`，timeout 60s。
2. **fetch + ReadableStream**（`client.ts` `stream()` 方法）：SSE 流式请求。

**认证机制**：

- Bearer Token 认证，请求拦截器自动附加 `Authorization: Bearer <accessToken>`
- 双 Token：accessToken + refreshToken，存储在 `ApiClient` 实例的内存字段中（不落 localStorage）
- 401 自动刷新：axios 拦截器 + `stream()` 方法均支持，使用 single-flight 模式避免 refresh token 并发轮换

### 4.4 AG-UI SSE 协议解析

支持的事件类型：`RUN_STARTED`、`THINKING_*`、`TEXT_MESSAGE_*`、`TOOL_CALL_*`、`RUN_FINISHED`、`RUN_ERROR`。

关键设计：

- 工具参数分片缓冲（`toolArgsBuffer`），`TOOL_CALL_ARGS` 累积后尝试 JSON 解析，成功才回调
- 兼容 `delta` 和 `content` 两个字段，适配后端契约变更

### 4.5 状态管理

| 库 | 文件 | 职责 |
|----|------|------|
| **Jotai** | `atoms.ts` | 细粒度 UI 状态：platformAtom、isFullscreenAtom、sidebarVisibleAtom、contextPanelVisibleAtom、settingsOpenAtom、settingsCategoryAtom（持久化）、userAtom（占位） |
| **Zustand** | `useAppStore.ts` | 主题模式（persist 中间件持久化） |
| **Zustand** | `chatStore.ts` | 聊天业务核心：会话列表、消息字典、流式状态、agentMode |
| **Zustand** | `useAgentStore.ts` | Agent 执行状态（实际未被真实业务使用） |
| **Zustand** | `useWorkspaceStore.ts` | 打开文件、最近项目 |

### 4.6 聊天业务核心流程

#### 消息发送流程（`chatStore.ts` `sendMessage`）

1. 若有旧 `abortController` → `abort()`
2. 若无 `currentSessionId` → `createSession(title)`
3. 生成单调递增 `streamSeq`（竞态守卫）
4. 构造 userMessage + assistantPlaceholder（`assistantMsgId = assistant-${now}-${mySeq}`）
5. `set` 注入两条消息 + 重置 streaming 状态
6. 根据 `agentMode` 选择 `agentService` / `chatService.sendMessageStream`
7. 请求体 `buildSendText(content)` 将 `@{}` 转为 `<select-file>`
8. 注册回调
9. `set({ abortController: controller })`

#### 流式响应处理

使用 rAF 批量更新（`scheduleUpdate`）：

- `pendingContent` / `pendingThinking` 累积增量
- 每帧最多 flush 一次到 `streamingContent` / `streamingThinking`（累积式写入）
- `liveToolCalls` 数组同步维护工具调用状态

#### 竞态守卫（M1）

`streamSeq` 为模块级单调递增序号。每个回调入口检查 `if (mySeq !== streamSeq) return`——旧流的回调发现自己不是最新流时立即丢弃。

#### 工具调用流程

```
onToolCallStart → liveToolCalls.push({status:'running', startTime})
onToolCallArgs  → 合并 arguments（{...prev.arguments, ...args}）
onToolCallResult → 更新 status: completed|error, 设置 result/errorMessage/endTime
```

`onDone` 时：

1. 取消 rAF
2. 合并 `streamingContent + pendingContent` 为最终正文
3. 通过 `findIndex(m => m.id === assistantMsgId)` 定位占位消息并替换
4. 可选回填 `meta.messageId`（后端真实 ID）、`model`、`tokenCount`

### 4.7 上下文管理

- 消息存储：`Record<sessionId, Message[]>`，全量内存缓存，无 LRU 淘汰
- `selectSession`：仅当 `messages[sessionId]` 不存在时才 `loadMessages`，且不 await（fire-and-forget）
- `mapContentBlocks`：将后端 `contentBlocks` 转换为前端 `thinking` + `toolCalls`，处理 `thinking`/`tool_call`/`tool_result` 三种块类型

### 4.8 停止生成

1. `abortController.abort()` 前端中断
2. `void stopper.stopGeneration?.(currentSessionId).catch(()=>{})` 通知后端（best-effort）
3. 合并已流式内容到消息（避免空气泡）

### 4.9 IPC 调用方式

`ipc.ts` 封装了 `window.api`（preload 注入）的类型安全调用。所有 API 通过 `getApi() => window.api` 获取，IPC 不可用时返回安全降级默认值。

| API 命名空间 | 功能 | 降级策略 |
|-------------|------|---------|
| `windowApi` | 窗口控制 | `isMaximized` → `Promise.resolve(false)` |
| `appApi` | 应用信息 | `getVersion` → `'0.0.0'` |
| `fileApi` | 文件对话框/读写 | `Promise.resolve({canceled:true,...})` |
| `notificationApi` | 系统通知 | 无降级 |
| `clipboardApi` | 剪贴板 | `read` → `Promise.resolve('')` |
| `shellApi` | 外部链接 | 无降级 |
| `storeApi` | KV 持久化 | `get` → `undefined`，`set` → `Promise.resolve(false)` |
| `healthApi` | 健康检查 | `ping` → `Promise.resolve('pong')` |

**窗口拖拽 rAF 节流**：`moveDrag` 由高频 `mousemove` 触发，通过模块级 `requestAnimationFrame` 合并，每帧最多发一次 IPC，只发最新坐标。`endDrag` 时 `flushDrag()` 冲刷最后一帧，防止松手漂移。

## 5. 菜单系统

### 5.1 数据驱动模板

`shared/menu-template.ts` 是单一数据源，4 个顶级菜单：

1. **Pioneering**（mac only）：关于 / 检查更新 / 退出
2. **编辑**：撤销/重做/剪切/复制/粘贴/全选（均带 CmdOrCtrl 加速键）
3. **窗口**：关闭窗口
4. **帮助**：使用文档 / 网络检查 / 打开日志目录 / 意见反馈 / 开发者工具

### 5.2 平台本地化

- macOS 由原生菜单处理（`Menu.setApplicationMenu`）
- Windows/Linux 由渲染端 HTML 渲染下拉菜单
- `formatAccelerator.ts` 把 Electron accelerator 转为平台符号（⌘/⇧/Ctrl）

## 6. 布局系统

### 6.1 双模式

`RootLayout` 实现三栏模式（`three-column`）与覆盖模式（`overlay`）：

- 三栏：`ResizablePanelGroup` + 3 个 `ResizablePanel`（sidebar/center/context-panel），始终渲染，通过 `collapse/expand` 控显隐
- 覆盖：中栏全宽 + 两个 `Drawer` 抽屉

### 6.2 平台差异 CSS 变量化

`platform/layout-tokens.css` 把所有平台差异下沉到 CSS 变量：

```css
:root[data-platform='mac'] { --titlebar-h: 38px; --radius-control: 6px; ... }
:root[data-platform='windows'] { --titlebar-h: 40px; --titlebar-leading: 8px; ... }
```

组件层只消费 `var(--titlebar-h)` 等语义变量，不再出现 `isMac ? '...' : '...'` 的平台硬编码。

### 6.3 ResizablePanel 按平台记忆

`autoSaveId={`pioneering-main-layout-${platform}`}`——按平台区分记忆，避免各 OS 窗口尺寸不同导致布局错乱。

## 7. XSS 防护

`MessageBubble` 实现了多层纵深防御：

1. 自定义 sanitize schema（基于 `hast-util-sanitize` 默认白名单扩展）
2. 显式收紧 `href` 协议为 `http/https/mailto`
3. `SafeLink` 组件：非 http(s) 链接降级为 `<span>`
4. 图片附件按 `mediaType` 区分：非 `image/*` 不作为 `<a href>` 打开（防 data: HTML 注入）
5. `rel="noreferrer noopener"` 防 reverse tabnabbing

## 8. 设置面板

数据驱动架构，`settingsConfig.tsx` 为单一数据源：

```ts
export const settingsCategories: SettingsCategory[] = [
  { id: 'api', label: 'API 连接', icon: Globe, Component: ApiConnectionSection },
  { id: 'auth', label: '认证', icon: Key, Component: AuthSection },
  { id: 'appearance', label: '外观', icon: Monitor, Component: AppearanceSection },
  { id: 'about', label: '关于', icon: Info, Component: AboutSection }
]
```

新增分类只需追加数组项，零改动外壳。
