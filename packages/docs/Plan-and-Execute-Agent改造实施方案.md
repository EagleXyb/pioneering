# Plan-and-Execute 模式 Agent 改造实施方案
> 目标：基于 `packages/modu-agent` 现有 LangGraph 架构，新增 Plan-and-Execute（规划与执行）运行模式，使 Agent 能够"先规划、后执行、再汇总"，并将阶段化状态实时输出给前端面板。
>
> 范围：`packages/modu-agent` 后端改造方案（状态机 / 节点 / 配置 / 事件协议）；前端对接侧见 [Plan-and-Execute面板对接分析.md](./Plan-and-Execute面板对接分析.md)，两份文档互为配套。
>
> 关联代码：
> - 状态定义：[packages/modu-agent/src/graph/state.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/state.ts)
> - 节点函数：[packages/modu-agent/src/graph/nodes.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/nodes.ts)
> - 图构建：[packages/modu-agent/src/graph/graph.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/graph.ts)
> - 工厂：[packages/modu-agent/src/graph/factory.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/factory.ts)
> - 运行入口：[packages/modu-agent/src/graph/runner.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/runner.ts)
> - 子图参考：[packages/modu-agent/src/graph/subgraph/](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/subgraph/index.ts)
> - 事件桥接：[packages/modu-agent/src/graph/adapters/event-bridge.ts](file:///d:/Administrator/Desktop/pioneering/packages/modu-agent/src/graph/adapters/event-bridge.ts)
> - 对照文档：[packages/docs/CODE_WIKI.md](file:///d:/Administrator/Desktop/pioneering/packages/docs/CODE_WIKI.md)
---
## 一、现状分析与结论
### 1.1 现有 Agent 核心调度逻辑（对照 CODE_WIKI）
`modu-agent` 当前的主流程是一个 **单 ReAct 循环状态图**（`buildModuGraph`，graph.ts:134）：
```
START → perception → [routeAfterPerception]
                        ├─ memory_query → agent → [routeAfterAgent]
                        │                                  ├─ (hitl) human_review → tools → tool_processor → agent ↻
                        │                                  ├─ tools → tool_processor → agent ↻   (ReAct 循环)
                        │                                  └─ response → feedback → memory_update → END
                        └─ response → ... → END (感知熔断)
```
关键机制（与 CODE_WIKI §4.3 / §7.1 对照核实，均与源码一致）：
| 机制 | 实现位置 | 与 Plan-and-Execute 的关系 |
|------|---------|--------------------------|
| 状态定义 `ModuAgentStateAnnotation` | state.ts:131 | 已有 `subtasks` / `subtask_results` / `current_subtask` 字段与 `mergeSubtaskResults` reducer，可复用为 Plan 步骤的载体 |
| ReAct 循环路由 `routeAfterAgent` | nodes.ts:340 | Execute 阶段的单步执行可直接复用该循环，无需重写 |
| 工具执行 `ToolNode` + 结果提取 `makeToolResultProcessor` | graph.ts:204 / nodes.ts:493 | Execute 阶段工具调用完全复用，HITL 审批链路（`human_review`）同样兼容 |
| 多 Agent 分支 `supervisor → Send×N → subagent_run → consensus` | graph.ts:238-253 / subgraph/supervisor.ts | 提供了现成的"任务拆分 + 并行分发 + 结果聚合"样板，Planner 节点可参照 `make_supervisor_node` 实现 |
| 子图隔离 `SubAgentStateAnnotation` + `build_subagent_subgraph` | subgraph/states.ts / builder.ts | 提供了"独立状态空间 + 独立递归预算"的执行器样板，Execute 单步可直接复用或裁剪 |
| 配置门控 `orchestration.multi_agent.enabled` | runtime-config.ts:41 / nodes.ts:986 | Plan-and-Execute 应采用同款门控模式（默认关闭，零侵入） |
| 事件桥接 `LangGraphEventBridge` 节点→域映射 | event-bridge.ts:36-48 | 新增节点只需扩充 `_NODE_DOMAIN_MAP` / `_NODE_ACTION_MAP` 两个映射表 |
| 配置热更新传导 `_GRAPH_REBUILD_PREFIXES` | runner.ts:61 | 新增配置前缀需加入该列表以实现图重建主动传导 |
| 递归预算 `recursionLimit = max_iter*2+7(+2 hitl)(+4 multi)` | graph.ts:316-333 | Plan-and-Execute 节点增多，需按同样规则追加预算 |
### 1.2 核心差距（Gap）
现有架构缺的不是"执行能力"（ReAct 循环已完整），而是 **显式的规划阶段与步骤级状态追踪**：
1. **无规划节点**：`agent` 节点是"边想边做"的隐式规划，无法在执行前产出一份可展示、可审批、可重规划的结构化计划（Plan）。
2. **无步骤级状态字段**：`tool_results` 是扁平追加的，无法表达"第 3 步执行中 / 第 2 步失败"这类步骤生命周期状态，而前端面板（对接分析 §2.3 `PlanItem`）恰恰需要 `pending/running/done/failed/skipped` 五态。
3. **无阶段语义**：事件协议（protocol.ts `EventDomain`/`EventAction`）没有 `plan` 域与阶段动作，前端 `STATE_DELTA` 事件（对接分析 §2.2）无数据源。
4. **无重规划回路**：执行失败后当前只能走 `response → END`，无法"带着失败上下文回到规划器修正计划"。
### 1.3 结论
改造路径为 **"在现有状态图上插入 Plan 阶段分支，复用 ReAct 循环作为 Execute 阶段的单步执行器"**，而非新建引擎。这与 CODE_WIKI §8.7 "Skill 对图透明"、§8.4 "配置门控、默认关闭、零侵入" 的设计约定完全一致：
- **规划器（Planner）**：新增 LLM 节点，产出结构化 `PlanStep[]`；
- **执行器（Executor）**：逐步取出 `current_step`，注入步骤上下文后走现有 `agent ⇄ tools` ReAct 循环；
- **汇总器（Replanner/Finalizer）**：全部步骤完成后走现有 `response → feedback → memory_update` 收尾链路。
---
## 二、现有状态机/调度逻辑的改造点
共 5 处改造点，全部遵循"配置门控、默认关闭"原则，对现有 ReAct / HITL / 多 Agent 路径零影响。
### 2.1 改造点 A：状态字段扩展（state.ts）
在 `ModuAgentState` 与 `ModuAgentStateAnnotation` 中新增 Plan-and-Execute 字段组（复用 `_lw` last-write-wins 与追加 reducer 两种模式）：
```typescript
// === P4 Plan-and-Execute ===
plan?: Array<Record<string, any>>            // 规划步骤列表（Planner 产出，全量覆盖）
current_step_index?: number                  // 当前执行步骤游标（_lw）
step_results?: Array<Record<string, any>>    // 各步骤执行结果（追加 reducer，仿 tool_results）
replan_count?: number                        // 已重规划次数（防死循环）
plan_phase?: string                          // 'planning' | 'executing' | 'finalizing' | '' （阶段标记，供事件与前端）
```
要点：
- `plan` 用 `_lw`（重规划时整体替换）；`step_results` 用追加 reducer（与 `tool_results` 同款，state.ts:160）。
- `makeInitialState()` 同步补默认值（state.ts:208）。
- 现有 `subtasks`/`subtask_results` 字段保留给多 Agent 模式，不复用，避免两种模式语义混淆；`current_step_index` 采用游标而非弹出队列，便于 checkpointer 恢复与前端进度计算。
### 2.2 改造点 B：路由分叉（nodes.ts + graph.ts）
`routeAfterMemoryQuery`（nodes.ts:986）当前只区分 supervisor / agent 两路，扩展为三路：
```typescript
export function routeAfterMemoryQuery(state: ModuAgentState): string {
  const config = getConfig()
  if (config.get('orchestration.multi_agent.enabled', false)) return 'supervisor'
  if (config.get('plan_execute.enabled', false)) return 'planner'   // 新增
  return 'agent'
}
```
优先级说明：multi_agent 与 plan_execute 互斥（同时开启时 multi_agent 优先，并在启动日志中 warn），因为二者都消费 `memory_query → 推理` 这一段入口。
### 2.3 改造点 C：新增三个节点 + 三条路由（graph.ts）
在 `buildModuGraph()` 中，当 `planExecuteEnabled` 时挂载：
| 新增 | 职责 | 参照样板 |
|------|------|---------|
| `planner` 节点 | LLM 生成结构化计划，写入 `plan` / `plan_phase='executing'` / `current_step_index=0` | `makeAgentNode` 的消息组装 + `make_supervisor_node` 的任务产出 |
| `step_dispatch` 路由函数 | 按 `current_step_index` 判断：有剩余步骤 → `agent`（执行当前步）；全部完成 → `response`；失败且可重规划 → `planner` | `route_from_supervisor` 的分发逻辑（改为串行游标而非 Send 并行） |
| `step_finalize` 节点 | 单步执行完回到此节点：提取本步 `tool_results` 增量、写入 `step_results`、游标 +1、标记步骤 done/failed | `makeToolResultProcessor` 的结果提取 |
执行循环的接线：
```
memory_query → [routeAfterMemoryQuery] ─ plan_execute ─▶ planner ─▶ [routeAfterPlan]
                                                                          ├─ plan 为空/解析失败 → response（降级为无计划直答）
                                                                          └─ plan 就绪 → step_dispatch
step_dispatch ─▶ agent ⇄ tools ⇄ tool_processor（现有 ReAct 循环，处理当前步骤）
              ─▶ (hitl) human_review（现有审批链路，步骤内敏感工具照常审批）
agent 无 tool_calls（当前步骤完成）─▶ [routeAfterAgent 扩展] ─ plan_execute 模式 ─▶ step_finalize ─▶ step_dispatch ↻
step_dispatch 检测到 current_step_index >= plan.length ─▶ response → feedback → memory_update → END（现有收尾）
```
**对 `routeAfterAgent` 的最小侵入改造**：plan_execute 模式下，"无 tool_calls" 不再意味着全局结束，而是"当前步骤完成"，因此该路由需感知模式：
```typescript
export function routeAfterAgent(state: ModuAgentState): string {
  const messages = state.messages ?? []
  const lastMsg = messages[messages.length - 1] as any
  const hasToolCalls = lastMsg?.tool_calls?.length > 0
  if (hasToolCalls) return 'tools'
  if (state.plan_phase === 'executing') return 'step_finalize'  // 新增分支
  return '__end__'
}
```
判定依据用 `state.plan_phase` 而非配置，保证运行时一致（配置热更新不影响进行中的图执行）。
### 2.4 改造点 D：递归预算调整（graph.ts:316-333）
按现有"每类节点追加预算"的惯例：
```typescript
if (planExecuteEnabled) {
  const maxSteps = config.get('plan_execute.max_steps', 10)
  // 每步消耗 agent + step_finalize 两个节点，外加 planner 一次
  baseLimit += maxSteps * 2 + 2
}
```
同时 `replan_count` 上限由 `plan_execute.max_replans`（默认 2）控制，从业务层防止 planner↔executor 死循环，recursionLimit 作为兜底。
### 2.5 改造点 E：事件映射扩展（event-bridge.ts + protocol.ts）
`protocol.ts` 的 `EventDomain` 新增 `PLAN: 'plan'`；`EventAction` 新增 `PLAN_CREATED: 'plan_created'` / `STEP_STARTED: 'step_started'` / `STEP_COMPLETED: 'step_completed'` / `REPLANNED: 'replanned'`（仿 P3-12.3.1/12.3.2 的枚举扩展方式，protocol.ts:32-38）。
`event-bridge.ts` 的两个映射表追加：
```typescript
const _NODE_DOMAIN_MAP = {
  // ...现有
  planner: EventDomain.PLAN,
  step_finalize: EventDomain.PLAN,
}
const _NODE_ACTION_MAP = {
  // ...现有
  planner: EventAction.PLAN_CREATED,
  step_finalize: EventAction.STEP_COMPLETED,
}
```
并在 `_emitSseEvents` 中新增 `plan_created` / `step_update` 两类 SSE 细粒度事件，payload 对齐前端对接文档 §2.2 的 `PlanStateDelta`（`phase` + `plan` / `stepUpdate`），使后端 AGUI 输出与前端 `planExecuteStore.applyPlanDelta` 直接对接。
---
## 三、Plan 与 Execute 阶段的职责边界与数据流转
### 3.1 职责边界
| 维度 | Plan 阶段（planner 节点） | Execute 阶段（agent⇄tools + step_finalize） |
|------|--------------------------|-------------------------------------------|
| 核心职责 | 将用户目标拆解为有序、可执行、可验证的步骤序列 | 严格按步骤逐一执行，产出每步结果 |
| LLM 调用 | 1 次（结构化输出，低温度 0.2~0.3） | 每步 1~N 次（ReAct 循环，含工具） |
| 工具调用 | **禁止**（不绑定工具的纯 LLM） | 允许（复用现有 boundLlm + ToolNode + HITL） |
| 状态写入 | `plan` / `plan_phase` / `current_step_index` / `replan_count` | `messages` / `tool_results` / `step_results` / `current_step_index` |
| 记忆读写 | 读：`cleaned_text` / `knowledge` / `history` | 读：当前步骤描述 + 前序 `step_results` 摘要；写：由 `memory_update` 统一收尾 |
| 失败处理 | 解析失败 → 降级直答（response） | 步骤失败 → 记 `step_results[].status='failed'`，视配置决定重规划或终止 |
边界设计原则：**Planner 只产出"做什么"，Executor 只决定"怎么做"**。Planner 不碰工具、不改消息历史（只写计划字段）；Executor 不修改计划（只推进游标），重规划决策集中在 `step_dispatch` 路由，避免职责弥散。
### 3.2 数据流转全图
```
input_data { prompt }
   │
   ▼
perception ──▶ cleaned_text / perception_result / knowledge (memory_query)
   │
   ▼
planner 节点
   │ 输入: cleaned_text + knowledge + 可用工具名清单（registry.listTools() 的 name+description）
   │ 输出: plan = [{ step_id, title, description, depends_on?, status:'pending' }] (≤ max_steps)
   │       plan_phase='executing', current_step_index=0
   ▼
step_dispatch（路由，无 LLM）
   │ 读取 plan[current_step_index] → 写入 state.current_step（复用现有 current_subtask 的 transient 模式）
   ▼
agent 节点（复用 makeAgentNode，仅需在消息组装处追加"当前步骤上下文"）
   │ 注入: SystemMessage("Current step {i}/{n}: {title}\n{description}\n"
   │                    "Completed steps summary: {step_results 摘要}")
   ▼
tools ⇄ agent（ReAct，HITL 兼容）
   ▼
step_finalize 节点
   │ 提取本步新增的 tool_results（按 tool_call_id 去重，现有逻辑）
   │ 追加 step_results: { step_id, status:'done'|'failed', output, tool_refs[] }
   │ current_step_index += 1
   ▼
step_dispatch ↻ ── 全部完成 ──▶ response → feedback → memory_update → END
                     │
                     └─ 失败且 replan_count < max_replans ──▶ planner（携带失败上下文重规划）
```
### 3.3 上下文传递机制
三层通道，全部复用现有机制，不引入新的状态容器：
1. **LangGraph State（主通道）**：`plan` / `current_step_index` / `step_results` 随 `ModuAgentState` 在节点间流转，由 checkpointer 按 `thread_id`（= session_id）持久化——天然获得 **断点续跑** 能力（服务重启后从 checkpointer 恢复游标继续执行）。
2. **SystemMessage 注入（LLM 可见通道）**：Planner 的计划、前序步骤摘要通过 `makeAgentNode` 现有的消息组装逻辑（nodes.ts:392-424 注入 systemPrompt/perception/knowledge 的同款手法）注入，步骤摘要需做长度裁剪（默认每步结果截断 500 字符，可配 `plan_execute.step_summary_max_chars`）。
3. **EventBus / SSE（对外通道）**：Planner 与 step_finalize 节点发布标准 `AgentEvent`，经 `LangGraphEventBridge` 转 SSE 推送前端（对接文档 §2.2 的 `STATE_DELTA`）。事件 metadata 全字符串化，遵循 protocol.ts 现有约定。
**关键约束**：`messages` 在 Execute 阶段持续累积全部步骤的对话，长任务下有上下文膨胀风险。对策：`step_finalize` 中将已完成步骤的中间 ToolMessage 折叠为一条摘要 SystemMessage（`plan_execute.compact_completed_steps=true` 时启用，默认关闭保真），与 CODE_WIKI §8.3 "异步优先、可观测" 不冲突。
---
## 四、新增核心模块、类与接口定义
### 4.1 新增文件清单
```
packages/modu-agent/src/graph/plan-execute/
├── index.ts            # 统一导出
├── types.ts            # PlanStep / StepResult / PlanStateDelta 类型与 zod schema
├── planner.ts          # makePlannerNode / routeAfterPlan / 计划解析与校验
├── dispatcher.ts       # stepDispatch 路由 + makeStepFinalizeNode
└── prompts.ts          # Planner 系统提示模板（含工具清单注入与 JSON 输出约束）
```
放置于 `graph/plan-execute/` 而非顶层模块：它是图编排的一种模式，与 `graph/subgraph/`（多 Agent 模式）平级，符合 CODE_WIKI §3 的目录约定。
### 4.2 类型定义（types.ts）
```typescript
import { z } from 'zod'
/** 单个规划步骤（Planner 输出 + 前端 PlanItem 对齐） */
export interface PlanStep {
  step_id: string                 // 'step_1' 形式，Planner 生成
  title: string                   // 步骤标题（前端展示）
  description: string             // 步骤描述（Executor 执行依据）
  depends_on?: string[]           // 依赖的前序 step_id（V1 仅顺序执行，字段预留）
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
}
export const PlanStepSchema = z.object({
  step_id: z.string(),
  title: z.string().min(1),
  description: z.string().min(1),
  depends_on: z.array(z.string()).optional(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']).default('pending'),
})
export const PlanSchema = z.object({
  goal: z.string(),
  steps: z.array(PlanStepSchema).min(1).max(20),
})
/** 单步执行结果（step_finalize 产出） */
export interface StepResult {
  step_id: string
  status: 'done' | 'failed'
  output: string                  // 本步最终 AIMessage 内容摘要
  tool_refs: string[]             // 本步涉及的 tool_call_id 列表
  error?: string
  started_at?: number
  finished_at?: number
}
/** SSE STATE_DELTA payload（对齐前端对接文档 §2.2 PlanStateDelta） */
export interface PlanStateDelta {
  phase: 'plan' | 'execute' | 'finalize'
  plan?: Array<Record<string, any>>
  step_update?: {
    id: string
    status: PlanStep['status']
    result?: string
    error?: string
    started_at?: number
    finished_at?: number
  }
}
```
### 4.3 Planner（planner.ts）
```typescript
/** 创建规划器节点：调用未绑定工具的 LLM，产出结构化计划。 */
export function makePlannerNode(
  llm: any,                        // 原始 llm（非 boundLlm，规划阶段禁止工具）
  registry: ComponentRegistry,     // 注入可用工具清单（name + description 摘要）
): (state: ModuAgentState) => Promise<Partial<ModuAgentState>>
/** 规划后路由：plan 就绪 → step_dispatch；为空/解析失败 → response（降级直答） */
export function routeAfterPlan(state: ModuAgentState): string
```
实现要点：
- 提示词中注入 `registry.listTools()` 的 `name + description`（截断 200 字符/工具），约束 LLM 输出严格 JSON（`PlanSchema`），用 zod 校验；校验失败重试 1 次（降低 temperature 至 0），仍失败则返回空 plan 触发降级。
- 步骤数硬上限 `plan_execute.max_steps`（默认 10）；`step_id` 规整化为 `step_{i}`。
- 重规划时（`replan_count > 0`）提示词追加"上一轮失败步骤及原因"，并在状态中 `replan_count += 1`。
- LLM 温度取 `plan_execute.planner_temperature`（默认 0.2），保证计划确定性。
### 4.4 Dispatcher 与 StepFinalize（dispatcher.ts）
```typescript
/** 步骤分发路由（条件边）：决定下一个去向。 */
export function stepDispatch(state: ModuAgentState): string
// 逻辑：
//   const idx = state.current_step_index ?? 0
//   const plan = state.plan ?? []
//   if (idx >= plan.length) return 'response'                       // 全部完成
//   const lastFailed = state.step_results?.at(-1)?.status === 'failed'
//   if (lastFailed && !config.get('plan_execute.continue_on_failure', false)) {
//     if ((state.replan_count ?? 0) < config.get('plan_execute.max_replans', 2)) return 'planner'
//     return 'response'                                              // 重规划耗尽，终止
//   }
//   return 'agent'                                                   // 执行当前步
/** 单步收尾节点：提取本步结果、推进游标、发布 SSE 步骤事件。 */
export function makeStepFinalizeNode(): (
  state: ModuAgentState,
) => Promise<Partial<ModuAgentState>>
```
`makeStepFinalizeNode` 核心逻辑：
1. 定位 `plan[current_step_index]`，从 `messages` 尾部截取本步新增消息（以本步开始时消息数为基线，基线存 `state` 的 transient 字段）；
2. 提取本步 `tool_call_id` 列表与最终 AIMessage 摘要（截断）；
3. 追加 `step_results`，更新 `plan[i].status`，`current_step_index + 1`；
4. 组装 `PlanStateDelta`（`phase:'execute'` + `step_update`）写入 transient 字段供 EventBridge 发 SSE。
### 4.5 Agent 节点上下文注入改造（nodes.ts，非新增）
`makeAgentNode` 增加可选参数 `planContextInjector`（默认 null，不传时行为完全不变）：
```typescript
export function makeAgentNode(
  boundLlm: any,
  systemPrompt: string | null = null,
  confidenceThreshold = 0.5,
  conservativeTemperature = 0.3,
  planContextInjector?: (state: ModuAgentState) => SystemMessage | null,  // 新增
)
```
plan_execute 模式下由 `graph.ts` 传入注入器，产出形如 `Current step 2/5: 搜集资料\n...\nCompleted: step_1(done) - 摘要...` 的 SystemMessage。此方式避免改动现有节点签名调用方，符合最小侵入。
### 4.6 配置项（runtime-config.ts DEFAULT_CONFIG 追加）
```typescript
plan_execute: {
  enabled: false,                 // 总开关（默认关闭，零侵入）
  max_steps: 10,                  // 单计划最大步骤数
  max_replans: 2,                 // 最大重规划次数
  planner_temperature: 0.2,       // 规划温度
  continue_on_failure: false,     // 步骤失败是否跳过重规划继续后续步骤
  compact_completed_steps: false, // 是否折叠已完成步骤的中间消息
  step_summary_max_chars: 500,    // 步骤摘要注入 LLM 的截断长度
}
```
同时将 `'plan_execute.'` 追加到 `runner.ts:61` 的 `_GRAPH_REBUILD_PREFIXES`，使开关变更主动触发图重建。
---
## 五、与现有工具调用及记忆模块的集成
### 5.1 工具调用集成
| 现有机制 | 集成方式 |
|---------|---------|
| `ToolNode` + `wrap_modu_tool`（tool-adapter.ts） | Execute 阶段原样复用，Planner 提示词中仅引用工具元信息（`registry.listTools()`），不产生额外包装 |
| HITL 审批（`human_review` + `interrupt`） | 步骤内敏感工具调用照常走 `agent → human_review → tools` 链路；interrupt 暂停时 checkpointer 保存含 `current_step_index` 的完整状态，`resume_sync` 恢复后继续当前步，步骤语义不丢失 |
| 工具重试（`with_tool_retry`） | 不变，作用于工具 invoke 层，与步骤粒度正交 |
| MCP 工具 / Skill 工具 | Planner 的工具清单来自 `registry.listTools()`，天然包含 MCP 与 Skill 注册的工具，无需特殊处理 |
| 多 Agent（supervisor 子图） | 互斥（§2.2），V1 不支持"计划步骤由子 Agent 并行执行"；V2 可在 `step_dispatch` 内对无依赖步骤组用 `Send` 并行（`depends_on` 字段已预留） |
### 5.2 记忆模块集成
| 记忆层 | 集成方式 |
|--------|---------|
| 短期记忆（Checkpointer，thread_id） | 新增 plan 字段随 State 自动持久化，**免费获得断点续跑**：中断后同 session 再发起请求，`_loadPrevConfigOverrides` 同款思路可扩展读取 `plan_phase`，提示用户"上次计划执行到第 3 步"（V2 能力，V1 仅保证状态不丢） |
| 长期知识（`memory_query` 节点 + Store search） | Planner 在 `memory_query` 之后执行，`state.knowledge` 直接可用，注入规划提示词（"相关历史知识"段落），提升计划贴合度 |
| 记忆写入（`memory_update` 节点） | 不变。完整对话（含所有步骤的工具调用）照常写入 `[userId, 'history']`；可选增强：`memory_update` 检测 `plan` 非空时将 `plan` + `step_results` 摘要作为独立条目写入 `[userId, 'plans']` 命名空间，供后续"相似任务计划复用"（V2 能力，字段设计已兼容） |
| 进化闭环（feedback 节点） | 不变。`feedback` 收到的 `output` 中 `tool_results` 含全步骤结果；可选增强：把 `replan_count` 与失败步骤数注入评估 `context`（nodes.ts:626 的 context 构造处追加两个字段），让 `EfficiencyMetrics` 感知"计划质量"，为进化信号提供新维度 |
### 5.3 可观测性集成
- 事件域 `plan.*` 经 EventBus 后，现有 `PersistentEventLog` / `EvolutionSignalCollector` 订阅者自动可见，无需改动订阅方。
- `runner.ts` 的 span 埋点不变；Planner LLM 调用走 `build_chat_model` 同一实例，token usage 由 `responseNode` 现有逻辑归集。
---
## 六、实施步骤
按依赖顺序分 5 个里程碑（M1~M5），每个里程碑独立可验证、可回滚。
### M1：状态与类型层（约 0.5 天）
1. `state.ts`：新增 plan 字段组 + `makeInitialState` 默认值 + `step_results` 追加 reducer。
2. 新建 `graph/plan-execute/types.ts`（PlanStep / StepResult / zod schema）。
3. `runtime-config.ts`：追加 `plan_execute.*` 默认配置；`runner.ts`：`_GRAPH_REBUILD_PREFIXES` 加 `'plan_execute.'`。
4. `protocol.ts`：新增 `PLAN` 域与 4 个 action 枚举。
**验证**：`npm run build` 通过；现有 vitest 全绿（纯新增，无行为变更）。
### M2：Planner 节点（约 1 天）
1. `prompts.ts`：规划系统提示模板（目标 + 工具清单 + JSON 输出约束 + 重规划上下文段）。
2. `planner.ts`：`makePlannerNode`（zod 校验 + 1 次降温重试 + 空计划降级）与 `routeAfterPlan`。
3. 单测：mock LLM 分别返回合法 JSON / 非法 JSON / 空，断言 `plan` 字段、降级路径、`replan_count` 递增。
### M3：执行循环接线（约 1.5 天）
1. `dispatcher.ts`：`stepDispatch` + `makeStepFinalizeNode`（含基线消息截取、结果摘要、游标推进）。
2. `nodes.ts`：`routeAfterAgent` 增加 `plan_phase==='executing'` 分支；`makeAgentNode` 增加 `planContextInjector` 可选参数；`routeAfterMemoryQuery` 增加 planner 分支。
3. `graph.ts`：`buildModuGraph` 增加 `planExecuteEnabled` 参数与节点/边挂载、递归预算追加。
4. `factory.ts`：`create_agent` 读取配置传入 `planExecuteEnabled`。
5. 单测：FakeListChatModel 脚本化模拟"planner 出 3 步 → 每步 agent 直接作答 / 带工具调用 → 全部完成进 response"全链路；含 1 步失败触发重规划、重规划耗尽终止两个分支。
### M4：事件与 SSE 输出（约 0.5 天）
1. `event-bridge.ts`：节点映射表追加 + `_emitSseEvents` 新增 `plan_created` / `step_update`（payload 对齐前端 `PlanStateDelta`）。
2. `step_finalize` 节点接入 transient delta 字段。
3. 单测：构造 stream 事件序列，断言 SSE 事件类型与 payload 结构。
### M5：记忆增强与联调（约 1 天）
1. `memory_update` 可选写入 `[userId, 'plans']` 命名空间；`feedback` context 追加 `replan_count` / `failed_steps`。
2. 端到端：开启 `plan_execute.enabled=true`，用真实 LLM（DeepSeek）跑"调研并总结 X"多步任务，验证 SSE 序列与前端 mock 面板（对接文档 §6.3）对接。
3. 回归：默认配置（开关关闭）下跑通现有全部集成测试，确认零侵入。
**总工作量预估：约 4.5 人日**（含测试）。
---
## 七、关键验证指标
### 7.1 功能正确性
| 指标 | 目标 | 验证方式 |
|------|------|---------|
| 计划解析成功率 | ≥ 95%（合法 JSON 一次通过；含重试 ≥ 99%） | M2 单测 + 真实 LLM 100 次采样统计 |
| 步骤状态机正确性 | 五态流转无非法跃迁（pending→running→done/failed/skipped） | M3 单测覆盖全部流转路径 |
| 重规划收敛 | `replan_count` 不超过 `max_replans`；耗尽后正确走 response 终止 | M3 单测强制注入连续失败 |
| 降级路径 | Planner 失败 → 直答响应，不报错、不挂起 | M3 单测 + E2E |
| 零侵入回归 | 开关关闭时，现有测试套件 100% 通过，图节点数/边数与改造前一致 | M5 回归 + `buildModuGraph` 快照断言 |
### 7.2 兼容性与资源
| 指标 | 目标 | 验证方式 |
|------|------|---------|
| HITL 兼容 | 步骤内敏感工具 interrupt/resume 后步骤游标不丢 | M3 单测：interrupt 在步骤 2 触发，resume 后完成步骤 2/3 |
| Checkpointer 恢复 | 中断后同 thread_id 状态含完整 plan 字段 | M5 用 SqliteSaver 验证 |
| 递归预算充足 | 10 步计划（每步 1 次工具调用）不触发 GraphRecursionError | M3 压测：max_steps=10 + max_iter=3 边界组合 |
| Token 开销增幅 | 相比纯 ReAct，同任务 token 增量 ≤ 40%（Planner 1 次 + 步骤摘要注入） | M5 E2E 对比 `usage.total_tokens` |
| 延迟增幅 | 首 token 延迟增加 = Planner 单次 LLM 耗时（可接受）；总耗时不劣于 ReAct 盲目试错的场景 | M5 E2E 计时 |
### 7.3 前端对接验收（与对接文档 §8 联动）
| 指标 | 目标 |
|------|------|
| `plan_created` SSE 在 Planner 完成后 100% 发出，payload 可序列化为 `PlanStateDelta` | M4 单测 |
| 每个步骤完成发出一条 `step_update`，`id` 与 plan 中 `step_id` 一致 | M4 单测 + E2E |
| 前端 `planExecuteStore.applyPlanDelta` 消费后端真实事件无 schema 适配层 | M5 联调 |
---
## 八、风险与对策
| 风险 | 等级 | 对策 |
|------|------|------|
| LLM 输出非结构化 JSON 导致计划解析失败 | 中 | zod 校验 + 降温重试 1 次 + 空计划降级直答；提示词中给 one-shot 示例 |
| 长计划 messages 膨胀超上下文 | 中 | `compact_completed_steps` 折叠已完成步骤中间消息；步骤摘要截断；`max_steps` 硬上限 |
| planner↔executor 失败循环 | 低 | `max_replans` 业务层限制 + recursionLimit 兜底层双层防护 |
| 与 multi_agent 同时开启语义冲突 | 低 | 互斥路由 + 启动 warn 日志；文档明确"二者选其一" |
| 配置热更新导致进行中的计划状态错乱 | 低 | 路由判定用 `state.plan_phase` 而非实时配置；新配置仅影响新请求（图重建后新 session） |
| `routeAfterAgent` 改动影响纯 ReAct 路径 | 低 | 新分支以 `plan_phase==='executing'` 为条件，纯 ReAct 下该字段恒为空串，走原 `__end__`；M1 即加回归单测锁定 |
---
## 九、后续演进（V2，不在本次范围）
1. **并行步骤执行**：利用 `depends_on` 字段构建 DAG，在 `step_dispatch` 内对就绪步骤组用 `Send` API 并行分发（复用 supervisor 子图的 Send 机制）。
2. **计划审批（Plan-level HITL）**：Planner 产出后 `interrupt` 等待人工确认/编辑计划，复用现有 `resume_sync` 通道，resume payload 携带修改后的 `plan`。
3. **计划复用**：从 `[userId, 'plans']` 命名空间检索相似历史计划，作为 few-shot 注入 Planner。
4. **流式规划**：Planner 改为流式输出，前端面板实时看到计划"逐条浮现"（`plan_created` 改为增量 delta）。
---
> 本方案基于 `packages/modu-agent` 源码（V1.8 分支）静态分析撰写，与 [packages/docs/CODE_WIKI.md](file:///d:/Administrator/Desktop/pioneering/packages/docs/CODE_WIKI.md) §4.3 / §7 / §8 对照核实。前端对接侧设计见 [Plan-and-Execute面板对接分析.md](./Plan-and-Execute面板对接分析.md)。