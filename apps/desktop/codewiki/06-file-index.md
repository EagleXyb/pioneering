# 06 · 关键文件索引与阅读地图

> 按模块组织的关键文件索引，便于快速定位代码位置。

## 1. 主进程层（src/main）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [index.ts](../src/main/index.ts) | 窗口创建 / CSP / 平台分支 / 启动流程 | L31-38 CSP, L41-97 createWindow, L99-121 启动 |
| [ipc-handlers.ts](../src/main/ipc-handlers.ts) | 26 个 ipcMain.handle + 3 个 on | L73 isTrustedSender, L79-97 isPathAllowed, L264-313 文件读写 |
| [menu.ts](../src/main/menu.ts) | macOS 原生菜单构建 | L22-47 runAction, L49-70 buildAppMenu |
| [window-config.ts](../src/main/window-config.ts) | 平台窗口样式 | getWindowOptions |
| [resources.d.ts](../src/main/resources.d.ts) | 资源类型声明 | — |

## 2. Preload 层（src/preload）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [index.ts](../src/preload/index.ts) | contextBridge 暴露 window.api + window.electron | L10-41 window, L43-57 app, L59-65 file, L101-109 electron, L111-120 隔离降级 |
| [index.d.ts](../src/preload/index.d.ts) | 类型声明 | L3-7 MinimalElectronAPI, L9-73 PioneeringApi, L75-80 Window 扩展 |

## 3. 共享层（src/shared）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [types.ts](../src/shared/types.ts) | 全局类型定义 | L33-44 ChatSession, L61-73 ChatMessage, L79-90 ContentBlock, L107-115 SSEChunk, L118-159 Agent 系列, L162-199 UI 扩展, L201-219 AgentStep/Execution |
| [ipc-channels.ts](../src/shared/ipc-channels.ts) | IpcChannel 枚举与 IPC 类型 | L7-58 IpcChannel, L67-103 File 相关, L105 UserDataPath |
| [menu-template.ts](../src/shared/menu-template.ts) | 菜单模板（数据驱动） | L9-25 MenuActionId, L38-77 menuTemplate |
| [index.ts](../src/shared/index.ts) | Barrel re-export | — |

## 4. 服务层（src/renderer/src/services）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [api/client.ts](../src/renderer/src/services/api/client.ts) | axios 单例 + fetch SSE + Token 刷新 | L14 DEFAULT_BASE_URL, L18-19 token 字段, L33-41 请求拦截器, L54-71 401 刷新, L96-111 single-flight, L160-204 stream() |
| [api/agui.ts](../src/renderer/src/services/api/agui.ts) | AG-UI SSE 解析器 | L18-45 AguiStreamCallbacks, L48-56 tryParseToolArgs, L82 toolArgsBuffer, L134-228 事件 switch |
| [api/agent.ts](../src/renderer/src/services/api/agent.ts) | Agent 服务 | L17-26 createSession/getSession, L33 sendMessageStream, L37-50 getExecutions/getExecutionResult, L54 stopGeneration |
| [api/chat.ts](../src/renderer/src/services/api/chat.ts) | Chat 服务 | L25-87 会话 CRUD, L120 stopGeneration, L132 sendMessageStream |
| [api/auth.ts](../src/renderer/src/services/api/auth.ts) | 认证服务 | L53-55 logout |
| [api/index.ts](../src/renderer/src/services/api/index.ts) | Barrel re-export | — |
| [ipc.ts](../src/renderer/src/services/ipc.ts) | window.api 封装 | L20-64 拖拽 rAF 节流 |

## 5. 状态层（src/renderer/src/stores）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [chatStore.ts](../src/renderer/src/stores/chatStore.ts) | 聊天业务核心 | L27 messages 缓存, L38 agentMode, L56-102 mapContentBlocks, L115-119 streamSeq 守卫, L168-174 selectSession, L193-478 sendMessage, L266-282 rAF 批量, L480-535 stopStreaming, L537 setAgentMode, L539-557 deleteSession |
| [useAgentStore.ts](../src/renderer/src/stores/useAgentStore.ts) | Agent 执行状态（mock 专用，待删除） | L18-24 startExecution/addStep/completeExecution |
| [useAppStore.ts](../src/renderer/src/stores/useAppStore.ts) | 主题模式（persist） | — |
| [useWorkspaceStore.ts](../src/renderer/src/stores/useWorkspaceStore.ts) | 打开文件、最近项目 | — |
| [atoms.ts](../src/renderer/src/stores/atoms.ts) | Jotai UI 原子态 | L18 contextPanelVisibleAtom, L24-28 userAtom（占位） |

## 6. 页面层（src/renderer/src/pages）

| 文件 | 职责 | 状态 |
|------|------|------|
| [ChatPage.tsx](../src/renderer/src/pages/ChatPage.tsx) | 聊天页（极薄封装） | 生产可用 |
| [HomePage.tsx](../src/renderer/src/pages/HomePage.tsx) | 欢迎页/功能导航 | 生产可用 |
| [AgentPage.tsx](../src/renderer/src/pages/AgentPage.tsx) | Agent 执行页 | **100% mock，待删除或重写** |
| [WorkspacePage.tsx](../src/renderer/src/pages/WorkspacePage.tsx) | 文件编辑工作区 | 只读展示 |

## 7. 组件层（src/renderer/src/components）

### 7.1 聊天组件（chat/）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [ChatArea.tsx](../src/renderer/src/components/chat/ChatArea.tsx) | 聊天中栏容器 | L14-31 逐项 store 订阅, L42-50 自动滚动 |
| [MessageList.tsx](../src/renderer/src/components/chat/MessageList.tsx) | 消息列表 | L34-50 无虚拟化, L37-49 流式 props 传递 |
| [MessageBubble.tsx](../src/renderer/src/components/chat/MessageBubble.tsx) | 消息气泡 | L18-54 sanitizeSchema, L58-71 SafeLink, L138-167 图片附件, L182-188 ReactMarkdown |
| [ToolCallCard.tsx](../src/renderer/src/components/chat/ToolCallCard.tsx) | 工具调用卡片 | L13-18 状态图标, L41-45 参数, L48-68 结果 |
| [ThinkingBlock.tsx](../src/renderer/src/components/chat/ThinkingBlock.tsx) | 思考过程 | L21-42 Collapsible |
| [AgentStatus.tsx](../src/renderer/src/components/chat/AgentStatus.tsx) | 流式状态条 | — |

### 7.2 输入组件（chat/input/）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [InputArea.tsx](../src/renderer/src/components/chat/input/InputArea.tsx) | 输入区容器 | L159-205 菜单项（文案不一致）, L261-264 MODEL_OPTIONS, L607 IME 处理, L616-641 草稿持久化 |
| [FileAwareEditor.tsx](../src/renderer/src/components/chat/input/FileAwareEditor.tsx) | 双层叠加编辑器 | L67-87 EDITOR_TEXT_STYLE, L271 零宽字符, L305 死代码 span |
| [FileSearchPopover.tsx](../src/renderer/src/components/chat/input/FileSearchPopover.tsx) | 文件搜索浮层 | — |
| [SlashCommandPopover.tsx](../src/renderer/src/components/chat/input/SlashCommandPopover.tsx) | 斜杠命令浮层 | L16-22 BUILTIN_SLASH_COMMANDS |
| [ImagePreview.tsx](../src/renderer/src/components/chat/input/ImagePreview.tsx) | 图片预览 | — |
| [ContextRing.tsx](../src/renderer/src/components/chat/input/ContextRing.tsx) | 上下文压缩环 | **死代码，未使用** |
| [ComposerRuntimeStatus.tsx](../src/renderer/src/components/chat/input/ComposerRuntimeStatus.tsx) | 输入框运行时状态 | — |

### 7.3 上下文面板（context-panel/）

| 文件 | 职责 | 状态 |
|------|------|------|
| [ContextPanel.tsx](../src/renderer/src/components/context-panel/ContextPanel.tsx) | 三 Tab 容器 | 生产可用 |
| [CodePreview.tsx](../src/renderer/src/components/context-panel/CodePreview.tsx) | 代码预览 | **纯文本无高亮** |
| [DiffViewer.tsx](../src/renderer/src/components/context-panel/DiffViewer.tsx) | Diff 查看 | **mock，无真实 diff** |
| [TerminalView.tsx](../src/renderer/src/components/context-panel/TerminalView.tsx) | 终端 | **100% 静态硬编码** |

### 7.4 侧边栏（sidebar/）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [Sidebar.tsx](../src/renderer/src/components/sidebar/Sidebar.tsx) | 侧边栏容器 | L67 user.name.slice, L90-114 主题切换（与设置重复） |
| [ConversationList.tsx](../src/renderer/src/components/sidebar/ConversationList.tsx) | 会话列表（虚拟化） | L29 整 store 解构, L33-39 useVirtualizer, L51-54 删除无确认 |
| [FileTree.tsx](../src/renderer/src/components/sidebar/FileTree.tsx) | 打开文件列表 | L1 File 命名冲突 |

### 7.5 设置（settings/）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [settingsConfig.tsx](../src/renderer/src/components/settings/settingsConfig.tsx) | 数据驱动配置 | L26-31 settingsCategories |
| [SettingsDialog.tsx](../src/renderer/src/components/settings/SettingsDialog.tsx) | 弹框外壳 | L31 sr-only 描述 |
| [SettingsSidebar.tsx](../src/renderer/src/components/settings/SettingsSidebar.tsx) | 分类导航 | — |
| [sections/ApiConnectionSection.tsx](../src/renderer/src/components/settings/sections/ApiConnectionSection.tsx) | API 连接 | L18 测试前 setBaseURL Bug |
| [sections/AuthSection.tsx](../src/renderer/src/components/settings/sections/AuthSection.tsx) | 认证 | L10-14 状态不响应外部变化 |
| [sections/AppearanceSection.tsx](../src/renderer/src/components/settings/sections/AppearanceSection.tsx) | 外观 | L31 无效三元 |
| [sections/AboutSection.tsx](../src/renderer/src/components/settings/sections/AboutSection.tsx) | 关于 | L9 版本硬编码 |

### 7.6 UI 基础组件（ui/）

| 文件 | 备注 |
|------|------|
| [button.tsx](../src/renderer/src/components/ui/button.tsx) | L4 别名 `@renderer` 不统一 |
| [card.tsx](../src/renderer/src/components/ui/card.tsx) | 同上 |
| 其他（avatar/collapsible/dialog/dropdown-menu/resizable/scroll-area/tabs/textarea/tooltip） | 标准 shadcn/ui 封装 |

### 7.7 布局（layout/）

| 文件 | 职责 |
|------|------|
| [Drawer.tsx](../src/renderer/src/components/layout/Drawer.tsx) | 抽屉（覆盖模式） |

## 8. 布局与平台（src/renderer/src/layouts, platform）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [RootLayout.tsx](../src/renderer/src/layouts/RootLayout.tsx) | 三栏/覆盖双模式布局 | L43-145 双模式, L65 autoSaveId, L148-207 TopBarActions |
| [TitleBar.tsx](../src/renderer/src/layouts/TitleBar.tsx) | 标题栏（纯 IPC 拖拽） | L43-64 窗口按钮, L77-103 拖拽, L97-98 全局监听 |
| [layout-tokens.css](../src/renderer/src/platform/layout-tokens.css) | 平台 CSS 变量 | — |
| [usePanelToggle.ts](../src/renderer/src/platform/usePanelToggle.ts) | 面板同步 | L37-41 dead code |
| [useResponsiveLayout.ts](../src/renderer/src/platform/useResponsiveLayout.ts) | rAF 合并 resize | L17-32 |

## 9. 菜单（src/renderer/src/menu）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [MenuDropdown.tsx](../src/renderer/src/menu/MenuDropdown.tsx) | Win/Linux HTML 菜单 | L29-46 渲染 |
| [formatAccelerator.ts](../src/renderer/src/menu/formatAccelerator.ts) | 加速器符号化 | L14 split('+').pop()! |
| [menuActions.ts](../src/renderer/src/menu/menuActions.ts) | 菜单动作执行 | L27-43 execCommand |

## 10. Hooks（src/renderer/src/hooks）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [use-input-draft-persistence.ts](../src/renderer/src/hooks/use-input-draft-persistence.ts) | 草稿持久化 | L95 isFocused 守卫 |
| [useKeyboardShortcuts.ts](../src/renderer/src/hooks/useKeyboardShortcuts.ts) | 全局快捷键 | L30 Cmd+K 死快捷键 |
| [usePlatform.ts](../src/renderer/src/hooks/usePlatform.ts) | 平台检测 | — |

## 11. Lib（src/renderer/src/lib）

| 文件 | 职责 | 关键行号 |
|------|------|----------|
| [input/select-file-tags.ts](../src/renderer/src/lib/input/select-file-tags.ts) | 标签语法 | L10-12 三种标签, L92-120 parseSelectFileText, L185-188 serialize, L201-209 extractFilePaths |
| [input/select-file-editor.ts](../src/renderer/src/lib/input/select-file-editor.ts) | 文档模型 | L41 EditorDocumentNode, L122-148 deserialize, L247-256 buildSendText |
| [input/drag-folder.ts](../src/renderer/src/lib/input/drag-folder.ts) | 文件夹拖拽 | — |
| [input/image-attachments.ts](../src/renderer/src/lib/input/image-attachments.ts) | 图片附件 | L22 20MB 上限 |
| [input/input-drafts.ts](../src/renderer/src/lib/input/input-drafts.ts) | 草稿存储 | L46-52 base64 持久化 |
| [constants.ts](../src/renderer/src/lib/constants.ts) | 常量 | — |
| [genId.ts](../src/renderer/src/lib/genId.ts) | ID 生成 | — |
| [utils.ts](../src/renderer/src/lib/utils.ts) | cn 等工具 | — |

## 12. 配置文件

| 文件 | 职责 | 备注 |
|------|------|------|
| [electron.vite.config.ts](../electron.vite.config.ts) | Vite 配置 | preload CJS, Tailwind v4 插件 |
| [tsconfig.json](../tsconfig.json) | 根 TS 配置 | strict + noUncheckedIndexedAccess |
| [tsconfig.node.json](../tsconfig.node.json) | Node 端 TS 配置 | composite, main+preload+shared |
| [tsconfig.web.json](../tsconfig.web.json) | 渲染端 TS 配置 | jsx react-jsx, DOM lib |
| [components.json](../components.json) | shadcn/ui 配置 | new-york 风格 |
| [.prettierrc](../.prettierrc) | 格式化 | semi:false, trailingComma:none |
| [package.json](../package.json) | 依赖与脚本 | — |

## 13. 阅读建议路径

### 13.1 快速理解整体架构

1. [package.json](../package.json) → 了解技术栈
2. [src/main/index.ts](../src/main/index.ts) → 主进程启动
3. [src/preload/index.ts](../src/preload/index.ts) → IPC 桥接
4. [src/renderer/src/App.tsx](../src/renderer/src/App.tsx) → 路由结构
5. [src/renderer/src/layouts/RootLayout.tsx](../src/renderer/src/layouts/RootLayout.tsx) → 布局骨架

### 13.2 理解聊天业务核心

1. [src/renderer/src/stores/chatStore.ts](../src/renderer/src/stores/chatStore.ts) → 状态与流程
2. [src/renderer/src/services/api/agui.ts](../src/renderer/src/services/api/agui.ts) → SSE 解析
3. [src/renderer/src/services/api/client.ts](../src/renderer/src/services/api/client.ts) → 通信与认证
4. [src/renderer/src/components/chat/ChatArea.tsx](../src/renderer/src/components/chat/ChatArea.tsx) → UI 入口
5. [src/renderer/src/components/chat/MessageBubble.tsx](../src/renderer/src/components/chat/MessageBubble.tsx) → 渲染与 XSS

### 13.3 理解 Agent 能力现状

1. [src/renderer/src/services/api/agent.ts](../src/renderer/src/services/api/agent.ts) → Agent 服务
2. [src/renderer/src/stores/chatStore.ts](../src/renderer/src/stores/chatStore.ts) L38, L284, L537 → agentMode
3. [src/renderer/src/stores/useAgentStore.ts](../src/renderer/src/stores/useAgentStore.ts) → mock 轨道
4. [src/renderer/src/pages/AgentPage.tsx](../src/renderer/src/pages/AgentPage.tsx) → mock 页面
5. [src/renderer/src/components/chat/ToolCallCard.tsx](../src/renderer/src/components/chat/ToolCallCard.tsx) → 工具调用 UI
6. [src/shared/types.ts](../src/shared/types.ts) L118-219 → Agent 类型体系

### 13.4 理解上下文注入

1. [src/renderer/src/lib/input/select-file-tags.ts](../src/renderer/src/lib/input/select-file-tags.ts) → 标签语法
2. [src/renderer/src/lib/input/select-file-editor.ts](../src/renderer/src/lib/input/select-file-editor.ts) → 文档模型
3. [src/renderer/src/components/chat/input/FileAwareEditor.tsx](../src/renderer/src/components/chat/input/FileAwareEditor.tsx) → 双层编辑器
4. [src/renderer/src/components/context-panel/ContextPanel.tsx](../src/renderer/src/components/context-panel/ContextPanel.tsx) → 上下文面板
