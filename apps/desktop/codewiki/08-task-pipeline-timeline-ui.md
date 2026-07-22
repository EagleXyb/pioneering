# 任务模式右侧面板时间轴 UI 优化方案

> 评估对象：Web 端任务模式（Task Mode）右侧「任务流水线」面板
> 优化目标：扁平步骤列表 → 时间轴样式 + 折叠面板（参考行业标准 Agent 产品的时间轴 UI）
> 评估时间：2026-07-22
> 涉及范围：`apps/web/src/modes/task/` 任务模式组件与样式

---

## 0. 背景与目标

### 0.1 现状

当前右侧面板采用「进度条 + 扁平步骤列表」结构：

```
进度概览 [3/5] ═══░░
1. ○ 步骤标题         等待中
   描述文字...
2. ◐ 步骤标题         执行中
   描述文字...
3. ✓ 步骤标题         已完成
   执行结果...
```

存在问题：
- 步骤之间缺乏时间轴视觉关联，步骤间的递进关系不直观
- 所有步骤内容平铺展开，步骤多时信息密度低
- 缺少步骤序号的视觉化表达（与参考图的 `(1/7)` 角标不一致）

### 0.2 目标样式

参考业界标准 Agent 产品的时间轴折叠面板样式：

```
◉ 1. 分析AI战略咨询市场规模与主要参与者    (1/7) ⌄
   │
   ├── 展开内容：步骤描述 / 执行结果 / 错误信息
   │
◉ 2. 研究传统咨询巨头与科技公司的合作模式    (2/7) ⌄
   │
   ├── 展开内容...
   │
✓ 3. 探讨AI对咨询行业服务模式与价值创造的变革  (3/7) ⌄
   │
   ...
```

核心特征：
- **时间轴**：左侧竖线 + 圆点节点，视觉上呈现步骤间的时间/进度关系
- **折叠面板**：每步可独立展开/收起，默认折叠，聚焦当前执行步骤
- **序号角标**：`(当前/总数)` 表达整体进度
- **状态驱动**：节点颜色 / 标题颜色 / 默认展开策略均由步骤状态决定

---

## 1. 现状代码结构

### 1.1 组件树

```
TaskPipeline.tsx                     — 右侧面板容器（header + body）
└── PlanPipelineTree.tsx       — 步骤树主体（进度概览 + 步骤列表）
```

### 1.2 数据来源

[planExecuteStore.ts](file:///d:/Administrator/Desktop/pioneering/apps/web/src/store/planExecuteStore.ts) — Zustand store，由 `usePlanExecuteChat` 的 `STATE_DELTA` SSE 事件驱动。

数据结构：

```typescript
interface PlanItem {
  step_id: string;
  title: string;
  description: string;
  depends_on?: string[];
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  result?: string;     // done 时的执行结果
  error?: string;      // failed 时的错误信息
  started_at?: number;
  finished_at?: number;
}
```

### 1.3 当前样式文件

[task.css](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/task/task.css) §「P4 Plan-and-Execute: 任务流水线步骤树样式

核心类名：
- `.plan-tree` / `.plan-progress` / `.plan-steps`
- `.plan-step` + .plan-step--pending/running/done/failed/skipped`
- `.plan-step-indicator` / `.plan-step-content`

---

## 2. 优化方案

### 2.1 总体架构

| 层级 | 组件 | 职责 |
|------|------|------|
| 容器 | `PlanPipelineTree` | 状态摘要 + 时间轴列表 |
| 列表 | `PlanTimelineList` | 时间轴容器（左侧轨道 + 步骤项列表 |
| 步骤项 | `PlanTimelineItem` | 单个步骤：时间轴节点 + 折叠面板 |

### 2.2 Store 扩展（planExecuteStore.ts）

**新增状态**：

```typescript
collapsedSteps: Record<string, boolean>;  // step_id → 是否折叠
toggleStep: (stepId: string) => void; // 切换折叠状态
```

**默认折叠规则**：
- `running` / `failed` → 默认展开（用户需要关注）
- `pending` / `done` / `skipped` → 默认折叠（减少视觉噪音）

### 2.3 组件重构（PlanPipelineTree.tsx）

#### 2.3.1 PlanPipelineTree（主体）

```
PlanPipelineTree
  ├── 顶部摘要行：已完成 X/Y 步 （替代旧的进度条+计数）
  └── PlanTimelineList
        └── PlanTimelineItem × N
```

#### 2.3.2 PlanTimelineItem（单个步骤项）

结构：

```
┌─────────────────────────────────────────────┐
│ ◉  1. 步骤标题              (1/7)  ⌄ │  ← 标题行（可点击折叠）
│ │                                       │
│ │  步骤描述文字...                        │  ← 展开内容区
│ │  执行结果 / 错误信息                    │
└─────────────────────────────────────────┘
```

左侧时间轴节点列：
- 宽度固定（如 24px），`position: relative`
- 节点圆点：12px 直径，状态颜色区分
- 竖线连线：`::before` 伪元素，`w-px`，颜色 `var(--border-light)`
- 分段连线：首步只画下半段，末步只画上半段，中间步上下都画

#### 2.3.3 折叠交互

- 点击标题行切换展开/收起
- 手风琴样式（可同时展开多个）
- 折叠过渡：`max-height` + `opacity` 动画

### 2.4 状态视觉映射

| 状态 | 节点样式 | 标题颜色 | 默认展开 | 内容区 |
|------|---------|---------|---------|--------|
| pending | 空心灰圆 | `var(--text-tertiary)` | 折叠 | 描述 |
| running | 实心蓝圆 + 脉冲动画 | `var(--accent-blue)` 加粗 | 展开 | 描述 + loading 动画 |
| done | 实心绿圆 + ✓ | `var(--text-primary)` | 折叠 | 描述 + 结果 |
| failed | 实心红圆 + ✕ | `var(--accent-red)` | 展开 | 描述 + 错误 |
| skipped | 实心黄圆 + — | `var(--text-tertiary)` | 折叠 | 描述 |

---

## 3. 改动清单

### 3.1 文件改动

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| [planExecuteStore.ts](file:///d:/Administrator/Desktop/pioneering/apps/web/src/store/planExecuteStore.ts) | 新增 | 新增 `collapsedSteps` 状态 + `toggleStep` action |
| [PlanPipelineTree.tsx](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/task/components/PlanPipelineTree.tsx) | 重写 | 改为时间轴布局 + 折叠面板交互 |
| [task.css](file:///d:/Administrator/Desktop/pioneering/apps/web/src/modes/task/task.css) | 新增 | 时间轴节点、连线、折叠面板样式（替换旧 `.plan-step` 系列） |

### 3.2 不变的模块

- `TaskPipeline.tsx` — 仅作为容器，header/badge 逻辑不变
- `TaskMode.tsx` — 布局不变
- `usePlanExecuteChat.ts` — SSE 数据流不变
- `planExecuteStore.applyPlanDelta` — 数据更新逻辑不变

---

## 4. 实现要点与注意事项

### 4.1 时间轴连线的结构性实现

> 经验教训（来自任务进度步骤连线修复经验）：

**避免**：使用 `absolute` 定位 + `bottom` 负值微调的「看起来连上」的方案，容易在不同内容高度/行距/hover 状态下断开或越界。

**推荐**：结构化实现：
1. 图标列容器固定宽度（如 `w-6`）并设为 `relative`
2. 用 `::before` 伪元素画线，使用 `top/bottom` 的正向 `inset`
3. 分段渲染：上半段线（从 item 顶到图标中心）与下半段线（从图标中心到 item 底）
4. 首项只画下半段，末项只画上半段，中间项上下都画
5. 线宽 `w-px`，通过颜色 token 控制视觉强度

### 4.2 折叠过渡动画

使用 `max-height` + `opacity` 过渡，避免 `height: auto` 无法动画的问题：
- 折叠态：`max-height: 0` + `opacity: 0` + `overflow: hidden`
- 展开态：`max-height: 500px`（足够大的上限）+ `opacity: 1`
- 过渡时间：`200ms ease`

### 4.3 无障碍

- 标题行加 `role="button"` + `tabindex="0"` + `aria-expanded`
- 支持键盘 Enter/Space 切换
- 折叠内容区 `aria-labelledby` 关联标题

---

## 5. 实施步骤

1. **Store 扩展**：在 `planExecuteStore.ts` 中新增 `collapsedSteps` 状态和 `toggleStep` action
2. **组件重构**：重写 `PlanPipelineTree.tsx`，拆分为时间轴列表 + 步骤项组件
3. **样式新增**：在 `task.css` 中新增时间轴 + 折叠面板样式，替换旧的 `.plan-step` 系列
4. **验证**：浏览器实际运行任务模式，检查各状态下的视觉表现

---

## 6. 后续可扩展方向

- **子步骤嵌套**：若未来支持多级 plan（子任务），时间轴可扩展为树形缩进
- **步骤详情面板**：点击步骤后在下方展开详细工具调用日志、thinking 过程
- **时间戳显示**：在步骤标题旁显示 `started_at` / `finished_at` 耗时
- **步骤跳转**：点击步骤滚动到对话中对应的消息位置
