# 桌面端（apps/desktop）UI 功能分析报告

- 分析基线：分支 V2.6，HEAD `d133c2c`（HITL 三类中断统一为输入框内嵌卡，新增统一命令面板与插件市场页）；工作树另含一处未提交改动（`AccountMenu.tsx` 卡片式样式改造，报告以工作树为准）。
- 代码规模：`src/` 跟踪文件 171 个、31345 行（TypeScript/TSX），其中 renderer 约 2.94 万行、main+preload+shared 约 1900 行、测试 1859 行。
- 门禁实跑：`npm run typecheck`（node+web 两个 tsconfig）全部通过；`vitest run` 133 例中 128 通过、5 失败，5 例全部集中在 `lib/__tests__/match-accelerator.test.ts`（测试断言 `Ctrl+Comma` 的字面量，而 macOS 真环境下 `formatBindingForDisplay` 正确转为 `⌃Comma`，属测试未 mock 平台的断言漂移，非功能回归）。
- 方法说明：所有结论均来自源码逐文件阅读 + 门禁实跑，未采信任何注释自述；关键判定点附文件与行号。

---

## 一、功能概述

桌面端是 Electron 42 + React 19 + Vite 三进程架构（main / preload / renderer）的 AI Agent 工作台，采用 HashRouter 单窗口多路由（`App.tsx:135-149`），整体分为三栏：左侧栏（导航 + 会话列表 + 账户）、中栏（对话/功能页）、右侧栏（多标签面板）。

已落地的主干功能有六条：

1. **双运行时聊天/Agent 对话**：同一套 UI 支持云端 backend-ts（HTTP SSE）与本地内嵌 modu-agent（Electron IPC + better-sqlite3 持久化）两种运行时，按会话 `runtime` 字段路由（云边双模阶段 0–2，`shared/types.ts:48-55`、`transport/index.ts:85-95`）。
2. **流式轨迹渲染**：thinking / tool-call / observation / plan-step / artifact 事件归一化为 TraceNode 树（`stream-handler.ts`），流式期间 rAF 批量刷新，历史消息从后端 `contentBlocks` 重建同一棵树（`trace-builder.ts`）。
3. **HITL 人机协同**：工具审批（tool_confirm）、需求澄清（clarifying）、多选确认（choice）、方案确认门（plan_confirm）四类中断统一以「输入框上方内嵌卡」承载，含队列、去重、超时轮询、断线恢复（`hitlStore.ts`、`InputArea.tsx:364-1162`）。
4. **右栏多标签面板**：任务监控 / 任务流水线 / 产物预览三类标签并存，支持最大化、收起、同名产物复用标签（`rightPanelStore.ts`、`RightPanel.tsx`）。
5. **产物全链路**：AG-UI `ARTIFACT_CREATED` 事件 → 消息附件 → 产物标签 → 沙箱 iframe（HTML/SVG）/ Mermaid 矢量图 / Markdown / 代码四种渲染 → 另存为 / 在 Finder 中定位（`agui.ts:251-266`、`ArtifactRender.tsx`）。
6. **桌面系统集成**：受限 contextBridge API（11 组命名空间）、主进程统一 IPC 安全校验、safeStorage 密钥管理、electron-store 持久化、macOS 原生菜单、全局快捷键治理（electron-store 单一真源）、系统通知、剪贴板、外链白名单。

功能页矩阵中，「会话对话」是全功能实现；「助理 / 我的文件 / 更多」为占位页；「插件市场 / 自动化」为纯前端静态演示；设置弹框 11 个分类中 7 个真实接线、4 个占位。

---

## 二、模块明细

### 2.1 窗口与布局（main + layouts/ + platform/）

| 能力 | 实现 | 证据 |
|---|---|---|
| 平台化窗口 | macOS `titleBarStyle:'hiddenInset'` + 红绿灯定位 (20,17)；Win/Linux 完全无边框、渲染端自绘 min/max/close | `main/window-config.ts:16-33`、`layouts/TitleBar.tsx` |
| 纯 IPC 窗口拖拽 | send/on 模式 + 渲染端 rAF 节流合并坐标；主进程按 webContents.id 维护多窗口拖拽态、仅约束顶部越界、窗口 closed 时清理 | `ipc-handlers.ts:846-916`、`services/ipc.ts:22-30` |
| 自适应三栏 | ≥断点：侧栏 absolute 贴边（262px）+ ResizablePanelGroup（中栏 65% 起、右栏 15–50% collapsible，宽度按平台 autoSaveId 持久化）；<断点：中栏全宽 + 左右 Drawer 覆盖模式 | `RootLayout.tsx:53-55,145-283`、`useResponsiveLayout.ts:35-36` |
| 路由感知顶栏 | 路径 `/` 显示会话标题 + 右侧按钮组；功能页显示导航名；插件/自动化页隐藏通用 ChatHeader（页面自带顶栏）；欢迎页隐藏顶栏仅留折叠态浮动按钮 | `RootLayout.tsx:77-88,193-218` |
| 全屏/最大化同步 | 主进程 maximize/unmaximize/fullscreen 事件推送 → `isFullscreenAtom` → `<html data-fullscreen>` 驱动 layout token | `main/index.ts:91-107`、`App.tsx:113-121` |
| 原生菜单 | 仅 macOS 挂全局菜单，role 项本地执行，about/设置类经 `MENU_ACTION` 转发渲染端 `runMenuAction` | `main/index.ts:152-154`、`main/menu.ts:34-51`、`menu/menuActions.ts` |

### 2.2 侧边栏与会话管理（components/sidebar/ + chatStore）

- **导航**：「新建任务」+ 助理/插件/自动化/我的文件/更多 5 项，全部路由化；激活态由「路由 + draft 态 + 会话选中」推导，保证恰好一个高亮（`Sidebar.tsx:67-78`）。
- **会话列表**：`@tanstack/react-virtual` 虚拟化（行高常量 `CONVERSATION_ROW_HEIGHT`）；双击行内重命名；功能页路由下强制取消行高亮防双焦点（`ConversationList.tsx:41-47,117-119`）。
- **Lazy Create**：点「新建任务」只进入 `isDraftNewSession` 本地态，首条消息发送时才真正 `createSession`（`chatStore.ts:474-481,703-710`）；反复点击复用标题仍为「新对话」的空白会话防堆积（`chatStore.ts:485-496`）。
- **会话操作菜单**（`SessionActionsDropdown.tsx`）：打开文件夹（IPC 白名单，只能打开 userData/~/.pioneering）、重命名（乐观更新+失败回滚）、分享（后端有 shareUrl 复制链接，404 降级复制会话信息）、删除（全局 ConfirmDialog → 本地会话物理删、云端会话归档删）；「保存到工作空间」为 disabled 占位「即将开放」（`SessionActionsDropdown.tsx:111-115`）。
- **账户菜单**（工作树未提交改版）：卡片式 288px 弹层，含个人中心/外观设置/帮助与反馈/主题子菜单/关于软件/退出登录/版本脚注。登出真实调用 `authService.logout()`；「登录账户」跳设置弹框 auth 分类（重定向到系统设置复合页）；「个人中心」跳的 `account` 分类是占位页（见 2.7）。
- **认证状态机**：`idle/loading/authed/anonymous/error` 五态，token 持久化在 electron-store（key `auth.tokens`，明文）、用户资料 localStorage 缓存消闪烁、401/403 清缓存登出、网络故障保留缓存可重试（`authStore.ts`、`useAuthBootstrap.ts:37,121-142`）。

### 2.3 对话消息流（chatStore + stream-handler + chat 组件）

- **状态模型**：Zustand 单 store，流式快照（`streamingContent/Thinking/ToolCalls/TraceNodes/Attachments`）与消息列表分离，`streamSeq` 守卫旧流回调（`chatStore.ts:391,661-950`）。
- **消息生命周期**：streaming → done/error/aborted；HITL 扩展为 streaming → paused → resuming → done（暂停半截消息不落库、resume 续写同一条 assistant 消息，`chatStore.ts:289-311,1054-1201`）。
- **流式管线**：AG-UI 事件 → `createAguiEventDispatcher`（SSE 与 IPC 共用同一分发器，`agui.ts:144-325`）→ `createStreamHandler`（pending 缓冲 + rAF 合并 + 60s idle 超时 + 双写扁平/trace 树，`stream-handler.ts:89-620`）→ chatStore 快照 → 组件。
- **标题两阶段**：发送即截取前 30 字乐观命名；收到回复后云端调 `generate-title`，本地模式降级为截取首条用户消息落库；判据用标题值防重复生成（`chatStore.ts:717-726,838-867`）。
- **消息渲染**：用户消息右对齐气泡 + 图片缩略图（点击应用内 Lightbox 放大，非 image/* 类型不开链接）；助手消息优先 `AgentTimeline`（状态行「正在执行/已完成/出错」+ 总耗时 + 折叠，思考段落灰线引用、工具行中文映射名 + 参数摘要 + 耗时、observation 自动挂载并识别搜索结果/时间结果直出卡片），非 trace 回退 ThinkingBlock + ToolCallCard（`MessageBubble.tsx:125-296`、`AgentTimeline.tsx`、`constants.ts:18-42`）。
- **Markdown 安全渲染**：remark-gfm + rehype-highlight + rehype-sanitize 白名单 schema；`SafeLink` 仅放行 http(s)（其余降级为纯文本），`SafeImage` 协议三重校验 + Lightbox；代码块带复制与「预览」按钮（html/svg/mermaid 打开产物标签，`MarkdownRenderer.tsx:78-178`）。
- **消息操作栏**：hover 出现复制/赞/踩（乐观+失败回滚，本地会话写 SQLite）/重新生成/分享（navigator.share 降级复制）+ 模型名与 token 数展示（`MessageBubble.tsx:288-368`）。regenerate 实现为「截断本地列表 + 用原用户消息重发」，不调后端 regenerate 端点（`chatStore.ts:1463-1502`）。
- **列表滚动**：shadcn MessageScroller（content-visibility 替代虚拟化、autoScroll 流式跟随、新 turn 锚定上方 80px、距底 80px 阈值、跳到最新按钮、顶部「加载更多历史消息」按钮游标分页、产物面板跳转源消息高亮 2.2s）（`MessageScrollerList.tsx`）。

### 2.4 输入区（components/chat/input/）

- **编辑器**：textarea + 高亮遮罩层双盒模型（保留 textarea 光标可靠性），`@{路径}` 文件 token 渲染为标签 chip；IME 组合态 Enter 不发送（`FileAwareEditor.tsx`、`InputArea.tsx:940-961`）。
- **统一命令面板**：`/` 与 `+` 共用一份注册表（`PALETTE_COMMANDS`，7 条 + dev-only `/mock-plan`）；slash 模式查询来自编辑器文本、plus 模式内置搜索框；支持 ↑↓/Enter/Tab/Esc/⌘1-9 直选；当前注册的真实动作只有「上传文件（弹系统对话框）」「切换 Agent 模式」，`/clear /plan /agent /help /optimize` 仅向编辑器插入 token（全仓无这些 token 的执行器）（`CommandPalette.tsx:77-164`、`InputArea.tsx:741-774`）。
- **@ 文件引用**：候选只来自当前输入框内已存在的 `@{}` token 文件（`selectedFiles` 派生），不提供文件系统浏览（`InputArea.tsx:552-559`）。
- **图片附件**：粘贴/拖拽/按钮三入口，限 png/jpeg/gif/webp、单张 ≤20MB，超限系统通知提示；缩略图 + 移除 + 计数状态行（`image-attachments.ts`、`InputArea.tsx:596-689`）。
- **拖拽**：本地文件经 `webUtils.getPathForFile` 还原路径插入 token，图片走附件（`drag-folder.ts`、`preload/index.ts:211-221`）。
- **模型选择器**：硬编码 6 项 + 「配置模型」跳设置；发送时 `model` 字段透传（'Auto' 原样发送，'配置模型' 转 undefined）；**本地 IPC 模式该字段被主进程校验器丢弃**（`chatStore.ts:929`、`agent-runtime.ts:161-171`）。
- **草稿持久化**：按会话 key 存 electron-store（`STORE_SET`），含已附图片 base64；流式与 HITL 态暂停保存（`use-input-draft-persistence.ts`、`input-drafts.ts`）。
- **其他**：字符上限 10000（>90% 变色提示）；麦克风按钮永久 disabled（"即将上线"）；Agent 徽标可关闭；流式期发送按钮替换为停止按钮；免责声明行；HITL 精简态（`mode='hitl'`）隐藏模型/麦克风/slash/@/草稿，`+` 仅剩附件（`InputArea.tsx:107-174,508-516`）。

### 2.5 HITL（stores/hitlStore + lib/hitl-surface + 内嵌卡）

- **协议**：`UserQuestionRequestPayload.kind ∈ tool_confirm | clarifying | choice | plan_confirm`，载荷含 tool_calls/question/options/artifacts；答复体 `ResumeRequest` 含 approved/feedback/modifiedArgs/answer/answerId（`shared/types.ts:306-347`）。
- **队列状态机**：`enqueue/dequeue/resolve/skip/dismiss` 单一入口；按「会话+类型+runId+问题标识」去重；resolving 期间一律排队；答复前自动切换回归属会话；resume 启动失败回滚 paused 并暴露可读原因（`hitlStore.ts:122-212`）。
- **超时治理**：展示期间每 15s 轮询 `getState`，服务端 expired/失效则收尾消息（追加「已失效」）、走全局错误条提示；本地暂停但服务端无暂停项时同样收敛（`hitlStore.ts:284-304`、`chatStore.finalizeHitlStale`）。
- **断线恢复**：`selectSession` 后 `recover()` 查 `getHitlState`，仍暂停则重建 paused 占位容器 + 入队（`chatStore.ts:600-619`、`hitlStore.recover`）。
- **内嵌卡形态**（阶段三收敛后全部 inline，`resolveHitlSurface` 纯函数）：
  - tool_confirm 卡：工具编号列表（单行参数摘要、点击展开 JSON、逐工具「修改参数」textarea，批准时非法 JSON 项保持原参）、拒绝（approved=false 走拒绝分支）、批准并继续（携带 modifiedArgs）、右上 × 放弃整个 run（abort）；resume 中按钮禁用防重复提交（`InputArea.tsx:311-472`）。
  - clarifying/choice 卡：编号选项点击即 `answerId` 作答；无选项时输入框承接自由文本（同时写入 answer 与 feedback 双通道兼容后端）；× = 跳过（空回答 approved=true 继续）（`InputArea.tsx:1109-1161`、`ChatArea.tsx:143-158`）。
  - plan_confirm 卡：问题 + 固定说明语 + 产物文件列表（path 缺省仅展示名）+「是的，执行此方案」（Enter/点击均 approved=true）+ 输入其他指导文字；**当前后端无该事件的产出节点，仅 dev `/mock-plan` 可注入**（`InputArea.tsx:176-194,1052-1108`、`CommandPalette.tsx:150-164`）。
- **暂停消息视觉**：paused 气泡显示「已处理 N 秒」+ 虚线 + 「等待你确认/选择/补充」状态头（`MessageBubble.tsx:62-92`）。
- **观测**：clarifying/choice 的 triggered/answered/skipped/expired 计数存 localStorage，派生误触发率 skipRate，`window.__clarifyStats()` 只读出口（`clarify-metrics.ts`）。
- **模态弹窗通道**：`HitlHost` 恒返回 null，三个 Dialog 组件完整保留作回退，零挂载引用。

### 2.6 右栏面板与产物预览（right-panel/ + preview/）

- **标签模型**：`monitor/pipeline/preview` 三类；任务标签 keep-alive 仅切显隐，产物标签仅激活时挂载（iframe 资源考虑）；产物标签 id 由标题派生、同名复用；关闭激活标签回退右邻→左侧→空态；最大化/收起/面板菜单/新建标签按钮齐全（`rightPanelStore.ts`、`RightPanel.tsx`、`PanelTabBar.tsx`）。
- **任务监控**：四个分组——待办（**当前为硬编码 DEFAULT_TODO_ITEMS 四条已完成示例**，注释自述"暂时沿用默认值"）、产物（真实：聚合当前会话 assistant 消息 attachments + 流式 attachments，按 id 去重，带类型/大小/路径、预览、另存为、Finder 定位）、技能与 MCP / 记忆更新（**空分组，无 children 内容**）（`TaskMonitor.tsx:44-49,313-373`）。
- **任务流水线**：工具调用时间轴（等待/执行/完成/失败四态、圆点+连线、进度摘要「已完成 x/y」、错误条），流式期数据源 `streamingToolCalls`、空闲期回放最后一条 assistant 消息的 toolCalls，阶段徽章行 idle/thinking/executing/done/error（`TaskPipelineTab.tsx:42-90`）。
- **产物预览**：HTML/SVG 包完整文档进 `<iframe srcdoc sandbox="allow-scripts">`（不给 allow-same-origin），iframe key 绑内容防状态残留；Mermaid 动态 import 渲染矢量图，解析失败降级源码；Markdown 复用对话区渲染器；其余代码视图；支持导出（saveDialog + FILE_WRITE）与「跳转源消息」（高亮信号 → scrollIntoView）（`ArtifactRender.tsx:113-136`、`MermaidRender.tsx`、`ArtifactPanel.tsx`）。
- **消息附件卡**（AttachmentList）：信任通道分级——本地 filePath 走 FILE_READ 另存为、http(s) 交系统浏览器、base64 解码落盘（binary）；其它协议一律禁用。

### 2.7 设置弹框（components/settings/）

11 分类 = 7 个真实接线 + 4 个占位（`settingsConfig.tsx:87-124`）：

| 分类 | 状态 | 实际能力 |
|---|---|---|
| 通用 | 部分接线 | 主题（light/dark/system）、语言、字号三档真实持久化并作用 `<html>`；转录快捷键/本地链接打开方式/存储路径等 9 处控件为组件内 useState，无持久化无副作用（`GeneralSection.tsx:84-86`） |
| 快捷键 | 全接线 | 录制弹窗 + 冲突/危险绑定检查 → 全量提交主进程 electron-store（SOT），全局项注册冲突黄条回传；13 条注册表，其中 toggle-record/chat-search/stop-generate 无动作实现（引擎按零回归原则不吞键）（`useHotkeyEngine.ts:127-130`） |
| 系统设置 | 全接线 | 复合页内嵌三卡：本地运行时（云端/本地模式切换 + 5 个受管密钥 safeStorage CRUD，掩码展示）、外网 API（baseURL 编辑 + `/health` 探测 + 持久化同步主进程）、认证（登录/登出） |
| 模型 | 半接线 | 模型 CRUD + 启用开关 + apiKey/apiBase 表单，持久化到 localStorage（zustand persist）；**但输入框模型下拉是另一份硬编码 MODEL_OPTIONS，modelConfigs/defaultModel 无任何消费方**（grep 全仓仅 ModelSection 自身）；apiKey 明文入 localStorage |
| 数据管理 | 占位 | 4 个 Tab（分享文件/分享任务/发布应用/归档任务）全部静态空态 |
| 安全中心 | 占位 | 沙箱开关、自动备份、敏感保护、捆绑运行时等 10 组 useState，无持久化、无任何主进程联动（`SecuritySection.tsx:37-46`） |
| 关于 | 部分接线 | 官网/帮助/反馈/mailto 真实 openExternal；**「检查更新」按钮为 `Math.random() > 0.2` 假结果**（`AboutSection.tsx:144-153`）；主进程 `APP_CHECK_UPDATE` 仅回传版本号，无自动更新器（`ipc-handlers.ts:290-294`）；二维码为占位图形 |
| 账号 / 智能体 / 记忆 / 助理 | 占位 | 「功能正在建设中」 |

### 2.8 功能页

- **插件市场**（/plugins）：三 Tab（插件真实渲染、技能/工作伙伴占位）、17 分类胶囊 + 28 个静态插件卡 + 2 个推荐位、关键词过滤、安装态 Set（默认预装"飞书"）与管理模式；**数据全部硬编码于组件文件，安装态为组件内 useState，切换路由即丢失，不持久化不联动任何后端**；顶栏「添加」按钮无 onClick（`PluginsPage.tsx:437-443`）。
- **自动化**（/automation）：定时任务/运行记录双 Tab；创建弹窗（名称/内容/重复规则 daily-weekdays-weekly-once/时间/星期/日期）与 12 个模板预填真实可用；任务支持启停与删除；**任务列表为组件内 useState（不持久化，切页即失），无调度器联动，执行不会真的跑**；「运行记录」为静态空态（`AutomationPage.tsx:9,240-295`）。
- **占位页**：助理/我的文件/更多 = 图标 + "开发中，即将上线"。
- **/workspace**：文件标签页框架（打开/关闭/切换、dirty 星标位），但 `useWorkspaceStore.openFile` 全仓零调用方，页面永远停留在空态；内容区为只读 `<pre>`；store 注释自述"半成品"（`useWorkspaceStore.ts:3-5`）。
- **/home**：开发落地页（技术栈卡片），侧栏无入口。
- **欢迎页**：标题 + 5 个功能 Tab（doc 等）+ 模板画廊（16 种场景缩略图均为 SVG/CSS 手工绘制），点击模板把 prompt 直接 `sendMessage`（`templates.ts`、`ChatArea.tsx:117-122`）。

---

## 三、交互逻辑

### 3.1 与 modu-agent 的对接（重点）

**接线方式：渲染进程不直接 import 内核；内核以包依赖形式编译进 Electron 主进程，经 IPC 暴露。**

1. **内核入口**（`main/agent-runtime.ts:35-48`）：从 `@pioneering/modu-agent` import `create_agent / get_runner / reset_runner_cache / stream_response / resume_stream / resume_sync / get_interrupt_state / checkInterruptTimeout / AGUIStreamAdapter / getRegistry / getConfig / CodeExecutorTool`。
2. **端点语义对齐**：五个 IPC 通道与 backend-ts REST 一一对应——`agent:send`↔`POST /agent/completions`（stream 分支）、`agent:resume`↔`POST /agent/resume`、`agent:abort`↔`POST /agent/abort`、`agent:state`↔`GET /agent/state/:threadId`、`agent:stop`↔`POST /agent/completions/stop`；ipc-handlers 每个通道先 `isTrustedSender` 校验再调 runtime。
3. **事件流**：`AGUIStreamAdapter.transform_langgraph_events(stream_response(...))` 产出 `{data:"<json>"}` dict，主进程逐条 `JSON.parse` 后包成 `AgentEventEnvelope {runId, seq}` 经 `agent:event` 推送（`agent-runtime.ts:199-229`）；渲染端 IpcTransport 先订阅后 invoke（保证首事件不丢），按 runId 过滤进 `createAguiEventDispatcher`——与云端 SSE **共用同一分发器**，云边事件语义同源（`ipc-transport.ts:76-123`）。终态事件（RUN_FINISHED/RUN_ERROR/RUN_PAUSED/HITL_ABORTED）到达后自动退订清理。
4. **图生命周期**：默认模式复用内核 `get_runner()` 编译图缓存（config hash 失效）；`plan_execute` 必须建图期覆盖（planner/step_dispatch 节点挂载由 `configurable.plan_execute_enabled` 决定），故走 `create_agent({configurable})` + 运行时 extraConfigurable（`agent-runtime.ts:266-283`）；safeStorage 密钥写入 env 不进 config hash，SECURE_KEY_SET/DELETE 成功后主动 `reset_runner_cache()` 防"改 key 不生效"（`ipc-handlers.ts:816-833`）。
5. **HITL 桥**：`getHitlState` 查询前先 `checkInterruptTimeout`（超时自动拒绝返回 expired）；`abortPending` 用 `resume_sync(approved=false)`；**实测其返回体未透传 `artifacts` 字段**（`agent-runtime.ts:454-468` 无 artifacts 行，而类型与云端均支持）→ 本地模式下 plan_confirm 恢复场景拿不到产物列表。
6. **敏感工具注册策略**：factory 默认只注册 4 个无风险工具；`code_executor` 由宿主在 `tools.human_in_loop.enabled=true` 时才注册——防绕过审批直接执行（`agent-runtime.ts:241-253`）。
7. **请求契约差异（代码注释与实现一致）**：本地模式不透传 model/systemPrompt/temperature（validateSendRequest 白名单外字段全部丢弃）；多轮上下文由渲染端把最近 20 条消息压缩为 role/content 对随请求携带（内核无 Prisma 会话态）；userId 固定 `local_user`。
8. **渲染端路由**：Transport 抽象 + 三级选择（localStorage `agent.transportMode` > VITE_AGENT_TRANSPORT > 默认 http）；**会话级路由**：`runtime==='local'` 的会话 send/resume/abort/getState/stop 恒走 IPC，与全局模式无关；preload 不可用时自动回退 http 并告警一次；控制台 `window.__setAgentTransportMode()` 可切换（`transport/index.ts`）。
9. **本地持久化**（云边双模阶段 2）：`main/local-store.ts` better-sqlite3（createRequire 加载原生模块，缺失时各通道统一报"本地数据库不可用"不崩溃）落 `userData/local-chat.db`，`chat_sessions`/`chat_messages` 幂等建表；用户消息发送即落库、assistant 仅终态（done/error/aborted/stop）聚合落库一次（HITL 暂停半截消息不落库）、`INSERT OR IGNORE` 幂等；轨迹以 `contentBlocks`（thinking/tool_call/tool_result 对）持久化，回读时 trace-builder 重建 Trace 树；regenerate 同步物理删除被截断消息；登出保留本地会话（归属设备）。
10. **run 清理**：渲染端销毁（刷新/关闭）时 `abortRunsForSender` 中止该 webContents 全部在途 run（`ipc-handlers.ts:840-844`）。
11. **已知断点（实证）**：流式中抢占发送路径只做 `abortController.abort()`（渲染端退订），**不调 `transport.stop()`**——IPC 模式下主进程 `executeSend` 循环继续跑到自然结束，成为烧 token 的孤儿 run；同文件的「停止按钮」路径已正确调用 `getTransportForRuntime(...).stop()`（`chatStore.ts:677-679` vs `984-993`）。

### 3.2 关键 UI 行为链

- **发送**：InputArea.handleSend →（HITL 澄清态则改走 resolveHitl）→ ChatArea.handleSend → chatStore.sendMessage：暂停守卫（本会话 HITL paused 时拒绝新发送并给出可见错误）→ 抢占旧流 → 无会话则 Lazy Create 落地 → 乐观标题 → 用户消息入列（本地会话即时落库）→ assistant 占位 → Transport.sendMessage(streamHandler)。
- **停止**：停止按钮 → stopStreaming：暂停态等价「取消待确认项」（hitlStore.dismiss：关窗+abort+出队下一项）；正常态 abort + `transport.stop(sessionId)` + 在途 trace 节点全部标 completed + 快照落消息 + 本地终态落库。
- **HITL 答复**：卡片动作 → hitlStore.resolve（切归属会话 → resolving → chatStore.resumeHitl（以 paused 消息 trace 为种子续写）→ 成功关窗等流回调 dequeue / 失败回滚 paused+error）→ 队列串行处理多次 interrupt。
- **产物**：`ARTIFACT_CREATED` → stream-handler 转 Attachment 进流式快照 → 消息附件 → TaskMonitor 产物分组/消息附件卡 → 点击 → detectArtifactPreview 判型 → openArtifact 建同名标签 → ArtifactPanel 渲染/导出。
- **会话切换恢复**：selectSession → loadMessages（先）→ hitlStore.recover（后，顺序注释明确：防恢复占位被加载结果覆盖）。

### 3.3 进程与安全边界

- 渲染端全部系统能力经 preload 的 11 组受限 API（无裸 ipcRenderer；非隔离上下文直接抛错拒载）。
- 主进程 IPC 统一防护：trusted sender 帧 URL 校验（file://、app://、回环地址严格正则）、文件读写路径白名单 + realpath 逐级解析防软链逃逸、10MB 上限、electron-store 值 JSON 往返净化、外链仅 http(s)、showItemInFolder 仅限应用数据目录。
- CSP 经 webRequest 注入（生产 script-src 'self'，dev 放宽 inline）；产物 iframe sandbox 无 same-origin；Markdown sanitize + SafeLink/SafeImage；消息图片 mediaType 门控。

---

## 四、实现边界（未实现 / 预留 / 半成品清单）

以下每一条均经源码回查确认「协议/UI 存在但链路不通」或「纯占位」，按影响排序：

**A. 数据链路断点**

1. **图片不出本机**（P1）：`SendMessageRequest` 类型无 images 字段，云端 SSE 与本地 IPC 请求体均不携带图片二进制；纯图片消息发送的是英文占位字面量 `'[User attached images without additional text.]'`（`image-attachments.ts:25` → `InputArea.tsx:855`）。图片仅在本地消息气泡中可见，模型侧永远看不到。
2. **plan_confirm 无生产者**（P1 级预留）：UI、协议、resume 分支齐备，但本地与云端均无发射该事件的图节点；产品内唯一触发方式是 dev 构建的 `/mock-plan`（`types.ts:309-312` 注释与 `InputArea.tsx:177-194` 自述一致）。附带：本地 `getHitlState` 不透传 artifacts（3.1-5）。
3. **IPC 模式抢占孤儿 run**（P1）：流式中直接发送新消息，旧本地 run 不中止继续执行（3.1-11）。
4. **模型选择不生效**（P2）：设置页模型管理（modelConfigs/apiKey）与输入框下拉（硬编码 MODEL_OPTIONS）是两套数据，互不连通；即便选了模型，本地 IPC 模式主进程丢弃 model 字段；`'Auto'` 会原样作为模型名发给云端。
5. **agentMode=plan_execute 无 UI 入口**（P2）：chatStore→主进程→内核的透传链完整，但 desktop 任何交互都无法把会话 agentMode 置为 plan_execute（createSession 只会写 react_agent），当前为纯协议通道。
6. **云端后端不被 desktop 拉起**（边界说明）：主进程无 spawn backend 逻辑，`MODU_DOC_WRITER_ROOT` 注入仅在"desktop 负责拉起 backend"时生效（`main/index.ts:17-22` 注释）；云端模式要求用户自行启动 127.0.0.1:8088 服务，网络探测走 `/health`。

**B. 无执行器的交互面**

7. **斜杠命令**：`/clear /plan /agent /help /optimize` 只插入文本 token，全仓无消费端；选中技能前缀 `[Skill: x]` 同理——`setSelectedSkill` 仅出现在草稿恢复与清空处，没有任何选择器能设置它（P3）。
8. **ChatHeader 三个死按钮**：搜索、分享、历史按钮无 onClick（`ChatHeader.tsx:91-93`）；快捷键注册表中 `chat-search / toggle-record / stop-generate` 对应功能未落地（P3）。
9. **麦克风输入**：永久 disabled（P4，明示"即将上线"）。
10. **插件页「添加」按钮**：无 handler；安装态不持久化（P3）。
11. **自动化页**：无调度器、无持久化、无运行记录数据源——整个页面是交互原型（P3）。
12. **工作区页**：无任何调用方打开文件，恒为空态（P3）。

**C. 占位与装饰**

13. **设置占位分类**：账号（账户菜单「个人中心」的落点）、智能体、记忆、助理 4 项「功能正在建设中」；数据管理 4 Tab 静态空态；安全中心 10 组开关纯装饰（含"沙箱安全默认开"的误导展示——与实际安全实现无任何耦合）（P2：观感上像已实现）。
14. **关于页「检查更新」为随机结果**（`Math.random() > 0.2`），且主进程无自动更新器（P2：会产生虚假的"已是最新版本"反馈）。
15. **TaskMonitor 待办为硬编码示例**：任何会话打开右栏都会看到 4 条与当前无关的"已完成"待办（2026-08-16 AI 新闻任务），代码注释预留了"由 plan/state_delta 事件注入"的方向但无实现（P2：信息真实性问题）；「技能与 MCP」「记忆更新」分组为空壳。
16. **侧栏「空间」分组**：count 恒 0 +「即将开放」（P4）。
17. **会话分享 / 保存到工作空间**：依赖后端未就绪端点，失败静默降级（复制到剪贴板 / 什么都不做）（P4，有意的降级设计）。
18. **HITL 模态弹窗通道**：HitlHost 恒 null，三类 Dialog 零挂载保留作回退（P4，有意保留）。

**D. 环境边界**

19. 纯浏览器运行（无 Electron）时 `mocks/electron-mock` 兜底 window.api，本地密钥/SQLite/通知等降级；Transport 与本地 DAO 可用性检测自动回退云端模式。
20. 单元测试基线：10 文件 133 例（含 hitl/streaming/transport/ipc/clarify/hotkey 匹配等核心回归）；当前 5 例平台断言漂移待修。
