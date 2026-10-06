# Pioneering Desktop UI 功能分析报告（V2.7）

- **基线**：分支 `V2.7`，HEAD `4ef2741`（feat(desktop): P1-P4 全量修复 26 项 + 170 单测全绿），工作树干净
- **范围**：`apps/desktop/src` 全量源码（含测试共 35,079 行；不含测试约 30,779 行，171 个 ts/tsx 文件 + css）
- **门禁实证**：`tsc --noEmit` 0 错误；`vitest run` 170/170 通过（16 个测试文件，1.09s）
- **方法**：主代理直接深读源码 + 门禁实跑，全部结论可回溯到具体文件；不含设计意图推测

---

## 一、功能概述

Pioneering Desktop 是一个 Electron 桌面端 AI Agent 工作台，采用 **主进程（main，10 文件）+ 受限 preload 桥（2 文件）+ React 渲染层（renderer，158 文件）+ 进程间共享契约（shared，6 文件）** 的四层结构。

已实现的产品能力按用户可感知面归纳为七块：

1. **对话与 Agent 执行**：会话/消息管理、流式输出（思考过程/工具调用/正文/产物/计划步骤五类轨迹的可折叠树形渲染）、重新生成、点赞点踩、图片放大预览、欢迎页引导与模板卡片。
2. **HITL 人机协同**：三类中断（工具审批 / 需求澄清 / 多选）+ 方案确认门，全部内嵌为输入框上方卡片；支持改参批准、跳过澄清、队列串行展示、跨重启恢复与超时自动收敛。
3. **云边双模运行时**：同一套 UI 可选择「云端」（HTTP SSE 连 backend-ts）或「本地」（主进程内嵌 modu-agent，IPC 推送，断网可用）；按会话 `runtime` 字段路由，本地会话持久化到 SQLite。
4. **密钥与安全治理**：5 个本地受管密钥 + 每模型 apiKey 经系统密钥库（safeStorage：macOS Keychain / Windows DPAPI）加密存储，明文不回传渲染端；CSP、沙箱 preload、IPC 调用方校验、文件路径白名单等 9 类安全机制落地于主进程。
5. **输入工作台**：统一命令面板（`/` 与 `+` 共用注册表）、@ 文件引用、图片附件（粘贴/拖拽/按钮三入口）、按会话草稿持久化（图片二进制外置）、可自定义快捷键引擎、模型下拉（与设置页单一数据源）。
6. **功能页**：插件市场（安装态本地持久化）、自动化定时任务（配置持久化）、右侧任务监控（计划待办 + 产物预览/另存为/Finder 定位）、设置中心（9 个分区）。
7. **桌面集成**：无边框窗口（平台差异化标题栏）、纯 IPC 窗口拖拽、全局快捷键（Shift+Alt+W 唤起）、macOS 原生菜单、系统通知、剪贴板、文件对话框。

**未实现/预留部分**（详见第四节）：图片的模型视觉通道、plan_confirm 的后端生产节点、真实定时调度、安全中心开关的实际行为、三个占位导航页、语音输入等。

---

## 二、模块明细

### 2.1 main 进程（src/main，10 文件）

| 文件 | 已实现能力 |
|---|---|
| `index.ts` (166 行) | 应用启动编排：`app.name='Pioneering'`、注入文档根目录 env（`MODU_DOC_WRITER_ROOT`→userData/Documents）、CSP 经 `webRequest.onHeadersReceived` 注入（`connect-src` 仅限 localhost/127.0.0.1 的 http/ws，`frame-src 'none'`，生产禁内联脚本）、`sandbox:true + contextIsolation:true + nodeIntegration:false`、窗口 maximize/fullscreen 事件推送给渲染端、`setWindowOpenHandler` 仅放行 http(s) 并转 `shell.openExternal`、macOS 全局菜单挂载 |
| `agent-runtime.ts` (505 行) | 本地 Agent 运行时：五通道语义逐条对齐 backend-ts REST（send/resume/abort/state/stop）；`AgentEventEnvelope{runId, seq}` 经 `AGENT_EVENT` 推送；`get_runner()` 编译图缓存 + `plan_execute` 走 `create_agent({configurable:{plan_execute_enabled:true}})` 建图期覆盖；`validateSendRequest` 白名单校验（message 非空≤100k 字符、`agentMode ∈ {react_agent, plan_execute}` 白名单外归一化丢弃、history 逐项校验）；密钥变更 `invalidateAgentGraphCache()`；`code_executor` 仅在内核 HITL 开关启用时注册；`getHitlState` 先查 `checkInterruptTimeout` 超时治理，透传 kind/question/options/**artifacts**/pending_tool_calls；渲染端 webContents 销毁时 `abortRunsForSender` 清理在途 run；`.env` 惰性加载（只填未设值，desktop 自身优先、回退 backend-ts） |
| `ipc-handlers.ts` (1,140 行) | 全部 IPC 处理器（约 45 个通道）：每次调用先过 `isTrustedSender`（仅 file://、app://、localhost/127.0.0.1/[::1]，严格主机名匹配防 `localhost.evil.com` 绕过）；文件读写白名单（userData 等 8 个系统目录 + 用户经对话框选定路径，`realpathSync` 逐级解析防软链逃逸，10MB 上限，错误归一化不泄露路径）；`sanitizeValue` JSON 往返防原型链污染；DRAFT_ASSET 三通道（图片二进制外置 `userData/draft-assets/<id>`，MIME 四选一、≤20MB、id 白名单、异步写不阻塞）；MODEL_SECRET 四通道（apiKey 经 safeStorage 加密 `enc:v1:` 前缀落盘，apiBase 明文，明文永不回传渲染端）；窗口拖拽（per-webContents 状态、顶部工作区约束、窗口关闭清理） |
| `key-store.ts` (199 行) | 5 个受管密钥（LLM_API_KEY/LLM_BASE_URL/LLM_DEFAULT_MODEL/MODU_LLM_PROVIDER/TAVILY_API_KEY）：敏感键 safeStorage 加密、非敏感键明文、`list()` 只回掩码（头4尾2）、`applyToEnv()` 每次 run 前解密注入 `process.env`、删除同步清理 env |
| `local-store.ts` (467 行) | SQLite 会话/消息 DAO（better-sqlite3，WAL 模式）：表结构对齐云端 PG schema（snake_case），幂等建表；`INSERT OR IGNORE` 幂等追加 + 事务维护 `message_count/last_message_id`；游标分页（cursor 为最旧消息 id）；`deleteMessages` 事务内级联修正计数；原生模块缺失/磁盘不可写时降级返回 null 不崩溃 |
| `hotkey-main.ts` (132 行) | 快捷键治理：electron-store 为唯一真源（key=`hotkeys`）；`scope='global'` 的命令经 globalShortcut 注册（当前仅 `toggle-main-window` = Shift+Alt+W 唤起/隐藏）；注册失败记入 conflicts 回传渲染端黄条；`unregisterAll` 幂等防 crash 残留 |
| `window-config.ts` (35 行) | 平台窗口配置表：macOS = 原生 frame + `hiddenInset` + 红绿灯精确位置 (20,17)；Windows/Linux = 无边框，控件由渲染端提供 |
| `menu.ts` / `resources.d.ts` | macOS 应用菜单构建（模板在 shared/menu-template.ts，动作经 `MENU_ACTION` 通道转发渲染端 `runMenuAction` 15 个 case 分发） |

### 2.2 preload 桥（src/preload）

- `index.ts` (255 行)：通过 `contextBridge` 暴露 **13 组受限 API**：`window`（min/max/close/fullscreen/拖拽三段式/状态订阅）、`app`（平台/退出/checkUpdate/networkCheck/setApiBaseUrl/日志目录/菜单动作）、`file`（对话框×2/读/写/在文件夹显示）、`notification`、`clipboard`、`shell`、`store`（KV 持久化）、`draftAsset`、`agent`（send/resume/abort/state/stop/onEvent）、`localChat`（8 个 DAO 方法）、`secureKeys`、`modelSecret`、`hotkeys`。**不暴露 ipcRenderer**（H5），额外只暴露 `webUtils.getPathForFile`（try/catch 包裹，失败返 null）。非隔离环境直接抛错终止。
- `index.d.ts`：T1 修复后的完整类型桥接（13 组 API 全量声明）。

### 2.3 shared 契约（src/shared，6 文件）

- `types.ts` (377 行)：`SendMessageRequest`（message/sessionId/history/**agentMode**/model 等，**无 images 字段**）、`Message`（traceNodes 树、images/attachments、paused/pausedKind）、`TraceNode` 六种 kind（thinking/tool-call/observation/text/error/plan-step）、HITL 四类 kind（tool_confirm/clarifying/choice/plan_confirm）、`ResumeRequest`（approved/feedback/modifiedArgs/answer/answerId）、`HitlStateResponse`（含 artifacts）。
- `ipc-channels.ts` (325 行)：全部通道常量冻结（T3）。
- `hotkey-registry.ts`：14 条快捷键定义（13 条 renderer scope：发送/换行/新建/停止/左右面板/缩放/搜索/转录等；1 条 global）；`hotkey-protocol.ts`、`menu-template.ts`、`links.ts`（官网/文档/反馈 URL 单点维护）。

### 2.4 renderer — 状态层（stores，11 文件）

| Store | 已实现能力 |
|---|---|
| `chatStore.ts` (1,567 行) | 核心会话状态机。会话：云端+本地列表合并按 updatedAt 排序、Lazy Create（draft 态，首条消息才真正创建）、空白会话复用守卫、乐观标题（30 字截断→AI 命名/本地降级）、重命名乐观更新失败回滚、删除、分享（本地会话返回 null）、登出保留 local 会话。发送：HITL 暂停守卫、**抢占 = 渲染端 abort + `transport.stop`/`chatService.stopGeneration` 双通道通知后端**（T1）+ 空 assistant 占位移除；IPC 模式携带 20 条压缩 history；`model='Auto'` 归一化为不下发；`agentMode` 按会话透传。停止：HITL 态等价 dismiss，普通态 trace 在途节点标 completed。HITL：`pauseStreamingMessage` 保留 streamingMessageId 供续写、`resumeHitl` 用暂停消息 trace 树做种子续写同一条消息、`restoreHitlPause` 重建占位容器、`finalizeHitlStale` 超时收尾。反馈：乐观更新 + 本地 SQLite/云端分流落库。重新生成：截断消息列表 + 本地库同步删除 + images 回传 |
| `hitlStore.ts` (318 行) | HITL 队列状态机（idle/paused/awaiting/resolving）：去重键入队（会话+kind+runId+标识）、resolve 失败回滚并暴露原因（不再静默卡死）、**15 秒轮询 getState 超时收敛**、recover 进页/重连恢复（后端无暂停项则 finalize，有则重建容器+入队）、skip（tool_confirm 不可跳过）、clarify 观测指标（triggered/answered/skipped/expired） |
| `hitl-bridge.ts` (33 行) | T8 断环桥：chatStore 仅依赖本叶子模块，hitlStore 模块求值时 `bindHitlStore` 自注册，依赖方向收敛为单向（hitlStore→chatStore） |
| `useAppStore.ts` (285 行) | persist v2：主题/语言/字号/快捷键只读缓存（SOT 在主进程，仅 IPC 成功后回写）/默认模型/模型配置列表；**migrate(v1→v2) 剥离 v1 明文 apiKey**，由模型设置页挂载时一次性转存 safeStorage；预置 5 个模型配置 |
| 其余 | `authStore`（token/用户资料/登录登出）、`artifactStore`、`lightboxStore`（图片放大预览）、`rightPanelStore`、`useWorkspaceStore`、`atoms.ts`（Jotai：面板显隐/滚动/设置弹框）、`traceAtoms` |

### 2.5 renderer — 服务层（services）

- **transport/**（3 文件 + 测试）：双传输抽象。解析优先级 `localStorage['agent.transportMode']` > `VITE_AGENT_TRANSPORT` > 默认 http；`getTransportForRuntime(runtime)` 让 local 会话恒走 IPC（与全局开关无关）；T22：浏览器 mock 带 `unavailable` 标记时正确回退 http 并告警一次。
- **transport/ipc-transport.ts**：runId 生成（`send-`/`resume-` 前缀 UUID）；**先订阅 AGENT_EVENT 再 invoke**（首个事件不丢）；终态事件（RUN_FINISHED/RUN_ERROR/RUN_PAUSED/HITL_ABORTED）自动退订；abort 语义 = 静默退订，不触发 onDone/onError。
- **api/agui.ts** (392 行)：`createAguiEventDispatcher` —— 云边同源的 AG-UI 事件分发器，覆盖 16 种事件：RUN_STARTED、THINKING_×4、TEXT_MESSAGE_×3、TOOL_CALL_START/ARGS/RESULT（参数分片缓冲）、RUN_FINISHED、ARTIFACT_CREATED（doc_writer 产物）、STATE_DELTA（plan 数组 / step_update 两形态）、USER_QUESTION_REQUEST、RUN_PAUSED、HITL_ABORTED、RUN_ERROR。`streamAgui` 负责 HTTP SSE 解析（data: 行 + [DONE]），解析失败告警不静默。
- **stream-handler.ts** (620 行)：流式聚合器。rAF 批量 flush、`mySeq` 旧流守卫、idle 60s 超时（暂停态停表）、**Trace 树双写**（thinking/text 延迟创建、tool-call 自动挂 observation 子节点、plan-step 按 index 更新状态）、resume 种子续写不重开节点、onThinkingStart 多轮思考插入分隔。
- **localChat.ts** (222 行)：本地 DAO 封装，与 chatService 同构；`isLocalRuntimeActive()` = IPC 模式 + DAO 可用（新会话归属 local 的判据）；`buildPersistBlocks` 把渲染端 Message 逆向压回 contentBlocks（thinking→tool_call/tool_result 对）。
- **api/client.ts** (298 行)：baseURL 持久化 + localhost→127.0.0.1 归一化 + 旧端口(6000/8787)→8088 迁移；**trace-builder.ts**：contentBlocks→Trace 树（历史回填与实时渲染同构）；**clarify-metrics.ts**：澄清四类事件观测。

### 2.6 renderer — UI 组件

**聊天区（components/chat，17 文件）**
- `InputArea.tsx` (1,420 行)：输入工作台核心。统一命令面板（`/` 触发与 `+` 按钮共用 `PALETTE_COMMANDS` 注册表：上传图片/上传文件/模式切换 + /clear、/plan、/agent、/help 四个真实动作 + dev-only /mock-plan；评分过滤 = 完全<前缀<包含<模糊）；`HitlToolConfirmPanel`（工具编号列表、行展开完整 JSON、**逐工具改参 textarea**、拒绝/批准并继续、resume 中防重复）；plan_confirm 卡（产物列表 + 执行此方案 + 底部输入“其他”指导）；澄清卡（编号选项点击即答 + 自由文本）；`ModelSelect` 与 `useAppStore.modelConfigs` 单一数据源（enabled 项入列、Auto=不下发 model、空态引导“配置模型…”）；图片附件三入口统一管线（png/jpeg/gif/webp 白名单 + 20MB 上限 + 超限系统通知）；@ 文件引用弹层（已选文件过滤 + 浏览）；快捷键引擎（send-message/newline-on-input 可改绑，IME isComposing 守卫）；草稿持久化（HITL 态禁用）；字符上限 10,000（90% 变黄预警）；麦克风按钮 disabled（“语音输入即将上线”）；免责声明。
- `ChatArea.tsx` (369 行)：双模式容器——欢迎页（垂直居中 + WelcomeScreenTop 功能标签 + WelcomeScreenBottom 快捷提示词点击即发 + 模板卡）与聊天态（MessageScrollerList + AgentStatus 错误条 + InputArea）；HITL 内嵌卡的全部回调接线（answer/selectOption/skip/approve(带 modifiedArgs)/reject/dismiss/confirmPlan）；dev 压测注入（feature-flags）。
- 消息渲染：`MessageScrollerList`（自动跟随 + 向上分页）、`MessageBubble`、`AgentTimeline`/`TraceNodeView`/`TraceTreeRenderer`（Trace 树渲染：思考/工具/观察/正文/计划步骤五类节点折叠与耗时）、`MarkdownRenderer`（363 行）、`ToolCallCard`、`ThinkingBlock`、`ObservationResult`、`AttachmentList`（文件卡片打开/下载策略）、`ImageLightbox`（Portal 全局单例）。
- `CommandPalette.tsx` (406 行)：受控面板组件 + 命令注册表 + 纯函数过滤评分；**仅收录已落地能力**（/optimize 因无后端能力已移除）。

**侧栏（components/sidebar）**：`SidebarNav`（新建任务 + 5 导航项，placeholder 标记与页面实际渲染一致：插件/自动化 false，助理/我的文件/更多 true）、`ConversationList`（会话行 34px 高、SessionActionsDropdown 重命名/删除/归档）、`AccountMenu`（284 行：用户资料卡 + 登出（真实调 authService.logout）/未登录时登录入口 + 外链）、`SidebarBrand`。

**右栏（components/right-panel）**：`TaskMonitor`（396 行）——**待办消费 plan-step TraceNode**（流式实时 + 历史回退，普通 ReAct 会话显示“暂无待办项”，不再硬编码示例）；产物区收集全部 assistant 消息 attachments（ARTIFACT_CREATED），卡片支持**应用内预览（Markdown/HTML/SVG/代码沙箱 iframe）/另存为（FILE_READ→保存对话框→FILE_WRITE）/Finder 定位**；“技能与 MCP”“记忆更新”两组为无内容折叠占位。`TaskPipeline`/`TaskPipelineTab`/`PanelTabBar`（右栏 Tab 框架）。

**布局（layouts + platform）**：`RootLayout`（289 行）——三栏模式（ResizablePanelGroup，左 262px 冷灰贴边 Sidebar + 中栏 + 右栏，1px 分割线拖拽热区）/覆盖模式（<断点转 Drawer），平台断点区分、布局记忆按 platform 存；路由感知顶栏（会话视图显示标题+分享+右面板开关；插件/自动化页自带顶栏故隐藏）；macOS 白区拖拽 + Win/Linux 标题栏；`useHotkeyEngine`（Ctrl+N 新建等，读主进程 SOT 缓存）。`ChatHeader`：分享真实接线（shareSession→剪贴板→“已复制”2s 反馈），搜索/历史死按钮已移除；`TitleBar`/`MacTitleBar`/`TopBarActions`/`HeaderButton`。

**设置中心（components/settings）**：`SettingsDialog` + 9 分区——
- `ModelSection` (565 行)：模型增删/启停/设默认；apiKey 输入框明文仅存会话内存，经 `modelSecretApi` 加密落主进程，GET 只回掩码；挂载时执行 v1→v2 迁移转存；
- `LocalRuntimeSection` (300 行)：云端/本地双卡切换（调 `setAgentTransportMode`，提示“对新会话生效”）；5 个受管密钥的保存/清除/掩码徽标（加密态绿盾）；
- `GeneralSection` (673 行)：主题/语言/字号（真实生效于 `<html>` 属性）；**语音转录快捷键开关真实接线 HOTKEYS_SET**（T19）；本地链接打开方式/产物存储路径禁用并明示“即将开放”；
- `ShortcutsSection` (520 行)：快捷键列表改绑/恢复默认/冲突提示；
- `SecuritySection` (863 行)：**整页锁定**（pointer-events-none + 0.55 透明 + 黄条公告“仅作展示，不会保存、也不会改变实际安全行为”，T7），如实列出当前已生效安全能力；
- `AboutSection` (576 行)：版本行取 `app.getVersion()` 真实值；检查更新如实返回“暂无自动更新通道”（T5，随机假结果已删）；官网/文档/邮件走 shell.openExternal；意见反馈 alert“建设中”；二维码占位；
- `ApiConnectionSection`（baseURL 配置 + 网络检测）、`DataManagementSection`、`AuthSection`、`SystemSettingsCompositeSection`（组合分区）。

**页面（pages）**：`ChatPage`（/，= ChatArea）、`HomePage`（/home，AI Chat/Settings 双卡片导航，侧栏无对应入口）、`PluginsPage`、`AutomationPage`、`AssistantPage`/`MyFilesPage`/`MorePage`（三者均为图标 +“开发中，即将上线”占位）；`/skills`→`/plugins` 重定向；`/workspace` 路由已摘除（T15）。

**lib 与 hooks**：`input-drafts.ts` (246 行)——草稿图片经 DRAFT_ASSET 通道**二进制外置**，草稿 JSON 只存 `{id, mediaType, assetId}` 引用，通道失败回退内联 + 256KB 体积阈值兜底，按 key 串行队列防并发、孤儿资产清理（T9）；`image-attachments.ts`——三入口共用类型白名单与 20MB 校验（注释明示“后端暂未实现视觉通道，附件在 UI 层完整可用”）；`match-accelerator.ts`（273 行，跨平台加速键匹配，macOS Ctrl→⌃ 漂移已修 T16）；`embedded-tool-results.ts`、`extractCodeBlocks.ts`、`artifact-preview.ts`、`feature-flags.ts`（收敛后仅剩 dev 压测 2 个 flag）、`welcome/templates.ts`（342 行模板卡数据）；`useAuthBootstrap`、`useInputDraftPersistence`、`useArtifactPreview`、`usePlatform`、`usePanelToggle`/`useResponsiveLayout`。

---

## 三、交互逻辑

### 3.1 一次本地消息发送的完整链路（已实证）

```
InputArea.handleSend（Enter 经 matchesAccelerator 命中 send-message 绑定）
  → ChatArea.handleSend → chatStore.sendMessage
      ├─ 守卫：当前会话 HITL 暂停中 → 拒绝并发提示
      ├─ 抢占：已有 abortController → abort() + transport.stop(sid)（IPC→主进程 stopRun）
      ├─ 无会话 → createSession（Lazy Create；isLocalRuntimeActive() → localChatService 落 SQLite，
      │            agentMode 按 planMode/agentMode 开关解析）
      ├─ 乐观 UI：user 消息 + assistant 占位入列表；首条消息 30 字乐观标题；用户消息即落本地库
      └─ streamRequest：message(stream=true) + agentMode(plan_execute 才带) + model('Auto' 归一化)
           + history（IPC 模式压缩最近 20 条）
  → getTransportForRuntime('local') = ipcTransport.sendMessage
      → 先 window.api.agent.onEvent 订阅 → 再 invoke(AGENT_SEND, {runId, request})
  → 主进程 ipc-handlers：isTrustedSender → validateSendRequest（白名单校验/归一化）
      → ensureAgentRuntimeEnv（secureKeys.applyToEnv → .env 补充加载）
      → agent-runtime.startSend → executeSend（异步，invoke 立即返回 {ok}）
          ├─ plan_execute → create_agent({configurable}) 建图期覆盖；否则 get_runner() 缓存图
          └─ AGUIStreamAdapter.transform_langgraph_events(stream_response(...))
              → 每个 {data:"<json>"} dict → JSON.parse → envelope{runId, seq} → webContents.send
  → 渲染端 ipcTransport 按 runId 过滤 → createAguiEventDispatcher.dispatch（云边同源分发）
  → stream-handler（rAF 批量、Trace 树双写、idle 60s 守护）→ chatStore.onFlush 更新流式快照
  → 终态（RUN_FINISHED）→ onDone：finalizeStreamingMessage 落定消息 → persistAssistant 落本地库
      → 标题仍为默认值 → 本地模式 generateTitleFrom 截取首条用户消息 / 云端 generateTitle
```

### 3.2 HITL 三类中断 + 方案确认门（统一内嵌通道）

- **产生**：内核 interrupt → `USER_QUESTION_REQUEST`（kind/tool_calls/question/options/artifacts）事件 → `chatStore.onHumanInputRequest` 置 `hitlPending` 并 `hitlStore.enqueue`（去重；有展示项则排队）→ `RUN_PAUSED` → `pauseStreamingMessage`：半截内容写入消息并标 `paused=true`，保留 streamingMessageId。
- **展示**：`ChatArea` 判 `selectIsHitlPaused`（会话级匹配防跨会话串线）→ InputArea 切 `mode='hitl'` 精简态（隐藏模型下拉/麦克风/斜杠命令，仅保留附件与发送），按 kind 渲染内嵌卡：tool_confirm→审批卡（展开参数/改参/批准/拒绝/×=abort 整个 run）；clarifying/choice→澄清卡（选项点击即答 / 自由文本）；plan_confirm→方案门（产物列表 + “是的，执行此方案” / 文本输入其他要求）。
- **答复**：`hitlStore.resolve` → （跨会话自动 selectSession）→ `chatStore.resumeHitl`：用暂停消息的 trace 树/工具调用/附件做种子 → `transport.resume`（resume_stream 携带 approved/feedback/modifiedArgs/answer/answerId）→ 事件续写同一条 assistant 消息（不重开节点）→ 终态 `dequeue` 出队下一项。
- **失败可见**：resume 未真正启动（容器丢失等）返回 `{ok:false, reason}` → 回滚 paused 并在卡内展示 error，可重试。
- **超时治理**：展示期间 15s 轮询 `getState`；主进程 `getHitlState` 先查 `checkInterruptTimeout`（expired → 自动拒绝）。失效时 `finalizeHitlStale` 追加“[已失效]”文案并写全局错误条。
- **恢复**：切会话/重连 → `hitlStore.recover`：后端仍 pending 则 `restoreHitlPause` 重建 paused 占位消息 + 入队（origin='recover'）；后端已无暂停项则收敛残留。
- **模态回退**：`HitlHost` 恒返回 null（T20 已删 surface 决策死代码），三个 Dialog 组件文件保留为回退模板，挂载点保留在 Router 之外。

### 3.3 云边双模路由与会话归属

- 新会话创建时按 `isLocalRuntimeActive()`（IPC 模式 + DAO 可用）决定 `runtime='local'` 或云端；**切换运行模式只影响新会话**（LocalRuntimeSection 明示）。
- 后续所有操作（读消息/改名/删除/反馈/发送/resume/abort/getState）按 `session.runtime` 分流：`local`→localChatService/ipcTransport，`cloud`→chatService/httpTransport（Agent 会话走 agent 端点）。
- `loadSessions` 合并两侧列表（云端失败且本地有数据时不报错——本地即为可用产品）；登出仅清云端会话，保留本地会话。
- 传输模式三级解析 + 控制台 `window.__setAgentTransportMode` 运行时切换。

### 3.4 快捷键体系（单一真源）

主进程 electron-store 为 SOT → `HOTKEYS_GET` 启动 hydrate 校正渲染端缓存（localStorage 快照消除首帧空窗）→ 输入区（发送/换行）、`useHotkeyEngine`（新建任务）、GeneralSection（转录开关派生自覆盖表 null 语义）统一读缓存；设置页改绑 → `HOTKEYS_SET` 提交全量覆盖表 → 主进程持久化 + 重注册 global scope + 回传实际生效值与 conflicts → 黄条提示。

### 3.5 密钥数据流（明文零渲染端落地）

```
设置页输入 → IPC(SECURE_KEY_SET / MODEL_SECRET_SET)
  → 主进程 safeStorage.encryptString → electron-store（enc:v1: 前缀）
启动 run 前 → keyStore.applyToEnv() 解密注入 process.env（优先于 .env，不覆盖已有）
  → modu-agent config/env 零改动读取
密钥增删 → invalidateAgentGraphCache() → 下次 run 重建 LLM 实例（改 key 即时生效）
展示 → list() 只回 maskValue 掩码；MODEL_SECRET_GET 回 hasApiKey + masked
```

### 3.6 其他关键交互

- **Trace 树生命周期**：流式实时构建（thinking/text 首帧创建、tool_call→observation 父子、plan-step 按 STATE_DELTA index 更新）→ 终态快照写入 Message → 历史加载由 `trace-builder` 从 contentBlocks 重建 → AgentTimeline 渲染与实时形态一致；停止时在途节点标 completed。
- **产物链路**：doc_writer → `ARTIFACT_CREATED`（absolutePath）→ stream-handler 转 Attachment → 消息 attachments + TaskMonitor 产物区（去重合并流式与历史）→ 预览（iframe 沙箱/Markdown 复用渲染器）/另存为/Finder。
- **草稿**：按 `session:sessionId`（draft 态为 home）键控；400ms 级防抖保存；图片外置资产引用化；`/clear` 与发送后清草稿；streaming 中不保存。
- **窗口**：macOS hiddenInset 红绿灯定位与渲染层浮动按钮像素级对齐；拖拽为纯 IPC 三段式（规避 -webkit-app-region 点击 bug）；Win/Linux frame:false 由渲染端 WindowControls 提供控件。

---

## 四、实现边界

以下均为代码中**明确标注或结构上可证**的未实现/预留项，逐条给出证据位置：

### 4.1 模型视觉通道未打通（UI 层完整）
- `SendMessageRequest`（shared/types.ts:107-131）**无 images 字段**；`validateSendRequest`（agent-runtime.ts:148-172）白名单只保留 sessionId/message/history/agentMode——本地模式下图片不进内核。
- `lib/input/image-attachments.ts` 头部注释明示：“后端暂未实现视觉通道，但附件在 UI 层完整可用”。纯图发送使用占位文本 `QUEUED_IMAGE_ONLY_TEXT`（`'[User attached images without additional text.]'`）。
- 图片能力实际可用的部分：缩略图、ImageLightbox 放大、草稿外置持久化、regenerate 回传——全部止步于 UI 层。

### 4.2 plan_confirm 方案确认门：UI-only 协议预留
- shared/types.ts:306-312 注释：“plan_confirm=……（**UI 已落地，后端图节点暂未发射该事件，属于协议预留**）”。
- InputArea.tsx:186-201：`PLAN_CONFIRM_HINT` 注明“当前为 UI-only 形态（后端尚无 plan_confirm 生产节点）”；`/mock-plan` 为 dev-only 注入 mock 载荷（生产构建不注册）。
- `getHitlState` 已透传 artifacts（agent-runtime.ts:465），渲染端恢复链路已就绪——缺口仅在内核无生产者节点。

### 4.3 定时任务无真实调度
- AutomationPage.tsx:50-51 注释：“仅持久化任务配置；**真实定时调度（触发 Agent run）待后端/主进程调度器接入**”；列表页文案如实标注“当前开关仅保存启停状态，暂不会触发任务”；「运行记录」Tab 为恒定空态（“暂无运行记录”，550-554 行）。

### 4.4 插件市场为静态演示数据
- PluginsPage.tsx:119-344 插件目录为硬编码数组（含“XX 万人在用”）；页面以琥珀色角标如实标注“演示数据：插件目录展示中，安装状态仅保存在本机”；「添加」按钮禁用 + Tooltip“本地导入插件即将开放”；安装态持久化到 electron-store（T13）但**安装不产生任何运行时效果**（不注入工具/不改变 Agent 行为）；「技能」「工作伙伴」两个 Tab 为占位空态。

### 4.5 安全中心开关不产生实际行为
- SecuritySection 整页 `pointer-events-none` + opacity 0.55 + 黄条公告（T7）：“以下开关与配置当前仅作展示，不会保存、也不会改变应用的实际安全行为”；三个 LinkRow（文件/命令/网络安全）onNavigate 为空函数或注释“预留”。
- 同页明示当前**真实生效**的安全能力：IPC 调用方校验、文件路径白名单、产物沙箱预览、内容安全过滤。

### 4.6 明确预留/占位的 UI 入口
| 项 | 证据 |
|---|---|
| 助理 / 我的文件 / 更多 三个导航页 | 页面渲染“开发中，即将上线”；SidebarNav `placeholder:true` 与页面一致（T18） |
| /home 路由 | HomePage 双卡片导航页仍在路由表，但侧栏 NAV_ITEMS 无对应入口 |
| 语音输入 | InputArea 麦克风按钮 `disabled`，Tooltip“语音输入即将上线” |
| 语音转录 | GeneralSection 开关真实启停的是 `toggle-record` **快捷键**；转录功能本身无实现 |
| 技能选择器 | `selectedSkill` 状态与 `options.skill` 结构化字段保留，但无选择入口；`[Skill: x]` 死前缀已删（T11） |
| HITL 模态弹窗通道 | HitlHost 恒 null，三个 Dialog 文件保留为回退模板 |
| TaskMonitor「技能与 MCP」「记忆更新」 | SectionRow 无 children，纯折叠占位 |
| 检查更新 | 无自动更新器（electron-updater 未引入），APP_CHECK_UPDATE 仅回版本号；AboutSection 如实提示“可前往官网获取新版本”（T5） |
| 意见反馈 | AboutSection 内 `alert('意见反馈功能正在建设中')` |
| 会话分享（本地） | `shareSession` 对 local 会话直接返回 null（注释：阶段 4 单向同步后再评估）；分享动作仅对云端会话可复制链接 |
| GeneralSection 本地链接打开方式 / 产物存储路径 | 控件禁用并明示“即将开放”（无消费方/无目录选择 IPC） |
| 二维码（公众号/社区频道） | AboutSection `QrPlaceholder` 占位 |
| feature-flags | 收敛后仅剩 `devStressMessages/devStressCount` 两个 dev 压测 flag |

### 4.7 本地运行时的已知边界（代码内注释自认）
- 本地模式**只覆盖 Agent 通道**（chatStore.ts:970-971 注释），无独立纯聊天通道；local 会话的 `agentMode` 字段“仅作 UI 展示标记”（chatStore.ts:532-534）。
- 会话级 model 覆盖在本地 IPC 模式被 `validateSendRequest` 白名单丢弃，以 `LLM_DEFAULT_MODEL` 为准（InputArea.tsx:287-289 明示）。
- 无 Prisma 持久化：本地多轮上下文靠渲染端压缩 20 条 history 携带（超长对话上下文受限）。
- `code_executor` 等需审批工具仅在内核 HITL 开启时注册（agent-runtime.ts:241-253），默认关闭时不注册——属有意的安全默认而非缺陷。

### 4.8 V2.7 相对 V2.6 已消除的历史问题（本次实证确认已修复）
- 抢占发送的 IPC 孤儿 run（T1：sendMessage 抢占现调 `transport.stop`）；
- chatStore↔hitlStore 循环 import（T8：hitl-bridge 单向桥）；
- 输入框模型下拉与设置页两套数据（T6：ModelSelect 读 `modelConfigs`）；
- apiKey 明文入 localStorage（T6：persist v2 迁移剥离 + safeStorage）；
- `/clear` `/help` `/agent` `/plan` 死命令（T11：真实动作）；ChatHeader 搜索/分享死按钮（T12：分享接线、死按钮移除）；
- 插件/自动化页刷新丢状态（T13/T14：STORE_SET 持久化）；TaskMonitor 硬编码 4 条示例待办（T3：消费 plan-step）；
- AboutSection `Math.random()` 假检查结果（T5：如实状态机）；
- `/workspace` 空转路由（T15：摘除）；hitl-surface 死代码（T20：删除）；
- macOS 快捷键断言漂移（T16：vitest 平台注入，170/170 全绿）。

---

### 附：验证命令与结果

```text
$ npx tsc --noEmit            # 退出码 0，无输出（零类型错误）
$ npx vitest run              # Test Files 16 passed / Tests 170 passed (1.09s)
$ git log --oneline -1        # 4ef2741 feat(desktop): P1-P4 全量修复 (26项) + 170单测全绿
$ git status --short          # （空，工作树干净）
```
