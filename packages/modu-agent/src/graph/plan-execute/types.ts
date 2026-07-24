// P4 Plan-and-Execute: 类型定义与 zod schema。
//
// 与前端 PlanItem / PlanStateDelta 对齐（见 Plan-and-Execute面板对接分析.md §2.2/§2.3）。
import { z } from 'zod'

/** 单个规划步骤（Planner 输出 + 前端 PlanItem 对齐）。 */
export interface PlanStep {
  step_id: string
  title: string
  description: string
  depends_on?: string[]
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  /**
   * P2-优化: 标记该步骤是否必须调用工具获取外部/实时数据。
   * - true: step_finalize 会校验是否实际调用了工具，未调用则判失败触发重规划
   * - false/undefined: 不强制工具调用（常规推理/总结类步骤）
   *
   * 由 Planner 根据 step description 内容判定（涉及天气/新闻/价格/日期等实时数据时置 true）。
   */
  requires_tool?: boolean
}

/** 单步 description 长度上限（字符）。超出视为 LLM 输出异常（如嵌套 plan 塌陷）。 */
export const PLAN_STEP_DESCRIPTION_MAX_CHARS = 500

/** 单步 title 长度上限（字符）。 */
export const PLAN_STEP_TITLE_MAX_CHARS = 120

export const PlanStepSchema = z.object({
  step_id: z.string(),
  title: z.string().min(1).max(PLAN_STEP_TITLE_MAX_CHARS),
  description: z.string().min(1).max(PLAN_STEP_DESCRIPTION_MAX_CHARS),
  depends_on: z.array(z.string()).optional(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']).default('pending'),
  requires_tool: z.boolean().optional(),
})

export const PlanSchema = z.object({
  goal: z.string(),
  steps: z.array(PlanStepSchema).min(1).max(20),
})

/** 单步执行结果（step_finalize 产出）。 */
export interface StepResult {
  step_id: string
  status: 'done' | 'failed'
  output: string
  tool_refs: string[]
  error?: string
  started_at?: number
  finished_at?: number
}

/** SSE STATE_DELTA payload（对齐前端 PlanStateDelta）。 */
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
