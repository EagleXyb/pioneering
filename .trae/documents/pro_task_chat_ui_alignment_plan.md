# Pro/Task 对话区对齐 Chat 样式 实施计划

## 一、调研结论

### 1. Chat 模式（样式标杆）现状

Chat 模式已完成自研改造（移除 `@tdesign-react/chat`），关键样式模块：

| 模块 | 类名/实现 | 关键样式 |
|---|---|---|
| 模式容器 | `.chat-mode` | flex column、`background: var(--bg-secondary)` |
| 滚动区 | `.chat-scroll-area` | flex:1、overflow-y:auto、`scrollbar-gutter: stable` |
| 消息容器 | `.chat-messages` | max-width 960px 居中、padding 24px 0、gap 16px |
| 用户消息 | `.chat-msg-row--user` + `.chat-msg-user-bubble` | 右对齐、max-width 80%、padding 9px 14px、radius 12px、`background: var(--bg-input)`、14px/1.6、pre-wrap；含附件 Markdown 时切换 `<Markdown>` |
| Agent 消息 | `.chat-msg-row--ai` + `.chat-msg-ai-body` | 通栏、**无头像、无卡片背景/边框** |
| 思考过程 | `.chat-reasoning*` | 豆包风格折叠块：四瓣花图标 +「深度思考中…/已完成思考」+ chevron；grid 0fr→1fr 动画；正文 14px/1.75、`var(--text-tertiary)`；流式图标呼吸 |
| 正文渲染 | `<Markdown>`（`src/components/Markdown.tsx`） | react-markdown + GFM + sanitize + highlight；`.chat-markdown` 排版；围栏代码渲染为 `.chat-code-block` 卡片（语言标识 + 复制） |
| 操作栏 | `.chat-action-bar` + `.chat-action-btn` | AI 消息 hover 显现（触屏常驻；`has-sources` 常驻）；28px 圆角 ghost 按钮；copy/good/bad/share/replay 五项；右侧 `.chat-sources-chip` |
| 等待指示 | `.chat-typing` | 三个 6px 圆点跳动 |
| 流式占位 | `.chat-streaming-placeholder` | min-height 1.7em 保持行高 |
| 输入区 | `.chat-input-area` → `.chat-input-card` | max-width 960px 居中；卡片 margin 0 24px、radius 22px、1px 发丝边、贴边短阴影；三层布局（textarea + footer）；`.chat-upload-btn` 36px 圆形 + CSS 气泡 tooltip；`.chat-tools-divider`；深度思考/联网搜索 32px 胶囊（选中绿色）；`.chat-send-btn` 黑色 36px 圆形；`.copyright__item` |
| 附件条 | `.chat-attachment-*`（AttachmentBar） | 三模式共用，样式目前定义在 chat.css |
| 模式加载 | `.mode-loading` | 居中「加载中...」 |

### 2. Pro / Task 对应区域现状差异

**Pro（分析模式）中间栏：**
- 每条消息 = **头像**（AI 紫蓝渐变/User 浅蓝）+ **卡片容器** `.pro-message-content`（bg-card + border + radius）；用户消息为蓝底白字卡片、右对齐。
- Agent 正文为 `.pro-message-text` **纯文本** pre-wrap —— 未使用 Markdown 渲染（与截图中 Agent 回复观感粗糙一致）。
- streaming：头像 + 卡片 + `.pro-dot` 三点。
- 输入区 `.pro-input-area`（bg-card、padding 16/20/24）：**两个「+」按钮**——DropdownMenu 上传按钮 + MoreMenu 更多工具按钮（截图所指出的问题）；另有禁用态 Mic；卡片 radius 20、textarea 16px；自带简化 state，无 IME 保护/草稿。
- 思考过程的对应物是右侧 **ProcessPanel**（圆点时间轴 + 白卡片 content）。

**Task（任务模式）中间栏：**
- 用户消息：`.task-message-content-user`（`#EBF5FF` 硬编码浅蓝卡片）；无头像。
- Agent 消息：`.task-message-content` 白卡片（bg-card + radius，无 border）；MessageContent 已支持代码段切割（`.task-code-block` 琥珀色预览按钮）与 Markdown 两种路径。
- streaming 指示器引用了未定义样式的 `.task-message-avatar*`（裸奔结构）。
- 输入区与 pro 同款（`.task-input-*`），同样存在两个「+」、禁用 Mic。
- 右侧 TaskPipeline + PlanPipelineTree 是成熟的状态时间轴（保持不动）。

### 3. TDesign 残留排查结论

- `apps/web/package.json`：**已无** TDesign 依赖；根 `package-lock.json` 已无 TDesign 条目；node_modules 未安装。
- `apps/web/package-lock.json`：**死文件**（monorepo 改 workspace 后 npm 只读根 lock），内容停留在 React 18 + TDesign 时代 → 删除。
- `src` 内 TDesign 命中全部为注释；其中 [chat.css](file:///Users/ybxue/Desktop/pioneering/apps/web/src/modes/chat/chat.css#L13-L21) 的 `.chat-message-ai`（含 `--td-chat-item-*` 变量）是**无任何引用的死类**。
- 另发现 `--bg-hover` 令牌被多处引用但从未定义（hover 态失效）；`TaskTopBar`/`index.css` 注释包含已失效前提（`.tw-scope`、「TDesign 样式压过 reset」）。

## 二、改造对照（目标样式与 Chat 完全一致）

| 模块 | Pro 改造 | Task 改造 |
|---|---|---|
| 用户消息 | 去头像+蓝卡片 → `.chat-msg-row--user` + `.chat-msg-user-bubble` | 去浅蓝卡片 → 同左 |
| Agent 消息 | 去头像+卡片 → 通栏 `.chat-msg-row--ai` + `.chat-msg-ai-body` | 去白卡片 → 同左 |
| 正文 | 纯文本 → `<Markdown>` | 保持 Markdown；代码段切割/预览能力保留 |
| 思考过程 | ProcessPanel 步骤内容向 chat reasoning 克制风格对齐（浅灰底、去生硬白卡、字号 13px）；圆点时间轴结构保留 | PlanPipelineTree 已成熟，保持不动 |
| 操作栏 | 新增 chat 同款 `.chat-action-bar`：copy/good/bad/share（hover 显现）；RunTrace 作为模式特有项保留在操作栏下方 | 同左 |
| 等待指示 | `.pro-dot` 卡片 → `.chat-typing` 三点 | 修复裸奔 avatar 结构 → `.chat-typing` 三点 |
| 流式占位 | 新增 `.chat-streaming-placeholder` | 同左 |
| 输入区 | 换用 chat 三层卡片全部类名；接入 `useTaskInput`（IME/草稿/autosize，draft 前缀 `pro-input-draft`）；仅保留一个「+」DropdownMenu；移除 Mic 与 MoreMenu | 换用 chat 类名；保留 `useTaskInput`；移除 Mic 与 MoreMenu |
| 空态/加载 | 类名保留，样式统一走令牌；无会话页按钮改用 shadcn `Button` | 同左 |
| 代码块卡片 | — | `.task-code-block*` 重样式对齐 `.chat-code-block`（中性卡片，预览按钮改为小号 outline） |

说明（不擅自增加功能）：
- **不迁移 replay**：pro/task 后端无 regenerate 语义，避免出现无行为按钮。
- **不在 pro/task 消息内新增 reasoning 折叠块**：pro 的思考已由 ProcessPanel 承载，重复展示属新增功能。
- **删除 MoreMenu 组件**（MoreMenu.tsx / buildMoreMenuItems.ts / buildMoreMenuItems.test.ts）：其唯一使用方是 pro/task 输入区，功能与「+」DropdownMenu 重复且其余项未接线；同目录 McpSection 保留（SettingsDialog 使用）。
- good/bad 初始态从 converter 已下发的 `feedback`（'like'/'dislike'/'none'）映射，反馈仍走 `feedbackMessage`，失败回滚 + toast，与 chat 行为一致。

## 三、文件与模块

**新增：**
- `src/styles/conversation.css`：三模式共享的消息行/气泡/reasoning/操作栏/typing/输入卡片/附件条样式（**从 chat.css 原样迁移，类名与值不变**），含响应式断点。

**修改：**
- `src/main.tsx`：全局引入 `conversation.css`（位于 tailwind.css 之后）。
- `src/modes/chat/chat.css`：移除已迁移区块与死类 `.chat-message-ai`；保留 `.chat-mode/.chat-scroll-area/.chat-welcome*/.chat-messages/.chat-load-more*`。
- `src/styles/tokens.css`：新增 `--bg-hover: var(--bg-input)`（亮/暗自动跟随）。
- `src/modes/pro/components/AnalysisMessageList.tsx`：重写消息渲染（共享类名 + Markdown + 操作栏 + RunTrace + chat-typing）；空态类名保留。
- `src/modes/pro/components/AnalysisInput.tsx`：改为 chat 输入卡片结构 + `useTaskInput`；保留 HITL 卡片与附件。
- `src/modes/pro/pro.css`：删除 `.pro-message*/.pro-input*/.pro-thinking*/.pro-dot*/.pro-input-more-*`；`.process-step-content` 改为浅灰无边框（bg-input、radius 8、13px/1.6），其余 ProcessPanel 样式保留。
- `src/modes/task/components/TaskMessageList.tsx`：消息渲染改共享类名；保留 `data-message-id`、代码段切割预览、RunTrace；新增操作栏；指示器改 chat-typing。
- `src/modes/task/components/TaskInput.tsx`：改为 chat 输入卡片结构；保留 HITL、附件、useTaskInput。
- `src/modes/task/task.css`：删除消息/输入/more-pop 区块；timeline 时间轴样式全部保留。
- `src/components/ArtifactPreview/artifactPanel.css`：`.task-code-block*` 对齐 `.chat-code-block`；预览按钮改小号中性样式。
- `src/index.css`、`src/layout/TaskTopBar/tasktopbar.css`：更新失效注释。
- TDesign 历史注释清理（仅 src 内，改为描述当前实现）：ChatMode/ChatInput/ChatMessageItem/ChatMessageList/useAguiChat、SettingsDialog/SettingsDialog.css、Sidebar/AccountPopover/ConfirmDialog、main.tsx、ui/sonner、ui/spinner、converter.test、pages/auth/Login、Register、auth.module.css、types/chat.ts、TaskMode。
- `src/modes/task/components/TaskMessageList.test.tsx`：指示器断言由 `.task-thinking-indicator` 更新为 `.chat-typing`（设计统一，行为断言不变）。

**删除：**
- `apps/web/package-lock.json`（死锁文件）。
- `src/components/more-menu/MoreMenu.tsx`、`buildMoreMenuItems.ts`、`buildMoreMenuItems.test.ts`。

**不动：**
- Chat 模式全部 tsx/hooks 逻辑；右侧 TaskPipeline/PlanPipelineTree/ArtifactPanel/SourcesPanel；`apps/web/docs/*.md` 历史存档文档；其他 apps。

## 四、实施步骤（依赖顺序）

1. tokens.css 增加 `--bg-hover`。
2. 新建 `src/styles/conversation.css`，从 chat.css 迁移共享样式（含附件条、输入卡片响应式）。
3. 精简 chat.css（删迁移区块 + `.chat-message-ai`）；main.tsx 引入 conversation.css；验证 chat 视觉零变化。
4. 改造 pro：AnalysisMessageList → AnalysisInput → 清理 pro.css。
5. 改造 task：TaskMessageList → TaskInput → 清理 task.css → artifactPanel.css 代码块对齐。
6. 输入区移除 MoreMenu 引用后，删除 MoreMenu 三个文件。
7. 空态无会话页按钮替换为 shadcn Button（pro/task）。
8. 清理 src 内 TDesign/失效注释；删除 `apps/web/package-lock.json`。
9. 更新 TaskMessageList 测试断言。

## 五、依赖与注意事项

- 类名迁移保持字面值不变，确保 chat 组件与所有依赖类名的逻辑（sources 面板、高亮、测试）不受影响。
- 共享样式全局加载后，pro/task 的 lazy chunk 不再依赖 chat.css，无循环/重复样式问题。
- pro 接入 useTaskInput 后获得 IME/草稿/autosize，行为与 chat/task 一致；草稿键按前缀隔离。
- 操作栏反馈 API 契约（message id）沿用现状，与 chat 相同。
- 不新增依赖；不改动业务 store 与后端。

## 六、验证

1. `npm run test`（apps/web）：全部用例通过（含更新后的 TaskMessageList 测试；McpSection 等不受影响）。
2. `npm run build`（apps/web）：tsc + vite 构建通过，无新增告警类型；确认产物中无 tdesign。
3. `npm run lint`（apps/web）：无新增问题。
4. 全仓 grep：`tdesign` 在 `apps/web/src` 与锁文件中零命中（docs 存档除外）；`--td-` 零命中；`MoreMenu/buildMoreMenuItems` 零残留。
5. 浏览器实测（需后端 localhost:8088）：三模式用户气泡/Agent 通栏 Markdown/操作栏 hover/输入卡片外观一致；pro 历史与流式正文为 Markdown；输入区仅一个「+」，无 Mic；task 代码块预览功能正常、RunTrace/HITL 正常；明暗主题均无失效颜色。

## 七、风险

- **共享样式迁移遗漏**：迁移以 chat.css 原文逐段拷贝比对，第 3 步先单独验证 chat 视觉，再动 pro/task。
- **测试断言更新风险**：仅替换指示器类名断言，行为类断言（data-message-id、预览点击、空态）保持；空态类名 `.task-messages-empty` 保留。
- **删除 package-lock.json**：该文件不被 npm 读取（workspace 模式），删除不影响安装；安装实际以根 lock 为准。
