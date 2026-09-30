# 12 · apps/desktop 代码现状分析报告

> 分析范围：`apps/desktop` 全部源码（约 193 个文件、31,200 行，不含 node_modules）。
> 分析方法：逐文件通读 + 交叉检索 + 关键结论抽样验证。
> 附录：[附录 A：死代码专项检查](#附录-a死代码专项检查)（含两轮清理状态）· [附录 B：安全/缺陷/性能专项审查](#附录-b安全--缺陷--性能专项审查2026-10-01)（含 2 个 Electron PoC 实证）。
> 结论摘要：**架构分层清晰、类型纪律与安全基线显著优于同类项目，但存在"平行实现"惯性——同一件事经常有 2~3 套实现，且代码/文档存在滞后漂移。**

---

## 一、总览

| 维度 | 现状 |
|---|---|
| 项目定位 | `pioneering-desktop` v0.1.0，Electron 桌面端 AI Agent 应用（Electron 42 + React 19 + Vite 6 + Tailwind 4） |
| 规模 | 约 193 个源码文件 / 31,200 行（不含 node_modules） |
| 分层代码量 | main 2,669 · preload 438 · shared 1,079 · renderer 约 25,000（components 14,636 占近半） |
| 状态管理 | **双轨**：zustand（领域状态）+ jotai（细粒度 UI 状态） |
| 构建 | electron-vite（main/preload/renderer 三段构建）+ 独立 browser 降级构建（`vite.browser.config.ts`，纯网页预览） |
| 测试 | vitest，7 个测试文件 1242 行，只覆盖纯函数与 store/transport 局部 |
| 工程配套 | typecheck（node/web 双 tsconfig）、prettier、electron-builder 三平台打包、`@pioneering/modu-agent` 本地包依赖 |

---

## 二、组织结构与模块划分

```
src/
├── main/        (10 文件) 主进程：窗口、菜单、IPC handler、Agent 运行时、SQLite、密钥、快捷键
├── preload/     (2 文件)  白名单式 contextBridge，13 个命名空间 API
├── shared/      (7 文件)  三端契约中心：IPC 通道枚举、领域类型、快捷键注册表、菜单模板
└── renderer/src/
    ├── App.tsx / main.tsx     入口：路由、Provider、8 个启动副作用
    ├── pages/      (9 文件, 342 行)  薄壳页，零业务逻辑，全部转发到 components
    ├── layouts/    (6 文件, 792 行)  RootLayout 三栏布局/覆盖布局、TitleBar、ChatHeader
    ├── components/ (14636 行)  chat(3231) + input(2036) + welcome(1118) + settings(4543)
    │                          + sidebar(1040) + right-panel(1115) + ui(1313) 等
    ├── stores/     (10 文件)  zustand: chatStore(1494)/hitlStore/useAppStore/useWorkspaceStore
    │                          jotai: atoms/traceAtoms/rightPanelStore/authStore/artifactStore/lightboxStore
    ├── services/   (16 文件)  transport(http|ipc) + api(client/chat/agent/auth/agui) + stream-handler(620)
    │                          + localChat + trace-builder + ipc.ts
    ├── hooks/ lib/ menu/ platform/ mocks/  工具与适配层
```

**模块划分评价**：`shared → main/preload/renderer` 的契约边界非常明确，`renderer` 内部"pages 薄壳 → layouts → components → stores/services"的走向健康。`shared/index.ts` 桶文件无任何引用，属于死文件。

---

## 三、主要功能与技术实现

### 1. 聊天与流式（核心链路）

- 消息列表按会话分桶（`Record<sid, Message[]>`），支持分页游标；`MessageScrollerList` 基于 `@shadcn/react` 的 MessageScroller，长列表用 `content-visibility` 而非虚拟化（会话列表则用 `@tanstack/react-virtual`，**两套滚动方案并存**）。
- 流式处理：`stream-handler.ts`（620 行）负责累积 + rAF 批量 flush + 60s idle 超时 + 双向构建 trace 树；`chatStore` 维护 `streamingContent/streamingToolCalls/streamingTraceNodes` 快照，`onDone` 时定格落盘。
- 健壮性设计到位：旧流守卫（seq 校验）、IPC 按 runId 过滤、终态自动退订、HITL 暂停期间禁发新消息。

### 2. 云边双模 Agent

- `services/transport/` 抽象出 `AgentTransport` 接口，按会话 runtime 路由：**http-transport**（axios + SSE 直连后端）或 **ipc-transport**（主进程内嵌 `modu-agent` 真跑）。
- 两种 transport 复用同一个 AG-UI 事件分发器（`api/agui.ts`），事件语义同源。
- 本地模式消息落 SQLite（better-sqlite3 + WAL），DAO 幂等 `INSERT OR IGNORE`；密钥用 `safeStorage` 加密（白名单 5 键 + 掩码回传 + 启动注入 env）。

### 3. HITL（人在回路）

三弹窗（工具确认/多选/澄清）+ `hitlStore` 队列 + 暂停-恢复-重连状态机，恢复侧 15s 轮询 `getState`。**同一事件双写 `chatStore` 与 `hitlStore`**，且两 store 互相 `setState` 穿透（见债务清单）。

### 4. Electron 平台能力

- 49 个 `ipcMain.handle` + 3 个 `ipcMain.on`，全部经 `isTrustedSender` 调用方校验；文件读写有白名单根目录 + `realpathSync` 符号链接防逃逸（含 S4 修复的逐级父目录解析），10MB/50MB 上限，原型链清洗。
- 安全配置：`sandbox:true` + `contextIsolation:true` + CSP + preload 强制 CJS（注释详述了沙箱坑）。
- 平台适配：mac 用原生菜单，Win/Linux 用同一 `shared/menu-template.ts` 渲染 HTML 菜单；`platform/layout-tokens.css` 用 `data-platform` 驱动令牌。
- 未接入：自动更新（`APP_CHECK_UPDATE` 只回版本号）、深链/单实例锁。

### 5. 设置与系统

11 个设置分类（4 个"建设中"占位）+ 重定向兼容层；全局快捷键治理（electron-store 为真源 + 冲突检测）；浏览器降级模式靠 `electron-mock.ts` 与 preload 类型双向收敛。

---

## 四、依赖关系与调用逻辑

```
UI 组件 ──▶ stores（zustand/jotai）
              │
              ├─▶ services/api/*      ──▶ axios + SSE ──▶ 后端 (HTTP 模式)
              ├─▶ services/transport  ──┬─ http-transport ─┘
              │                         └─ ipc-transport ──▶ preload window.api
              │                                                   │
              └─▶ services/localChat ─────────────────────────────┤
                                                                  ▼
                                                        main/ipc-handlers
                                                     ├─ local-store (SQLite)
                                                     ├─ agent-runtime ─▶ modu-agent
                                                     ├─ key-store / hotkey-main / upload-store
                                                     └─ window/menu/file/shell/...

主 ──▶ 渲染推送：AGENT_EVENT(runId 信封) / WINDOW_STATE / MENU_ACTION
契约中心：shared/ipc-channels(56 通道) + shared/types（三端共用，renderer 52 个文件走 @shared 别名）
```

关键点：渲染端**零 `ipcRenderer` 直连**，全部收敛在 `window.api` 白名单；新增一个 IPC 需改 shared 枚举 → main handler → preload → renderer service 四处，但受类型保护（mock 类型不匹配会编译报错）。

---

## 五、代码风格与质量

**做得好的部分（有证据）**

- 生产代码 **`any`/`@ts-ignore`/TODO/FIXME 基本为零**（main/preload/shared 全 0；renderer 仅 3 处 `any`、2 处带注释的 `eslint-disable`）。
- 注释质量高：大量安全修复（H1/S1/S4/B10 编号）、设计决策、阶段标记被写进注释；中文注释表意清晰。
- 安全基线完整：调用方校验、路径白名单、CSP、safeStorage、日志脱敏、三端类型契约。
- 错误处理在关键路径有分类（token 401 single-flight 刷新、GET 退避重试、`unwrap` 异常归一化）。

**风格问题**

- **样式三轨并行**：chat 侧用语义 token（合规），settings 侧 166 处 hex + 75 处 `pxToRem` + 300+ 处内联 `style={{}}` → **设置页不跟随暗色主题**；另有 `pro-input.css`(510 行)、`settings-dialog.css` 两份手写 CSS。
- 组件内 `<style>` 注入全局选择器（`ModelSection.tsx:370`），样式越界。
- 命名小不一致：`settingsConfig.tsx`、`pro-input.css` 等小写文件混在 PascalCase 中。

---

## 六、重复与冗余（最大的问题域）

| # | 重复项 | 证据 |
|---|---|---|
| 1 | **trace 树两套构建实现**：实时（`stream-handler.ts`）与历史重建（`trace-builder.ts`）各写一遍节点规则，靠人工约定同步，无等价性测试 | `services/stream-handler.ts:176-298` vs `services/trace-builder.ts:33-197` |
| 2 | **设置区"三份设计系统"**：`GroupHeader`/`SectionCard`/`Switch` 各 3 份；`SecuritySection` 内 7 种 Row 变体；自造 Select 210 行（而 Radix Select 已在依赖里） | `GeneralSection.tsx:202/214/509`、`SecuritySection.tsx:239/254/722`、`ModelSection.tsx:395`、`GeneralSection.tsx:297-507` |
| 3 | **index.css 语法高亮配色双份复制**：`.chat-markdown .hljs-*` 与 `.artifact-view .hljs-*` 各 84 条规则，改主题要双改 | `src/renderer/src/index.css:307-449` 与 `523-654` |
| 4 | **工具展示三处平行**：`ToolIcon` ×3、`extractArgSummary` ×2、JSON `<pre>` ×4（ToolCallCard/AgentTimeline/TraceNodeView/HitlToolConfirmDialog） | `ToolCallCard.tsx:19,46` vs `AgentTimeline.tsx:120,149` vs `TraceNodeView.tsx:38,113` |
| 5 | 复制按钮 + 2s 复位逻辑 5 处；折叠动画片段 6 文件；弹窗壳 className 4 处 | `MessageBubble.tsx:110`、`MarkdownRenderer.tsx:159`、`ArtifactPanel.tsx:80` 等 |
| 6 | 快捷键显示两套实现且 mac 输出不一致（`⌘⇧Z` vs `⇧⌘Z`） | `lib/match-accelerator.ts:257-273` vs `menu/formatAccelerator.ts:47-84` |
| 7 | 类型重复三处（未 import shared）：`AgentEventEnvelope`、`ManagedKeyDescriptor`、`UploadInfoDto` | `main/agent-runtime.ts:62-66`、`shared/ipc-channels.ts:166-170` 等 |
| 8 | HITL 入参类型两份完全同构；映射逻辑双向各写一遍 | `chatStore.ts:49-58` vs `hitlStore.ts:48-57`；`chatStore.mapContentBlocks:191-237` vs `localChat.buildPersistBlocks:85-107` |

---

## 七、可维护性与扩展性

**正向**

- 契约中心（shared）+ transport 抽象 + 设置注册表驱动，三处扩展点都清晰；
- 注释中的决策记录使"为什么这样做"可追溯，利于 AI/新人接手；
- UI 基础件是规范 shadcn 风格（`cn` + `data-slot` + Radix）。

**风险点**

- **超大文件**：`chatStore.ts` 1,494 行（`sendMessage` 单函数约 285 行、`resumeHitl` 约 145 行且四回调高度相似）、`TemplateCard.tsx` 949、`InputArea.tsx` 894、`SecuritySection.tsx` 824、`GeneralSection.tsx` 635。
- **测试盲区**：`stream-handler`(620)、`agui`(391)、`client`(298)、`chatStore` 主链路、`lib/input/*`(649，最易错的解析/序列化)、全部 hooks 无测试；`streaming.test.ts:99-112` 是"复刻实现"的伪契约测试。vitest 配置仅 `*.test.ts`、node 环境，无组件/DOM 测试。
- **文档滞后**：`codewiki/08-tech-debt.md` 把"IPC 路径校验"列为待办（实际已实现且含符号链接修复）；`06-types.md` 所述 `renderer/src/types/` 目录已不存在（类型已统一到 shared）。文档描述的现状与代码有系统性偏差。
- 生产包带入 mock：`main.tsx:6` 无条件静态导入；`__setAgentTransportMode` 生产也暴露。

---

## 八、技术债务与问题清单（按严重度）

**高（影响正确性/数据）**

1. 本地模式**数据丢失**：落库不含 `images/attachments`，`metadata` 恒 null → 刷新后图片/附件丢失（`main/local-store.ts:357-370`）。
2. 本地模式**静默忽略** `model/systemPrompt/temperature/deepThink/netSearch` 请求字段（`main/agent-runtime.ts:139-157`）。
3. 切换新消息打断旧流时只 `abortController.abort()`、不通知后端 `transport.stop`，IPC 模式下后端 run 可能继续执行（`chatStore.ts:675-697`）。
4. HITL 状态双写且互相直改内部字段，清理路径分散（`hitlStore.ts:231,282` 直改 chatStore；`chatStore.ts:1299` 只清一侧）。
5. `traceNodeExpandedAtom` 确认无 `.remove()` 调用 → 消息删除/会话切换后 atom 缓存持续累积（`stores/traceAtoms.ts:29-34` 注释自述，实测全仓无清理）。
6. `APP_SET_API_BASE_URL` 注释称持久化实际未持久化 → 重启后主进程与渲染端 baseURL 可能脱钩（`main/ipc-handlers.ts:331` vs `83-84`）。
7. 未捕获异常路径：`SECURE_KEY_SET` 无 try/catch、`key-store.ts:132` `encryptString` 未捕获、`agent-runtime` 两处 `await get_runner()` 未捕获 → invoke reject 冒泡。

**中（可维护性/一致性）**

8. 6~8 项平行实现（见第六节），其中设置区样式双轨直接造成暗色主题失效。
9. 死代码规模可观：**11 个零引用整文件（约 564 行）+ 47 个完全死符号（44 个初扫所得 + 3 个复核补漏，另 2 个初判为误报）+ 108 个冗余导出**，另有 `ping`/`upload:*`/`clipboard:read`/`app:getVersion`/`file:getPath` 等死 IPC 链路（详见[附录 A](#附录-a死代码专项检查)，两轮清理状态见附录开头）。
10. 生产代码含 mock/占位：`TaskMonitor.tsx:43-49` 示例待办、`AboutSection.tsx` 假检查更新 + 伪二维码、`settingsConfig` 4 个占位分类。
11. 快捷键冲突启动期不上报（`main/ipc-handlers.ts:227` 恒返回空 conflicts）；`getState` 轮询替代推送。
12. `browser-window-created` 在 3 处重复注册且无防重；`registerIpcHandlers` 无二次调用防护。
13. 87 处阶段标记注释（T0x/M2/P0/H7…）分散 16 个文件，对新人构成阅读门槛。
14. 硬编码：端口 8088 + 旧端口一次性迁移代码常驻入口（`App.tsx:71-78`）、`262`/`72` 常量两处重复、`'v0.1.0'` 双真相源。

**低**

15. IPC 命名风格不一（`window:drag-start` vs `window:isMaximized` vs 裸 `ping`）。
16. 路由无 `path="*"` 兜底；`/home`、`/workspace` 不在侧栏导航（准孤儿页）；`HomePage` 数据里留不存在的 `'/settings'` 路径。
17. `isTrustedSender` 放行任意 `file://`；CSP 常开 `style-src 'unsafe-inline'`。
18. `preload/index.d.ts` 头部注释自相矛盾；`NotificationOptions` 未用 shared 类型。
19. `use-input-draft-persistence.ts:111` 恒真条件与修复注释矛盾；`usePanelToggle` 返回的 toggle 方法、`feature-flags` 多个导出无消费者。

---

## 九、总结与建议优先级

**结论**：`apps/desktop` 是一个**工程骨架相当成熟**的项目——三端契约清晰、IPC 安全防护超出一般水平、类型与注释纪律好，AI 协作痕迹（修复编号、决策注释）明显提升了可读性。当前核心矛盾不在"架构选错"，而在**演进过程中形成的多套平行实现与遗留物未清理**：同一职责（trace 构建、状态、样式、快捷键格式化）有成对实现，页面迁移/重构后旧文件未删，测试未能覆盖最核心的流式与状态层，且 codewiki 文档已落后于代码。

**建议处理顺序**：

1. **P0 数据正确性**：本地模式附件/图片持久化、请求字段透传、打断流时通知后端、HITL 状态单一化。
2. **P1 收敛重复**：trace 构建合并为一套；设置区抽 `SettingsComponents` 设计系统并改语义 token；hljs 配色去重；`ToolIcon/extractArgSummary/复制按钮/折叠动画` 抽公共件。
3. **P1 删死代码**：孤儿页面/Section、`lib/input` 无消费者导出（配合 tree-shaking 检查）、无引用 ui 件与通道；同时删除过时的阶段标记注释。
4. **P2 拆 God 文件**：`chatStore` 按域拆分（会话/消息/流式/HITL），抽取 `sendMessage`/`resumeHitl` 公共回调。
5. **P2 补测试**：优先 `stream-handler`、`agui`、`lib/input` 解析逻辑、chatStore 主链路；修掉伪契约测试。
6. **P3 一致性收尾**：mock 移出生产包、路由兜底与导航对齐、文档刷新（`08-tech-debt` 已修复项、`06-types` 目录说明）。

---

## 附录 A：死代码专项检查

> 检查方法：全量文件级扫描（无任何 `import`/`@import` 的文件）+ 符号级扫描（导出符号在全仓零引用），并对候选项逐一人工复核。检查范围 `apps/desktop/src` 全域。
>
> **清理状态（2026-09-30，两轮）**：
> **第一轮**：清理 A.1 / A.4 全部与 A.2 大部分（连同级联死符号 `createSelectFileTag`、`INTERNAL_FILE_DRAG_MIME`、`editorDocumentToPlainText`、`AgentStep`、`UserDataPath` 等），涉及 32 个文件、净删除 1246 行；typecheck 通过，vitest 与基线一致。
> **第二轮独立复核与补删**：① 发现本附录原"A.2 已全部清理完毕"表述失实——`useFeatureFlags` 第一轮漏删（已补删）；`StoreValue`、`WindowState`（`shared/ipc-channels.ts`）与 `closeAllPreviewTabsAtom`（`stores/rightPanelStore.ts`）为原清单扫描遗漏（已补删）。② `fetchUsers`/`updateUser` 经回源确认为**误报**（详见 A.5），维持不删。③ 同批修复代码异味两处：`main/ipc-handlers.ts` 的 `appendMessages` 死三元式（`n >= 0 ? undefined : undefined`）改为直返 `{ ok: true }`；`APP_SET_API_BASE_URL` 注释腐化（声称持久化 appStore 但无实现）改为如实描述"仅内存态、渲染端启动重同步"。④ 修正三处陈旧注释残指（`settingsConfig.tsx`/`SettingsSidebar.tsx` 的"settingsGroups 保留为兼容层"、`agui.ts` 两处"共享类型 SSEChunk"——对应代码已删）。第二轮后复扫：全仓"跨文件+文件内均零使用"的导出为 0；typecheck/build/vitest 三道门禁结果与基线一致。
> A.3 所列"冗余导出"（约 108 个，仅多余 `export` 关键字）属 API 面收敛项，收益低、改动面广，两轮均未处理。
> vitest 的 94 passed / 5 failed 中，5 个失败为 `match-accelerator.test.ts` 预先存在的环境问题（`isMacPlatform()` 运行时读 `navigator.platform`，Windows 语义用例在 mac 宿主/Node 环境必红），与清理无关——建议为该测试显式注入平台桩。

### A.1 零引用整文件（11 个，约 564 行）— 已删除

| 文件 | 行数 | 说明 |
|---|---|---|
| `components/settings/sections/SystemSection.tsx` | 152 | 已被 `SystemSettingsCompositeSection` 取代，旧文件未删 |
| `components/settings/sections/HelpSection.tsx` | 103 | 已合并到「关于」页（`settingsConfig.tsx` 重定向表 `help → about`） |
| `components/sidebar/FileTree.tsx` | 73 | 文件树组件，无任何 import；其消费的 `useWorkspaceStore` 仍被 `WorkspacePage` 使用 |
| `components/ui/tabs.tsx` | 52 | shadcn 原语，零引用（`DataManagementSection` 反而手写 tablist） |
| `components/settings/sections/PersonalizeSection.tsx` | 50 | 已合并到「通用」（`personalize → general`），旧文件未删 |
| `hooks/useWelcomeGuide.ts` | 44 | 注释自认「当前暂不引用」 |
| `components/settings/sections/AppearanceSection.tsx` | 40 | 已合并到「通用」（`appearance → general`），旧文件未删 |
| `components/ui/textarea.tsx` | 21 | 零引用（`HitlToolConfirmDialog` 反而用裸 `<textarea>`） |
| `pages/SkillsPage.tsx` | 18 | `App.tsx` 已重定向 `/skills → /plugins` |
| `components/ui/collapsible.tsx` | 7 | 零引用 |
| `shared/index.ts` | 4 | 桶文件，全仓 0 引用（三端均直接深链 `@shared/*`） |

### A.2 完全死符号（原列 46 个，复核修正为 44 真死 + 2 误报；另补 3 个扫描遗漏项）— 已删除

> 第二轮复核修正：`fetchUsers`/`updateUser` 为误报（见 A.5，保留不删）；`useFeatureFlags` 第一轮漏删、第二轮补删；`StoreValue`、`WindowState`（`shared/ipc-channels.ts`）、`closeAllPreviewTabsAtom`（`stores/rightPanelStore.ts`）为本清单原扫描遗漏，第二轮补删。

按文件分组（重点项）：

- `lib/input/select-file-tags.ts`（9 个）：`extractFilePaths`、`findSelectFileTagAt`、`hasSelectFileTag`、`hasSelectPluginTag`、`normalizeSelectFileText`、`removeFilePathFromText`、`selectFileTextToPlainText`、`serializeSelectFileText`、类型 `SendImages`
- `lib/input/select-file-editor.ts`（8 个）：`addFilesToSelection`、`documentHasFileReferences`、`ensureSelectedFile`、`mergeSelectedFiles`、`normalizeSelectionToFileBoundaries`、`removeReferenceNode`、`removeSelectedFile`、`replaceEditorRange`
- `lib/input/image-attachments.ts`（3 个）：`areImageAttachmentsEqual`、`cloneImageAttachments`、`estimateImageTokens`（后者实现为恒返回 `1024`，"估算"名不副实）
- `lib/input/input-drafts.ts`（2 个）：`getHomeInputDraftKey`、`getProjectInputDraftKey`
- `lib/input/drag-folder.ts`（1 个）：`getDraggedFilePaths`（会话内文件拖拽未落地）
- ~~`lib/dev/stress-messages.ts`（2 个）：`fetchUsers`、`updateUser`~~（误报：`SAMPLE_CODE` 模板字符串内的示例代码文本，非真实导出，保留，见 A.5）
- `lib/feature-flags.ts`（2 个）：`isFeatureEnabled`、`useFeatureFlags`
- `settingsConfig.tsx`（2 个）：`getGroup`、`settingsGroups`（注释自认空兼容层）
- `stores/artifactStore.ts`：`resetArtifactAtom`；`stores/rightPanelStore.ts`：`rightPanelActiveTabAtom`；`stores/traceAtoms.ts`：`traceSetExpandedBatchAtom`
- `shared/links.ts`：`DESKTOP_DOWNLOAD_URL`、`TRENDS_REPORT_URL`；`shared/types.ts`：`AgentExecuteRequest`、`AgentExecution`、`PaginatedData`、`SSEChunk`
- `main/local-store.ts`：`resetLocalChatStoreForTest`（测试辅助，无测试使用）

### A.3 冗余导出（108 个：外部零引用，仅定义文件内部在用）

主要为三类，可直接去掉 `export` 关键字或删除：

1. **组件 Props 接口（20+ 个）**：`InputAreaProps`、`FileAwareEditorProps`、`ConversationListProps`、`AccountMenuProps`、`SidebarNavProps` 等，全部仅文件内使用。
2. **shadcn 未使用的原语导出（40+ 个）**：`ui/dialog.tsx` 的 `DialogClose/Overlay/Portal/Trigger`、`ui/dropdown-menu.tsx` 的 `DropdownMenuCheckboxItem/Group/Portal`、`ui/message.tsx` 的 `MessageAvatar/MessageGroup/MessageHeader`、`ui/bubble.tsx` 的 `BubbleGroup/BubbleReactions`、`ui/card.tsx` 的 `CardContent/Description/Footer/Header/Title`、`ui/message-scroller.tsx` 的 3 个 hook、`ui/button.tsx` 的 `buttonVariants`、`ui/scroll-area.tsx` 的 `ScrollBar` 等。
3. **领域类型与工具（40+ 个）**：`main` 的 `KeyStore/ManagedKeyDescriptor/maskValue/HotkeyManager/UploadStore/UploadInfoDto/MAX_UPLOAD_BYTES`；store 的 `HitlResumeInput/HitlResumeResult/RestoreHitlPauseInput/HitlState/HitlStatus/HitlItemInput/HitlResolveInput/AuthStatus/ConfirmDialogPayload/OpenArtifactArg`；shared 的 `DANGEROUS_BINDINGS/getHotkeyDefinition/SUPPORT_EMAIL/AgentStep/MessageRole/TokenUsage/TraceNodeKind`；`ToolResultRenderer` 的 `DatetimeChip/GenericJsonCard/SearchResultsCard` 等。

### A.4 死 IPC 链路（通道已注册，但渲染端零消费）— 已删除（含 `main/upload-store.ts` 整文件）

| 链路 | 证据 |
|---|---|
| `upload:save/list/delete` 三通道 | main handler（`main/ipc-handlers.ts:858-886`）+ `main/upload-store.ts`（含未被调用的 `findByNamePrefix/readBase64`）+ preload `upload` 命名空间，renderer 无 `window.api.upload` 调用 |
| `ping` | `services/ipc.ts:126` 定义 `healthApi.ping`，全仓无消费 |
| `clipboard:read` | preload + `services/ipc.ts:110` 定义，renderer 仅用 `clipboardApi.write` |
| `app:getVersion` | `services/ipc.ts:73` 定义，无调用（版本显示改为 `HomePage.tsx:50` 硬编码 `'v0.1.0'`） |
| `file:getPath` | `services/ipc.ts:96` 定义，无调用 |
| `hotkey-main` 的 `onMainWindowToggle/setMainWindowToggleHandler` | 仅定义处出现，无调用者 |

### A.5 对正文中误报的更正

- **`services/api/index.ts` barrel 并非死代码**：`App.tsx:21` 与 `hooks/useAuthBootstrap.ts:19` 通过它导入 `apiClient`（正文第六节相关表述以本附录为准）。
- **CSS 文件均在使用中**：`index.css`（`main.tsx:9` 裸 import）、`settings-dialog.css`（`SettingsDialog.tsx:15`）、`pro-input.css`（`InputArea.tsx:95`）、`layout-tokens.css`（`index.css:3` 的 `@import`）。
- **`agent:*`、`store:*`、`file:read/write`、`notification:show`、`window:*`（除 getPath 外）等通道经复核均有真实消费**，不属于死链路。
- **`fetchUsers`/`updateUser`（`lib/dev/stress-messages.ts`）系误报**：符号扫描把 `SAMPLE_CODE` 模板字符串内以 `export async function` 开头的**示例代码内容**误判为真实导出。二者是压测样本数据的一部分，不是代码，保留不删。教训：正则式死代码扫描必须对模板字面量/字符串上下文做排除或逐一回源。

---

## 附录 B：安全 / 缺陷 / 性能专项审查（2026-10-01）

> 范围：功能缺陷、性能、安全（注入/XSS/CSRF/敏感信息/权限/加密）、资源泄漏与竞态。
> 方法：高危面逐行精读（key-store / local-store / hotkey 治理 / client.ts / agui.ts / stream-handler 全文 / hitlStore 全文 / Markdown-Mermaid-iframe 预览链 / 认证引导 / 草稿与附件链路），关键疑点以 **2 个 Electron PoC 实测**裁决；所有结论回源到行号。
> 与正文关系：本附录部分条目与第八节重合（如 B.1-2 即第八节高#3、B.1-9 即高#5），以本附录的严重度校准为准；与第八节结论冲突时，本附录为 2026-10-01 工作区状态（两轮死代码清理后）。

### B.0 P0：未发现

无 SQL 注入（全 prepared statement 绑定参数，DDL 仅插值自有常量）、无 XSS 可达路径（三层隔离，见 B.3）、无命令执行面、无未鉴权 IPC（56 通道全量 `isTrustedSender` + 路径白名单 + realpath 防软链 + 字节上限 + 原型链净化）、生产构建无 sourcemap。

### B.1 功能缺陷（按严重度）

| # | 严重度 | 问题 | 位置 | 影响 |
|---|---|---|---|---|
| 1 | **P1** | 图片附件全链路断裂：`SendMessageRequest` 无 images 字段；`toPersistMessage` 不落图片；upload IPC 链已删 | `shared/types.ts:107-123`、`services/localChat.ts:110-122`、`lib/input/image-attachments.ts:4`（注释自认） | UI 完整支持贴图/拖图/草稿，实际不进模型也不落库，刷新即丢——"虚假可用" |
| 2 | **P1** | 流式中按 Enter 无 `isStreaming` 守卫 → `sendMessage` 抢占式 abort 只断渲染端订阅、不 `transport.stop` | `InputArea.tsx:573-577`（键盘路径漏防，按钮路径已有防）、`chatStore.ts:675-697`、`ipc-transport.ts:106` | IPC 模式旧 run 在主进程跑完——重复烧 token、双倍负载，事件静默丢弃 |
| 3 | **P2** | `hitlStore.resolve()` 对 `resumeHitl` 无 try/catch | `hitlStore.ts:164-170` | 意外抛出则 status 永卡 `resolving`，弹窗已关无重试入口 |
| 4 | **P3** | SSE 静默截断（无 RUN_FINISHED/RUN_ERROR 即 done）不触发任何终态回调 | `agui.ts:357-380` | 靠 stream-handler 60s idle 超时兜底，期间 UI 转圈最长一分钟 |
| 5 | **P3** | 冷启动竞态：baseURL 恢复与认证引导两个 effect 无序并行 | `App.tsx:63-84` vs `useAuthBootstrap`（注释声称"必须先于"，代码未保证） | 自定义后端用户重启后 getProfile 打到默认 `127.0.0.1:8088`，误判 error 态 |
| 6 | **P3** | `traceNodeExpandedAtom`（atomFamily）全库零 `.remove()` | `traceAtoms.ts:32`（注释自认） | atom 缓存跨会话无界增长（第八节高#5） |
| 7 | **P3** | 菜单「检查更新」返回值丢弃 | `menuActions.ts` `void appApi.checkUpdate()` | 点击无任何反馈 |
| 8 | **P4** | `HOTKEYS_SET` 绑定值无语法校验（仅 id 白名单） | `hotkey-main.ts:50-53` | 非法串持久化，每次启动重试注册失败进 conflicts 黄条 |
| 9 | **P4** | `NOTIFICATION_SHOW`/`CLIPBOARD_WRITE` 参数未校验类型 | `ipc-handlers.ts:468-478` | 畸形入参 → 主进程构造抛错回 rejected promise（不崩溃） |
| 10 | **P4** | 草稿 unmount 冲刷仅聚焦态保存，与 B10 修复注释矛盾 | `use-input-draft-persistence.ts:104-113` | 快速切会话可能丢最后输入 |

### B.2 安全发现

| # | 严重度 | 问题 | 位置 | 说明 |
|---|---|---|---|---|
| S1 | **P2** | 认证 token（access+refresh）**明文**存 electron-store JSON | `useAuthBootstrap.ts:127-133`（`storeApi.set('auth.tokens', tokens)`） | 本机可读 userData 的任意进程可窃取 refresh token 长期冒用。对照：LLM 密钥走 safeStorage（`key-store.ts`），标准不一致；修复路径现成 |
| S2 | **P2** | 渲染端可读写 appStore **任意键**（含 secure.keys 密文、hotkeys 表） | `ipc-handlers.ts` `STORE_GET/SET/DELETE` | 实际危害有限（密文离端不可解、热键动作集固定），属攻击面宽而非可利用洞；建议加键命名空间白名单 |
| S3 | **P2** | SecuritySection 全部开关为局部 `useState`，不持久化、无消费方 | `SecuritySection.tsx:37-46` | 「安全预期失真」：用户以为沙箱/删除保护等可调，实际安全行为全由代码硬编码 |
| S4 | **P4** | `SafeLink` 展开顺序 `{...props}` 在 `rel="noreferrer noopener"` 之后 | `MarkdownRenderer.tsx:89` | sanitize 放行的内容侧 rel 可覆盖安全属性；Electron 场景（openExternal 走系统浏览器）影响小 |
| S5 | 低 | `APP_SET_API_BASE_URL` 接受渲染端任意 http(s) URL | `ipc-handlers.ts:333-343` | 需先攻陷受信 frame 才可滥用 networkCheck 探测内网；与 S2 同级面，可接受 |

**权限与加密面结论**：safeStorage 治理正确（敏感键强制加密、不可用即拒绝保存、只回掩码、受管键白名单杜绝任意 env 注入）；401 刷新 single-flight 防并发轮换、重试限 GET 幂等；`isTrustedSender` 正则已修 `localhost.evil.com` 绕过（S1/S6 注释）；`setWindowOpenHandler`/`openExternal` 均限 http(s)。

### B.3 XSS 渲染面：三层隔离成立（含 PoC 实证）

1. **对话 Markdown**：`rehype-sanitize`（defaultSchema 收紧：href 仅 http(s)/mailto，剥 on*）+ `SafeLink`/`SafeImage` 渲染期二次协议白名单；sanitize 在 highlight **之后**执行（正确顺序）。
2. **Mermaid**：`securityLevel: 'strict'`（禁 htmlLabels/脚本/交互）；innerHTML 注入的 SVG 处于页面 CSP 之下（`script-src 'self'`），双保险。
3. **HTML/SVG 产物预览**：`iframe sandbox="allow-scripts"`（**无 allow-same-origin** → opaque origin，无法触父页 DOM/cookie/localStorage）+ srcDoc 内层 CSP meta（`default-src 'none'`）；不给 `allow-top-navigation`/`allow-popups`；全库**零 postMessage 监听**（跨帧消息面闭合）。

**PoC 实测（临时 Electron 脚本，跑完已删）**：
- PoC-1：`loadFile(file://)` + `session.webRequest.onHeadersReceived` → 拦截器实际命中（`INTERCEPT_COUNT=1`），外部脚本/内联脚本均被 CSP 阻断 → **生产环境 CSP 注入生效**（曾疑"file:// 不被 webRequest 拦截则 CSP 形同虚设"，证伪）。
- PoC-2：`frame-src 'none'` 下 `<iframe srcdoc>` 正常渲染子文档 → **HTML/SVG 预览功能不被自身 CSP 阻断**（曾疑功能坏，证伪）。

### B.4 性能发现

| # | 严重度 | 问题 | 位置 | 影响 |
|---|---|---|---|---|
| P1 | **P2** | 草稿含 base64 图片（单图 ≤20MB，b64 后 ~27MB）经 `storeApi.set` 入 electron-store：`sanitizeValue` 全量 JSON 往返 + electron-store 同步整文件重写 | `input-drafts.ts`（images 入 draft）→ `ipc-handlers.ts:518-535` | 主进程同步大文件写 + 双份大字符串拷贝 → 全部 IPC 卡顿、store 文件无界膨胀。建议图片改存独立文件仅留引用 |
| P2 | **P3** | 所有列表查询 `ORDER BY datetime(created_at)` 使 `(session_id, created_at)` 索引失效 | `local-store.ts`（listMessages/deleteMessages 触底重建） | ISO 串字典序即时间序，`datetime()` 多余且致大会话全表排序 |
| P3 | **P3** | `deleteMessages` 循环内逐条 `prepare` 未复用 | `local-store.ts:400-404` | 批量截断时重复编译开销（better-sqlite3 prepare 非免费） |
| P4 | **P4** | `keyStore.applyToEnv()` 每次 `AGENT_*` 调用都执行（safeStorage 解密循环） | `ipc-handlers.ts:557-569` | 量级小可接受；可加脏标记 |
| P5 | **P4** | `LocalChatStore.close()` 全库无调用（无 before-quit 钩子） | `local-store.ts:442` | WAL 依赖 SQLite 崩溃安全兜底，不致损坏但不洁 |

### B.5 实证排除清单（避免后人重疑）

| 疑点 | 裁决 | 证据 |
|---|---|---|
| SQL 注入 | ✅ 无 | 全部 prepared statement；`where` 仅插自有常量 |
| Markdown/Mermaid/iframe XSS | ✅ 三层隔离成立 | B.3 + 双 PoC |
| 生产 CSP 失效（file:// 不拦截） | ✅ 生效 | PoC-1 |
| srcdoc 预览被 frame-src 阻断 | ✅ 不阻断 | PoC-2 |
| 401 并发刷新互相失效 | ✅ single-flight（axios 拦截器与 fetch 流共用） | `client.ts:145-162`（M4） |
| 定时器/监听器泄漏 | ✅ 配对完整（仅 B.1-6 atomFamily 例外） | hitlStore 三路 stopPolling；stream-handler rAF/idle 终态清理；`addEventListener/removeEventListener` 全库 11 文件逐一配对 |
| 主进程 run 注册表泄漏 | ✅ finally 清理 + sender destroyed 钩子 abort | `agent-runtime.ts:267,434-441` |
| 拖拽状态 Map 多窗口泄漏 | ✅ B13 已修（closed 事件按 webContents.id 清理） | `ipc-handlers.ts` 尾段 |
| 依赖冗余 | ✅ 36 deps + 15 devDeps 全部在用 | 全库 import 对账 |

