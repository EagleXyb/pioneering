# Desktop 与 Modu-Agent 代码深度分析报告

> 分析范围：`apps/desktop`（Electron 42 桌面应用，约 3.0 万行）与 `packages`（`modu-agent` 内核约 3.5 万行 + `evals` 评测工程约 2 千行）
> 分析方式：全文件通读 + 关键问题行号逐一复核
> 报告日期：2026-09-27
> 问题总数：72 项（P0×2 / P1×22 / P2×48）

## 严重程度总览

| 模块 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| apps/desktop 主进程（src/main） | 0 | 9 | 6 | 15 |
| apps/desktop 渲染进程 / preload / shared / services | 2 | 4 | 8 | 14 |
| modu-agent graph 图编排层 | 0 | 5 | 11 | 16 |
| modu-agent 内核（core/tools/config 等其他模块） | 0 | 5 | 11 | 16 |
| packages/evals 评测工程 | 0 | 4 | 7 | 11 |

严重程度定义：
- **P0**：必须立即修复——直接导致安全漏洞、数据丢失或核心功能不可用
- **P1**：重要缺陷——特定路径下功能失效、稳定性风险或信息泄露
- **P2**：一般问题——性能、可维护性、规范性问题，排期修复

---

# 一、apps/desktop 主进程（src/main）

## P1 级问题

### P1-1 同步 SQLite 调用阻塞主进程
- **位置**：[local-store.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/local-store.ts) L201、L203、L242、L275、L315、L320、L371、L402、L437；调用方 [ipc-handlers.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/ipc-handlers.ts) L668-L807
- **描述**：better-sqlite3 仅提供同步 API，全部 `LocalChatStore` 方法经 `ipcMain.handle` 在主线程执行。会话消息量大或 WAL checkpoint 时主进程阻塞，整个 UI（含 Agent 流式渲染）卡死。
- **原因**：未做进程隔离，DB 操作直接落在 UI 线程所属进程。
- **建议**：将 DB 持有者迁移至 `utilityProcess`/Worker，主进程与 Worker 通过 MessagePort 异步通信；短期方案为 IPC handler 外层包 `setImmediate` 让步并对查询结果分页限制。

### P1-2 base64 上传先全量解码再校验大小
- **位置**：[upload-store.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/upload-store.ts) L61-L68
- **描述**：`Buffer.from(base64)` 在长度检查之前执行，渲染端传入数百 MB base64 字符串即造成主进程内存尖峰甚至 OOM；`readdir + startsWith` 顺序扫描删除（L127-L130）与 `readBase64` 全量回读（L147-L152）也无上限。
- **原因**：先物化后校验；用遍历匹配替代 id→文件名的确定性映射。
- **建议**：先按 `base64.length * 3/4` 预判长度，超限直接拒；持久化 id→fileName 索引（SQLite 或 manifest JSON）实现 O(1) 定位。

### P1-3 FILE_WRITE 校验用真实路径、写入用原始路径（TOCTOU）
- **位置**：[ipc-handlers.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/ipc-handlers.ts) L143-L186（`isPathAllowed`）、L443
- **描述**：`isPathAllowed` 对 `resolve` 后且经 realpath 解析的路径做白名单校验，但 `writeFile(req.filePath, ...)` 写的是调用方传入的原始（可能是符号链接）路径。若白名单目录内存在指向 `/etc` 的软链，配合竞态可写越界。
- **原因**：检查路径与使用路径不一致（check-use 分离）。
- **建议**：`isPathAllowed` 改为返回规范化后的真实路径，后续 read/write 一律使用该返回值。

### P1-4 Agent abort 无真实取消语义，activeRuns 可能泄漏
- **位置**：[agent-runtime.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/agent-runtime.ts) L254-L262、L285-L298、L361-L370、L435-L441；根因在 [runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts) L421（`stream_response`/`resume_stream` 不接受 AbortSignal）
- **描述**：`run.controller` 只能在事件间隙生效。LLM 请求 hang 住或长工具执行不 yield 事件时，`for await` 永不醒来 → `finally` 不执行 → `activeRuns` 条目永驻，abort 后 runId 仍占用，同会话重发报 "runId already exists"。
- **原因**：取消机制依赖上游协作，内核未提供 signal 通道，调用方也无兜底超时。
- **建议**：执行链路加总超时看门狗（可配置，如 10 分钟），超时强制 abort + `activeRuns.delete`；`abortRunsForSender` 同步清理注册表；推动内核在 `extraConfigurable` 透传 AbortSignal。

### P1-5 IPC 抛出的原始错误泄露本机绝对路径
- **位置**：[ipc-handlers.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/ipc-handlers.ts) L675、L688、L708、L724、L743、L770、L789、L811
- **描述**：8 处 `catch` 均 `String(e)` 直回渲染端，LocalChatStore 抛出的“本地数据库不可用（…路径…）”及 SQLite 错误会带上 `/Users/<name>/Library/...` 绝对路径，可被恶意渲染端利用做信息收集。
- **原因**：错误未分类脱敏（同文件 `normalizeFileError` L200 已有正确范式，未覆盖 DB 路径）。
- **建议**：抽统一 `normalizeError`，只回错误码与通用文案，细节仅打日志。

### P1-6 `app.whenReady().then(...)` 无 catch，启动静默死亡
- **位置**：[index.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/index.ts) L128-L159
- **描述**：`registerIpcHandlers`/`bootstrapHotkeys`/`createWindow` 任一抛错即 unhandled rejection，表现为“启动后无窗口、无日志、静默死亡”。`getAllowedRoots()`（ipc-handlers.ts L91-L102）在启动早期调 `app.getPath('documents')` 等，某些沙盒/重定向环境会抛，直接打死整个 IPC 注册。
- **原因**：Promise 链无失败分支；路径获取无 try 兜底。
- **建议**：`.then(...).catch(e => { dialog.showErrorBox(...); app.exit(1) })`；`getAllowedRoots` 逐项 try，失败项跳过。

### P1-7 FILE_GET_PATH 未校验 name 参数
- **位置**：[ipc-handlers.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/ipc-handlers.ts) L451-L454
- **描述**：渲染端传任意字符串直接 `app.getPath(name)`，传 `'home'`/`'exe'` 等可探测本机路径，传未知名抛未捕获异常使 invoke reject。
- **原因**：参数无枚举白名单。
- **建议**：固定白名单数组过滤后再调。

### P1-8 `abortPending` 拒绝 resume 产生的后续事件无投递目标
- **位置**：[agent-runtime.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/agent-runtime.ts) L373-L396
- **描述**：`resume_sync(false)` 会把图继续跑到终态，期间产生的新事件（如 LLM 收尾总结）不会被任何 emitter 推送，用户端状态与图实际状态漂移；且与同 session 在跑流并发操作同一 graph，存在交错。
- **原因**：abort 被建模成“完整 resume 一次”，与流式 run 生命周期未互斥。
- **建议**：abort 前先 `stopRun(sessionId)` 并等待在途流退出，再执行 resume_sync；对同 session 的新 run 入口加互斥锁。

### P1-9 `isPathAllowed` 同步 realpathSync 阻塞主进程
- **位置**：[ipc-handlers.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/ipc-handlers.ts) L151-L154、L166-L186
- **描述**：每次 FILE_READ/WRITE 在主线程做 `realpathSync` 及最多 40 层向上重试（L170），深层/恶意路径可放大为长串同步系统调用，阻塞 UI。
- **建议**：改用 `fs/promises.realpath`，向上解析用 `path.dirname` 循环配异步 stat。

## P2 级问题

### P2-1 UPLOAD_SAVE 无 base64 长度前置校验
- **位置**：[ipc-handlers.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/ipc-handlers.ts) L858-L867
- **描述**：只校验 `typeof base64 === 'string'`，IPC 结构化克隆本身也要先全量传输该巨型字符串。
- **建议**：handler 内先按 `base64.length` 粗筛（>约 67MB 直接拒），再进 store。

### P2-2 `registerIpcHandlers` 无幂等保护，监听重复累积
- **位置**：[ipc-handlers.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/ipc-handlers.ts) L220、L891-L895、L951-L967
- **描述**：`ipcMain.handle` 重复调用会覆盖并抛 "second handler" 警告；两条 `app.on('browser-window-created')` 无 off 手段，测试反复注册即泄漏；`dragTargets`（L902）持 BrowserWindow 强引用，仅靠 `closed` 释放。
- **建议**：模块级 `let registered = false` 短路；app 级监听收敛并支持 off。

### P2-3 自研窗口拖拽协议可用 CSS 方案替代
- **位置**：[ipc-handlers.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/ipc-handlers.ts) L897-L946
- **描述**：DRAG_START/MOVE/END + offset 状态 + 工作区钳制约 50 行，MOVE 高频到达时 `getDisplayMatching` 每次查询显示器（有 I/O）。
- **建议**：标题栏区域 CSS `-webkit-app-region: drag`，删除三条 IPC 与状态表。

### P2-4 UPLOAD_LIST 返回绝对路径 + STORE_SET 无键名约束
- **位置**：[upload-store.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/upload-store.ts) L81-L89、L105-L111；[ipc-handlers.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/ipc-handlers.ts) L523
- **描述**：`UploadInfoDto.path` 把 `userData/uploads/...` 绝对路径回传渲染端；`STORE_SET` 的 key 无格式校验，可写入任意键（含覆盖内部配置键 `hotkeys`）。
- **建议**：`path` 改为仅 filename/id；`STORE_SET` 加 `^app:` 命名空间限制，内部键走独立通道。

### P2-5 开发态全局快捷键 handler 为空实现（死代码）
- **位置**：[hotkey-main.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/hotkey-main.ts) L26-L28、L99-L115
- **描述**：`setMainWindowToggleHandler` 从未被调用，toggle 降级为 `BrowserWindow.getAllWindows().find(...)` 启发式，多窗口/窗口销毁竞态时行为不确定。
- **建议**：`index.ts` 创建窗口后注入 handler（处理 hide/show/focus 与 `isDestroyed`），或删除该注入 API。

### P2-6 开发态 CSP 放宽 + OFF_DIALOG 参数未校验
- **位置**：[index.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/index.ts) L42；[ipc-handlers.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/ipc-handlers.ts) L359-L364
- **描述**：dev 下 `script-src 'unsafe-inline'` 常开；`filters`/`properties` 未验证类型即透传 `dialog.showOpenDialog`，`filters.extensions` 含非字符串时抛未处理 rejection。
- **建议**：dev CSP 收紧至 Vite 最小集合并加 nonce；dialog 参数校验后再透传。

---

# 二、apps/desktop 渲染进程 / preload / shared / services

## P0 级问题

### P0-1 sendMessage 并发双发竞态
- **位置**：[chatStore.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/stores/chatStore.ts) L675（读 `abortController` 判空）与 L942（`set({ abortController: controller })`）
- **描述**：判空后到赋值前有 `await createSession()`（L703）空窗，第二次调用同样通过判空，导致：两条 user/assistant 占位消息、重复创建会话、先发者 `streamSeq` 失效后半截内容丢失。
- **原因**：缺少 in-flight 守卫。
- **建议**：函数入口用 Promise 或 `isStreaming` 原子置位守卫，替代末尾赋值。

### P0-2 模型 API Key 明文落 localStorage
- **位置**：[useAppStore.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/stores/useAppStore.ts) L43（`apiKey` 字段）、L231-L240（persist partialize 含 `modelConfigs`）
- **描述**：项目已建有 `secureKeys` safeStorage 治理体系，但模型 Key 经 zustand persist 明文写入 localStorage，XSS/恶意扩展可直接读取。
- **建议**：Key 改走 `window.api.secureKeys`，本地仅存引用名。

## P1 级问题

### P1-1 流异常路径不 abort，run 与订阅悬挂
- **位置**：[chatStore.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/stores/chatStore.ts) L881-L887（onError 未 abort）、L833（onDone 同）；[ipc-transport.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/services/transport/ipc-transport.ts) L44-L61
- **描述**：idle 超时或 invoke 失败后 controller 从不 abort：IPC 侧 `ActiveRun` 与 AGENT_EVENT 监听、主进程 run 永久泄漏；HTTP 侧 fetch reader 不取消，后台持续下载。
- **建议**：onError/onDone/idle-timeout 统一 `controller.abort()`。

### P1-2 recover 跨会话竞态，串线覆盖
- **位置**：[chatStore.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/stores/chatStore.ts) L611-L616
- **描述**：快速切换 A→B 时，A 的 recover 不校验会话是否仍选中，`restoreHitlPause` 后置写入可覆盖 B 的 `hitlPausedSessionId`，恰好破坏 L126-L136 注释所述“阶段三收敛”要根除的跨会话串线。
- **建议**：recover 前后比对 `currentSessionId`，不符则丢弃。

### P1-3 preload 暴露面无命名空间约束的通用 store/文件/剪贴板 API
- **位置**：[preload/index.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/preload/index.ts) L103-L107（store）、L81-L88（file）、L94-L97（clipboard.read）；认证 token 以固定键 `auth.tokens` 存于该 store（[useAuthBootstrap.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/hooks/useAuthBootstrap.ts) L37、L129）
- **描述**：`isTrustedSender` 只防跨窗口，防不住渲染进程内 XSS——被攻陷后可读取/覆写 token、读剪贴板。
- **建议**：key 加前缀白名单；clipboard.read 改事件驱动或移除。

### P1-4 mailto 链接被主进程协议白名单静默拦截
- **位置**：[links.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/shared/links.ts) L42-L43（`SUPPORT_MAILTO_URL`）vs [ipc-handlers.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/main/ipc-handlers.ts) L512（仅 `^https?://` 放行）
- **描述**：文件头注释声称支持 mailto 直传 openExternal，实际“联系我们”点击无响应（AboutSection.tsx L94 调用点）。
- **建议**：handler 放行 mailto 或桥接层剔除，二者收敛。

## P2 级问题

### P2-1 流式期每帧全量深拷 trace 树
- **位置**：[stream-handler.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/services/stream-handler.ts) L168-L174；消费方 chatStore.ts L803-L811
- **描述**：`snapshotTrace` 逐节点克隆 + children 新数组，经 onFlush 整体替换，复杂度 O(N)/帧，长 Agent 会话主线程卡顿。
- **建议**：增量 diff 或脏节点集合快照。

### P2-2 裸 window.open + 硬编码占位链接
- **位置**：[HelpSection.tsx](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/components/settings/sections/HelpSection.tsx) L18、L58；[electron-mock.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/mocks/electron-mock.ts) L86
- **描述**：绕过 shellApi/links.ts 统一出口；mock 的 `window.open(url)` 无协议校验，链接一旦动态化即成 `javascript:` 入口。
- **建议**：改用 `DOCS_URL`/`SUPPORT_MAILTO_URL` + `shellApi.openExternal`。

### P2-3 atomFamily 无清理，常驻内存
- **位置**：[traceAtoms.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/stores/traceAtoms.ts) L34
- **描述**：注释自认需 remove，全仓无 `.remove(` 调用，会话/消息累积后 atom 实例不释放。
- **建议**：消息卸载/会话切换时批量 remove。

### P2-4 停止流式时原地修改共享 TraceNode
- **位置**：[chatStore.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/stores/chatStore.ts) L1002-L1010
- **描述**：`{...streamingTraceNodes}` 仅浅拷贝 record，节点对象仍被 mutate，破坏不可变更新约定。
- **建议**：深拷贝节点或生成新节点对象。

### P2-5 中止旧流按当前会话裁剪消息
- **位置**：[chatStore.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/stores/chatStore.ts) L675-L696
- **描述**：旧流在其他会话时，`sid=currentSessionId` 裁错列表，可能误删新会话末尾空消息。
- **建议**：记录每次流的 sessionId 再裁剪。

### P2-6 类型漂移：shared↔preload↔transport 三处契约弱化
- **位置**：[preload/index.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/preload/index.ts) L156-L162 与 [preload/index.d.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/preload/index.d.ts) L31-L37 同类型两处写法；[ipc-transport.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/services/transport/ipc-transport.ts) L38 把 dispatcher 参数退化为 `Record<string, unknown>`，绕过 `AguiEventObject` 编译期校验
- **建议**：统一从 shared/types 单点引入，恢复泛型约束。

### P2-7 不安全 Cast 与死分支
- **位置**：[chatStore.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/stores/chatStore.ts) L200、L205
- **描述**：`s as ToolCall['status']` 任意串强转；`reasoningContent` 死分支（`text_stream` 块被拼入 thinking）。
- **建议**：显式映射函数并删除死代码。

### P2-8 setAgentTransport 不更新 currentMode
- **位置**：[transport/index.ts](file:///Users/ybxue/Desktop/pioneering/apps/desktop/src/renderer/src/services/transport/index.ts) L117-L119
- **描述**：`getAgentTransportMode()` 返回陈旧值，导致 localChat.ts L41-L43 的 `isLocalRuntimeActive()` 误判，新建会话 runtime 归属与传输通道选择可能错配。
- **建议**：切换 transport 时同步 mode 或从 `currentTransport.kind` 反推。

## 做得好的方面（main/renderer）
`setWindowOpenHandler` 协议拦截（index.ts L109-L117）、STORE 写入净化（ipc-handlers.ts L517）、MarkdownRenderer rehype-sanitize href 白名单，均为良好实践，应保留。

---

# 三、modu-agent graph 图编排层

## P1 级问题

### P1-1 LLM 拆分的 depends_on 与生成的 task_id 永远不匹配，导致静默终止
- **位置**：[supervisor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/supervisor.ts) L163-L178、L322-L329
- **描述**：`decompose_task_with_llm` 把 LLM 输出的 `depends_on`（如 "task_1"）原样透传（L171），但 `task_id` 被替换为 `${taskType}_${随机UUID}`（L166），两者永不匹配 → `route_from_supervisor` 中 `depsReady` 恒为 false（L321），所有子任务被过滤，返回空 Send 数组，图直接结束，不经过 consensus/finalize_response。
- **原因**：任务 id 重写与依赖表述未同步映射。
- **建议**：LLM 拆分时把 LLM 输出的序号映射回生成的 task_id，或以序号下标作为依赖键。

### P1-2 `supervisor_round` 运算符优先级错误且未注册 channel
- **位置**：[supervisor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/supervisor.ts) L256
- **描述**：`(state as any)['supervisor_round'] ?? 1 + 1` 中 `+` 优先级高于 `??`，恒等于 `?? 2`，轮次永不递增（无限重拆分无上限）；且 `supervisor_round` 未在 `ModuAgentStateAnnotation` 注册，写入被 LangGraph 静默丢弃。
- **建议**：改为 `Number((state as any)['supervisor_round'] ?? 0) + 1`，并在 state.ts 注册该字段。

### P1-3 改参批准路径新 AIMessage 丢失 id，残留悬挂 tool_calls
- **位置**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L1982-L1994
- **描述**：modified_args 批准时 `new AIMessage({...})` 未传 `id: lastMsg.id`，messagesStateReducer 按 id 去重失效——旧消息（含 tool_calls）仍留在历史中，下一次 LLM 调用会因 tool_calls 无对应 ToolMessage 报 INVALID_TOOL_RESULTS。对比 docFinalAnswerNode（nodes.ts L842-L848）刻意保留了 id，此处遗漏。
- **建议**：构造时补 `id: lastMsg.id`。

### P1-4 事件丢失：resume_stream 完全绕过 EventBridge
- **位置**：[runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts) L1106-L1119
- **描述**：`stream_response` 经 `bridge.consume()` 发布 EventBus 事件、SSE 细粒度事件与 EvolutionSignalCollector 信号；`resume_stream` 直接消费原始流，恢复执行后的 thinking/tool_result 事件全部丢失，进化信号采集中断。
- **建议**：resume_stream 复用 `_normalizeLangGraphStream` + EventBridge 链路。

### P1-5 Metrics 的 finally 块将失败请求记为 success
- **位置**：[runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts) L488-L500
- **描述**：`stream_response` 的 finally 无条件 `record_request('success', ...)`；图执行抛异常时 metrics 仍记成功，错误率监控失真。且该函数无 try/catch，异常直接把生成器 reject 给调用方。
- **建议**：区分正常完成与异常路径分别打点。

## P2 级问题

### P2-1 状态字段只增不减，Checkpoint 无界膨胀
- **位置**：[state.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/state.ts) L225-L228、L333-L346、L354-L357
- **描述**：`tool_results / observation_history / confidence_history / information_gain_history / artifacts` 均为 append reducer，无长度上限；agentNode 仅注入最近 5 条观测（nodes.ts L1019），但全量数据随每次 `values` 流事件与 rollback 历史快照反复序列化，长会话下 checkpoint 与单次流 payload 持续变大。
- **建议**：对历史数组加窗口上限，或 values 事件做字段裁剪。

### P2-2 MemorySaver 单例仅单进程有效，多实例部署 HITL resume 失效
- **位置**：[factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts) L158-L162
- **描述**：默认 memory checkpointer 为模块级单例，多 Worker/多实例部署下 interrupt 状态只在单进程内存中，其他实例 resume 时找不到 checkpoint；所有图实例共享一份数据，无隔离。
- **建议**：生产默认切换 sqlite/postgres checkpointer，或文档明确单实例约束。

### P2-3 工具入参静默兜底、深层无校验
- **位置**：[tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/tool-adapter.ts) L58-L114
- **描述**：为兼容 structured outputs，所有字段被标 required 并以 `.nullable().default(兜底值)` 声明——LLM 漏传必填参数时不会报错，而是注入 `''`/`{}`/`0` 继续执行（如 sql_query、文件类工具收到空参数）；array/object 用 `z.any()` 无深层校验。
- **建议**：危险工具保留服务端入参强校验，必填缺失应返回参数错误而非兜底值。

### P2-4 MCP 信任边界：工具全量注册 + 远程描述直注入 Prompt
- **位置**：[factory.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts) L374-L388；[mcp-tool-adapter.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/mcp-tool-adapter.ts) L60-L66、L209-L211
- **描述**：`_discover_and_register_mcp_tools` 无白名单/确认机制，任意已连接 MCP Server 可向 Agent 注入任意工具；远程 description 被原样拼入系统提示（prompt 注入面）；`requiresApproval()` 恒为 false，MCP 工具默认不过 HITL。
- **建议**：增加 Server/工具级 allowlist，对 MCP 工具默认纳入审批。

### P2-5 子图执行完全绕过 HITL 审批
- **位置**：[subgraph/builder.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/builder.ts) L186-L190；[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L2583-L2584
- **描述**：sub_tools 直接用 `new ToolNode(effectiveTools)` 执行，无 human_review 节点；`_filterToolsByTaskType` 对未知 task_type 保守返回全部工具（含 code_executor），多 Agent 路径下敏感工具脱离审批链路。
- **建议**：子图内对 requiresApproval 工具加审批中断；未知 task_type 改为最小工具集。

### P2-6 并行 DAG 分支共享 last-write-wins channel 互相覆盖
- **位置**：[dispatcher.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/dispatcher.ts) L255-L264
- **描述**：多个就绪步骤经 Send 并行进入 agent，各分支回写 `current_step_index / plan / step_msg_baseline` 等 last-write-wins 字段，并发写入互相覆盖——游标推进与 plan 状态更新可能丢失，导致步骤重复执行或漏执行（L77-L79 注释已承认该风险但仅规避读侧）。
- **建议**：plan/游标改为按 task_id 的合并 reducer 或分流域写入。

### P2-7 重试层数相乘且阻塞在节点内
- **位置**：[retry.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/retry.ts) L102-L156、L168-L192；[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L2448-L2514；[dispatcher.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/plan-execute/dispatcher.ts) L496-L498
- **描述**：LLM withRetry(默认2) × 工具重试(默认3) × 子 Agent 重试 × 步骤重试(最多5次、`await sleep` 阻塞在 step_finalize 节点内)层层相乘，最坏请求时延为各层之积；无全局时间/次数预算。
- **建议**：引入请求级 deadline 与全局重试预算，透传剩余额度。

### P2-8 事件重复/悬挂：tool_call_end 永不发送，_toolCallStack 可能泄漏
- **位置**：[event-bridge.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/adapters/event-bridge.ts) L57、L402-L427
- **描述**：`tool_call_end` 声明在 SSE 类型中却从未 emit（前端无法感知工具调用结束）；HITL 拒绝路径下 tool_call_start 已入栈但无对应 tool_result，栈条目永不清理，同 id 后续不再发 start。
- **建议**：tools 分支补发 tool_call_end，拒绝路径同步清理栈。

### P2-9 魔法数与硬编码散布
- **位置**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L540、L585、L2401、L333、L1019 等
- **描述**：doc_writer 失败上限 2、兜底轮数硬编码 8、子图 recursionLimit 硬编码 10、知识条数 5、观测截取 5 等；新增节点在 `_NODE_DOMAIN_MAP` 无映射即静默丢失 AgentEvent；新增 interrupt 节点必须手动登记 `INTERRUPT_NODE_NAMES` 否则漏判。
- **建议**：魔法数收敛至配置；映射表缺失时打 warning 兜底。

### P2-10 死代码路径
- **位置**：[nodes.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts) L893（`_originalLlm` 声明后从未使用）；[graph.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts) L781-L807（`_cached_plan` 无任何节点写入，永远走回退分支）
- **建议**：删除死代码或将 plan 回填落实。

### P2-11 入口无长度与并发约束
- **位置**：[runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts) L191-L218
- **描述**：`_validateInputData` 仅校验类型与必填，prompt 无大小上限；`get_runner` 缓存单图实例，无 per-session 并发上限，超大 prompt 或多会话并发可直接压满 LLM 配额与内存。
- **建议**：增加 prompt 长度校验与会话级并发/配额控制。

---

# 四、modu-agent 内核（core/tools/config/orchestration 等）

## P1 级问题

### P1-1 EventBus.publish 域索引覆盖全局订阅者致事件静默丢失
- **位置**：[message-bus.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/message-bus.ts) L98-L102
- **描述**：当某 domain 存在域级订阅者时，`matched` 被整体替换为 `_domainIndex` 结果，未注册 domain 的全局订阅者被完全跳过。PersistentEventLog（同文件 L234）与 EvolutionSignalCollector 均以无 domain 方式订阅。
- **原因**：域索引本应作“加速路径”，实现却变成“独占路径”，缺少“域级 ∪ 全局”合并。
- **建议**：`matched = [...domainMatched, ...globalSubs]` 后统一过 `sub.matches()`。

### P1-2 file-ops/doc-writer 路径校验漏检中间目录符号链接（逃逸面）
- **位置**：[file-ops.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/file-ops.ts) L169-L175；[doc-writer.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/doc-writer.ts) L194-L200
- **描述**：`_validatePath` 仅对最终组件做 `lstat` 符号链接检查；若 `allowedRoot/sub` 是指向 `/etc` 的符号链接，读 `sub/passwd` 可越界读任意文件。默认 root 为 `$TMPDIR/modu_workspace`（file-ops.ts L45，全局可写共享目录），放大了预置链接风险。
- **建议**：对 `fullPath` 与 `allowedRoot` 均取 `fs.realpathSync` 后再比较，或逐段校验父目录。

### P1-3 构造函数未 await 异步初始化，连接池/指标静默失效
- **位置**：[base-llm.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/base-llm.ts) L88；[metrics.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/observability/metrics.ts) L54
- **描述**：`this._initDispatcher()` / `this._initPromClient()` 为 fire-and-forget：`llm.connection_pool.enabled=true` 时 `_dispatcher` 在首次 invoke 前恒为 null，连接池配置静默不生效；MetricsRegistry 构造后早期 `record_*` 被丢弃。
- **建议**：保存 init Promise 并提供 `ready()`，或在使用点懒加载（`await this._ensureDispatcher()`）。

### P1-4 CodeExecutorTool 正则校验器误报与绕过并存、临时文件落共享目录
- **位置**：[code-executor.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/code-executor.ts) L107-L157、L268-L283
- **描述**：(a) 校验前不剥离注释与字符串，`# os.path.join` 或合法字符串 "subprocess" 即触发整码拒绝；(b) `_detectStringConcatenation` 比对字面量原始内容，`'\x5f\x5fimport\x5f\x5f'` 可绕过片段检测；(c) 校验后的 `.py` 写入共享 `os.tmpdir()`，文件名可预测、无独占创建。
- **原因**：无 Python AST，纯正则属启发式；注释/转义序列未经 tokenize 归一。
- **建议**：先做词法剥离（注释/字符串/转义解码）再匹配；临时文件用 `fs.openSync(path,'wx')` 并设 0600；文档中将定位降级为“纵深防御之一”。

### P1-5 串行/异步感知管线对多级依赖结果不一致
- **位置**：[pipeline.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/perception/pipeline.ts) L188-L198
- **描述**：串行版逐个传递前一感知器输出；异步版让第 2..n 个感知器全部共享“第一个感知器”的输出基线。当管线为 `[text_preprocessor, llm_parser, X]` 且 X 依赖 llm_parser 输出时，两条路径产物不同。
- **建议**：为感知器声明 depends_on，按拓扑层内并行；或文档限定异步版仅适用于单级基线管线。

## P2 级问题

### P2-1 AgentEvent.fromDict hex 启发式误判导致字符串静默变二进制
- **位置**：[protocol.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/communication/protocol.ts) L233-L241
- **描述**：偶数长度且全为 hex 字符的字符串 payload（如 `"12345678"`、`"abcd"`）反序列化时被转为 Uint8Array，文本数据静默损坏。
- **建议**：schema_version 路由或显式 payload_kind 字段，勿用内容嗅探。

### P2-2 YAML 类型校验对 null 基准字段一律丢弃合法覆盖
- **位置**：[yaml-loader.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/config/yaml-loader.ts) L293-L330
- **描述**：base 值为 null（`memory.chroma_persist_path`、`perception.deep_parsing.spacy_model`）时，任何非 null override 因 `typeof null==='object'` 与标量类型不符被静默丢弃并告警。
- **建议**：null 基准视为“任意类型放行”。

### P2-3 MODU_CONFIG_PATH 指向损坏 JSON 时 getConfig 直接抛异常
- **位置**：[runtime-config.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts) L426-L434
- **描述**：`JSON.parse` 无 try/catch，与 YAML 路径“失败即降级”行为不一致，启动期可被单点故障击穿。
- **建议**：捕获后 warn 并降级 DEFAULT_CONFIG。

### P2-4 RuntimeConfig.get 浅拷贝不彻底，嵌套对象仍可被外部改写
- **位置**：[runtime-config.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/config/runtime-config.ts) L454-L469、L385-L389
- **描述**：`get('llm.router')` 返回的浅拷贝中嵌套 routes/limits 与内部状态共享，调用方改子字段即污染全局配置。
- **建议**：对 dict 深拷贝或返回只读代理。

### P2-5 ConsensusPattern 超时后参与者任务未取消
- **位置**：[consensus.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/consensus.ts) L353-L377
- **描述**：`Promise.race` 超时后 allSettled 中的 LLM/子 agent 任务继续后台运行；timeout 定时器悬挂至触发。
- **建议**：传入 AbortSignal 支持取消，race 结束后 clearTimeout。

### P2-6 EvolutionSignalCollector 信号列表无界增长
- **位置**：[evolution-signal.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/feedback/evolution-signal.ts) L58-L71
- **描述**：每 reportInterval 个事件 push 一条 signal，永无淘汰；长生命周期单例持续吃内存（对比 FeedbackLoop 已有 200 条环形缓冲）。
- **建议**：加定长上限或按 TTL 清理。

### P2-7 MCP SSE/WebSocket 传输的 timeout 配置为死字段
- **位置**：[transport.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/transport.ts) L229-L252、L311-L334
- **描述**：`_timeout` 存入后从未使用，`connect()` 无超时保护（StdioTransport L147-L167 有）；远端挂起会永久卡死 `MCPClient.start()`。
- **建议**：复用 stdio 的 race+timeout 模式并接线或移除 `_timeout`。

### P2-8 Skill 动态加载无签名/白名单校验即执行任意代码
- **位置**：[loader.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/skills/loader.ts) L79-L96、L138
- **描述**：`await import(...)` 后直接调用 `skill.setup()` 与注册工具；目录来自 `skills.auto_discover_dirs` 配置，配置或扫描目录被污染即任意代码执行。
- **建议**：加 manifest 校验/来源签名，并对 setup 做超时与异常隔离。

### P2-9 BaseLLMReasoner 公开 apiKey getter 返回明文密钥
- **位置**：[base-llm.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/reasoning/llm/base-llm.ts) L495-L497
- **描述**：任何序列化、日志、调试快照路径经 `llm.apiKey` 即可带出明文。
- **建议**：删除该 getter 或仅返回掩码值（`sk-***`）。

### P2-10 MCP 工具缓存无失效、连接失败仍标记 started
- **位置**：[client.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/mcp/client.ts) L89-L102、L209-L218
- **描述**：`listTools` 缓存永不失效，服务端工具集变更不可见；`start()` 中单个 server 失败仍置 `_started=true`，重试/重连路径不可达。
- **建议**：缓存加 TTL/显式 refresh，start 失败时允许重置状态。

### P2-11 `any` 泛滥与 logger 样板大段重复
- **位置**：[tool-registry.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/tool-registry.ts) L167、L218（`tools: any[]`）；[consensus.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/orchestration/patterns/consensus.ts) L313；11+ 个文件重复定义同一 console logger 包装
- **建议**：抽出共享 `createLogger(tag)` 工厂；工具数组以结构化接口替代 `any[]`。

## 做得好的方面（内核）
- [http-request.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/http-request.ts) 的 DNS pinning + 流式限长 + 重定向不跟随（防 SSRF/Rebinding 设计完整）
- [sql-query.ts](file:///Users/ybxue/Desktop/pioneering/packages/modu-agent/src/tools/sql-query.ts) 的 `readonly` + `fileMustExist` 连接级只读
- FeedbackLoop / ObservationMemory 的有界缓冲与 token 预算

---

# 五、packages/evals 评测工程

## P1 级问题

### P1-1 `--no-save` 完全失效
- **位置**：[cli.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/cli.ts) L86 + [runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/runner.ts) L274
- **描述**：CLI 在 `save=false` 时传 `outputDir: null`，但 `runEvaluation` 中 `options.outputDir ?? resolve(EVALS_ROOT, ...)` 对 `null` 求值得到默认目录（`null ?? x === x`），输出目录被“复活”。
- **原因**：null 表示“不落盘”被误当作“未指定”；默认目录解析逻辑在 cli 与 runner 重复实现。
- **建议**：以 `undefined` 表示缺省、`null` 显式禁用，删除重复的默认值解析。

### P1-2 `gate: off` 指标仍计入总分与层级分
- **位置**：[report.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/report.ts) L62、L100-L104；对比 metrics/thresholds.yaml L64-L68（`process_iteration_efficiency` 声明 `gate: off`）
- **描述**：`aggregate` 注释称“全部启用（gate != off）指标加权”，实现却遍历全部有数据指标，off 指标（weight 0.15）仍贡献 overallScore 与 process 层分。文档与实现不一致。
- **建议**：聚合与层级分计算时跳过 `def.gate === 'off'`，并补测试锁定。

### P1-3 空数据集静默全绿
- **位置**：[dataset-loader.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/dataset-loader.ts) L176-L214；[runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/runner.ts) L212；[cli.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/cli.ts) L136-L147
- **描述**：cases 文件缺 `cases` 键/拼写错误、`sample.n: 0` 时数据集为空；aggregate 得 overallScore=0 但所有 gate 规则因无数据降级为 warning，`run` 命令 failures 为空返回 0——source 名打错也会得到“绿色”评测。
- **建议**：`buildDataset` 对空结果/非数组 `cases` 抛错；runDataset 对 0 用例直接失败退出。

### P1-4 重试无取消、无退避
- **位置**：[runner.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/runner.ts) L70-L78、L131-L145
- **描述**：`withTimeout` 只 reject 外层 Promise，底层 `run_sync`（真实 LLM 调用）继续执行；随后重试立即发起，形成两次并行重复执行，超时用例 token 成本翻倍且无 AbortSignal 可取消。
- **建议**：executor 支持 AbortSignal 取消，重试加指数退避。

## P2 级问题

### P2-1 非法 category/source 被静默纠正
- **位置**：[dataset-loader.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/dataset-loader.ts) L95-L96
- **描述**：非法 `category` 静默降为 `core`、`source` 降为 `human`，污染 perCategory 统计与 release 门禁的回归统计（gate.ts L53-L55 依赖 category 准确）。
- **建议**：非法取值记 warning 或直接抛错。

### P2-2 单条坏用例炸掉整个数据集；错误信息带原文
- **位置**：[dataset-loader.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/dataset-loader.ts) L88-L91、L176-L178
- **描述**：`normalizeCase` 任何一条 throw 都会中断整个数据集构建；错误消息 `JSON.stringify(raw).slice(0,200)` 可能把用例敏感内容打进日志。
- **建议**：收集坏用例列表、跳过并汇总报告，日志只含 case id。

### P2-3 source 路径无约束、无大小上限
- **位置**：[dataset-loader.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/dataset-loader.ts) L174
- **描述**：`resolve(base, src.file)` 对绝对路径与 `../` 不校验，datasets.yaml 可引用包外任意文件当用例载入；`loadYaml` 全量读入（config-loader.ts L77），无文件大小/用例条数限制，大文件 OOM 风险。
- **建议**：校验解析后路径须位于 base 内；加文件大小与用例数上限。

### P2-4 CI 日志可能被截断
- **位置**：[cli.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/cli.ts) L192-L198
- **描述**：`process.exit(code)` 在 stdout 为管道时可能截断尚未 flush 的输出。
- **建议**：改用 `process.exitCode = code` 让进程自然退出。

### P2-5 delta 回归规则缺 baseline 时静默失效
- **位置**：[gate.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/gate.ts) L43-L45；[cli.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/cli.ts) L87
- **描述**：首次运行或无历史报告时 `report.delta` 为空，所有 delta 规则降级为 warning，回归检测形同虚设且无任何显式提示。
- **建议**：至少输出显著 warning，或提供 `require_baseline` 选项缺失即 block。

### P2-6 进化闭环断裂，函数名不副实
- **位置**：[evolution-bridge.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/evolution-bridge.ts) L103-L116；[cli.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/cli.ts) L91-L97
- **描述**：`feedEvolutionCollector` 实际只是 `[...getSignals(), ...signals]` 透传，从不写入 collector；CLI 也只 stdout 打印第 1 条信号，“评测→进化”链路未闭合。文件头注释宣称的 `evaluation_low_quality` 信号类型从未产出。
- **建议**：补真实注入路径或更名/删除，保持文档与实现一致。

### P2-7 gate 评估缺输入校验，on_failure 字段空转
- **位置**：[gate.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/gate.ts) L84；[types.ts](file:///Users/ybxue/Desktop/pioneering/packages/evals/src/types.ts) L163
- **描述**：`evaluateGate` 不校验 reports 是否覆盖 `gateDef.datasets`，库调用方漏传数据集时规则静默不评估、结果假 pass；`on_failure.fail_fast/upload_report`、`triggers`、`notifications` 等字段解析后无任何消费点；`--quiet` 参数 usage 声明了但实现未使用。
- **建议**：校验 reports 覆盖；移除死字段或接入 CI 行为。

---

# 六、优先修复路线图建议

## 第一批（立即修复，约 1 周内）
1. **P0-1 sendMessage 并发双发竞态**（chatStore.ts L675/L942）——用户可稳定复现的消息丢失/重复
2. **P0-2 API Key 明文落 localStorage**（useAppStore.ts L43/L231-L240）——既有 secureKeys 体系未闭环
3. **P1-3 FILE_WRITE TOCTOU**（ipc-handlers.ts L143-L186/L443）——可复现的越权写
4. **P1-2/P2-1 上传内存放大**（upload-store.ts L61-L68）——单次操作即可 OOM
5. **P1-4 Agent abort 失效 + activeRuns 泄漏**（agent-runtime.ts L254-L298）——长时间使用必现
6. **P1-6 启动静默死亡**（main/index.ts L128-L159）——影响所有用户的故障可观测性

## 第二批（重要，2-4 周）
1. **P1-1 depends_on/task_id 不匹配**（supervisor.ts L163-L178/L321）——LLM 拆分在带依赖场景下图静默空转
2. **P1-3 改参批准后 INVALID_TOOL_RESULTS**（nodes.ts L1982-L1994）——批准即崩
3. **P1-1 EventBus 域索引覆盖全局订阅者**（message-bus.ts L98-L102）——事件静默丢失
4. **P1-2 file-ops/doc-writer 中间目录软链逃逸**（file-ops.ts L169-L175）
5. **SQLite 主进程阻塞**（local-store.ts 全线）——影响所有用户的基础体验
6. **evals 三连：`--no-save` 失效 / gate:off 污染总分 / 空数据集全绿**——CI 结论失真

## 第三批（质量债，持续迭代）
- 重试层数相乘与全局预算（graph/adapters/retry.ts）
- Checkpoint 无界膨胀（graph/state.ts append reducers）
- MCP/Skill 信任边界加固（allowlist + manifest 签名）
- CodeExecutorTool 词法剥离 + 独占临时文件
- Trace 快照增量 diff、atomFamily 清理
- logger 工厂抽取与 `any[]` 结构化治理

## 全批共性建议
- **错误处理范式统一**：`normalizeFileError` 已有正确范式，应扩展到 DB 错误（ipc-handlers L675-L811）与 dialog 路径，这是最低成本的补齐点
- **魔法数收敛**：graph 层与 evals 层的硬编码阈值统一进配置管理
- **契约单点化**：shared/types ↔ preload/index.d.ts ↔ transport 三处类型漂移需以 shared/types 为唯一事实来源
