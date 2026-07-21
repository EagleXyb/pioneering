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
