# shadcn/ui 官方 AI 聊天组件替换可行性分析

> 评估对象：shadcn/ui 官方基于 Radix UI 的 `Message` 与 `Message Scroller` 组件
> 评估目标：当前 `desktop` 渲染端的聊天消息展示与输入区域实现
> 评估时间：2026-07-20
> 评估维度：功能覆盖度 / 交互流畅度 / 无障碍访问 / 视觉反馈

---

## 0. 重要前置说明：范围澄清

阅读代码后发现一个**范围错配**，必须先澄清，否则后续结论会偏题：

| 用户原话 | 实际对应代码 | shadcn/ui 对应组件 |
|---|---|---|
| 「聊天输入区域」 | [input/InputArea.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx)、[FileAwareEditor.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/FileAwareEditor.tsx)、[SlashCommandPopover.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/SlashCommandPopover.tsx)、[FileSearchPopover.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/FileSearchPopover.tsx)、[ImagePreview.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/ImagePreview.tsx)、[ComposerRuntimeStatus.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/ComposerRuntimeStatus.tsx)、[ContextRing.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/ContextRing.tsx) | **无** — shadcn 官方目前**没有** Composer / Prompt 输入组件，仅有 `Message`（单条消息）与 `Message Scroller`（滚动容器） |
| 「Message / Message Scroller」可替换的对象 | [MessageList.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/MessageList.tsx)、[MessageBubble.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/MessageBubble.tsx)、[ChatArea.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/ChatArea.tsx) 中的 `ScrollArea` + 自动滚动逻辑 | `Message` + `MessageScroller` + `MessageScrollerProvider/Viewport/Content/Item/Button` |

**因此本分析将分两部分回答：**

- **第一部分**：按用户要求，深度梳理当前「聊天输入区域」的功能模块与交互逻辑（这部分 shadcn 官方组件**无法直接替换**，原因见下）。
- **第二部分**：将「Message / Message Scroller」与当前**消息展示侧**实现（`MessageList` + `MessageBubble` + `ChatArea` 滚动逻辑）做正面对比，得出可行性结论。

---

## 第一部分：当前聊天输入区域的功能与交互逻辑

### 1.1 组件树与职责

```
ChatArea (容器)
├── AgentStatus            —— 顶部 Agent 推理/工具轨迹状态条
├── ScrollArea
│   └── MessageList        —— 虚拟化消息列表（@tanstack/react-virtual）
│       └── MessageBubble  —— 单条消息气泡（ReactMarkdown + sanitize）
└── InputArea              —— 输入区域主组件
    ├── SlashCommandPopover  ——「/」命令弹出层
    ├── FileSearchPopover    ——「@」文件引用弹出层
    ├── <输入卡片容器>
    │   ├── ImagePreview         —— 图片附件缩略图条 + 预览 Dialog
    │   ├── FileAwareEditor      —— 富文本（文件感知）编辑器
    │   │   ├── 高亮遮罩层（背后渲染 @{...} / <select-plugin> 为彩色 Chip）
    │   │   └── textarea（透明文字、保留光标）
    │   └── ComposerToolbar      —— 底部工具栏
    │       ├── 左：附件 / 工具 / Agent 模式切换（DropdownMenu）
    │       └── 右：ModelSelect + 发送/停止按钮
    ├── 字符超限提示（10000 字上限）
    └── ComposerRuntimeStatus    —— 底部状态（图片数 / Agent 标识）
```

辅助模块：

- `use-input-draft-persistence.ts`：草稿持久化（挂载恢复 / 去抖保存 / 卸载冲刷）
- `lib/input/image-attachments.ts`：图片附件的 File→base64、粘贴/拖拽校验
- `lib/input/select-file-editor.ts` / `select-file-tags.ts`：`@{path}` 文档解析与 Chip 渲染
- `lib/input/drag-folder.ts`：拖拽文件夹路径提取

### 1.2 核心功能模块清单

| 模块 | 实现位置 | 关键能力 |
|---|---|---|
| 富文本编辑 | [FileAwareEditor.tsx#L89](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/FileAwareEditor.tsx) | textarea + 高亮遮罩双层架构，`@{path}` / `<select-plugin>` 渲染为 Chip；ref 暴露 `focus / getSelectionOffsets / insertText / replaceRange` 等命令式接口 |
| 自适应高度 | [FileAwareEditor.tsx#L141](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/FileAwareEditor.tsx) | `useLayoutEffect` 中 `ta.style.height = min(scrollHeight, maxHeight)`，封顶 200px |
| 光标与遮罩对齐 | [FileAwareEditor.tsx#L63-L87](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/FileAwareEditor.tsx) | `EDITOR_TEXT_STYLE` 像素级共享样式，固定 `lineHeight: 24px`，消除 WebKit 基线漂移 |
| Slash 命令 | [SlashCommandPopover.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/SlashCommandPopover.tsx) + [InputArea.tsx#L95-L104](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx) | 正则 `(?:^\|\s)\/([^\s/]*)$` 检测；评分算法（完全 < 前缀 < 包含 < 模糊）；键盘导航 ↑↓/Enter/Tab/Esc |
| @ 文件引用 | [FileSearchPopover.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/FileSearchPopover.tsx) + [InputArea.tsx#L369-L375](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx) | 基于已附加文件做查询过滤；提供「浏览文件…」入口经 `fileApi.openDialog` 写入 `@{path}` |
| 图片附件 | [ImagePreview.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/ImagePreview.tsx) + [image-attachments.ts](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/lib/input/image-attachments.ts) | 缩略图条 + 点击放大 Dialog；20MB 上限校验；粘贴 / 拖拽 / 选择三入口 |
| 拖拽支持 | [InputArea.tsx#L471-L502](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx) | `dragOver/Leave/Drop` 三件套；区分本地路径（写 `@{path}`）与图片 File（转 base64） |
| 模型选择 | [InputArea.tsx#L266-L325](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx) | 受控 DropdownMenu；支持「自定义模型名」输入；防冒泡 |
| 草稿持久化 | [use-input-draft-persistence.ts](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/hooks/use-input-draft-persistence.ts) | 按 sessionId 分键；400ms 去抖；空草稿自动清理；卸载冲刷；流式期间跳过保存 |
| 字符上限 | [InputArea.tsx#L92](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx) | 10000 字符；>90% 黄色警告、>100% 红色 + 禁用发送 |
| 发送/停止 | [InputArea.tsx#L212-L248](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx) | 流式时切换为停止按钮（反相配色：Light 深底白图标 / Dark 白底深图标） |
| Agent 模式 | [ComposerRuntimeStatus.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/ComposerRuntimeStatus.tsx) | 状态栏紫色 Agent 徽标 + 图片计数 |

### 1.3 关键交互逻辑

- **键盘冲突仲裁**（[InputArea.tsx#L559-L613](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx)）：Slash > Mention > Enter 发送的优先级链；中文输入法 `isComposing` 守卫；Shift+Enter 换行。
- **触发器重算**（[InputArea.tsx#L383-L407](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx)）：`text` 或光标变化时同时刷新 `/` 与 `@` 触发态，避免互相干扰。
- **草稿守卫**（[use-input-draft-persistence.ts#L86-L100](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/hooks/use-input-draft-persistence.ts)）：`enabled` / `hydrated` / 流式态多重判断；卸载时若去抖窗口内有未保存草稿立即冲刷。
- **超限提示反馈**（[InputArea.tsx#L723-L734](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx)）：仅当接近 / 超过上限时才显示计数，避免常态噪音。

### 1.4 视觉与无障碍现状

- **视觉**：Agent 紫 `#6D28D9`（Light）/ `#8B5CF6`（Dark）作为主色，仅作用于发送按钮、focus-within ring、Agent 徽标，符合「局部主色，不污染全局主题」原则。
- **无障碍**：发送/停止按钮均有 `aria-label`、`title`、`focus-visible:ring`；但 Slash/File 弹出层为受控 div，**未提供 `role="listbox"`/`aria-activedescendant`**，键盘导航完全靠 `e.preventDefault()` 与样式高亮，对屏幕阅读器不友好。
- **配色对比**：`text-muted-foreground/50` 用于状态栏（11px），在 Light 主题下对比度偏低。

---

## 第二部分：Message / Message Scroller 替换可行性

> 替换目标：[MessageList.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/MessageList.tsx) + [MessageBubble.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/MessageBubble.tsx) + [ChatArea.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/ChatArea.tsx) 中基于 `ScrollArea` + `isNearBottomRef` 的滚动逻辑。
>
> **不替换**：[InputArea.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx)（无对应官方组件，详见第三部分）。

### 2.1 shadcn/ui 官方组件能力摘要

#### Message（单条消息行）

来源：[官方 registry](https://ui.shadcn.com/r/styles/new-york-v4/message.json)

- 纯展示型布局组件，组合关系：
  ```
  Message (align="start"|"end")
  ├── MessageAvatar        —— 底部对齐头像槽，遇 footer 自动上移
  └── MessageContent
      ├── MessageHeader    —— 始终 start 对齐
      ├── Bubble           —— 配套的消息表面组件（需另装 `bubble`）
      └── MessageFooter    —— 跟随 message 侧对齐，承载 actions
  ```
- `MessageGroup`：堆叠同发送者多条消息。
- `align="end"`：自动 `flex-row-reverse`，footer 也跟随 `justify-end`。
- 仅暴露 `align` 与 `className`，**几乎零行为**，灵活度极高。
- 无障碍：组件本身是 presentational wrapper，a11y 由内部内容负责；官方建议在 `MessageFooter` 给 icon-only 按钮 `aria-label`，在 streaming 时用 `Marker role="status"` 让 AT 朗读。

#### Message Scroller（流式滚动容器）

来源：[官方 registry](https://ui.shadcn.com/r/styles/new-york-v4/message-scroller.json)，依赖 `@shadcn/react/message-scroller` 原语。

- `MessageScrollerProvider` —— 无头根，承载滚动状态与行为 props：
  - `autoScroll`：跟随 live edge；滚动离开即自动停止跟随
  - `defaultScrollPosition`：`start` / `end` / `last-anchor`（默认 `last-anchor`，重开会话定位到最后一条 user 消息）
  - `scrollPreviousItemPeek`：新 turn 锚定时，上方保留多少像素的上一条消息作为上下文
  - `preserveScrollOnPrepend`：默认开启，加载历史时不丢位置
- `MessageScrollerViewport` —— 真正滚动元素，含 `scrollbar-thin`、`overscroll-contain`、`contain-content`。
- `MessageScrollerContent` —— 内容容器，含 `gap-8` 与 live-region 默认值。
- `MessageScrollerItem` —— 每一行边界，**必须包裹每一个直接子节点**；含 `content-visibility: auto` 与 `contain-intrinsic-size: auto 10rem`，本身就是性能优化。
- `MessageScrollerButton` —— 「跳到最新/最旧」按钮，根据 `data-active` 自动显隐 + 弹性动画。

**官方组件相比当前实现多出的关键能力**（直接对应官方文档「15 条流式聊天最佳实践」）：

1. **Anchoring turns**：新 turn 自动定位到视口顶部附近，而不是被流式输出推到底部。
2. **`scrollPreviousItemPeek`**：新 turn 上方保留部分上一条，避免「断片」感。
3. **`defaultScrollPosition="last-anchor"`**：重开会话定位到最后一条 user 消息而非绝对底部，更符合阅读习惯。
4. **`preserveScrollOnPrepend`**：加载更早历史时位置不跳变。
5. **`MessageScrollerButton`**：内置「跳到最新」按钮 + 弹性显隐动画，当前实现完全没有。
6. **content-visibility: auto**：CSS 级性能优化，对长会话比虚拟化更轻量，且天然支持任意高度。
7. **`data-autoscrolling` 状态属性**：可在程序化滚动期间条件应用样式。

### 2.2 当前实现 vs 官方组件 — 多维度对比

#### 维度 A：组件功能覆盖度

| 能力 | 当前实现 | 官方 Message Scroller | 差距 |
|---|---|---|---|
| 单条消息布局（头像 + 气泡 + 时间 + actions） | `MessageBubble` 手写 `flex gap-3 group flex-row-reverse` | `Message` + `Bubble` + `MessageAvatar/Header/Footer` | 官方更结构化、可组合 |
| 同发送者多条堆叠 | 无 | `MessageGroup` | 官方多 |
| 消息 actions（复制/点赞/踩） | `MessageBubble` 末尾 `opacity-0 group-hover:opacity-100` | `MessageFooter` + 任意按钮 | 等价 |
| 图片附件 | `MessageBubble` 内联 `<a href=dataUrl>` + 安全降级 | `Message` + `Bubble` 内自定义 | 等价（需自己写） |
| 工具调用 / 思考过程 | `ThinkingBlock` + `ToolCallCard` 独立组件 | 官方建议用 `Marker` + 自定义内容 | 等价（需自己写） |
| Markdown 渲染 + sanitize | `ReactMarkdown + remarkGfm + rehypeHighlight + rehypeSanitize` | 不提供 | **必须保留当前实现** |
| 虚拟化 | `@tanstack/react-virtual` + `measureElement` | 不提供，依赖 `content-visibility: auto` | 见维度 B |
| 自动跟随 live edge | `isNearBottomRef` + 80px 阈值 + `scrollTop = scrollHeight` | `autoScroll` 内置 + 滚动离开自动停跟随 | 官方更智能 |
| 新 turn 锚定到视口顶部 | **无** | `scrollAnchor` + `scrollPreviousItemPeek` | 官方多 |
| 重开会话定位 | 直接拉到底部 | `defaultScrollPosition="last-anchor"` | 官方更合理 |
| 加载历史不跳位置 | **未实现** | `preserveScrollOnPrepend` 默认开启 | 官方多 |
| 「跳到最新」按钮 | **无** | `MessageScrollerButton` 内置 | 官方多 |
| 任意消息跳转 | 无 | 通过 `messageId` 锚定 | 官方多 |
| 状态指示（typing/streaming） | `AgentStatus` 顶部条 + 气泡末尾 `▊` 光标 | 官方推荐 `Marker role="status"` | 等价 |

**结论 A**：官方组件在**滚动行为、turn 锚定、历史加载、跳转**这四块显著覆盖更多场景；当前实现的 **Markdown 渲染 + sanitize 链路**与**虚拟化**是官方组件没有的，必须保留。

#### 维度 B：交互流畅度

| 子项 | 当前实现 | 官方实现 | 评估 |
|---|---|---|---|
| 长会话性能 | `@tanstack/react-virtual` 仅渲染视口 + overscan，长会话性能稳定；`measureElement` 动态测高 | `content-visibility: auto` + `contain-intrinsic-size`：浏览器原生跳过不可见子树的渲染与布局 | **两者都优秀**；官方更轻量（零 JS 测高），但对极长代码块 / 大图片的「可视即渲染」策略可能比虚拟化更耗内存 |
| 流式期间自动滚动 | 80px 阈值判断，简单粗暴 | 多信号融合（滚动、文字选中、键盘、链接点击、搜索都会停止跟随）| 官方显著更精细，避免「正在读上一条被强行拉回」的痛点 |
| 加载历史时位置保持 | 未实现，新消息 prepend 会跳变 | 原生 `preserveScrollOnPrepend` | 官方多 |
| 键盘焦点保持 | 未特别处理 | 官方文档明确「preserve keyboard focus」 | 官方更稳 |
| 跳转动画 | 无 | `MessageScrollerButton` 内置 cubic-bezier 弹性显隐 | 官方多 |

**结论 B**：官方组件在流式体验的「精细度」上明显领先；当前实现的虚拟化在「极长会话」下也表现优秀，但官方用 CSS `content-visibility` 在大多数场景下可达到接近的体验且无需 JS 测高。**两者流畅度持平偏官方略优**，但官方需要验证 1000+ 条带富文本/代码块会话下的实际表现。

#### 维度 C：无障碍访问

| 子项 | 当前实现 | 官方实现 | 评估 |
|---|---|---|---|
| 消息行 ARIA | `MessageBubble` 无 `role` / `aria-live` | `Message` 是 presentational，由内容决定；官方明确建议用 `Marker role="status"` 朗读 streaming | 官方有明确指引，但需主动实现 |
| Actions 标签 | `<Button title="Copy">` 仅靠 `title`，**缺 `aria-label`** | 官方示例明确 `aria-label="Copy"` | 官方更规范 |
| 「跳到最新」按钮 | 无 | `MessageScrollerButton` 内置 `<span class="sr-only">Scroll to end</span>` | 官方多 |
| Live region | 无 | `MessageScrollerContent` 默认提供 live-region | 官方多 |
| 键盘导航 | 仅输入区有 ↑↓/Enter/Esc，消息列表无键盘焦点链 | `MessageScrollerButton` 可聚焦；其余靠原生 | 两者都偏弱，但官方架构更易补齐 |
| 屏幕阅读器朗读 streaming | 气泡末尾 `▊` 字符无法被 AT 朗读 | `Marker role="status"` 推荐模式 | 官方更友好 |

**结论 C**：当前实现的 a11y 短板明显（icon 按钮缺 `aria-label`、streaming 无 `role="status"`、无 live region）。官方组件虽不「自动」解决所有问题，但**给出了清晰的 a11y 模式与对应原语**，迁移过程正是补齐 a11y 的契机。

#### 维度 D：视觉反馈

| 子项 | 当前实现 | 官方实现 | 评估 |
|---|---|---|---|
| 头像 / 对齐 | `flex-row-reverse` 手动切换 | `align="end"` 一键切换，footer 跟随 | 官方更优雅 |
| 同发送者堆叠 | 无 | `MessageGroup` | 官方多 |
| 头像与 footer 关系 | 无特别处理 | `MessageAvatar` 遇 footer 自动 `-translate-y-8` 上移 | 官方细节更好 |
| 状态条 | `AgentStatus` 顶部条 + 工具横向滚动条 | 推荐用 `Marker` 内联在消息流中 | 各有取舍，当前实现信息密度更高 |
| 「跳到最新」按钮 | 无 | 弹性显隐 + 旋转图标 | 官方多 |
| Streaming 光标 | 气泡末尾 `▊` 字符 | `Marker` + `Spinner` | 官方更现代 |
| 暗色模式 | 已支持（手写 `dark:` 类） | 默认支持（基于 CSS 变量） | 等价 |
| 主色一致性 | Agent 紫局部使用 | 通过 `bg-primary` 等令牌自动适配主题 | 官方更易维护 |

**结论 D**：官方组件在「细节交互反馈」（头像错位、跳转按钮、streaming 指示）上更完善；当前实现信息密度更高、Agent 状态条更直观，这是产品定位差异，迁移时**应保留 `AgentStatus` 顶部条**作为补充。

### 2.3 适配成本评估

| 项 | 工作量 | 风险 |
|---|---|---|
| 安装 `message` + `message-scroller` + 依赖 `@shadcn/react` + `bubble` + `marker` | 小 | `@shadcn/react` 是较新的原语包，需验证与 React 19 兼容性 |
| 改造 `MessageBubble` → `Message + Bubble + MessageAvatar/Header/Footer` | 中 | 需保留 `ReactMarkdown` 链路、`SafeLink` 安全降级、`ThinkingBlock` / `ToolCallCard` 内联 |
| 改造 `MessageList` + `ChatArea` 滚动逻辑 → `MessageScrollerProvider` 全家桶 | 中 | 需移除 `@tanstack/react-virtual`，改用 `content-visibility`；要验证 1000+ 条带富文本会话的内存占用 |
| 重写自动滚动逻辑（删 `isNearBottomRef`，依赖 `autoScroll`） | 小 | 需测试用户向上回看时流式输出是否真的不再拉回 |
| 接入 `scrollAnchor`（user 消息标记为锚点） | 小 | 行为变化：新 turn 会在视口顶部而非底部，需用户适应 |
| 补 a11y：icon 按钮 `aria-label` + streaming `Marker role="status"` | 小 | 与现有 `Button title=` 共存即可 |
| 保留 `AgentStatus` 顶部条 + `ThinkingBlock` + `ToolCallCard` | 无 | 这三者不在替换范围 |
| 保留 [InputArea.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx) 全部子组件 | 无 | shadcn 官方无对应 Composer |

**估算**：1.5 – 2 个工作日的纯开发 + 1 天回归测试。

### 2.4 风险点

1. **`@shadcn/react` 原语包成熟度**：`MessageScrollerProvider` 的滚动状态机较复杂，bug 修复依赖上游；需评估版本稳定性与 issue 活跃度。
2. **失去 `@tanstack/react-virtual` 的精确测高**：当前 `measureElement` 对长代码块 / 大图片能精确撑高，`content-visibility: auto` 的 `contain-intrinsic-size: auto 10rem` 估算偏差可能造成滚动条抖动。
3. **`last-anchor` 默认行为变更**：现有用户习惯了「重开会话拉到底部」，迁移后变成「拉到最后一条 user 消息」，需产品确认。
4. **`MessageBubble` 内的安全降级（`SafeLink`、`sanitizeSchema`）**：迁移时必须整体保留，不能因为换了外壳就丢失。
5. **`MessageScrollerItem` 必须包裹每一项**：当前 `MessageList` 的虚拟化结构是 `position: absolute + translateY`，与 `MessageScrollerItem` 的常规流布局不兼容，**两者不能混用**，必须二选一。

---

## 第三部分：输入区域的处理建议

由于 shadcn 官方目前**没有** Composer / Prompt 输入组件（`https://ui.shadcn.com/docs/components/composer` 与 `/prompt` 均返回 404），[InputArea.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx) 及其子组件**无法用官方组件替换**。

可行的演进路径：

1. **维持现状**：当前输入区功能（Slash 命令、@ 文件引用、图片附件、拖拽粘贴、草稿持久化、模型选择、Agent 模式、字符上限）已相当完整，且无对应官方组件，短期内不应改动。
2. **局部借用 shadcn 配套**：未来若官方推出 `Composer` / `Prompt` 组件，可优先替换 `ComposerToolbar`（按钮 + DropdownMenu 部分）与 `ImagePreview`（缩略图 + 预览 Dialog）。
3. **补 a11y 短板**：SlashCommandPopover 与 FileSearchPopover 应改造为 `role="listbox"` + `aria-activedescendant` 模式，或直接复用 `Command` 组件（shadcn 已有）。

---

## 第四部分：评估结论

### 4.1 总体可行性

| 替换目标 | 可行性 | 建议 |
|---|---|---|
| **输入区域**（InputArea 及子组件） | **不可行** | shadcn 官方无对应组件；当前实现功能完备，应保留 |
| **消息展示区域**（MessageList + MessageBubble + ChatArea 滚动逻辑） | **可行，推荐** | 官方 `Message` + `Message Scroller` 在滚动行为、turn 锚定、a11y、视觉细节上**显著超越**当前实现 |
| **Markdown 渲染链路**（ReactMarkdown + sanitize） | **不替换** | 官方不提供，必须整体保留 |
| **虚拟化**（@tanstack/react-virtual） | **可替换但需验证** | 改用 `content-visibility: auto`，需 1000+ 条会话压测 |
| **AgentStatus / ThinkingBlock / ToolCallCard** | **不替换** | 这是产品差异化能力，官方无对应物 |

### 4.2 是否能达到或超越现有用户体验标准？

**能，且明显超越**。具体：

- **交互流畅度**：官方的「滚动离开自动停跟随」+「新 turn 锚定到视口顶部」+「加载历史不跳位置」三件套，直接解决了当前实现「流式期间被强行拉回底部」「重开会话直接跳到底」「无法加载历史」三个核心痛点。
- **无障碍访问**：官方提供 `Marker role="status"`、`sr-only` 跳转按钮、live-region 等模式，当前实现几乎为空白，迁移即补齐。
- **视觉反馈**：`MessageScrollerButton` 的弹性显隐、`MessageAvatar` 遇 footer 自动上移、`MessageGroup` 同发送者堆叠，都是当前实现没有的细节。
- **功能覆盖度**：仅在「Markdown 渲染」与「虚拟化」两块官方不提供，需保留当前实现，**不影响整体替换**。

### 4.3 最终建议

1. **分两阶段推进**：
   - **阶段一（推荐立即执行）**：用 `Message` 替换 `MessageBubble` 的外壳（保留 `ReactMarkdown` 内核），引入 `MessageGroup`、补 a11y。**不动**滚动逻辑。风险低、收益明显。
   - **阶段二（需压测后执行）**：用 `MessageScrollerProvider` 全家桶替换 `ScrollArea` + `@tanstack/react-virtual` + `isNearBottomRef`。先在 1000+ 条带代码块的会话下做内存 / 帧率压测，确认 `content-visibility` 表现可接受后再合并。

2. **必须保留**：`ReactMarkdown` + `rehypeSanitize` + `SafeLink` 安全降级链路、`AgentStatus` 顶部条、`ThinkingBlock`、`ToolCallCard`、`InputArea` 全部子组件。

3. **必须验证**：`@shadcn/react` 原语包与 React 19 / Electron 42 的兼容性；`content-visibility` 在 Electron Chromium 中的实测表现。

4. **行为变更需告知用户**：`defaultScrollPosition="last-anchor"` 会改变重开会话的默认位置，建议在设置中提供「重开时定位到」选项（`last-anchor` / `end`）。

---

## 附录 A：当前实现关键文件索引

| 文件 | 行数 | 角色 |
|---|---|---|
| [input/InputArea.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx) | 752 | 输入区主组件，状态编排 + 键盘仲裁 |
| [input/FileAwareEditor.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/FileAwareEditor.tsx) | 309 | 富文本编辑器，textarea + 高亮遮罩双层 |
| [input/SlashCommandPopover.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/SlashCommandPopover.tsx) | 89 | `/` 命令弹出层 |
| [input/FileSearchPopover.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/FileSearchPopover.tsx) | 79 | `@` 文件引用弹出层 |
| [input/ImagePreview.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/ImagePreview.tsx) | 61 | 图片附件缩略图 + 预览 |
| [input/ComposerRuntimeStatus.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/ComposerRuntimeStatus.tsx) | 36 | 底部状态栏 |
| [input/ContextRing.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/input/ContextRing.tsx) | 62 | 上下文压缩环（未启用） |
| [MessageList.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/MessageList.tsx) | 105 | 虚拟化消息列表 |
| [MessageBubble.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/MessageBubble.tsx) | 230 | 单条消息气泡 + Markdown + actions |
| [ChatArea.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/ChatArea.tsx) | 126 | 容器，含自动滚动逻辑 |
| [AgentStatus.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/AgentStatus.tsx) | 99 | Agent 推理/工具轨迹状态条 |
| [use-input-draft-persistence.ts](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/hooks/use-input-draft-persistence.ts) | 127 | 草稿持久化 Hook |

## 附录 B：shadcn/ui 官方组件源码速览

### Message（registry/new-york-v4/ui/message.tsx）

```tsx
function Message({ className, align = "start", ...props }) {
  return (
    <div data-slot="message" data-align={align}
      className={cn("group/message relative flex w-full min-w-0 gap-2 text-sm data-[align=end]:flex-row-reverse", className)}
      {...props} />
  )
}
function MessageAvatar({ className, ...props }) {
  return (
    <div data-slot="message-avatar"
      className={cn("flex w-fit min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted group-has-data-[slot=message-footer]/message:-translate-y-8", className)}
      {...props} />
  )
}
// MessageContent / MessageHeader / MessageFooter 同构，data-slot + className 组合
```

### Message Scroller（registry/new-york-v4/ui/message-scroller.tsx）

```tsx
function MessageScrollerItem({ className, scrollAnchor = false, ...props }) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item" scrollAnchor={scrollAnchor}
      className={cn("min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]", className)}
      {...props} />
  )
}
function MessageScrollerButton({ direction = "end", ...props }) {
  return (
    <MessageScrollerPrimitive.Button
      data-direction={direction}
      className={cn(
        "absolute inset-s-1/2 -translate-x-1/2 border-border bg-background",
        "data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0",
        "data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100",
        "data-[direction=end]:bottom-4 data-[direction=start]:top-4", className)}
      render={render ?? <Button variant={variant} size={size} />} {...props}>
      {children ?? (<><ArrowDownIcon /><span className="sr-only">{direction === "end" ? "Scroll to end" : "Scroll to start"}</span></>)}
    </MessageScrollerPrimitive.Button>
  )
}
```

依赖：`@shadcn/react`（提供 `MessageScroller` 原语 + `useMessageScroller` / `useMessageScrollerScrollable` / `useMessageScrollerVisibility` 三个 Hook）、`button`。

---

## 附录 C：决策速查表

| 问题 | 答案 |
|---|---|
| 能用 `Message` + `Message Scroller` 替换**输入区域**吗？ | **不能**，官方无 Composer 组件 |
| 能用 `Message` + `Message Scroller` 替换**消息展示**吗？ | **能，且推荐** |
| 替换后体验能超过现状吗？ | **能**，滚动 / a11y / 视觉细节三方面明显提升 |
| 最大风险是什么？ | `@shadcn/react` 原语成熟度 + `content-visibility` 在长会话下的表现 |
| 需要保留什么？ | Markdown 渲染链路、AgentStatus、ThinkingBlock、ToolCallCard、整个 InputArea |
| 建议节奏？ | 分两阶段：先换 Message 外壳（低风险），再换 Scroller（需压测） |

---

# 第五部分：系统化代码优化改造优先级方案

> 本部分基于前述可行性分析结论，按业务影响度、技术依赖关系、改造风险三个维度，将优化项分为 P0–P3 四级，给出可落地的执行顺序、阶段目标、依赖前提与风险规避策略。
>
> **总体原则**：
> 1. **不阻断现有功能**：每一阶段必须可独立合并、可回滚，不依赖后续阶段。
> 2. **特性开关兜底**：所有用户可感知的行为变更（如重开定位策略）必须通过 feature flag 控制，默认关，验证后开。
> 3. **压测先行**：任何涉及性能或滚动行为的改造，必须先通过压测脚手架再合入主干。
> 4. **保留安全降级链路**：`ReactMarkdown + rehypeSanitize + SafeLink` 在任何阶段都不得丢失。

---

## 5.1 优化项分级总览

| ID | 优先级 | 优化项 | 业务影响 | 技术依赖 | 改造风险 | 所在阶段 |
|---|---|---|---|---|---|---|
| T01 | **P0** | 输入区弹出层 a11y 改造（Slash / File 弹出层补 `role="listbox"` + `aria-activedescendant`） | 高 — 直接影响视障用户可用性 | 无外部依赖 | 低 — 仅改两个 Popover 组件 | 阶段 0 |
| T02 | **P0** | `MessageBubble` icon 按钮补 `aria-label`（Copy/Like/Dislike） | 高 — WCAG 合规性 | 无 | 低 — 单文件改动 | 阶段 0 |
| T03 | **P0** | 流式期间补 `role="status"` 与 live region | 高 — AT 无法朗读 streaming | 无 | 低 — 加挂属性 | 阶段 0 |
| T04 | **P1** | 用 `Message` + `Bubble` 替换 `MessageBubble` 外壳（保留 ReactMarkdown 内核） | 中高 — 视觉一致性 + 结构化 | 安装 `message` + `bubble` registry | 中 — 需保留所有内联能力 | 阶段 1 |
| T05 | **P1** | 引入 `MessageGroup` 堆叠同发送者多条消息 | 中 — 视觉整洁 | 依赖 T04 | 低 | 阶段 1 |
| T06 | **P1** | `ThinkingBlock` / `ToolCallCard` 改造为内联于 `MessageContent` | 中 — 结构一致 | 依赖 T04 | 低 | 阶段 1 |
| T07 | **P1** | `MessageFooter` 承载 actions，按 `align="end"` 跟随对齐 | 中 — 视觉细节 | 依赖 T04 | 低 | 阶段 1 |
| T08 | **P2** | 引入 `@shadcn/react`，验证 React 19 + Electron 42 兼容性 | 高 — 后续所有 P2 项的前置 | 无 | 中 — 原语包成熟度 | 阶段 2 前置 |
| T09 | **P2** | 搭建长会话压测脚手架（1000+ 条带代码块/图片的 mock 数据） | 高 — T11/T12 的安全网 | 无 | 低 | 阶段 2 前置 |
| T10 | **P2** | 用 `MessageScrollerProvider` + `MessageScrollerViewport` 替换 `ScrollArea` + `isNearBottomRef` | 高 — 解决流式拉回痛点 | 依赖 T08、T09 | 中高 — 行为变更 | 阶段 2 |
| T11 | **P2** | 移除 `@tanstack/react-virtual`，依赖 `content-visibility: auto` | 中高 — 性能架构调整 | 依赖 T10 压测通过 | 中高 — 长会话表现 | 阶段 2 |
| T12 | **P2** | 接入 `scrollAnchor` + `scrollPreviousItemPeek`（user 消息标记为锚点） | 中高 — 新 turn 阅读体验 | 依赖 T10 | 中 — 行为变更 | 阶段 2 |
| T13 | **P2** | 接入 `MessageScrollerButton`（跳到最新/最旧） | 中 — UX 补全 | 依赖 T10 | 低 | 阶段 2 |
| T14 | **P2** | `defaultScrollPosition="last-anchor"`（feature flag 控制，默认关） | 中 — 重开会话定位 | 依赖 T10 | 中 — 用户习惯变更 | 阶段 2 |
| T15 | **P3** | 启用 `ContextRing`（待后端压缩能力就绪） | 低 — 后端未就绪 | 跨团队 | 低 | 阶段 3 |
| T16 | **P3** | 若官方推出 Composer/Prompt 组件，评估替换 `InputArea` 子组件 | 低 — 官方暂无 | 上游发布 | 中 | 阶段 3 |
| T17 | **P3** | 若 T11 压测不达标，回退为虚拟化 + Message Scroller 混合方案 | 低 — 兜底 | 依赖 T11 结果 | 中 | 阶段 3 |
| T18 | **P3** | 抽离 `ComposerRuntimeStatus` 状态令牌，统一配色规范 | 低 — 视觉一致性 | 无 | 低 | 阶段 3 |

---

## 5.2 阶段排期与执行顺序

### 阶段 0：a11y 紧急补齐（P0，先行独立合入）

**目标**：在不引入任何新依赖的前提下，补齐当前实现的无障碍短板，满足 WCAG 2.1 AA 基线。

**执行顺序**：
1. T02 → T03 → T01（按改动范围由小到大，每项独立 PR）
2. T01 完成后做一次屏幕阅读器（NVDA / VoiceOver）实测

**依赖前提**：
- 无外部依赖
- 不改动任何视觉表现

**预期产出**：
- `MessageBubble` 所有 icon 按钮具备 `aria-label`
- 流式输出区具备 `role="status"` + `aria-live="polite"`
- `SlashCommandPopover` / `FileSearchPopover` 改造为 `role="listbox"` + `aria-activedescendant` 模式（可选项：直接复用 shadcn 已有的 `Command` 组件）

**退出标准**：
- axe DevTools 扫描 0 critical 违规
- NVDA / VoiceOver 实测可正确朗读 streaming 与按钮用途
- 现有键盘交互（↑↓/Enter/Tab/Esc）行为不变

---

### 阶段 1：Message 外壳替换（P1，低风险收益明显）

**目标**：用 `Message` + `Bubble` + `MessageGroup` 重构消息展示层，统一布局结构，保留所有现有内联能力。

**执行顺序**：
1. T04（外壳替换）→ T05（MessageGroup）→ T06（Thinking/ToolCall 内联）→ T07（Footer actions）

**依赖前提**：
- 阶段 0 已合入（避免在旧外壳上重复改 a11y）
- 已通过 `pnpm dlx shadcn@latest add message bubble` 安装 registry
- `components.json` 配置已校验（当前 `style: new-york` / `baseColor: neutral` 已匹配）

**关键技术约束**：
- 必须整体保留：`sanitizeSchema`、`SafeLink`、`remarkGfm`、`rehypeHighlight`、`rehypeSanitize` 链路
- `MessageAvatar` 使用现有 `Avatar` + `AvatarFallback`，不引入 `AvatarImage`
- 用户消息 `align="end"`，助手消息 `align="start"`
- `MessageFooter` 内 actions 的 `opacity-0 group-hover:opacity-100` 行为保留

**预期产出**：
- [MessageBubble.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/MessageBubble.tsx) 重构为基于 `Message` 的组合，行数预计持平或略增
- 同一发送者连续多条消息通过 `MessageGroup` 视觉聚合
- 视觉回归测试通过（截图对比）

**退出标准**：
- Markdown 渲染、代码高亮、链接安全降级、图片附件、思考块、工具调用卡片行为全部一致
- 视觉对比无回归（含 Light/Dark 双主题）
- 虚拟化滚动行为不变（此阶段不动 `MessageList`）

---

### 阶段 2：Message Scroller 替换（P2，需压测护航）

**目标**：用 `MessageScrollerProvider` 全家桶替换 `ScrollArea` + `@tanstack/react-virtual` + `isNearBottomRef`，解决流式拉回、重开定位、历史加载三大痛点。

**执行顺序**（严格按依赖链）：
1. T08（引入 `@shadcn/react`，兼容性验证） — **gate**
2. T09（压测脚手架搭建） — **gate**
3. T10（Provider + Viewport 替换 ScrollArea，先保留虚拟化共存验证）
4. T11（移除虚拟化，切 `content-visibility`） — **需 T09 压测通过**
5. T12（接入 scrollAnchor + peek）
6. T13（MessageScrollerButton）
7. T14（last-anchor 定位，feature flag 默认关）

**依赖前提**：
- 阶段 1 已合入（`Message` 外壳已就位，`MessageScrollerItem` 可直接包裹）
- T08 兼容性报告通过：`@shadcn/react` 在 React 19 + Electron 42 下无 fatal 错误
- T09 压测脚手架就绪：可一键生成 1000 / 5000 / 10000 条带代码块与图片的 mock 会话

**关键技术约束**：
- T10 与 T11 之间必须有一个**共存验证版本**：`MessageScrollerProvider` 外壳 + 内部仍用 `@tanstack/react-virtual`，确认滚动状态机兼容后再移除虚拟化
- `MessageScrollerItem` 与 `position: absolute + translateY` 的虚拟化结构**不兼容**，T11 完成后必须改为常规流布局
- T14 的 `defaultScrollPosition` 必须由 feature flag 控制，默认保持当前「拉到底部」行为，灰度后再切换

**预期产出**：
- [ChatArea.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/ChatArea.tsx) 删除 `isNearBottomRef` 与手动 `scrollTop` 逻辑
- [MessageList.tsx](file:///d:/Administrator/Desktop/pioneering/apps/desktop/src/renderer/src/components/chat/MessageList.tsx) 删除 `useVirtualizer`，改为 `messages.map` + `MessageScrollerItem`
- 新增「跳到最新」浮动按钮
- 重开会话定位策略可配置

**退出标准**：
- 1000 条会话下首屏渲染 < 500ms，滚动 60fps
- 5000 条会话下内存占用不超过当前虚拟化方案的 1.3 倍
- 流式期间用户向上滚动不会被拉回（关键回归测试用例）
- 重开会话定位行为可通过 feature flag 在新旧策略间切换

---

### 阶段 3：收尾与可选优化（P3，视情况执行）

**目标**：处理跨团队依赖项、上游演进跟进、兜底方案准备。

**执行项**：
- T15：待后端上下文压缩能力就绪后，启用 `ContextRing` 并接入 `onCompress`
- T16：持续关注 shadcn 官方 Composer/Prompt 组件发布，发布后评估替换 `ComposerToolbar` / `ImagePreview`
- T17：若 T11 压测不达标，回退为「虚拟化 + MessageScroller 混合方案」（保留 `useVirtualizer` 但用 `MessageScrollerViewport` 作为滚动容器）
- T18：抽离 `ComposerRuntimeStatus` 状态令牌，与 `Message` 系列配色对齐

**依赖前提**：
- 阶段 2 已稳定上线至少 2 周，无重大回归
- T15 需后端团队提供压缩 API
- T16 需上游发布

---

## 5.3 关键里程碑

| 里程碑 | 达成标志 | 对应任务 | 预期收益 |
|---|---|---|---|
| **M0** — a11y 基线达标 | 阶段 0 全部合入，axe 扫描 0 critical | T01–T03 | 视障用户可用性从「不可用」到「可用」 |
| **M1** — 消息展示现代化 | 阶段 1 全部合入，视觉回归通过 | T04–T07 | 结构化布局、同发送者堆叠、actions 对齐规范 |
| **M2** — 兼容性 gate 通过 | `@shadcn/react` 在目标环境验证通过 + 压测脚手架就绪 | T08–T09 | 解锁阶段 2 所有后续任务 |
| **M3** — 滚动体验升级 | 阶段 2 核心合入（T10–T13），feature flag 开启灰度 | T10–T13 | 解决流式拉回、跳转按钮、新 turn 锚定三大痛点 |
| **M4** — 行为变更全量 | `last-anchor` 定位策略全量启用 | T14 | 重开会话定位到最后一条 user 消息，符合阅读习惯 |
| **M5** — 收尾完成 | T15–T18 视情况完成 | T15–T18 | 跨团队依赖项落地、兜底方案就位 |

---

## 5.4 风险规避策略

### 5.4.1 技术风险

| 风险 | 概率 | 影响 | 规避策略 |
|---|---|---|---|
| `@shadcn/react` 与 React 19 / Electron 42 不兼容 | 中 | 高 — 阻断阶段 2 | T08 作为独立 gate，不通过则阶段 2 整体搁置，考虑 T17 混合方案 |
| `content-visibility` 在长会话下内存超标 | 中 | 中高 — 需回退 | T09 压测脚手架先行，T11 必须压测通过才合入；保留 T17 兜底 |
| `MessageScrollerItem` 与虚拟化不兼容导致合并冲突 | 高 | 中 — 阶段 2 内部返工 | T10/T11 之间设共存验证版本，分两步切换 |
| Markdown 渲染链路在迁移中丢失 sanitize | 低 | 极高 — XSS 风险 | 代码 review 必须检查 `sanitizeSchema` 与 `SafeLink` 完整保留；增加单元测试 |
| 流式期间滚动行为回归（用户被拉回） | 中 | 高 — 体验倒退 | T10 合入后必须新增 E2E 用例：流式期间向上滚动不应被拉回 |
| 草稿持久化在组件重构中失效 | 低 | 中 — 用户感知 | 阶段 1 重构 `MessageBubble` 时不动 `InputArea`；阶段 2 不涉及草稿逻辑 |

### 5.4.2 业务风险

| 风险 | 概率 | 影响 | 规避策略 |
|---|---|---|---|
| `last-anchor` 改变重开定位习惯，用户困惑 | 中 | 中 — 体验投诉 | T14 强制 feature flag，默认关；灰度 2 周后全量；设置页提供切换选项 |
| 阶段 2 周期过长阻塞其他需求 | 中 | 中 — 排期冲突 | 阶段 0/1 独立合入，不依赖阶段 2；阶段 2 内部 T10–T13 可拆分多个 PR |
| 重构期间引入回归导致线上故障 | 低 | 高 — 用户流失 | 每个 PR 必须附带视觉回归截图；阶段 2 上线前在内部环境试用 1 周 |

### 5.4.3 回滚策略

- **阶段 0**：纯属性补齐，无需回滚预案
- **阶段 1**：保留旧 `MessageBubble.tsx` 为 `MessageBubble.legacy.tsx`，通过 feature flag 切换；1 周后删除
- **阶段 2**：保留旧 `MessageList.tsx` + `ChatArea.tsx` 滚动逻辑为 `*.legacy.tsx`，feature flag 控制；T11 切换 `content-visibility` 时保留虚拟化代码路径至少 2 周
- **阶段 2 全量**：若 1 周内发现重大回归，feature flag 一键回退到阶段 1 状态

---

## 5.5 依赖关系图

```
阶段 0 (P0)
  T02 ── T03 ── T01
                    │
                    ▼
阶段 1 (P1)
  T04 ── T05 ── T06 ── T07
                    │
                    ▼
阶段 2 前置 (P2 gate)
  T08 ──┐
  T09 ──┴─→ 兼容性 + 压测就绪
                    │
                    ▼
阶段 2 (P2)
  T10 (共存验证) ── T11 (切 content-visibility) ── T12 ── T13 ── T14 (flag)
                                                              │
                                                              ▼
阶段 3 (P3)
  T15 (待后端) / T16 (待上游) / T17 (兜底) / T18 (独立)
```

**关键依赖链**：
- T01 → T04：a11y 改造先于外壳替换，避免在旧外壳上重复改
- T04 → T10：`Message` 外壳必须先就位，`MessageScrollerItem` 才能直接包裹
- T08 + T09 → T10：兼容性与压测是阶段 2 的硬性 gate
- T10 → T11：共存验证通过后才能移除虚拟化
- T11 通过 → T12/T13/T14：行为增强项依赖核心切换完成

---

## 5.6 验收检查清单

每个阶段合入前必须通过以下检查（ reviewer 对照清单逐项确认）：

### 阶段 0 检查清单
- [ ] `MessageBubble` 所有 icon 按钮具备 `aria-label`
- [ ] streaming 区域具备 `role="status"` + `aria-live="polite"`
- [ ] `SlashCommandPopover` / `FileSearchPopover` 具备 `role="listbox"` + `aria-activedescendant`
- [ ] axe DevTools 扫描 0 critical
- [ ] NVDA / VoiceOver 实测通过
- [ ] 现有键盘交互行为无回归

### 阶段 1 检查清单
- [ ] `sanitizeSchema` 与 `SafeLink` 完整保留
- [ ] `remarkGfm` / `rehypeHighlight` / `rehypeSanitize` 链路不变
- [ ] `ThinkingBlock` / `ToolCallCard` 行为一致
- [ ] 图片附件安全降级（非 image/* 不开 `<a href>`）保留
- [ ] Light/Dark 双主题视觉回归通过
- [ ] `MessageGroup` 对同发送者多条消息正确堆叠
- [ ] `MessageFooter` actions 在 `align="end"` 下正确右对齐
- [ ] 虚拟化滚动行为无回归（此阶段不动）

### 阶段 2 检查清单
- [ ] `@shadcn/react` 在 React 19 + Electron 42 下无 fatal
- [ ] 1000 / 5000 / 10000 条会话压测报告达标
- [ ] 流式期间向上滚动不被拉回（E2E 用例）
- [ ] `MessageScrollerButton` 在距底/距顶时正确显隐
- [ ] `scrollAnchor` 对 user 消息正确锚定
- [ ] `scrollPreviousItemPeek` 上方保留像素符合预期
- [ ] `defaultScrollPosition` 受 feature flag 控制，默认行为不变
- [ ] 旧实现已备份为 `*.legacy.tsx` 并附 feature flag
- [ ] 草稿持久化行为无回归
- [ ] 内存占用不超过虚拟化方案的 1.3 倍

### 阶段 3 检查清单（视执行项而定）
- [ ] T15：后端压缩 API 已就绪，`ContextRing` 状态机正确
- [ ] T16：官方 Composer 组件评估报告完成
- [ ] T17：若执行，混合方案压测达标
- [ ] T18：状态令牌抽离后无视觉回归

---

## 5.7 排期建议

> 以下为基于 1 名前端工程师全职投入的粗略排期，实际排期需根据团队容量调整。**不作为承诺时间，仅作相对顺序参考。**

| 阶段 | 任务 | 相对工作量 |
|---|---|---|
| 阶段 0 | T01 + T02 + T03 | 1 单位 |
| 阶段 1 | T04 + T05 + T06 + T07 | 3 单位 |
| 阶段 2 前置 | T08 + T09 | 2 单位 |
| 阶段 2 | T10 + T11 + T12 + T13 + T14 | 5 单位 |
| 阶段 2 稳定期 | 灰度观察 + 回归修复 | 2 单位 |
| 阶段 3 | T15–T18 视情况 | 不定 |

**建议节奏**：阶段 0 → 阶段 1 之间可连续推进；阶段 1 → 阶段 2 之间建议留 1 周观察期；阶段 2 内部 T10–T11 必须有 1 周共存验证期。

---

## 5.8 方案小结

- **P0（紧急）**：3 项 a11y 补齐，无外部依赖，立即执行
- **P1（高）**：4 项 Message 外壳替换，低风险高收益，阶段 0 后跟进
- **P2（中）**：7 项 Message Scroller 替换，需压测护航，分 gate 推进
- **P3（低）**：4 项收尾与兜底，视上游/后端进度

**核心保障**：
1. 每阶段独立可合入、可回滚，不阻断主干
2. 所有行为变更走 feature flag，默认关
3. 性能/滚动改造必须压测先行
4. 安全降级链路（Markdown sanitize）在任何阶段都不得丢失

按此方案推进，可在保障现有功能不被阻断的前提下，稳步将消息展示体验升级到 shadcn/ui 官方组件水平，并为输入区域的未来演进预留接口。
