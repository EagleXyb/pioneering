# 03 · 改进建议

> 针对 [02-issues-diagnosis.md](./02-issues-diagnosis.md) 中所列问题，提供具体、可操作的优化方向。按优先级分级。

## 1. 安全改进

| 优先级 | 问题 | 建议 |
|--------|------|------|
| P0 | S1 正则绕过 | 改为 `^https?:\/\/localhost(:\d+)?(?:\/\|$)` 或 `^https?:\/\/localhost(:\d+)?$/`；同时加入 `127\.0\.0\.1` 与 `\[::1\]`（顺带解决 S6） |
| P0 | S2 CSP `wss:` 过宽 | 移除 `wss:` 或限定为 `wss://具体主机` |
| P0 | S3 `setWindowOpenHandler` 未校验协议 | 复用 `SHELL_OPEN_EXTERNAL` 的 http(s) 白名单，非白名单直接 `return { action: 'deny' }` |
| P1 | S4 符号链接绕过 | 写操作路径对所有父目录逐级 `realpathSync` 校验 |
| P1 | S5 Token 不持久化 | 通过 `storeApi`（Electron secure storage）注册 `onTokensChange` 回调持久化 token |
| P2 | S7 logout 未通知后端 | 增加 `POST /auth/logout` 调用撤销后端 token |
| P2 | S8 getPathForFile 无 try/catch | 包装 try/catch 并返回 `null`，与类型声明对齐 |

**S1 修复示例**（`src/main/ipc-handlers.ts:73`）：

```ts
function isTrustedSender(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): boolean {
  const url = event.senderFrame.url
  return (
    url.startsWith('file://') ||
    url.startsWith('app://') ||
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(?:\/|$)/i.test(url)
  )
}
```

## 2. Bug 修复

| 优先级 | 问题 | 建议 |
|--------|------|------|
| P0 | B1 孤儿空气泡 | `sendMessage` 开头 abort 旧流时，主动移除旧的空 `assistantPlaceholder`；或在 `onError`/abort 时清理空 content 的占位消息 |
| P0 | B3 ApiConnectionSection 测试前 setBaseURL | 先用临时变量发起 health check，成功后再 `apiClient.setBaseURL()` |
| P1 | B2 删除流式中会话未 abort | `deleteSession` 内若 `sessionId === currentSessionId && isStreaming`，先调用 `stopStreaming()` |
| P1 | B4 macOS 菜单引用旧窗口 | `runAction` 内 `if (win?.isDestroyed())` 改用 `BrowserWindow.getFocusedWindow()`；或在 `activate` 重建窗口后重新 `Menu.setApplicationMenu` |
| P1 | B5 FILE_WRITE 大小校验 | 改用 `Buffer.byteLength(req.content, 'utf-8')` |
| P1 | B6 STORE_SET sanitize 失败 | `sanitizeValue` 失败时返回 `false` 或抛错，不写入 `undefined` |
| P2 | B7 Cmd+K 死快捷键 | 实现 `global-search` 监听器，或移除该快捷键绑定 |
| P2 | B8 自动滚动破坏回看 | 增加 `isNearBottom` 判断（如 `scrollHeight - scrollTop - clientHeight < threshold`），仅当用户在底部附近才自动滚动 |
| P2 | B9 删除会话无确认 | 包一层确认 Dialog，或用 `window.confirm`（轻量方案） |
| P3 | B10 草稿 blur 丢失 | 移除 `isFocused()` 守卫，或 blur 时立即 flush 一次 |
| P3 | B11 字段命名不一致 | 与后端统一为 camelCase 或 snake_case |
| P3 | B12 formatAccelerator 边界 | 用 `accel.split('+')` 后对末段做 key map（Enter→⏎、Escape→⎋），处理 `+` 键转义 |
| P3 | B13 拖拽状态泄漏 | 监听窗口 `closed` 事件清理 `dragStates`/`dragTargets` |

**B1 修复示例**（`src/renderer/src/stores/chatStore.ts:198-200`）：

```ts
// abort 旧流前，清理空占位消息
if (abortController) {
  abortController.abort()
  // 移除上一个未完成的 assistant 占位
  if (currentSessionId && messages[currentSessionId]) {
    const msgs = messages[currentSessionId]
    const last = msgs[msgs.length - 1]
    if (last?.role === 'assistant' && !last.content && !last.streamingContent) {
      set({
        messages: {
          ...messages,
          [currentSessionId]: msgs.slice(0, -1)
        }
      })
    }
  }
}
```

**B3 修复示例**（`ApiConnectionSection.tsx:18`）：

```ts
const checkApiHealth = async () => {
  setApiStatus('loading')
  const testUrl = apiBaseUrl.replace(/\/$/, '') + '/api/v1/ping'
  try {
    await fetch(testUrl, { method: 'GET', signal: AbortSignal.timeout(5000) })
    // 测试成功后再 setBaseURL
    apiClient.setBaseURL(apiBaseUrl + '/api/v1')
    setApiStatus('ok')
  } catch (err) {
    setApiStatus('error')
    // 不污染 apiClient.baseURL
  }
}
```

## 3. 性能优化

| 优先级 | 问题 | 建议 |
|--------|------|------|
| P0 | P1 消息列表无虚拟化 | 用 `@tanstack/react-virtual`（项目已引入）实现 `MessageList` 虚拟化；注意 `MessageBubble` 高度动态，需 `measureElement` |
| P0 | P2 ConversationList 整 store 解构 | 改为逐项订阅：`useChatStore((s) => s.sessions)`、`useChatStore((s) => s.currentSessionId)` 等 |
| P1 | P3 messages 引用不稳定 | `ChatArea` 用 `useMemo` 稳定 `currentMessages`；或 store 内用结构共享保证引用稳定 |
| P1 | P3 MessageList 未 memo | `export default memo(MessageList)` |
| P2 | P4 消息缓存无淘汰 | 引入 LRU（如最多缓存 N 个会话），超出时淘汰最久未访问的会话消息 |
| P2 | P5 拖拽全局监听 | `TitleBar` 在 `startDrag` 时 `addEventListener`，`endDrag` 时 `removeEventListener` |
| P3 | P6 sanitizeValue 开销 | 对小对象保持现状；对大对象改用结构化克隆 + 原型重置 |

**P2 ConversationList 修复示例**（`src/renderer/src/components/sidebar/ConversationList.tsx:29`）：

```ts
// 改前
const { sessions, currentSessionId, deleteSession, selectSession } = useChatStore()

// 改后
const sessions = useChatStore((s) => s.sessions)
const currentSessionId = useChatStore((s) => s.currentSessionId)
const deleteSession = useChatStore((s) => s.deleteSession)
const selectSession = useChatStore((s) => s.selectSession)
```

## 4. 架构与可维护性

| 优先级 | 问题 | 建议 |
|--------|------|------|
| P1 | C1 useAgentStore 死代码 | 移除 `useAgentStore`，或将其与 `chatStore` 的 agentMode 逻辑统一；`AgentPage` 接入真实 `agentService` 或明确标注 TODO |
| P1 | C4 InputArea 菜单项不一致 | 区分「上传文件」与「上传图片」（后者 `accept="image/*"`）；移除/重命名「连接」菜单项；「技能」文案改为「切换 Agent 模式」 |
| P2 | C2 状态管理两库 | 明确边界：Jotai 仅管 UI 原子态，Zustand 管业务域；持久化统一用一套机制（推荐 Zustand `persist`）；接入 `authService.getProfile()` 填充 `userAtom` |
| P2 | C3 DiffViewer/TerminalView mock | 引入 `diff` 库实现真实 diff；TerminalView 接入 `node-pty`（主进程）+ IPC 流式传输；或明确标注 `// TODO:` 并加 issue 链接 |
| P2 | M1 可访问性 | 会话项/文件项改 `<button>` 或加 `role="button" tabIndex={0}` + `onKeyDown`；窗口按钮补 `aria-label`；Drawer 加 `role="dialog"` + focus trap |
| P3 | C5 dead code | 清理 ContextRing、toggleSidebar/toggleContext、data-focused span、`cn(theme === value ? '' : '')` 等 |
| P3 | C6 sendMessage 过长 | 拆分为 `scheduleUpdate`、`handleStreamCallbacks`、`finalizeStream` 等独立函数 |
| P3 | C7 '自定义' 硬编码 | 提取为 `const CUSTOM_MODEL_SENTINEL = '自定义'` 或枚举 |
| P3 | C8 版本号重复 | 从 `window.api.app.getVersion()` 获取，单一来源 |
| P3 | C9 别名不统一 | 统一为 `@/lib/utils`（shadcn/ui 惯例） |
| P3 | C10 DevTools 生产暴露 | 生产构建时移除该 API，或 handler 内加 `is.dev` 守卫 |
| P3 | M2 主题切换两套 UI | 保留设置面板为主，Sidebar 下拉菜单改为快捷切换（或反之） |
| P3 | M3 appStore 未持久化 | 接入 `electron-store`，或明确重命名为 `appMemoryStore` |
| P3 | M4 selectSession 不 await | 改为 `async` 并返回 Promise，调用方可显示 loading |

## 5. 修复优先级总览

```
P0 (立即)  ─ S1, S2, S3, B1, B3
P1 (短期)  ─ S4, S5, B2, B4, B5, B6, P1, P2, P3, C1, C4
P2 (中期)  ─ S7, B7, B8, B9, P4, P5, C2, C3, M1
P3 (长期)  ─ S8, B10, B11, B12, B13, P6, C5-C10, M2-M5
```

## 6. 值得保留的亮点

改进过程中应保留以下已有实践：

1. **安全基线**：sandbox + contextIsolation + nodeIntegration:false + CSP + 信任源校验 + 路径白名单 + 原型链净化 + 错误脱敏
2. **XSS 防护纵深**：自定义 sanitize schema + SafeLink + 图片 mediaType 校验
3. **流式竞态处理**：`streamSeq` 单调递增守卫 + rAF 批量更新 + single-flight token 刷新
4. **平台差异 CSS 变量化**：`layout-tokens.css` 把所有平台硬编码下沉到语义变量
5. **菜单系统数据驱动**：`menu-template.ts` 单一数据源
6. **IME 正确处理**：`isComposing` 判断
7. **ResizablePanel 按平台记忆**：`autoSaveId` 含 platform 后缀
8. **TypeScript 严格模式**：`strict: true` + `noUncheckedIndexedAccess: true`
