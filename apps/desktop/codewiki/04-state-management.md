# 04 · 状态管理

桌面端采用 **Zustand（全局 store）+ Jotai（细粒度 atom）** 双轨方案。

- Zustand：承载业务实体与会话状态，便于跨组件订阅、批量更新、持久化。
- Jotai：承载 UI 局部状态、派生状态、跨组件轻量联动（如面板显隐、artifact 高亮）。

## 1. Zustand Stores（`stores/`）

### 1.1 `useAppStore.ts`
应用级全局设置与 UI 状态。
- 主题（亮/暗/跟随系统）
- 语言
- 设置项（由 `settingsConfig` 驱动）
- 全局加载态等

### 1.2 `useWorkspaceStore.ts`
工作区状态。
- 当前工作区信息
- 工作区列表

### 1.3 `chatStore.ts`（核心）
会话与消息状态，是渲染层最大的 store。

**State 形态（关键字段）**
```ts
{
  sessions: Session[]              // 全部会话
  currentSessionId: string | null  // 当前会话
  // 当前会话派生：currentSession = sessions.find(currentSessionId)
}
```

**主要 actions**
| Action | 职责 |
| --- | --- |
| `createSession` | 新建会话 |
| `selectSession` | 切换当前会话 |
| `renameSession` | 重命名（支持行内重命名） |
| `deleteSession` | 删除会话 |
| `sendMessage` | 发送消息：乐观追加 user + assistant 占位，触发 API + SSE |
| `appendToken` | 流式追加文本 token |
| `appendThinking` | 流式追加思考内容 |
| `updateToolCall` | 更新工具调用状态（start/end） |
| `updateTrace` | 更新 trace 节点树 |
| `finalizeMessage` | 流式结束，固化 assistant 消息 |
| `regenerateMessage` | 重新生成指定消息 |
| `toggleMessageFeedback` | 点赞/点踩切换 |
| `stopStreaming` | 中止当前流式 |

**流式字段**：流式期间 assistant 占位消息携带 `streamingContent` / `streamingThinking` / `streamingToolCalls` / `streamingTraceNodes` / `streamingTraceRootOrder`，`MessageBubble` 据此实时渲染。

### 1.4 `authStore.ts`
鉴权状态。
- `token` / `user` / `isAuthenticated`
- 登录/登出/刷新 token
- 由 `useAuthBootstrap` 在应用启动时初始化

### 1.5 `artifactStore.ts`
Artifact 预览状态（部分以 Jotai atom 形式导出，见下）。

### 1.6 `lightboxStore.ts`
图片放大查看（Lightbox）状态。

### 1.7 `traceAtoms.ts`
trace 相关派生 atom（如统计、状态聚合），供 `AgentTimeline` 等消费。

## 2. Jotai Atoms（`atoms/` 与 store 内导出）

| Atom | 类型 | 职责 |
| --- | --- | --- |
| `contextPanelVisibleAtom` | boolean | 上下文面板显隐 |
| `activeArtifactAtom` | Artifact \| null | 当前预览的 artifact |
| `openArtifactAtom` | 写 atom | 打开 artifact 预览 |
| `closeArtifactAtom` | 写 atom | 关闭预览 |
| `highlightMessageAtom` | 写 atom | 高亮源消息（artifact 回溯） |
| `highlightMessageIdAtom` | string \| null | 当前需高亮跳转的消息 id |
| `clearHighlightAtom` | 写 atom | 清除高亮 |
| `openLightboxAtom` | 写 atom | 打开图片 Lightbox |

## 3. 状态持久化与同步

- 会话历史：通过 `chatStore` 维护；如需落盘走 IPC（`fileApi`）写本地文件（具体持久化策略以代码实现为准）。
- 鉴权 token：`authStore` + `useAuthBootstrap`，启动时从本地恢复。
- 跨组件联动优先用 Jotai atom，避免 prop drilling。

## 4. 订阅模式

- 组件用 `useChatStore((s) => s.xxx)` 精确订阅，避免全量重渲染。
- 派生数据用 `useMemo` 或 Jotai 派生 atom。
- `MessageBubble` 使用 `memo` + 流式 props，减少重渲染。
