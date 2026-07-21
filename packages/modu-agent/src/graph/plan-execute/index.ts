// P4 Plan-and-Execute: 规划与执行模式（统一导出）。
//
// 与 graph/subgraph/（多 Agent 模式）平级，是图编排的一种可选模式，
// 默认关闭（plan_execute.enabled=false），对现有 ReAct / HITL / 多 Agent 路径零侵入。
//
// 模块划分：
//   types.ts      —— PlanStep / StepResult / PlanStateDelta 类型与 zod schema
//   prompts.ts    —— Planner 系统提示模板（工具清单注入 + JSON 输出约束）
//   planner.ts    —— makePlannerNode / routeAfterPlan（计划生成、校验、降级）
//   dispatcher.ts —— makeStepDispatchNode / stepDispatch / makeStepFinalizeNode（执行循环）
export {
  type PlanStep,
  PlanStepSchema,
  PlanSchema,
  type StepResult,
  type PlanStateDelta,
} from './types.js'
export {
  buildToolCatalogText,
  buildPlannerSystemPrompt,
  buildReplanContext,
} from './prompts.js'
export { makePlannerNode, routeAfterPlan } from './planner.js'
export {
  makeStepDispatchNode,
  stepDispatch,
  makeStepFinalizeNode,
} from './dispatcher.js'
export { makePlanContextInjector } from './context.js'
