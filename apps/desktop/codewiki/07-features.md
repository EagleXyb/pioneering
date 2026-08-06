# 07 · 已实现功能列表与待完善部分

> 基于当前代码实现梳理。标注 ✅ 为已实现，🟡 为部分实现/待完善，⏳ 为预留/规划中。

## 1. 会话与消息

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 多会话管理 | ✅ | 新建/切换/重命名/删除/置顶（`chatStore` + `ConversationList`） |
| 会话列表虚拟化 | ✅ | `@tanstack/react-virtual` 固定行高 |
| 流式对话 | ✅ | SSE 流式 token/思考/工具调用/trace/artifact |
| 消息重新生成 | ✅ | `regenerateMessage` |
| 消息点赞/点踩 | ✅ | `toggleMessageFeedback` |
| 消息复制/分享 | ✅ | `MessageBubble` 操作栏 |
| 图片附件 | ✅ | 用户图片走 `message.images`，点击 Lightbox 放大 |
| 文件附件卡片 | ✅ | `AttachmentList`（非图片） |
| 中止流式 | ✅ | `stopStreaming` |
| 消息列表 content-visibility | ✅ | `MessageScrollerList` 基于 shadcn `MessageScroller` |
| 同发送者消息分组 | ✅ | `computeGroupPosition`（T05） |
| 跳转到源消息高亮 | ✅ | `highlightMessageIdAtom` |

## 2. Trace 与 Agent 展示

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| Trace 树递归渲染 | ✅ | `TraceTreeRenderer` 支持任意深度嵌套 |
| Agent 时间线视图 | ✅ | `AgentTimeline`（思考/工具步骤/搜索结果） |
| 工具调用卡片 | ✅ | `ToolCallCard` |
| 工具结果渲染 | ✅ | `ToolResultRenderer`（搜索结果、JSON 等） |
| 多层嵌套 Agent 调用 | 🟡 | UI 已支持；依赖后端在 `TOOL_CALL_START` 携带 `parentCallId`，目前可能为扁平 |

## 3. Artifact 预览

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 多类型 artifact 渲染 | ✅ | `ArtifactRender`（HTML/SVG/代码/图片/Markdown） |
| 复制内容 | ✅ | 原生剪贴板 IPC，失败回退 `navigator.clipboard` |
| 下载另存为 | ✅ | 原生 `saveDialog` + `fileApi.write` |
| 源消息高亮回溯 | ✅ | `highlightMessageAtom` |
| 代码块全屏预览 | ✅ | `MarkdownRenderer` CodeBlock |

## 4. 输入区

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 结构化文档模型 | ✅ | 文本/文件引用/插件引用节点 |
| @文件引用 | ✅ | `@{}` 标签解析与渲染 |
| @插件引用 | ✅ | 插件 prompt 展开 |
| 草稿持久化 | 🟡 | 文档模型支持，持久化落盘策略以实现为准 |
| Token 计数 | 🟡 | 文档模型预留，实际计数依赖后端/配置 |

## 5. 鉴权与用户

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 登录/注册/登出 | ✅ | `authStore` + `api/auth` |
| Token 自动注入 | ✅ | `client.ts` 请求拦截 |
| 启动鉴权引导 | ✅ | `useAuthBootstrap` |
| Token 刷新 | ✅ | `authStore` |

## 6. 导航与页面

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 侧边栏导航 | ✅ | `SidebarNav`（首页/对话/工作区/助理/技能/插件/自动化/更多） |
| 功能页路由 | ✅ | 各 Page 组件 |
| 双高亮抑制 | ✅ | 功能页时 `ConversationList.selectionEnabled=false` |
| 响应式布局 | ✅ | `useResponsiveLayout` |
| 面板显隐切换 | ✅ | `usePanelToggle` |
| 键盘快捷键 | ✅ | `useKeyboardShortcuts` |
| 应用菜单 | ✅ | `menu.ts` + `menuActions` |

## 7. 设置

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 设置对话框 | ✅ | `SettingsDialog` + `settingsConfig` |
| 分区设置 | ✅ | `settings/sections/` |
| 主题切换 | ✅ | `useAppStore` 主题 |
| 功能开关 | ✅ | `feature-flags.ts` |

## 8. 欢迎引导

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 欢迎引导流程 | ✅ | `useWelcomeGuide` + `lib/welcome/` + `components/chat/welcome/` |

## 9. 平台与本地能力

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 文件读写/选择 | ✅ | `fileApi` |
| 剪贴板 | ✅ | `clipboardApi` |
| 窗口控制 | ✅ | `windowApi` |
| 打开外链 | ✅ | `systemApi.openExternal` |
| 单实例锁 | ✅ | `window-config.ts` |
| 开发期 Mock | ✅ | `mocks/electron-mock.ts` |

## 10. 待完善部分（汇总）

- 🟡 多层嵌套 Agent 调用：UI 就绪，等后端 `parentCallId`。
- 🟡 输入区草稿持久化与 Token 计数：模型就绪，落盘/计数策略待落地。
- 🟡 会话历史本地持久化：`chatStore` 维护内存态，落盘策略需确认。
- ⏳ trace 节点 `kind` 扩展：当前覆盖主要类型，未来按后端协议扩展。
- ⏳ 消息列表虚拟化回归：当前 `MessageScrollerList` 不虚拟化，超长会话性能需观测。
