# 02 · 核心模块功能描述

## 1. 主进程层（`src/main`）

### 1.1 `index.ts`
- Electron 应用入口。
- 创建 `BrowserWindow`，加载渲染进程（dev 走 vite dev server，prod 走打包产物）。
- 注册应用菜单（`menu.ts`）、注册 IPC handlers（`ipc-handlers.ts`）。
- 单实例锁（`window-config.ts`）。

### 1.2 `ipc-handlers.ts`
集中实现所有原生 IPC handler，对应 `shared/ipc-channels.ts` 中的通道名：
- **文件**：读/写/选择文件、保存对话框另存为。
- **剪贴板**：读/写文本。
- **窗口**：最小化、最大化/还原、关闭、置顶、聚焦。
- **系统**：打开外部链接、获取平台信息、获取应用版本。
- **会话存储**：本地会话草稿/历史读写（如有）。

### 1.3 `menu.ts` / `shared/menu-template.ts`
- 构建 macOS/Windows 自适应应用菜单。
- 菜单项触发后通过 `menuActions`（渲染进程）响应，或直接走 IPC。

### 1.4 `window-config.ts`
- 默认窗口尺寸、最小尺寸、标题栏样式。
- 单实例检测：二次启动时聚焦已有窗口。

## 2. 预加载层（`src/preload`）

### `index.ts`
通过 `contextBridge.exposeInMainWorld` 暴露以下命名空间到 `window`：
- `fileApi`：`read` / `write` / `selectFile` / `selectDirectory` / `saveDialog`
- `clipboardApi`：`read` / `write`
- `windowApi`：`minimize` / `maximize` / `close` / `isMaximized` / `setAlwaysOnTop` / `focus`
- `systemApi`：`openExternal` / `getPlatform` / `getVersion`
- （具体方法以实际暴露为准，类型见 `index.d.ts`）

`index.d.ts` 为这些 API 补充全局类型声明，渲染进程可直接 `window.fileApi.xxx` 调用并获得类型提示。

## 3. 共享层（`src/shared`）

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 全局核心类型：`Message`、`Session`、`ToolCall`、`TraceNode`、`Artifact`、`ArtifactType` 等 |
| `ipc-channels.ts` | IPC 通道名常量（主/渲染双方共用，避免字符串拼写错误） |
| `menu-template.ts` | 菜单模板数据 |
| `index.ts` | 统一导出 |

> 详见 `06-types.md`。

## 4. 渲染进程层（`src/renderer/src`）

### 4.1 入口与路由
- `main.tsx`：挂载 React，注入全局 Provider（Router、TooltipProvider 等）。
- `App.tsx`：定义 `createHashRouter` 路由表，包裹 `RootLayout`。

### 4.2 页面（`pages/`）
| 页面 | 功能 |
| --- | --- |
| `ChatPage` | 对话主页：组合 `ChatArea` + `Sidebar` + `ContextPanel` + `ArtifactPanel` |
| `HomePage` | 首页/欢迎入口 |
| `WorkspacePage` | 工作区管理 |
| `AssistantPage` | 助理（Assistant）列表与管理 |
| `SkillsPage` | 技能（Skill）市场/管理 |
| `PluginsPage` | 插件（Plugin）管理 |
| `AutomationPage` | 自动化任务（定时/触发） |
| `MorePage` | 更多设置与入口聚合 |

### 4.3 布局（`layouts/`）
- `RootLayout`：应用骨架，包含侧边栏插槽、主内容 `<Outlet/>`、上下文面板与预览面板的显隐控制。

### 4.4 组件（`components/`）
按职责分子目录：

#### chat/（对话区）
| 组件 | 职责 |
| --- | --- |
| `ChatArea` | 对话区容器，组合消息列表 + 输入区 |
| `MessageScrollerList` | 消息列表（基于 shadcn `MessageScroller`，content-visibility 优化，不虚拟化） |
| `MessageBubble` | 单条消息气泡（用户/助手），组合 Markdown、trace、工具调用、附件 |
| `MarkdownRenderer` | 统一 Markdown 渲染（rehype-sanitize 安全策略、代码块折叠/复制/全屏、内嵌工具结果） |
| `AgentTimeline` | 时间线样式的 Agent 运行过程展示（思考/工具步骤/搜索结果） |
| `TraceTreeRenderer` | 递归渲染 `TraceNode` 树（支持任意深度嵌套） |
| `TraceNodeView` | 单个 trace 节点视图 |
| `ThinkingBlock` | 深度思考块展示 |
| `ToolCallCard` | 工具调用卡片 |
| `ToolResultRenderer` | 工具结果渲染（搜索结果、JSON 等） |
| `ObservationResult` | 观察结果展示（用于 AgentTimeline） |
| `AttachmentList` | 文件附件列表（非图片） |
| `input/InputArea` | 输入区：文档模型、@文件引用、@插件引用、发送 |
| `welcome/` | 欢迎引导组件 |

#### sidebar/（侧边栏）
| 组件 | 职责 |
| --- | --- |
| `Sidebar` | 侧边栏容器，组合导航 + 会话列表 |
| `SidebarNav` | 顶部导航项（首页/对话/工作区/…） |
| `ConversationList` | 会话历史列表（`@tanstack/react-virtual` 虚拟化，行内重命名） |
| `SessionActionsDropdown` | 会话行操作菜单（重命名/删除/置顶等） |

#### context-panel/（上下文面板）
| 组件 | 职责 |
| --- | --- |
| `ContextPanel` | 右侧上下文面板，展示当前会话上下文/引用文件等 |

#### preview/（预览面板）
| 组件 | 职责 |
| --- | --- |
| `ArtifactPanel` | Artifact 预览面板（复制走原生剪贴板 IPC，下载走原生另存为） |
| `ArtifactRender` | 按 `ArtifactType` 渲染产物（HTML/SVG/代码/图片等） |

#### settings/（设置）
| 组件 | 职责 |
| --- | --- |
| `SettingsDialog` | 设置对话框容器 |
| `settingsConfig.tsx` | 设置项配置（分组、字段、校验） |
| `sections/` | 各设置分区组件 |

#### layout/、common/、ui/
- `layout/`：布局壳组件。
- `common/`：通用业务组件。
- `ui/`：shadcn/ui 基础组件本地源码（button、tooltip、scroll-area、message、bubble、message-scroller、dialog、dropdown-menu 等）。

### 4.5 状态管理（`stores/` + `atoms/`）
> 详见 `04-state-management.md`。

### 4.6 服务层（`services/`）
> 详见 `05-api-and-ipc.md`。

### 4.7 工具函数（`lib/`）
| 文件 | 职责 |
| --- | --- |
| `utils.ts` | `cn`（clsx + tailwind-merge）等通用工具 |
| `constants.ts` | 常量：`CONVERSATION_ROW_HEIGHT`、`CONVERSATION_LIST_OVERSCAN`、`getToolDisplayName` 等 |
| `feature-flags.ts` | 功能开关 |
| `genId.ts` | 唯一 id 生成（用于消息/节点/文档节点） |
| `trace-utils.ts` | trace 工具：`formatDuration` 等 |
| `extractCodeBlocks.ts` | 代码块提取：`getHastText`、`previewableLanguage`、`getCodeLanguage` |
| `embedded-tool-results.ts` | 内嵌工具结果提取 `extractEmbeddedToolResults` |
| `input/select-file-editor.ts` | 输入区文档模型（文本/文件引用/插件引用节点互转） |
| `input/select-file-tags.ts` | `@{}` 标签解析与构造 |
| `dev/` | 开发期工具 |
| `welcome/` | 欢迎引导数据/逻辑 |

### 4.8 Hooks（`hooks/`）
| Hook | 职责 |
| --- | --- |
| `useAuthBootstrap` | 应用启动时鉴权初始化（加载 token、校验、自动登录） |
| `useKeyboardShortcuts` | 全局键盘快捷键注册 |
| `usePlatform` | 平台信息（mac/win/linux）适配 |
| `useWelcomeGuide` | 欢迎引导流程控制 |

### 4.9 平台适配（`platform/`）
| Hook | 职责 |
| --- | --- |
| `useResponsiveLayout` | 响应式布局（窄屏折叠侧边栏等） |
| `usePanelToggle` | 面板显隐切换逻辑 |

### 4.10 菜单动作（`menu/menuActions.ts`）
- 渲染进程侧响应应用菜单事件，桥接到路由跳转或 store 动作。

### 4.11 Mock（`mocks/electron-mock.ts`）
- 开发期（非 Electron 环境，如纯浏览器调试）模拟 `window.xxxApi`，保证渲染层可独立运行。
