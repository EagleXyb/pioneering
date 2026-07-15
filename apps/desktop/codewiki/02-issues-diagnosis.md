# 02 · 问题诊断

> 维度：代码规范 · 潜在 Bug · 性能瓶颈 · 安全隐患 · 可维护性

## 1. 安全隐患

### S1【高危】`isTrustedSender` 正则可被 `localhost.evil.com` 绕过

- 文件：`src/main/ipc-handlers.ts:73`
- 现状：

```ts
/^https?:\/\/localhost(:\d+)?\b/i.test(url)
```

- 问题：`\b` 对 `http://localhost.evil.com` 命中（`.` 是非单词字符），正则匹配成功。攻击者注册 `localhost.evil.com` 即可绕过信任源校验。
- 影响：所有依赖 `isTrustedSender` 的 IPC 通道均可被绕过。

### S2【高危】CSP `connect-src` 允许任意 `wss:`

- 文件：`src/main/index.ts:23`
- 现状：

```
connect-src 'self' http://localhost:6000 ws://localhost:* wss:
```

- 问题：`wss:` 无主机限定，渲染端被 XSS 后可通过 `wss://attacker.com` 外泄数据。

### S3【中危】`setWindowOpenHandler` 未校验 URL 协议

- 文件：`src/main/index.ts:85-88`
- 现状：

```ts
mainWindow.webContents.setWindowOpenHandler((details) => {
  shell.openExternal(details.url)  // 未校验协议
  return { action: 'deny' }
})
```

- 问题：与 `SHELL_OPEN_EXTERNAL`（仅允许 http(s)）不一致，`file://`/`javascript:`/`data:` 都会传给 `shell.openExternal`。

### S4【中危】`isPathAllowed` 在 `realpathSync` 失败时回退到未解析路径

- 文件：`src/main/ipc-handlers.ts:86-91`
- 问题：写操作时若 `~/Documents/evil` 是指向 `/etc/` 的符号链接，`realpathSync` 解析到 evil 级失败，回退前缀校验仍认为合法，实际写入 `/etc/payload`。

### S5【中危】Token 仅内存存储，无持久化

- 文件：`src/renderer/src/services/api/client.ts:18-19,117-119`
- 问题：`onTokensChange` 回调机制存在但在所读文件中未见注册，刷新页面即登出。

### S6【低危】`isTrustedSender` 拒绝 `127.0.0.1`

- 文件：`src/main/ipc-handlers.ts:73`
- 问题：正则仅匹配 `localhost`，开发服务器若绑定 `127.0.0.1` 则所有 IPC 调用被判定不可信，功能大面积失效。

### S7【低危】`logout` 未通知后端失效 token

- 文件：`src/renderer/src/services/api/auth.ts:53-55`
- 问题：仅前端 `clearTokens()`，未调用后端撤销端点。若 token 在别处被截获，仍可在有效期内使用。

### S8【低危】`webUtils.getPathForFile` 包装无 try/catch

- 文件：`src/preload/index.ts:107`
- 问题：若 `file` 不合法或底层抛错，异常会冒泡到渲染端。`index.d.ts:5` 声明返回 `string | null`，但实现并不会返回 `null`，类型与行为不一致。

## 2. 潜在 Bug

### B1【高】连续发送导致孤儿空气泡消息

- 文件：`src/renderer/src/stores/chatStore.ts:198-200`
- 现状：

```ts
if (abortController) { abortController.abort() }
```

- 问题：`streamAgui` 对 `AbortError` 静默忽略（`agui.ts:238`），不触发 `onDone`/`onError`。旧 `assistantPlaceholder`（空 content）留在消息列表中无法清理。快速连发时聊天界面出现多个空气泡。

### B2【中】删除正在流式的会话未中止流

- 文件：`src/renderer/src/stores/chatStore.ts:539-557`
- 问题：`deleteSession` 不 abort 当前流，后台流继续运行浪费资源，后端持续生成。

### B3【高】`ApiConnectionSection` 测试前就 `setBaseURL`

- 文件：`src/renderer/src/components/settings/sections/ApiConnectionSection.tsx:18`
- 问题：用户输入 URL 点「测试」，即使测试失败，`apiClient` 的 baseURL 已被污染，后续所有 API 全部失败。

### B4【中】macOS 窗口重建后菜单引用已销毁窗口

- 文件：`src/main/menu.ts:22-24`
- 问题：`buildAppMenu(mainWindow)` 闭包持有首窗口引用，`activate` 重建窗口后菜单仍引用旧窗口，`win ?? ...` 中 `win` 非 null 不触发 fallback，`target.webContents.send` 在已销毁 webContents 上抛错。

### B5【中】`FILE_WRITE` 大小校验单位错误

- 文件：`src/main/ipc-handlers.ts:303`
- 现状：

```ts
if (req.content.length > MAX_FILE_BYTES)  // length 是 UTF-16 代码单元数
```

- 问题：与 `MAX_FILE_BYTES = 10 * 1024 * 1024`（字节数）单位不一致。多字节字符实际字节数可达 `length * 4`，突破上限。`FILE_READ`（行 276）用 `stat().size` 是字节，二者不一致。

### B6【中】`STORE_SET` 在 `sanitizeValue` 失败时仍返回 `true`

- 文件：`src/main/ipc-handlers.ts:362-366`
- 问题：`sanitizeValue` JSON 往返失败返回 `undefined`，但仍 `appStore.set(key, undefined)` 并返回 `true`，渲染端误以为写入成功。

### B7【中】`Cmd+K` 死快捷键

- 文件：`src/renderer/src/hooks/useKeyboardShortcuts.ts:30`
- 问题：派发 `global-search` CustomEvent，但无组件监听。

### B8【中】自动滚动无「用户是否在底部」判断

- 文件：`src/renderer/src/components/chat/ChatArea.tsx:42-50`
- 问题：流式期间每次 token 都强制拉回底部，破坏用户向上回看历史的体验。

### B9【中】删除会话无确认弹窗

- 文件：`src/renderer/src/components/sidebar/ConversationList.tsx:51-54`
- 问题：点击垃圾桶图标直接删除，误触风险高。

### B10【低】草稿在 blur 后可能丢失

- 文件：`src/renderer/src/hooks/use-input-draft-persistence.ts:95`
- 问题：debounced save 仅在输入框聚焦时才写入，blur 后 `isFocused()` 返回 false 跳过保存。

### B11【低】`stopGeneration` 端点字段命名不一致

- 文件：`src/renderer/src/services/api/chat.ts:120` vs `src/renderer/src/services/api/agent.ts:54`

```ts
// chat: { sessionId }        (camelCase)
// agent: { session_id: ... } (snake_case)
```

### B12【低】`formatAccelerator` 对 `+` 键或非字母键输出异常

- 文件：`src/renderer/src/menu/formatAccelerator.ts:14`
- 问题：`'CmdOrCtrl++'.split('+').pop()!` 得到空字符串；未处理 Alt/Enter/Escape 等。

### B13【低】拖拽状态在窗口关闭时不清理

- 文件：`src/main/ipc-handlers.ts:384-385`
- 问题：`dragStates` / `dragTargets` 以 `webContents.id` 为 key，但仅在 `WINDOW_DRAG_END` 时清理。若用户在拖拽中关闭窗口，对应 entry 永不释放。

## 3. 性能瓶颈

### P1【高】聊天消息列表无虚拟化

- 文件：`src/renderer/src/components/chat/MessageList.tsx:34-50`
- 问题：直接 `.map()` 渲染所有消息，每条 `MessageBubble` 还跑 `ReactMarkdown + rehypeHighlight + rehypeSanitize`。长会话 DOM 膨胀，渲染成本高。项目已用 `@tanstack/react-virtual`（见 ConversationList），应复用。

### P2【高】`ConversationList` 整 store 解构

- 文件：`src/renderer/src/components/sidebar/ConversationList.tsx:29`
- 现状：

```ts
const { sessions, currentSessionId, ... } = useChatStore()
```

- 问题：订阅整个 store，流式 `streamingContent` 高频更新时 ConversationList 全量重渲染。与 `ChatArea` 的逐项订阅形成对比，是性能反模式。

### P3【中】`messages` 数组引用不稳定

- 文件：`src/renderer/src/components/chat/ChatArea.tsx:34`
- 问题：`messages[currentSessionId] || []` 每次渲染可能产生新数组引用，导致 `MessageList` 全量重渲染。`MessageList` 也未 `memo`。

### P4【中】消息缓存无淘汰策略

- 文件：`src/renderer/src/stores/chatStore.ts:27`
- 问题：`messages: Record<string, Message[]>` 缓存所有已加载会话的完整消息，无 LRU、无上限。长时间使用内存持续增长。

### P5【中】`WINDOW_DRAG_MOVE` 高频 IPC

- 文件：`src/main/ipc-handlers.ts:400-412` + `src/renderer/src/layouts/TitleBar.tsx:97-98`
- 问题：每个 mousemove 触发一次 `setPosition`。虽然渲染端 `ipc.ts` 已用 rAF 合并，但 `TitleBar` 全局 `mousemove`/`mouseup` 监听即使非拖拽中也持续触发回调。

### P6【低】`sanitizeValue` 对大对象开销大

- 文件：`src/main/ipc-handlers.ts:101-107`
- 问题：每次 `STORE_SET/GET` 都 `JSON.parse(JSON.stringify(value))`。若 store 存大对象（如聊天历史），开销显著。

## 4. 代码规范问题

### C1【中】`useAgentStore` 与 `AgentPage` 是死代码

- 文件：`src/renderer/src/stores/useAgentStore.ts` + `src/renderer/src/pages/AgentPage.tsx:20-33`
- 问题：`AgentPage` 用 `setTimeout` + 硬编码步骤模拟执行，与真实 `agentService` 完全脱节；`useAgentStore` 的方法从未被真实 API 调用。容易让维护者误以为 Agent 功能已实现。

### C2【中】状态管理两库边界清晰但不统一

- `settingsCategoryAtom` 用 Jotai `atomWithStorage`，`theme` 用 Zustand `persist`——持久化机制两套并存，增加心智负担。`userAtom` 是硬编码占位 `{ name: 'Demo User', email: 'demo@pioneering.ai' }`，未接入 `authService.getProfile()`。

### C3【中】DiffViewer/TerminalView 是 mock

- 文件：`src/renderer/src/components/context-panel/DiffViewer.tsx:24,47` + `src/renderer/src/components/context-panel/TerminalView.tsx`
- 问题：DiffViewer 第 1 行硬编码 `bg-green-500/10` 当作「added」演示，无真实 diff 逻辑；TerminalView 是纯静态 UI，无 PTY/输入/输出流。

### C4【中】`InputArea` 菜单项文案/图标/行为不一致

- 文件：`src/renderer/src/components/chat/input/InputArea.tsx:159-205`
- 问题：
  - 「上传文件」与「上传图片」都调用同一个 `onAttachFile()`，无类型过滤
  - 「连接」菜单项图标是 `HelpCircle`、行为是打开文件对话框，三者不符
  - 「技能」菜单项插入 `/agent`，但 BUILTIN_SLASH_COMMANDS 里 `/agent` 描述是「切换 Agent 模式」

### C5【低】多处 dead code

- `src/renderer/src/components/chat/input/ContextRing.tsx` 定义但未使用
- `src/renderer/src/platform/usePanelToggle.ts:37-41` `toggleSidebar`/`toggleContext` 导出但未使用
- `src/renderer/src/components/chat/input/FileAwareEditor.tsx:305` `<span data-focused={focused} className="hidden" />` 父组件未读
- `src/renderer/src/components/settings/sections/AppearanceSection.tsx:31` `cn(theme === value ? '' : '')` 三元两分支都为空字符串
- `src/renderer/src/lib/input/select-file-tags.ts:76-77` `...(payload ? {} : {})` 无效果

### C6【低】`sendMessage` 函数过长

- 文件：`src/renderer/src/stores/chatStore.ts:193-478`
- 问题：单函数约 285 行，含 6 个回调闭包，`scheduleUpdate` 嵌套在内部。可拆分为独立函数或类。

### C7【低】硬编码中文字符串用于逻辑判断

- 文件：`src/renderer/src/stores/chatStore.ts:291`
- 现状：

```ts
model: model && model !== '自定义' ? model : undefined
```

- 问题：'自定义' 作为模型选择 UI 的特殊标记硬编码在业务逻辑中，与 UI 层强耦合。

### C8【低】版本号 `v0.1.0` 硬编码两处

- 文件：`src/renderer/src/components/settings/sections/AboutSection.tsx:9` + `src/renderer/src/components/sidebar/Sidebar.tsx:136`
- 问题：应从 package.json 或 IPC `getVersion()` 获取。

### C9【低】UI 组件别名不统一

- 文件：`src/renderer/src/components/ui/button.tsx:4` 用 `@renderer/lib/utils`，而 `dialog.tsx:4` 用 `@/lib/utils`，两个别名都指向同一目录但风格不一致。

### C10【低】`DevTools` API 生产环境暴露

- 文件：`src/preload/index.ts:16` + `src/main/ipc-handlers.ts:168-171`
- 问题：生产构建下渲染端可随意开关 DevTools。

## 5. 可维护性问题

### M1【中】可访问性普遍缺失

- `src/renderer/src/components/sidebar/ConversationList.tsx:138-155` + `src/renderer/src/components/sidebar/FileTree.tsx:42-68`：`<div onClick>` 非 `<button>`/`role="button"`，键盘不可达
- `src/renderer/src/layouts/TitleBar.tsx:43-64`：窗口控制按钮只有 `title` 无 `aria-label`，`isMaximized` 未暴露 `aria-pressed`
- `src/renderer/src/components/layout/Drawer.tsx:40-54`：`<aside>` 缺 `role="dialog"`/`aria-label`，无 focus trap

### M2【低】主题切换两套 UI

- `AppearanceSection.tsx` + `Sidebar.tsx:90-114` 重复实现，都改 `useAppStore.theme`。

### M3【低】`appStore` 注释承诺持久化但未实现

- 文件：`src/main/ipc-handlers.ts:30`
- 现状：`// 简单的内存 Store（可替换为 electron-store）`。重启即丢失，与 `STORE_*` 命名暗示的"持久化"语义不符。

### M4【低】`selectSession` 不 await `loadMessages`

- 文件：`src/renderer/src/stores/chatStore.ts:168-174`
- 问题：调用方无法感知加载结果，`loadMessages` 失败时 error 写入 state 但 `selectSession` 不返回 Promise。

### M5【低】`ApiConnectionSection`/`AuthSection` 状态不持久化/不响应外部变化

- `ApiConnectionSection.tsx:11-14`：`apiBaseUrl` 修改后不持久化
- `AuthSection.tsx:10-14`：`isAuthenticated` 仅挂载时取一次值，外部 logout 不更新

## 6. 已采用的优秀实践

值得保留的安全与架构亮点：

1. **安全基线扎实**：`sandbox: true` + `contextIsolation: true` + `nodeIntegration: false`
2. **XSS 防护纵深**：自定义 sanitize schema + SafeLink + 图片 mediaType 校验
3. **流式竞态处理**：`streamSeq` 单调递增守卫 + rAF 批量更新 + single-flight token 刷新
4. **平台差异 CSS 变量化**：`layout-tokens.css` 把所有平台硬编码下沉到语义变量
5. **菜单系统数据驱动**：`menu-template.ts` 单一数据源
6. **IME 正确处理**：`isComposing` 判断
7. **ResizablePanel 按平台记忆**：`autoSaveId` 含 platform 后缀
8. **TypeScript 严格模式**：`strict: true` + `noUncheckedIndexedAccess: true`
9. **preload 不暴露整包 `electronAPI`**：仅 `webUtils.getPathForFile`
10. **`contextIsolation` 未启用时直接抛错终止**
