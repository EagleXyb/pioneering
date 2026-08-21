# HITL 人机协同 UI 交互实现分析

> 本文档基于对 `apps/desktop` 代码库的深度阅读，分析如何在桌面端实现 Human-in-the-Loop（人机协同）的 UI 交互，参考目标样式为：底部极简输入框（澄清追问）与居中模态弹窗（选项确认）。

---

## 一、现状摸底（深度阅读后的关键发现）

### 1. apps/desktop 现有技术栈

| 维度 | 现状 |
|---|---|
| 框架 | Electron 39 + React 19 + electron-vite 4 |
| UI 体系 | shadcn/ui (new-york) + Radix UI + Tailwind 4 + lucide-react |
| 状态 | Zustand (`useChatStore`) + Jotai (`atoms`, `confirmDialogAtom`) |
| 路由 | React Router 7 |
| 通信 | 主进程 vite 代理 `20040`，前端 fetch + SSE |
| 输入框 | `components/chat/input/InputArea.tsx`（已实现"Pro"形态） |

### 2. 已具备的"积木"（不需要重新造）

- `InputArea.tsx` 已经是底部固定式输入卡，视觉结构（`pro-input-card` 20px 圆角、focus-within 蓝色描边、+ 号 + 向上箭头）已与目标样式一致——**只需新增 `mode="hitl"` 即可降级**为极简澄清追问样式。
- `components/ui/dialog.tsx`（Radix Dialog）+ `radio-group.tsx`（Radix RadioGroup）+ `input.tsx` + `button.tsx` 已全部就绪，**可直接拼出居中模态弹窗**。
- 全局确认弹窗范式（`confirmDialogAtom` + `ConfirmDialog`）已经验证过"原子 + Portal"的模式，HITL 弹窗可以照此风格新建。

### 3. 后端 HITL 能力盘点

后端实际为 `apps/backend-ts`（Fastify + TypeScript，对应 Python 版 `apps/backend`）。Agent 流式链路通过 `@pioneering/modu-agent`（即 `packages/modu-agent`）的 LangGraph 引擎驱动。

| 模块 | 现状 |
|---|---|
| `packages/modu-agent/src/orchestration/nodes/human_review.ts` | 已有 `human_review_node` + LangGraph `interrupt()` |
| `packages/modu-agent/src/core/tools/base.ts` | `BaseTool.requiresApprovalFor()` 已实现 |
| `packages/modu-agent/src/orchestration/communication/agui-adapter.ts` | `AGUIStreamAdapter` + `AGUIEventType`，但**没有** "等待用户输入" 事件 |
| `apps/backend-ts/src/core/agent-bridge.ts` | `streamAgentCompletion()` 已通过 `AGUIStreamAdapter.transform_langgraph_events` 转 AG-UI SSE——**是 HITL 真正应接入的层** |
| `apps/backend-ts/src/routes/agent.ts` | `/agent/completions` 已用 `agent-bridge` 流式输出 AG-UI 事件（含 `RUN_STARTED` / `RUN_FINISHED`） |
| `apps/backend-ts/src/routes/chat.ts` | `/chat/completions` 走的是裸 `llmService.streamAgui`（`core/llm.ts`），**未接通** ModuAgent 图，HITL 在此链路上**不生效** |

### 4. 关键缺口

1. **主链路没接通 HITL 透传**：`agent-bridge.ts` 的 `streamAgentCompletion` 目前仅透传 `RUN_*` / `THINKING_*` / `TOOL_CALL_*` 等事件，未拦截 LangGraph `interrupt()` 产生的 `human_review` 暂停点并转为前端可识别的事件。
2. **AG-UI 协议无"用户问题"事件**：`AGUIEventType` 中只有 `RUN_* / TEXT_MESSAGE_* / THINKING_* / TOOL_CALL_* / STATE_* / ARTIFACT_CREATED`，缺 `USER_INPUT_REQUEST` / `USER_CHOICE_REQUEST` / `TOOL_CONFIRM_REQUEST`。
3. **前端 `stream-handler.ts` 未识别** `USER_QUESTION_REQUEST`，只解析了既有 AG-UI 类型。
4. **没有"待回答"全局状态**：`chatStore` 只管消息流，没有"暂停点 / 恢复句柄"的概念。
5. **缺少 resume 端点**：`routes/agent.ts` 只有 `/agent/completions` 与 `/agent/completions/stop`，没有把用户答复回灌 LangGraph 的 `/agent/resume` 接口。

---

## 二、目标样式语义解读

| 样式 | 本质 | 命中场景 |
|---|---|---|
| **图1**：极简底部输入框（占位符"问大图..."、+ 附件、↑ 发送） | **Clarifying Question 澄清追问** | Agent 收到请求后，对**目标**或**关键参数**模糊——必须先让用户说清楚才能继续 |
| **图2**：居中 Modal（标题"你想设置什么类型的定时任务？"、5 个单选 + "其他"输入、跳过/确认） | **Multi-choice Question 选项确认** | Agent 已经识别出意图，但有**几个候选方案**需要用户拍板 |

两者合起来是 HITL 的**两大交互原语**：

- 自由文本回复（**图1** = `<ClarifyingInputPanel/>`）
- 预设选项选择（**图2** = `<HitlChoiceDialog/>`）
- 外加**第三类**：敏感工具审批（`Approve/Run` 已有 `ConfirmDialog` 风格，但需要升级为"显示工具名 + 参数"）

---

## 三、推荐实现方案

### 阶段 0：协议对齐（最关键，决定天花板）

#### 0.1 主链路接通

HITL 真正对接的是 `apps/backend-ts/src/core/agent-bridge.ts` 的 `streamAgentCompletion()`。当前它把 LangGraph 事件交给 `AGUIStreamAdapter.transform_langgraph_events` 后推送 SSE，但**未拦截 `interrupt()` 暂停点**。需要在 `AGUIStreamAdapter` 中识别 LangGraph 的 `interrupt` 事件（或 `human_review_node` 写回的占位状态），并额外发射一个自定义 SSE 行：

```ts
// apps/backend-ts/src/core/agent-bridge.ts（概念伪代码）
const agent = await getModuAgent(runtimeConfig)   // 复用现有 create_agent / graph 构建
const stream = agent.stream({ messages, thread_id: tid }, { streamMode: ['values', 'messages'] })
for await (const chunk of stream) {
  // LangGraph 进入中断点（human_review_node 调用了 interrupt()）
  if (chunk.__interrupt__ || isHumanReviewInterrupt(chunk)) {
    yield { type: 'USER_QUESTION_REQUEST', requestId: rid, threadId: tid, runId: rid, payload: chunk.value }
    continue
  }
  // 其余事件照旧经 AGUIStreamAdapter 转 AG-UI
  for (const ev of adapter.transform(chunk)) yield ev
}
```

> 注意：`agent-bridge.ts` 调用的是 `@pioneering/modu-agent` 导出的图（通过 `create_agent`/`getConfig` 构建），而不是 Python 端。所有图节点（含 `human_review_node`）都在 `packages/modu-agent` 内。

#### 0.2 扩展 `AGUIEventType`

在 `packages/modu-agent/src/orchestration/communication/agui-adapter.ts` 的 `AGUIEventType` 枚举末尾追加 4 个事件：

```ts
TOOL_CONFIRM_REQUEST: 'TOOL_CONFIRM_REQUEST'   // 敏感工具审批
USER_QUESTION_REQUEST: 'USER_QUESTION_REQUEST' // 澄清/多选问题
USER_INPUT_RESOLVED: 'USER_INPUT_RESOLVED'     // 前端已答复（用于后端确认）
RUN_PAUSED: 'RUN_PAUSED'                       // 中断锚点
```

并在 `AGUIStreamAdapter.transform_langgraph_events` 中增加 `interrupt` → `USER_QUESTION_REQUEST` 的映射分支。

#### 0.3 前端 `stream-handler.ts` 新增解析分支

```ts
if (parsed.type === 'USER_QUESTION_REQUEST') {
  hitlStore.enqueue({
    requestId: parsed.requestId,
    threadId: parsed.threadId,
    runId: parsed.runId,
    kind: parsed.kind,           // 'clarifying' | 'choice' | 'tool_confirm'
    payload: parsed.payload      // {question, options?, toolName?, toolArgs?}
  })
}
```

---

### 阶段 1：HITL 状态层

新建 `apps/desktop/src/renderer/src/stores/hitlStore.ts`（Zustand，平行于 `chatStore`）：

```ts
export type HitlKind = 'clarifying' | 'choice' | 'tool_confirm'
export interface HitlRequest {
  requestId: string
  threadId: string
  runId: string
  kind: HitlKind
  payload: {
    question: string
    options?: { value: string; label: string }[]
    toolName?: string
    toolArgs?: Record<string, unknown>
    placeholder?: string
  }
  enqueuedAt: number
}

interface HitlState {
  pending: HitlRequest[]
  current: HitlRequest | null       // 始终等于 pending[0]，简化渲染
  enqueue: (req: HitlRequest) => void
  resolve: (answer: unknown) => Promise<void>   // 调 POST /api/v1/agent/resume
  abort: () => Promise<void>                    // 用户主动取消
  skip: () => Promise<void>                     // 等价 resolve(null)
}
```

`resolve()` 内部：

```ts
await fetch('/agent/resume', {            // apps/backend-ts/src/routes/agent.ts 新增端点
  method: 'POST',
  body: JSON.stringify({
    threadId, runId,
    decision: { type: 'Command', resume: answer }   // langgraph 协议
  })
})
hitlStore.dequeue(requestId)
```

**为什么独立 store 而不是塞进 `chatStore`？**

- HITL 状态需要**跨页面**（设置页、登录页切回来仍能恢复）
- 需要**重连恢复**（SSE 中断后能根据 threadId/routeId 重新拉取待回答项）
- 需要**超时降级**（60s 不答自动 skip）

---

### 阶段 2：UI 组件层

#### 2.1 图1 — `<ClarifyingInputPanel/>`

新建 `apps/desktop/src/renderer/src/components/hitl/ClarifyingInputPanel.tsx`：

- 复用 `InputArea.tsx` 的 `.pro-input-card` 视觉，但**降级到 `mode="hitl"`**（去掉模型选择、麦克风、Agent 切换、状态行，只保留 + 附件 + ↑ 发送）
- 头部加一个"提问卡"小条：`问号 icon + 序号 "1/2" + Agent 的问题文本 + ×关闭`（×触发 `skip`）
- 输入框 placeholder 从 `问大图...` 改为 `hitlStore.current.payload.placeholder ?? '请补充...'`
- 提交时调 `hitlStore.resolve({ answer: text })`

在 `InputArea.tsx` 增加 `mode: 'full' | 'hitl' | 'minimal'` 即可，**不破坏现有体验**：

```tsx
{ mode === 'hitl' && (
  <div className="pro-input-hitl-header">
    <HelpCircle className="size-4 text-primary" />
    <span className="text-sm">{current.payload.question}</span>
    <button onClick={skip}><X className="size-4" /></button>
  </div>
)}
```

视觉对位（已与图1 一致，无需新增 CSS）：

- `rounded-2xl`、边框 `border-input`、`focus-within:border-primary`
- 左下角 `+`（`size-9 rounded-full hover:bg-accent`）
- 右下角 `↑`（`size-8 rounded-md bg-primary` 仅在有内容时显示）

#### 2.2 图2 — `<HitlChoiceDialog/>`

新建 `apps/desktop/src/renderer/src/components/hitl/HitlChoiceDialog.tsx`：

```tsx
<Dialog open={!!current && current.kind === 'choice'} onOpenChange={(o) => !o && skip()}>
  <DialogContent className="max-w-md gap-0 p-0">
    <DialogHeader className="px-6 py-4 border-b">
      <DialogTitle>{current?.payload.question}</DialogTitle>
    </DialogHeader>
    <RadioGroup
      value={selected}
      onValueChange={setSelected}
      className="px-6 py-2"
    >
      {options.map(o => (
        <div className="flex items-center gap-3 py-3 border-b last:border-0">
          <RadioGroupItem value={o.value} id={o.value} />
          <Label htmlFor={o.value} className="flex-1 cursor-pointer">{o.label}</Label>
        </div>
      ))}
      <div className="flex items-center gap-3 py-3">
        <RadioGroupItem value="__other__" id="__other__" />
        <Input
          value={customText}
          onChange={e => { setCustomText(e.target.value); setSelected('__other__') }}
          placeholder="请输入其他..."
          className="border-0 shadow-none focus-visible:ring-0 px-0"
        />
      </div>
    </RadioGroup>
    <DialogFooter className="px-6 py-4 border-t">
      <Button variant="ghost" onClick={skip}>跳过</Button>
      <Button onClick={confirm} disabled={!selected}>确认</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

#### 2.3 全局挂载点 — `<HitlHost/>`

新建 `apps/desktop/src/renderer/src/components/hitl/HitlHost.tsx`：

```tsx
export function HitlHost() {
  const current = useHitlStore(s => s.current)
  const dequeue = useHitlStore(s => s.dequeue)

  // 同时只显示一个；多任务排队时显示小气泡提示"还有 N 个待回答"
  return (
    <>
      <ClarifyingInputPanel />         {/* 监听 current?.kind === 'clarifying' */}
      <HitlChoiceDialog />             {/* 监听 current?.kind === 'choice' */}
      <ToolConfirmDialog />            {/* 监听 current?.kind === 'tool_confirm'，复用 ConfirmDialog 风格 */}
      <HitlQueueIndicator />           {/* 右上角徽标：还有 N 个待回答 */}
    </>
  )
}
```

在 `App.tsx` 根布局、`<RouterProvider>` 之内挂一次：

```tsx
<RouterProvider ...>
  <HitlHost />
</RouterProvider>
```

**关键约束**：`HitlHost` 必须放在 `<RouterProvider>` **内部**且独立于具体路由，这样切路由时弹窗不消失。

#### 2.4 ChatArea 中的"系统提问卡"（可选增强）

如果希望 HITL 提示也以**消息流形式**留在会话里（更符合"上下文"感），在 `ChatArea.tsx` 的消息列表 `messages.map(...)` 末尾插入一个特殊的 `<HitlMessageCard/>`，样式参考 `MessageBubble.tsx`（Assistant 角色），但**交互区**内嵌 `<ClarifyingInputPanel/>` 或触发 `<HitlChoiceDialog/>` 的按钮：

```tsx
{messages.map(m => <MessageBubble key={m.id} message={m} />)}
{hitlCardForCurrentRun && <HitlMessageCard request={hitlCardForCurrentRun} />}
```

---

### 阶段 3：交互细节（与目标样式一致）

| 元素 | 实现 |
|---|---|
| 图1 占位符"问大图..." | `placeholder` 由 `hitlStore.current?.payload?.placeholder` 决定 |
| 图1 圆角 + 描边 | 复用 `pro-input-card`（已有 `rounded-2xl border-input`） |
| 图1 ↑ 按钮 | 已有 `bg-primary text-primary-foreground`，仅在有内容时显示 |
| 图2 标题"你想设置什么类型的定时任务？" | `DialogTitle` 直接渲染 `payload.question` |
| 图2 × 关闭 | Radix 自带 `DialogClose`，绑定 `skip` |
| 图2 单选项 | `RadioGroup` + `Label`（hover `bg-accent/50`、checked 蓝点） |
| 图2 "请输入其他..." | 最后一项 RadioGroupItem + `<Input>` 无边框（嵌入 Radio 行内） |
| 图2 跳过/确认 | `DialogFooter` 右对齐 + 间距 `gap-2`，主按钮"确认" `disabled={!selected}` |
| 图2 高度 | `max-h-[60vh] overflow-y-auto`（选项多时滚动） |

---

### 阶段 4：边界与健壮性

| 场景 | 处理 |
|---|---|
| **超时未答** | `hitlStore` 入队时 setTimeout(60s) → 自动 `skip()` + 调后端 cancel |
| **用户主动取消** | 暴露 `abort()`，调用 `POST /agent/abort`（在 `apps/backend-ts/src/routes/agent.ts` 新增）+ 清空 `pending` |
| **SSE 断线** | 主进程 `electronApp` 的 `stream-handler.ts` 已有重连，HITL 端点 `/agent/state/:threadId` 可拉取待回答项恢复 |
| **同时多任务** | `pending` 队列；处理完一个再展示下一个；右上角徽标 `+N` |
| **历史会话回看** | `loadMessages` 时同步拉 `/agent/state/:threadId`，恢复未答项（如果后端允许） |
| **跨页面** | 切到设置页再回来，弹窗仍在（因为 `HitlHost` 在 Router 之内） |
| **审批类（图2 没有的）** | 第三类 `tool_confirm` 弹窗：标题"允许执行 {toolName} 吗？" + 折叠展示 `toolArgs` JSON + "拒绝/允许"按钮 |

---

## 四、关键决策点

| 决策 | 建议 | 理由 |
|---|---|---|
| 新建 `hitlStore` vs 塞进 `chatStore` | **新建** | 跨页面、跨 SSE 重连、独立超时机制 |
| 复用 `ConfirmDialog` | **不复用** | 它只支持 `title/message/buttons`，无法塞 RadioGroup/Input |
| 在 store 还是在组件 state | **store** | 见上 |
| AG-UI 新增自定义事件 | **新增** | 标准没有"等待用户"事件 |
| `agent-bridge.ts` 是否拦截 interrupt 透传 | **必须拦截** | 否则 HITL 永远无法触发 |
| `InputArea` 形态 | **加 `mode` 开关** | 不破坏现有"pro"体验，HITL 时降级为图1 |
| 是否进消息流 | **进** | 更符合"上下文"感，HITL 提示也是会话的一部分 |
| `app:1:78` 中 `agentMode` 切换 | 保留 | HITL 不影响 agentMode，只是输入区 UI 降级 |

---

## 五、文件清单（按优先级）

| 优先级 | 文件 | 类型 | 改动 |
|---|---|---|---|
| P0 | `apps/backend-ts/src/core/agent-bridge.ts` | 扩展 | `streamAgentCompletion` 拦截 LangGraph `interrupt()` 并透传 `USER_QUESTION_REQUEST` |
| P0 | `packages/modu-agent/src/orchestration/communication/agui-adapter.ts` | 扩展 | `AGUIEventType` 加 4 个事件 + `transform_langgraph_events` 加 interrupt 映射 |
| P0 | `apps/backend-ts/src/routes/agent.ts` | 加 3 个端点 | `/agent/resume`（回灌答复）、`/agent/abort`（取消）、`/agent/state/:threadId`（恢复） |
| P0 | `apps/desktop/src/renderer/src/services/stream-handler.ts` | 扩展 | 解析 `USER_QUESTION_REQUEST` |
| P1 | `apps/desktop/src/renderer/src/stores/hitlStore.ts` | 新建 | HITL 状态机 |
| P1 | `apps/desktop/src/renderer/src/components/hitl/HitlHost.tsx` | 新建 | 全局挂载点 |
| P1 | `apps/desktop/src/renderer/src/components/hitl/ClarifyingInputPanel.tsx` | 新建 | 图1 样式 |
| P1 | `apps/desktop/src/renderer/src/components/hitl/HitlChoiceDialog.tsx` | 新建 | 图2 样式 |
| P1 | `apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx` | 加 `mode` | 支持 `mode="hitl"` 降级 |
| P1 | `apps/desktop/src/renderer/src/App.tsx` | 加一行 | 嵌入 `<HitlHost/>` |
| P2 | `apps/desktop/src/renderer/src/components/hitl/ToolConfirmDialog.tsx` | 新建 | 工具审批（第三类 HITL） |
| P2 | `apps/desktop/src/renderer/src/components/chat/ChatArea.tsx` | 插入 | `<HitlMessageCard/>` 渲染到消息流 |

---

## 六、视觉对比验证

- **图1 极简底部输入框** = `InputArea mode="hitl"`，**不需要新设计**。
- **图2 居中弹窗** = `HitlChoiceDialog` 完全基于已有 `Dialog + RadioGroup + Input + Button`，**不需要新设计**。
- 两个组件的所有依赖（`Dialog`/`RadioGroup`/`Input`/`Button`/`Label`）都已在 shadcn/ui 体系中，0 额外 UI 库依赖。
