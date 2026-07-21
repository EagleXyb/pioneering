# Plan-and-Execute 模式 Agent 面板对接分析

> 目标：将任务模式右侧面板（`TaskPipeline`）改造为能够实时接收并展示 Plan-and-Execute Agent 输出过程的预览面板。
>
> 范围：前端 `apps/web` 内可落地的对接方案；不含后端 Agent 实现。
>
> 关联代码：
> - 容器层：[TaskMode.tsx](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/task/TaskMode.tsx)
> - 占位组件：[TaskPipeline.tsx](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/task/components/TaskPipeline.tsx)
> - 参考实现（AGUI SSE 解析）：[useAgentChat.ts](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/pro/hooks/useAgentChat.ts)
> - 参考组件（线性步骤渲染）：[ProcessPanel.tsx](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/pro/components/ProcessPanel.tsx)
> - Store 样板：[artifactStore.ts](file:///d:/Administrator/Desktop/pioneering/apps/web/src/store/artifactStore.ts)

---

## 一、现状分析

### 1.1 右侧面板当前状态

**容器层（已完善）**
- `TaskMode.tsx` 第 102 行通过 `hasActiveArtifact ? <ArtifactPanel /> : <TaskPipeline />` 实现右侧面板的互斥渲染：当存在 artifact 预览时显示 ArtifactPanel，否则显示 TaskPipeline。
- `useAppStore` 提供 `pipelineOpen`、`togglePipeline`、`pipelineWidth`、`setPipelineWidth`，面板的折叠/展开/拖拽调宽已可用，并通过 `localStorage` 持久化（key: `task-pipeline-width`，默认 320px，范围 240~560px）。
- `TaskResizer` 已支持鼠标拖拽调宽。

**Body 区（占位）**
- `TaskPipeline.tsx` 第 31~41 行：body 区目前仅显示空状态图标 + "Plan-and-Execute 模式" + "Agent 将自动规划任务步骤，逐项执行并汇报结果"。
- header 已有 `task-pipeline-badge`（"开发中"徽章），后续可切换为状态徽章（执行中/已完成/失败）。

**结论**：容器层（折叠、拖拽、顶栏 toggle、与 ArtifactPanel 互斥）全部可用，仅需替换 body 区内容。

### 1.2 参考实现：ProMode 的 useAgentChat

[useAgentChat.ts](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/pro/hooks/useAgentChat.ts) 已经实现了一个完整的 AGUI SSE 解析器，可直接作为 Plan-and-Execute 对接的设计参考：

- **请求端点**：`POST /api/agent/completions`，body `{ sessionId, message, stream: true }`，header 带 `getAuthHeader()`。
- **SSE 解析**：`TextDecoder` + `buffer.split('\n')` 分行，匹配 `data: ` 前缀后 `JSON.parse`。
- **stateMap 数据结构**：`Record<string, AgentStep>`，key 形如 `step_1`、`step_2`，每个 step 含 `{ type, label, content, status: 'running' | 'done' | 'pending' }`。
- **事件 → stateMap 映射**：
  - `THINKING_START` → 新建 `type:'thinking'`、`status:'running'`
  - `THINKING_TEXT_MESSAGE_CONTENT` → 累加 `content`
  - `THINKING_END` → 置 `status:'done'`
  - `TOOL_CALL_START` → 新建 `type:'tool_call'`、`status:'running'`
  - `TOOL_CALL_ARGS` → 累加参数
  - `TOOL_CALL_RESULT` → 当前 tool_call 置 done，再新建 `type:'tool_result'`、`status:'done'`
  - `RUN_ERROR` → 所有 running 置 done，状态切 `error`
- **状态机**：`'idle' | 'pending' | 'streaming' | 'complete' | 'error'`

**结论**：ProMode 已实现 14 种 AGUI 事件的完整解析，Plan-and-Execute 只需在其基础上扩展 `STATE_DELTA` 事件对 Plan/Execute 阶段的语义解析，无需重写解析器。

### 1.3 参考组件：ProcessPanel

[ProcessPanel.tsx](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/pro/components/ProcessPanel.tsx) 是一个 82 行的纯展示组件：

- **可复用部分**：`process-step-indicator`（圆圈+连接线）、`process-step-spinner`（CSS 旋转动画）、`process-step-circle`、`process-step-line`。
- **必须扩展**：
  1. 仅支持 `running` / `done` 两种状态，需新增 `pending` / `failed` / `skipped`。
  2. 仅线性渲染（`Object.entries(stateMap).map`），需支持父子层级（Plan → 子任务）。
  3. 无折叠/展开交互，需新增可折叠树形结构。
  4. 无按 `step.type` 分化渲染（thinking / tool_call / tool_result / plan / execute），需新增分类型 UI。

### 1.4 Store 设计样板：artifactStore

[artifactStore.ts](file:///d:/Administrator/Desktop/pioneering/apps/web/src/store/artifactStore.ts) 是任务模式新增 store 的设计样板，体现了以下原则：

- Zustand 单 store，状态字段最小化（`activeArtifact` + `highlightMessageId`）。
- Actions 命名清晰：`openArtifact` / `closeArtifact` / `highlightMessage` / `clearHighlight` / `reset`。
- 与 conversationStore 解耦：状态只活在任务模式生命周期内，切换会话由 `TaskMode.tsx` 的 `useEffect([activeId])` 主动调 `reset()` 清理。
- 不使用 persist 中间件（流式状态不需要持久化，刷新即重置）。

### 1.5 后端阻塞项

- `apps/backend-ts/src/routes/agent.ts` 的 `/agent/completions` 端点当前返回 501 Not Implemented。
- 真实 Plan-and-Execute 联调需后端接入 `packages/modu-agent` 并实现 AGUI 协议的 SSE 输出。
- **前端可独立推进**：mock SSE 数据 + 单元测试可在后端就绪前完成全部 UI 与状态流转逻辑。

---

## 二、数据对接方案

### 2.1 AGUI 事件清单与 Plan-and-Execute 语义扩展

在 ProMode 的 14 种事件基础上，Plan-and-Execute 通过 `STATE_DELTA` 事件承载 Plan 阶段与 Execute 阶段的结构化数据。

| 事件类型 | 用途 | Plan-and-Execute 语义 |
|---------|------|---------------------|
| `RUN_STARTED` | 运行开始 | Agent 开始规划 |
| `RUN_FINISHED` | 运行结束 | 全部任务执行完成 |
| `RUN_ERROR` | 运行错误 | 规划失败或执行异常 |
| `STATE_DELTA` | **阶段状态变更（核心扩展点）** | 携带 `phase: 'plan' \| 'execute'` 与 Plan/Execute 数据 |
| `TEXT_MESSAGE_START/CONTENT/END` | 文本消息流式输出 | Agent 的总结说明文本 |
| `THINKING_*` | 思考过程 | 规划前的推理（可选） |
| `TOOL_CALL_*` | 工具调用 | Execute 阶段的子任务执行 |
| `TOOL_CALL_RESULT` | 工具结果 | Execute 阶段子任务的执行结果 |

### 2.2 STATE_DELTA 扩展 payload 约定

建议后端在 `STATE_DELTA` 事件的 payload 中携带以下字段（前端需做兼容解析）：

```typescript
interface PlanStateDelta {
  phase: 'plan' | 'execute' | 'finalize';
  // plan 阶段：完整的任务规划树
  plan?: PlanItem[];
  // execute 阶段：单个子任务的状态变更
  stepUpdate?: {
    id: string;          // 与 plan 中的 item.id 对应
    status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    result?: string;     // 执行结果（done/failed 时携带）
    error?: string;      // 失败原因（failed 时携带）
    startedAt?: number;
    finishedAt?: number;
  };
}
```

### 2.3 PlanItem 数据结构建议

```typescript
export interface PlanItem {
  id: string;                    // 唯一 ID（后端生成）
  parentId: string | null;       // 父任务 ID，null 表示根任务
  title: string;                 // 任务标题
  description?: string;          // 任务描述
  children?: string[];           // 子任务 ID 列表（也可通过 parentId 反查）
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: string;               // 执行结果
  error?: string;                // 失败原因
  startedAt?: number;
  finishedAt?: number;
  // 可选：关联的工具调用信息
  toolCalls?: Array<{ name: string; args: any; result?: string }>;
}
```

### 2.4 planExecuteStore 数据结构

```typescript
interface PlanExecuteState {
  // 扁平化的任务树：id → PlanItem
  items: Record<string, PlanItem>;
  // 根任务 ID 列表（按规划顺序）
  rootIds: string[];
  // 当前执行阶段
  phase: 'idle' | 'planning' | 'executing' | 'finalizing' | 'done' | 'error';
  // 当前正在执行的任务 ID
  currentItemId: string | null;
  // 整体进度（0~100）
  progress: number;
  // 错误信息
  error: string | null;

  // Actions
  applyPlanDelta: (delta: PlanStateDelta) => void;
  reset: () => void;
  setPhase: (phase: PlanExecuteState['phase']) => void;
}
```

**为什么用扁平 `Record<id, PlanItem>` 而非嵌套树**：
1. SSE 增量更新时只需 `O(1)` 修改单个 item，无需递归遍历树。
2. `parentId` + `rootIds` 即可还原树形结构（在组件层做一次 `children` 反查聚合）。
3. 与 ProMode `stateMap` 的 `Record<string, AgentStep>` 模式一致，降低心智负担。

### 2.5 usePlanExecuteChat Hook 设计

```typescript
export function usePlanExecuteChat(activeId: string | null): {
  status: AgentChatStatus;
  sendMessage: (params: { prompt: string }) => void;
  abort: () => void;
} {
  // 内部实现：
  // 1. 复用 useAgentChat 的 SSE 解析逻辑（建议抽成共享的 parseAGUIStream 工具）
  // 2. 监听 STATE_DELTA 事件，调用 planExecuteStore.applyPlanDelta
  // 3. 监听 TOOL_CALL_RESULT，更新对应 PlanItem 的 result
  // 4. 监听 RUN_FINISHED / RUN_ERROR，更新 phase
}
```

**关键实现点**：
- SSE 解析与 `useAgentChat` 第 130~398 行逻辑一致，可考虑抽取 `parseAGUIStream(reader, handlers)` 共享工具，避免重复代码。
- `STATE_DELTA` 事件 handler：
  - `phase === 'plan'` 且 `plan` 字段存在 → 全量替换 `items` 与 `rootIds`，phase 切 `executing`。
  - `phase === 'execute'` 且 `stepUpdate` 存在 → 增量更新 `items[stepUpdate.id]`。
- `TOOL_CALL_RESULT` 可选地追加到当前 `currentItemId` 的 `toolCalls` 数组。
- `RUN_ERROR` 时所有 `running` 状态置 `failed`，phase 切 `error`。

---

## 三、层级展示方案

### 3.1 组件层级

```
TaskPipeline (容器，已有)
└── PlanPipelineTree (新增，body 区)
    ├── PlanProgressHeader (新增，进度概览)
    │   ├── 阶段徽章（规划中 / 执行中 / 已完成 / 失败）
    │   ├── 进度条（done/total）
    │   └── 计时器（可选）
    └── PlanTree (新增，递归树)
        └── PlanNode (新增，单节点)
            ├── NodeIndicator（圆圈 + 状态图标 + 连接线）
            ├── NodeHeader（标题 + 状态徽章 + 折叠按钮）
            └── NodeBody（展开时显示）
                ├── 描述
                ├── 工具调用列表（可选）
                └── 子节点列表（递归 PlanNode）
```

### 3.2 状态展示规则

| status | 圆圈图标 | 颜色 | 文案 |
|--------|---------|------|------|
| `pending` | 空心圆 | 灰色 (`--text-tertiary`) | 等待中 |
| `running` | spinner | 蓝色 (`--accent-blue`) | 执行中 |
| `done` | 对勾 | 绿色 (`--accent-green`) | 已完成 |
| `failed` | 叉号 | 红色 (`--accent-red`) | 失败 |
| `skipped` | 横线 | 黄色 (`--accent-amber`) | 已跳过 |

### 3.3 分类型渲染扩展

`PlanNode` 可选地展示关联的 thinking / tool_call 步骤（来自 stateMap），通过 `currentItemId` 关联：

- **Plan 阶段**：只展示 `items` 树，不展示 stateMap 步骤。
- **Execute 阶段**：在对应 `PlanNode` 的 `NodeBody` 中追加 "执行详情" 折叠区，渲染关联的 thinking / tool_call / tool_result 步骤（复用 ProcessPanel 的 step 渲染逻辑）。

### 3.4 进度概览计算

```typescript
const { items, rootIds } = usePlanExecuteStore();
const total = Object.keys(items).length;
const done = Object.values(items).filter(i => i.status === 'done').length;
const failed = Object.values(items).filter(i => i.status === 'failed').length;
const progress = total === 0 ? 0 : Math.round((done / total) * 100);
```

---

## 四、实时更新方案

### 4.1 状态流转图

```
idle ──sendMessage──▶ planning ──STATE_DELTA(plan)──▶ executing
                                                          │
                                          STATE_DELTA(execute) × N
                                                          │
                                                          ▼
                            RUN_FINISHED ──▶ done ◀── finalizing
                                          ▲
                            RUN_ERROR ────┴── error
```

### 4.2 实时更新机制

**Store 驱动**：`planExecuteStore` 是 Zustand store，组件通过 `usePlanExecuteStore(selector)` 订阅。任何 `applyPlanDelta` / `setPhase` 调用都会触发组件重渲染。

**增量更新优化**：
- `applyPlanDelta` 对单个 item 的更新使用 `set((s) => ({ items: { ...s.items, [id]: { ...s.items[id], ...patch } } }))`，保证引用最小化变更。
- 组件层用 `React.memo` + `useMemo` 避免不必要的重渲染，selector 用 `shallow` 比较避免返回新引用。

**流式动画**：
- `running` 状态的圆圈用 CSS spinner（已有 `.process-step-spinner`）。
- 进度条用 CSS transition 平滑过渡 `width`。
- 新增节点用 `@keyframes fadeIn` 淡入动画。

### 4.3 错误处理

- `RUN_ERROR` 事件触发时：
  1. `phase` 切 `error`。
  2. 所有 `running` 状态的 item 置 `failed`，记录 `error` 字段。
  3. header 显示错误徽章 + 错误信息。
  4. 失败的节点用红色高亮，可展开查看错误详情。
- 网络断开（fetch reject）：与 `RUN_ERROR` 同等处理。

### 4.4 中止与重试

- `abort()` 调用 `AbortController.abort()`，状态切 `complete`（与 `useAgentChat` 一致）。
- 重试：`reset()` 清空 store 后重新 `sendMessage`。

---

## 五、可折叠交互设计

### 5.1 折叠状态管理

**Store 层**（避免 React state 在组件卸载后丢失）：

```typescript
// 在 planExecuteStore 中追加
collapsedIds: Record<string, boolean>;
toggleCollapse: (id: string) => void;
setCollapsed: (id: string, collapsed: boolean) => void;
expandAll: () => void;
collapseAll: () => void;
```

**默认折叠策略**：
- `pending` 节点默认展开（用户最关心接下来要做什么）。
- `running` 节点默认展开（实时观察执行细节）。
- `done` 节点默认折叠（减少视觉噪音，可手动展开查看结果）。
- `failed` 节点默认展开（突出错误信息）。

### 5.2 折叠交互

- **点击节点 header**：toggle 折叠/展开。
- **折叠箭头图标**：`ChevronRight`（折叠）/ `ChevronDown`（展开），用 lucide-react（项目已用）。
- **键盘支持**：`Enter` / `Space` 切换折叠，`ArrowDown/Up` 在同级节点间移动，`ArrowRight/Left` 展开/折叠子节点。
- **全局操作**：header 右上角提供"全部展开"/"全部折叠"按钮。

### 5.3 折叠动画

```css
.plan-node-children {
  overflow: hidden;
  transition: max-height 200ms ease-out, opacity 150ms ease-out;
}
.plan-node--collapsed .plan-node-children {
  max-height: 0;
  opacity: 0;
}
```

注意：`max-height` 过渡对动态内容高度有局限，若节点内容差异大可改用 `grid-template-rows: 0fr → 1fr` 的现代方案。

### 5.4 与容器折叠的关系

右侧面板整体折叠由 `useAppStore.pipelineOpen` 控制（已有），与单个 PlanNode 的折叠互不干扰：
- 面板整体折叠：`TaskPipeline` 整个 width: 0，与 ArtifactPanel 互斥。
- 节点折叠：仅影响 `PlanPipelineTree` 内部展示，不影响面板尺寸。

---

## 六、对接实施步骤

### 6.1 文件清单

**新增文件**：
- `src/store/planExecuteStore.ts` — Zustand store（参考 artifactStore.ts 样板）
- `src/modes/task/hooks/usePlanExecuteChat.ts` — SSE hook（参考 useAgentChat.ts）
- `src/modes/task/components/PlanPipelineTree.tsx` — body 区主组件
- `src/modes/task/components/PlanProgressHeader.tsx` — 进度概览
- `src/modes/task/components/PlanNode.tsx` — 递归节点组件
- `src/modes/task/components/planPipeline.css` — 树形样式（扩展 process-panel.css）
- `src/lib/parseAGUIStream.ts` — 抽取的共享 SSE 解析工具（可选，但强烈建议以避免 ProMode 与 TaskMode 重复代码）

**修改文件**：
- `src/modes/task/components/TaskPipeline.tsx` — body 区替换为 `<PlanPipelineTree />`
- `src/modes/task/TaskMode.tsx` — 集成 `usePlanExecuteChat`，在 `useEffect([activeId])` 中调 `planExecuteStore.reset()`
- `src/modes/task/task.css` — 移除 `.task-pipeline-empty` 占位样式，新增 `.task-pipeline-badge` 的状态变体（执行中/已完成/失败）

**测试文件**：
- `src/store/planExecuteStore.test.ts` — applyPlanDelta / 状态流转 / reset
- `src/modes/task/hooks/usePlanExecuteChat.test.ts` — SSE 流 mock + 断言 store 状态
- `src/modes/task/components/PlanPipelineTree.test.tsx` — 树渲染 / 折叠交互 / 状态展示
- `src/modes/task/components/PlanNode.test.tsx` — 单节点渲染 / 递归 / 键盘交互

### 6.2 实施顺序

1. **抽取共享 SSE 解析工具** `parseAGUIStream.ts`（重构 useAgentChat 以复用，不破坏 ProMode 现有行为，回归测试 14 个原有用例）。
2. **新建 planExecuteStore** + 单元测试（参考 artifactStore.test.ts 模式）。
3. **新建 usePlanExecuteChat** + 单元测试（mock SSE 数据，覆盖 plan/execute/error/abort 场景）。
4. **新建 PlanPipelineTree / PlanProgressHeader / PlanNode** + 组件测试（含可折叠交互、键盘交互）。
5. **改造 TaskPipeline.tsx**：body 区替换为 `<PlanPipelineTree />`，header 状态徽章联动 phase。
6. **改造 TaskMode.tsx**：接入 `usePlanExecuteChat`，切换会话时 reset。
7. **端到端集成测试**：mock 后端 SSE 数据走完整 Plan-and-Execute 流程。
8. **后端就绪后联调**：替换 mock 为真实 `/api/agent/completions`，验证 STATE_DELTA payload 兼容性。

### 6.3 Mock 数据示例

在后端未就绪期间，建议在 `src/mocks/planExecuteSSE.ts` 中导出一个 mock SSE 生成器，输出符合 AGUI 协议的事件序列，供开发与测试使用：

```typescript
export function* mockPlanExecuteSSE(prompt: string): Generator<string> {
  yield `data: ${JSON.stringify({ type: 'RUN_STARTED' })}\n\n`;
  yield `data: ${JSON.stringify({
    type: 'STATE_DELTA',
    phase: 'plan',
    plan: [
      { id: 't1', parentId: null, title: '分析需求', status: 'pending' },
      { id: 't2', parentId: null, title: '搜集资料', status: 'pending',
        children: ['t2-1', 't2-2'] },
      { id: 't2-1', parentId: 't2', title: '搜索 A', status: 'pending' },
      { id: 't2-2', parentId: 't2', title: '搜索 B', status: 'pending' },
      { id: 't3', parentId: null, title: '生成报告', status: 'pending' },
    ],
  })}\n\n`;
  // ...依次发出 stepUpdate 事件
  yield `data: ${JSON.stringify({ type: 'RUN_FINISHED' })}\n\n`;
}
```

---

## 七、关键决策与风险

### 7.1 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Store 形态 | 扁平 `Record<id, PlanItem>` + `rootIds` | SSE 增量更新 O(1)，树形结构在组件层聚合 |
| SSE 解析 | 抽取共享 `parseAGUIStream` | 复用 ProMode 逻辑，避免 14 种事件解析重复 |
| 折叠状态位置 | Store 层（非组件 state） | 支持跨组件访问（如"全部展开"按钮），卸载不丢失 |
| 与 ArtifactPanel 关系 | 互斥（沿用现有逻辑） | TaskMode 已通过 `hasActiveArtifact` 切换，无需改动 |
| 工具调用展示 | PlanNode 内嵌折叠区 | 将 thinking / tool_call 与所属子任务关联，避免线性展示割裂 |

### 7.2 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| 后端 `/agent/completions` 返回 501 | 无法真实联调 | mock SSE 数据先行，前端独立推进 |
| STATE_DELTA payload 未与后端对齐 | 联调时解析失败 | 文档先行约定 payload schema，后端实现时对齐 |
| 大量子任务导致渲染卡顿 | 性能 | `React.memo` + 虚拟滚动（>50 节点时启用） |
| SSE 流被中断后状态不一致 | UI 残留 running | `RUN_ERROR` 兜底 + 心跳检测（可选） |
| ProMode 重构引入回归 | 影响现有功能 | 抽取 `parseAGUIStream` 后保留 ProMode 14 个测试，回归验证 |

### 7.3 与现有功能的兼容性

- **不破坏 ProMode**：`parseAGUIStream` 抽取为纯函数，ProMode 的 `useAgentChat` 改为调用该函数并传入自己的 handlers，行为完全一致，14 个原有测试需全部通过。
- **不破坏 ArtifactPanel**：TaskMode 第 102 行的互斥逻辑保留，Plan-and-Execute 面板只在 `!hasActiveArtifact` 时显示。
- **不破坏任务消息列表**：`TaskMessageList` 的 `data-message-id` 反向联动机制不受影响，Agent 的 `TEXT_MESSAGE_*` 事件仍正常追加到消息列表。

---

## 八、右边栏多用途复用机制分析

> 本节分析任务模式三栏布局中，右边栏可否同时作为预览面板（ArtifactPanel）与 Agent 输出过程面板（TaskPipeline/PlanPipelineTree）两用，以及当前是否实现了多用途复用机制确保互不干扰。

### 8.1 当前实现现状

**结论：当前实现了"互斥式复用"，但未实现"无干扰并存"。** 右边栏同一时刻只能二选一展示 `ArtifactPanel` 或 `TaskPipeline`，两者无法同时存在，也无法在 Agent 执行过程中保留预览。

#### 已实现的切换机制

[TaskMode.tsx](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/task/TaskMode.tsx) 第 102 行：

```tsx
{hasActiveArtifact ? <ArtifactPanel /> : <TaskPipeline />}
```

| 切换入口 | 触发方式 | 代码位置 |
|---------|---------|---------|
| 预览按钮 | 用户点击 assistant 消息中的"预览"按钮 → `openArtifact()` → 自动切到 ArtifactPanel | [TaskMessageList.tsx:97](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/task/components/TaskMessageList.tsx#L97) |
| 关闭预览 | 用户点击 ArtifactPanel 右上角 X → `closeArtifact()` → 自动切回 TaskPipeline | [ArtifactPanel.tsx:109](file:///d:/Administrator/Desktop/pioneering/apps/web/src/components/ArtifactPreview/ArtifactPanel.tsx#L109) |
| 顶栏展开按钮 | 仅在 `!pipelineOpen && !hasActiveArtifact` 时显示"展开任务流水线"按钮 | [TaskTopBar.tsx:63](file:///d:/Administrator/Desktop/pioneering/apps/web/src/layout/TaskTopBar/TaskTopBar.tsx#L63) |

#### 已实现的数据隔离

| 维度 | 现状 | 评估 |
|------|------|------|
| Artifact 状态 | 独立 `artifactStore`（Zustand），与消息流解耦 | ✅ 隔离 |
| 会话切换清理 | `useEffect([activeId])` 调 `resetArtifact()` | ✅ 自动清理 |
| 面板宽度 | 两者复用 `useAppStore.pipelineWidth`，可拖拽调整 | ✅ 共享布局 |
| 顶栏按钮联动 | 预览态下顶栏"展开流水线"按钮隐藏 | ⚠️ 缺少手动切换入口 |

### 8.2 与"多用途互不干扰"目标的差距

| 用户要求 | 当前状态 | 差距分析 |
|---------|---------|---------|
| **状态切换逻辑（自动 + 手动）** | 仅手动触发（预览按钮 / X 关闭） | 缺自动切换（如 Agent 进入 executing 阶段时自动切到流水线）；预览态下顶栏无手动切回按钮 |
| **各模式上下文独立与数据隔离** | Artifact 已隔离，Agent 状态待建 | 需新建 `planExecuteStore`；两 store 各自独立，不互相污染 |
| **Agent 输出过程中无缝嵌入预览** | **未实现**（互斥渲染） | 用户预览 artifact 时，Agent 仍在后台输出但右侧面板被 ArtifactPanel 完全遮挡，用户看不到执行进度 |

#### 已存在的视觉/交互冲突

1. **预览遮挡执行**：用户预览 artifact 时，Agent 的 `TEXT_MESSAGE_*` 事件仍在消息列表追加，但右侧面板被 ArtifactPanel 占用，无法看到 Plan-and-Execute 进度。
2. **关闭预览丢失上下文**：用户必须关闭预览才能看到 Agent 进度，关闭后想再看预览需重新滚动消息列表找代码块。
3. **顶栏切换按钮缺失**：预览态下顶栏不显示"切回流水线"按钮，只能通过 ArtifactPanel 内的 X 关闭。

### 8.3 改造方案对比

| 方案 | 描述 | 优点 | 缺点 | 推荐度 |
|------|------|------|------|--------|
| **A. Tab 切换** | 顶栏加 Tab：`流水线 \| 预览`，二者仍互斥渲染但切换不丢状态 | 改动小，数据天然隔离 | 切换有视觉跳变，无法同时看 | ⭐⭐⭐ |
| **B. 分屏（上下/左右）** | 预览态下右侧栏内部再分上下两栏：上预览 + 下流水线 | 同时可见，无干扰 | 320px 宽度内分屏太挤 | ⭐ |
| **C. 浮层预览（推荐）** | 流水线常驻右栏，预览作为浮层卡片悬浮在流水线上方，可最小化/拖动 | 不抢占位置，Agent 进度持续可见，预览即用即抛 | 浮层管理复杂度略高 | ⭐⭐⭐⭐⭐ |

#### 推荐方案 C 的关键设计

**Store 层扩展**（`artifactStore` 追加）：

```typescript
interface ArtifactState {
  // ... 现有字段
  minimized: boolean;            // 是否最小化
  minimizeArtifact: () => void;  // 最小化（缩为底部小条）
  restoreArtifact: () => void;   // 恢复展开
}
```

**浮层布局**：
- `TaskPipeline`（含 `PlanPipelineTree`）常驻右侧面板，不受预览影响。
- 展开预览时，`ArtifactPanel` 作为绝对定位浮层覆盖在 `TaskPipeline` 上方（保留底部进度条可见）。
- 最小化预览时，缩为右下角小卡片条（类似 VS Code 通知），不遮挡流水线主体。

**自动切换联动**（与 `planExecuteStore` 集成）：

```typescript
// 在 TaskMode.tsx 中
const phase = usePlanExecuteStore((s) => s.phase);
const minimizeArtifact = useArtifactStore((s) => s.minimizeArtifact);
const restoreArtifact = useArtifactStore((s) => s.restoreArtifact);

useEffect(() => {
  if (phase === 'executing' && hasActiveArtifact) {
    // Agent 进入执行阶段时，自动最小化预览，让出空间给流水线
    minimizeArtifact();
  }
  if (phase === 'done' || phase === 'error') {
    // 执行结束时自动恢复预览（如果之前有预览）
    restoreArtifact();
  }
}, [phase]);
```

**手动切换入口修正**（[TaskTopBar.tsx](file:///d:/Administrator/Desktop/pioneering/apps/web/src/layout/TaskTopBar/TaskTopBar.tsx)）：

```tsx
// 修改前：预览态下隐藏"展开流水线"按钮
{!pipelineOpen && !hasActiveArtifact && (
  <PanelRight ... />
)}

// 修改后：预览态下显示"切回流水线"按钮
{!pipelineOpen && (
  <TooltipTrigger asChild>
    <Button onClick={() => {
      if (hasActiveArtifact) minimizeArtifact();
      togglePipeline();
    }}>
      <PanelRight />
    </Button>
  </TooltipTrigger>
)}
```

### 8.4 最小化落地路径（分步实施）

| 步骤 | 改动范围 | 风险 | 前置条件 |
|------|---------|------|---------|
| **1. 顶栏切回入口**（低风险） | 修改 `TaskTopBar.tsx` 第 63 行条件，预览态下也可切回流水线 | 低 | 无 |
| **2. artifactStore 追加 minimized 状态** | `artifactStore.ts` 新增 `minimized` + `minimizeArtifact` / `restoreArtifact` | 低 | 无 |
| **3. ArtifactPanel 支持最小化态** | `ArtifactPanel.tsx` 新增最小化卡片 UI | 中 | 步骤 2 |
| **4. 改为并排渲染** | `TaskMode.tsx` 第 102 行从互斥改为 `<> <TaskPipeline /> {hasActiveArtifact && <ArtifactPanel />} </>` | 中 | 步骤 3（确保最小化态不遮挡） |
| **5. 接入 phase 自动联动** | `TaskMode.tsx` 新增 `useEffect` 监听 `planExecuteStore.phase` | 中 | `planExecuteStore` 就绪 |

### 8.5 与现有功能的兼容性

- **不破坏已有 Artifact 预览**：浮层/最小化只改变 ArtifactPanel 的尺寸和位置，不改变其渲染逻辑和交互（跳转源消息、复制、下载、关闭）。
- **不破坏消息列表**：`TaskMessageList` 的 `data-message-id` 反向联动机制不受右栏布局变更影响。
- **不破坏 ProMode**：ProMode 不涉及任务模式右侧面板，无影响。
- **不破坏会话切换清理**：`useEffect([activeId])` 中的 `resetArtifact()` 仍生效，切换会话时自动清理最小化状态。

---

## 九、验收清单

- [ ] `planExecuteStore` 单元测试覆盖：plan / execute / error / reset / 折叠状态
- [ ] `usePlanExecuteChat` 单元测试覆盖：mock SSE 全流程、abort、网络错误
- [ ] `PlanPipelineTree` 渲染测试覆盖：空状态、单层树、多层树、状态流转
- [ ] `PlanNode` 测试覆盖：5 种状态展示、折叠/展开、键盘交互、递归渲染
- [ ] ProMode 14 个原有测试全部通过（无回归）
- [ ] TaskMode 切换会话时 store 正确 reset
- [ ] 与 ArtifactPanel 互斥逻辑正确（预览 artifact 时 PlanPipelineTree 隐藏）
- [ ] 暗色主题适配（CSS 变量复用 `--bg-card` / `--border-light` / `--accent-*`）
- [ ] 后端联调：真实 SSE 数据下状态流转正确（后端就绪后补测）
