# 11 · 中间栏布局分析报告

> 深度阅读 `apps/desktop` 中栏（内容展示区 + 输入交互区）相关代码，从空间利用率、交互体验、视觉层级、响应式四维度评估布局合理性，并与 `workbuddy` 输入区规范横向对比，最终给出可落地的优化方案。

## 0. 分析范围与结论速览

- **范围**：`apps/desktop/src/renderer/src/{layouts,components/chat}`，聚焦三栏布局中的"中栏"。
- **核心组件链**：`RootLayout` → `ResizablePanel(center)` → `ChatArea` → `AgentStatus` + `chat-messages-pane` + `InputArea` + `ImageLightbox`。
- **总体结论**：
  - 输入卡片（阴影 / 左工具右发送）已较好对齐 WorkBuddy 规范；**圆角 20px 与列宽 880px 为内部既定标准，不强制对齐 WorkBuddy（16px / 768px）**；
  - 但**顶部状态条（AgentStatus）与辅助信息（disclaimer / limit）克制度不及 WorkBuddy**，且**列宽存在内部双源（内容 880px、输入 880px、欢迎 672px 三处写死），导致轴线不对齐**；
  - 共识别 **5 个布局问题（P1–P5）**，其中 P1（轴线内部不对齐 / 宽度双源）为最高优先级。

> 说明：本文对比 WorkBuddy 仅作形态参考。**圆角 20px、列宽 880px 属 Desktop 内部既定设计标准，不要求对齐 WorkBuddy**，下文不将其作为"需修正"问题。

## 1. 当前布局结构

### 1.1 三栏骨架（RootLayout）

| 区域 | 宽度约束 | 说明 |
|------|----------|------|
| 左 Sidebar | 固定 `262px`（`SIDEBAR_WIDTH`） | 会话列表 / 导航 |
| 中栏 center | `ResizablePanel defaultSize=65` `minSize=30` | 内容 + 输入，宽度完全由用户拖拽决定 |
| 右 ContextPanel | `defaultSize=35` `minSize=15` `maxSize=50` | 任务信息 / 上下文 |

覆盖（overlay）模式下半屏以下转为 Drawer 抽屉。

### 1.2 中栏组件树（ChatArea）

```
ChatArea
├─ AgentStatus            // 顶部横条，条件渲染（仅 streaming / error 时显示）
├─ chat-messages-pane     // flex-1 overflow-hidden
│   └─ mx-auto h-full w-full max-w-[880px] px-0   // 列宽 880px 写死
│       ├─ WelcomeScreen（空会话，max-w-2xl = 672px）
│       └─ MessageList / MessageScrollerList        // 双渲染路径（feature flag `messageScroller`）
├─ InputArea              // 常驻底部
│   ├─ pro-input-area     // padding: 10px 20px 15px
│   │   └─ pro-input-inner  // max-width: 880px; margin: 0 auto
│   │       └─ pro-input-card  // 圆角 20 / shadow
│   │           ├─ status-row / attachments
│   │           ├─ main（Textarea）
│   │           └─ toolbar（左 + 按钮 + Agent badge；右 模型选择 + 麦克风(disabled) + 发送/停止）
│   ├─ pro-input-limit
│   └─ pro-input-disclaimer  // font-size 12px; padding 8px 4px 0
└─ ImageLightbox
```

### 1.3 关键尺寸链路（CSS / JSX 中散布的魔法值）

| 位置 | 值 | 来源文件 |
|------|----|----------|
| 中栏内容列宽 | `max-w-[880px]` | `ChatArea.tsx:152` |
| 输入区内层最大宽 | `max-width: 880px` | `pro-input.css` |
| 欢迎页最大宽 | `max-w-2xl` (672px) | `WelcomeScreen.tsx` |
| 输入区外 padding | `10px 20px 15px` | `pro-input.css` |
| 输入卡片圆角 | `20px` | `pro-input.css` |
| disclaimer | `font-size:12px; padding:8px 4px 0` | `pro-input.css` |
| 助手消息排版 | `w-full max-w-full px-0 text-[15px]`（注释"对齐 WorkBuddy 排版"） | `MessageBubble.tsx` |
| 用户消息 | `px-4 text-sm`（右侧气泡） | `MessageBubble.tsx` |

> ⚠️ **宽度双源问题**：内容列宽（880px）与输入区内层（880px）各自独立写死，且欢迎页又用 672px，三处不对齐（注：880px 为内部既定宽度标准，不强制对齐 WorkBuddy；问题在于三处写死未统一，而非宽度值本身）。

## 2. 与 WorkBuddy 的横向对比

参考规范 `docs/重构/chat/桌面端AI-Agent输入区设计规范.md`。

| 维度 | Desktop 现状 | WorkBuddy 规范 | 评估 |
|------|--------------|----------------|------|
| **输入区位置** | 底部 docked、常驻 | 底部 docked、常驻 | ✅ 一致 |
| **输入卡片** | 单卡片、圆角 20（既定标准）、shadow | 单卡片、圆角 16、`pb-6` | ✅ 卡片形态一致；圆角 20px 为既定标准，不强制对齐 WB 的 16px |
| **工具栏布局** | 左 `+` + Agent badge；右 模型 + 麦克风 + 发送 | 左工具 / 右发送 | ✅ 一致 |
| **列宽** | 880px（内容 + 输入统一；欢迎 672px 未对齐） | 建议 `max-w-[768px]` | ✅ 880px 为内部既定标准（不强制对齐 WB）；⚠️ 仅欢迎页 672px 未统一，需内部对齐 |
| **纵向空间** | disclaimer + limit + 外 padding 常驻，约 47px 非功能高度 | 仅底部免责一行，`pb-6` 克制 | ⚠️ Desktop 辅助信息更占空间 |
| **顶部状态** | AgentStatus 顶部独立横条（运行状态 + 工具 chips，MAX_VISIBLE_TOOLS=6） | 无独立顶部状态条，运行态内聚于输入卡片 status-row | ❌ Desktop 顶部横条带来 layout shift 且职责重叠 |
| **消息排版** | 助手 `w-full` 满宽、用户右侧气泡 | 助手满宽、用户右侧气泡 | ✅ 一致 |
| **响应式** | 仅"中栏 < 某一阈值"两档（媒体查询对拖拽宽度无效） | 基于容器宽度内部降级 | ❌ Desktop 因宽度由拖拽决定，媒体查询失效 |

**四维度结论**：

1. **空间利用率**：Desktop 输入卡片已对齐，但顶部状态条 + 纵向辅助信息使可用高度被侵蚀；WorkBuddy 更克制。
2. **交互体验**：Desktop 顶部状态条在 streaming 出现 / 消失会引发 layout shift；WorkBuddy 将状态内聚于卡片，无跳动。
3. **视觉层级**：Desktop 出现"顶部横条 + 卡片"双层顶部信息，层级略乱；WorkBuddy 单一焦点（卡片）更清晰。
4. **响应式**：Desktop 仅两档且无容器感知；WorkBuddy 用容器查询按实际宽度降级，更适配可拖拽中栏。

### 2.1 是否应像 WorkBuddy 一样增加常驻顶部标题栏

**结论：不应照搬 WorkBuddy 的常驻顶部标题栏；应移除当前 ` AgentStatus` 顶部横条。**

#### 关键前提：两类"顶部条"语义完全不同

| 类型 | WorkBuddy 常驻标题栏（推测语义） | Desktop ` AgentStatus` 横条（实测） |
|------|--------------------------------|--------------------------------------|
| 内容性质 | 稳定标识：会话标题 / Agent 名称 / 模式切换 | 瞬时运行态：`isStreaming` / `thinking` / `toolCalls` / `error` |
| 渲染时机 | 常驻（空闲也有意义） | 条件渲染 `if (!isStreaming && !error) return null`，空闲即消失 |
| 信息寿命 | 长期、与单次回答无关 | 仅一次流式周期有效 |
| 当前 Desktop 同类信息落点 | 会话标题在左 Sidebar；模式在 InputArea 的 Agent badge | 无处常驻，仅流式时出现 |

可见 WorkBuddy 的"常驻标题栏"承载的是**稳定身份上下文**，而 Desktop 当前的顶部条承载的是**瞬时运行态**。二者要解决的问题不同，直接"加一条常驻栏"会把瞬时信息误当成身份信息常驻，反而引入问题。

#### 为什么不应加 WorkBuddy 式常驻栏

1. **语义错配 → 空闲即空洞**：若把 ` AgentStatus` 改成常驻，空闲时它既无运行态也无错误，只能显示空白/占位，成为一条无信息量的死栏，浪费 ~40–48px（与 P3 纵向空间问题叠加）。
2. **信息已冗余**：运行态在流式期间本就内联于助手消息气泡（思考内容 + 工具 chips 随消息呈现），再在顶部复制一份属重复表达；WorkBuddy 之所以不需要顶部运行态，正是因为状态内聚于消息/卡片。
3. **身份上下文已有归属**：会话标题在左 Sidebar，模式切换在 InputArea 的 Agent badge，中栏无需再承担身份展示职责。
4. **layout shift 的根源是"条件渲染"而非"没有常驻栏"**：当前 ` AgentStatus` 在 streaming 起止时插入/卸载导致跳动；移除该条即可消除跳动，无需用一个常驻空栏去"抵消"它。

#### 决策矩阵

| 方案 | layout shift | 空闲空间占用 | 信息冗余 | 结论 |
|------|--------------|--------------|----------|------|
| A. 复制 WorkBuddy 常驻标题栏（含运行态） | 无 | 高（空栏） | 高 | ❌ 不采纳 |
| B. 常驻栏只放稳定身份（标题/模式） | 无 | 中 | 低 | ⚠️ 可选，但当前身份信息已在 Sidebar/InputArea，收益低 |
| **C. 移除 ` AgentStatus`，运行态内聚到消息流 + 输入卡片 status-row** | **无（彻底移除条件渲染）** | **最低** | **无** | **✅ 采纳（用户既定方向）** |

#### 移除后，运行态信息去哪

- **思考 / 工具轨迹**：保留在流式助手消息气泡内联呈现（`thinking` + `toolCalls` chips），与 WorkBuddy 一致，无需顶部条。
- **错误提示**：由顶部横条改为消息流内的内联错误块或轻量 toast，避免常驻占位。
- **停止/重跑等控制**：已在 InputArea 的发送/停止按钮承担。
- **若未来确需身份栏（如侧栏收起后需在中栏显示会话标题/模式）**：采用方案 B——**常驻且仅放稳定内容**，永不放入运行态，既无 layout shift 也不冗余；此时高度应计入 ` --input-vertical-nonfunc` 之外的一级布局预算，而非临时插入。

## 3. 问题清单（P1–P5）

| 编号 | 优先级 | 问题 | 影响 |
|------|--------|------|------|
| P1 | **高** | 列宽内部双源：内容 880px、输入 880px、欢迎 672px 三处写死未统一（880px 为既定标准，仅欢迎页未对齐） | 视觉轴线歪、空/非空切换跳变 |
| P2 | 高 | AgentStatus 顶部条件渲染（`if (!isStreaming && !error) return null`）+ 与卡片 status-row 职责重叠，且不应照搬 WorkBuddy 常驻标题栏（语义错配） | layout shift、信息双出口、空闲空洞栏浪费空间 |
| P3 | 中 | 输入区纵向非功能空间常驻约 47px（外 padding 10+15 + disclaimer 8+12 + limit） | 可用高度被侵蚀 |
| P4 | 中 | 响应式仅两档，媒体查询对拖拽宽度无效 | 窄中栏下卡片挤压无降级 |
| P5 | 低 | 双渲染路径 padding 分叉：legacy `py-4` vs Scroller `px-3 py-4 gap-4` | feature flag 切换时留白不一致 |

## 4. 优化方案

### 4.1 组件结构调整：抽取 `ChatColumn`

目标：统一中栏"内容 + 输入"共享同一列宽 token，消除双源。

```tsx
// ChatArea.tsx（建议）
function ChatColumn({ children }: { children: React.ReactNode }) {
  // 统一宽度令牌，内容/输入/欢迎共享
  return (
    <div className="chat-column mx-auto h-full w-full">
      {children}
    </div>
  )
}

// 使用
<AgentStatus />                         // 不再独立顶部横条，改为卡片内 status-row
<ChatColumn>
  <div className="chat-messages-pane flex-1 overflow-hidden" />
</ChatColumn>
<InputArea />                           // 内部复用同一 --chat-col-max
```

- **移除 ` AgentStatus` 顶部横条（不照搬 WorkBuddy 常驻标题栏）**：运行态（思考 / 工具 chips）保留在流式助手消息气泡内联呈现，错误提示改为消息流内联错误或轻量 toast；输入卡片 `status-row` 仅承载与输入直接相关的状态（如停止中）。彻底移除条件渲染以消除 layout shift（解决 P2 + 见 2.1 决策矩阵方案 C）。
- 欢迎页宽度改用同一令牌（解决 P1，统一到既定 880px）。

### 4.2 尺寸约束表（统一 CSS 变量令牌）

在 `index.css` 或 `pro-input.css` 增设语义令牌，替代散落魔法值：

| 令牌 | 建议值 | 说明 |
|------|--------|------|
| `--chat-col-max` | `880px`（或 `clamp(480px, 100%, 880px)`） | 统一内容/输入/欢迎列宽令牌（880px 为既定标准，仅消除三处写死带来的内部不一致） |
| `--chat-col-pad` | `clamp(12px, 2vw, 24px)` | 横向留白随列宽自适应，不再写死 20px |
| `--input-card-radius` | `20px` | 内部既定标准（不强制对齐 WB 的 16px），仅抽为令牌统一引用 |
| `--input-vertical-nonfunc` | 收敛至 ≤ 30px | 精简 disclaimer/limit 间距（解决 P3） |
| `--chat-col-min` | `480px` | 中栏拖到最窄时卡片仍可操作（支撑 P5 降级） |

### 4.3 响应式适配：容器查询（Container Queries）

中栏宽度由拖拽决定，**媒体查询无效**，必须使用容器查询做中栏内部降级。在 `ChatArea` 根容器声明 `container-type: inline-size`，按实际列宽分三档：

```css
.chat-column { container-type: inline-size; }

/* 宽列（≥ 720px）：完整工具栏 + 工具 chips 展开 */
@container (min-width: 720px) {
  .pro-input-toolbar { /* 显示模型选择 / 麦克风 / 全部工具 chip */ }
}

/* 中列（480–720px）：折叠工具 chips，保留核心按钮 */
@container (min-width: 480px) and (max-width: 719px) {
  .pro-input-toolbar .agent-tools { display: none; }   /* +N 折叠提前 */
  .pro-input-card { --input-card-radius: 14px; }
}

/* 窄列（< 480px）：单列堆叠，发送按钮换行 */
@container (max-width: 479px) {
  .pro-input-toolbar { flex-wrap: wrap; }
  .pro-input-disclaimer { display: none; }             /* 极致精简 */
}
```

| 档位 | 容器宽度 | 规则 |
|------|----------|------|
| 宽 | ≥ 720px | 全功能工具栏，工具 chips 至多显示 6 个 +N |
| 中 | 480–719px | 工具 chips 折叠，圆角收敛 14px |
| 窄 | < 480px | 工具栏换行，隐藏 disclaimer，卡片堆叠 |

### 4.4 双渲染路径对齐（解决 P5）

统一 `MessageList` 与 `MessageScrollerList` 的内层 padding 为 `px-3 py-4 gap-4`，使 feature flag 切换时留白一致。

## 5. 落地优先级建议

1. **P1**：引入 `--chat-col-max` 令牌（值保持既定 880px），将欢迎页 672px 统一到同一令牌，消除内部轴线不对齐（不改变既定 880px 宽度）。
2. **P2**：移除顶部 AgentStatus 横条，状态内聚输入卡片（消除 layout shift）。
3. **P3**：精简输入区纵向非功能空间至 ≤ 30px。
4. **P4 + 容器查询**：替换媒体查询为容器查询，补齐三档降级。
5. **P5**：双渲染路径 padding 对齐（收尾）。

### 执行路线图（批次建议）

| 批次 | 包含 | 内容 | 备注 |
|------|------|------|------|
| **批次 1** | P1 + P2 | 引入 `--chat-col-max`（880px）令牌统一三处列宽；移除 ` AgentStatus` 顶部横条，运行态回流入流式消息气泡 / 输入卡片 status-row | 改动小、收益大；两者围绕"宽度令牌 + 顶部条移除"，互不冲突，可合并一个 PR |
| **批次 2** | P3 + P4 | 输入区纵向非功能空间收敛至 ≤ 30px；用容器查询替换媒体查询，补齐宽 / 中 / 窄三档降级 | 样式与响应式重构，建议独立 PR 便于回归 |
| **批次 3** | P5 | 统一 `MessageList` 与 `MessageScrollerList` 内层 padding 为 `px-3 py-4 gap-4` | 独立小改动收尾 |

> 优先级依据：P1/P2 属"高"且直接影响轴线对齐与 layout shift，先行；P3/P4 为"中"，改善空间利用率与窄栏体验；P5 为"低"，仅做双路径留白一致性收尾。880px 宽度与 20px 圆角属既定标准，全程保持不变。

## 6. 参考文件

- `apps/desktop/src/renderer/src/layouts/RootLayout.tsx`（三栏骨架 / 宽度常量）
- `apps/desktop/src/renderer/src/components/chat/ChatArea.tsx`（中栏容器 / 880px 列宽）
- `apps/desktop/src/renderer/src/components/chat/input/InputArea.tsx`（输入区结构）
- `apps/desktop/src/renderer/src/components/chat/input/pro-input.css`（卡片 / 免责 / padding）
- `apps/desktop/src/renderer/src/components/chat/AgentStatus.tsx`（顶部状态条）
- `apps/desktop/src/renderer/src/components/chat/MessageBubble.tsx`（消息排版）
- `apps/desktop/src/renderer/src/components/chat/MessageList.tsx` / `MessageScrollerList.tsx`（双渲染路径）
- `apps/desktop/src/renderer/src/components/chat/WelcomeScreen.tsx`（欢迎页 672px）
- `docs/重构/chat/桌面端AI-Agent输入区设计规范.md`（WorkBuddy 对标规范）
