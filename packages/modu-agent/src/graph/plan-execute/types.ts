// P4 Plan-and-Execute: 类型定义与 zod schema。
//
// 与前端 PlanItem / PlanStateDelta 对齐（见 Plan-and-Execute面板对接分析.md §2.2/§2.3）。
//
// v1.2 扩展（对应文档 §4.1 建议5/2/6）：
//   - PlanStep 增加 expected_output / verification_hint / retry_policy / task_type 字段
//   - StepResult 明确 started_at 写入语义
import { z } from 'zod'

/** 步骤类型（决定 step_dispatch 路由去向）。 */
export type PlanStepTaskType = 'reasoning' | 'tool_use' | 'delegation'

/** 步骤级重试策略（step_finalize 失败时按此重试，仍失败再触发 replan）。 */
export interface StepRetryPolicy {
  /** 最大重试次数（不含首次执行；0 = 不重试，直接触发 replan） */
  max_attempts: number
  /** 重试间隔基数（秒），指数退避：第 n 次重试等待 base_delay * 2^n */
  base_delay?: number
}

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
   * v1.2: 优先读取 BaseTool.providesRealtimeData() 元方法推断（见 planner.ts _inferRequiresToolFromToolMetadata）
   */
  requires_tool?: boolean
  /**
   * v1.2 步骤预期输出（对应文档 §4.1 建议5）：
   * 描述本步骤成功完成后应产出的内容形态，作为 step_finalize 判定成功/失败的辅助标准。
   * 例："返回北京今日天气文本，含温度、天气现象、风力"
   */
  expected_output?: string
  /**
   * v1.2 验证提示（对应文档 §4.1 建议5）：
   * 给 step_finalize 的语义合理性检查提示，用于检测 LLM 输出是否满足预期。
   * 例："输出中应包含数字温度值，且温度范围在 -50~60 之间"
   */
  verification_hint?: string
  /**
   * v1.2 步骤级重试策略（对应文档 §4.1 建议2）：
   * 单步失败时按此策略重试，仍失败再触发整计划 replan。
   * 未提供时回退到 plan_execute.step_retry.default_max_attempts 配置。
   */
  retry_policy?: StepRetryPolicy
  /**
   * v1.2 步骤类型（对应文档 §4.1 建议6）：
   * - reasoning: 纯推理/总结/格式化（不调工具）
   * - tool_use: 需要调用工具获取外部数据（默认）
   * - delegation: 委托给子 Agent 执行（Plan-Execute + multi_agent 组合模式）
   * step_dispatch 根据 task_type 路由：reasoning/tool_use → agent；delegation → supervisor
   */
  task_type?: PlanStepTaskType
}

/** 单步 description 长度上限（字符）。超出视为 LLM 输出异常（如嵌套 plan 塌陷）。 */
export const PLAN_STEP_DESCRIPTION_MAX_CHARS = 500

/** 单步 title 长度上限（字符）。 */
export const PLAN_STEP_TITLE_MAX_CHARS = 120

/** 单步 expected_output / verification_hint 长度上限（字符）。 */
export const PLAN_STEP_EXPECTED_OUTPUT_MAX_CHARS = 300
export const PLAN_STEP_VERIFICATION_HINT_MAX_CHARS = 300

export const StepRetryPolicySchema = z.object({
  max_attempts: z.number().int().min(0).max(5),
  base_delay: z.number().positive().optional(),
})

export const PlanStepSchema = z.object({
  step_id: z.string(),
  title: z.string().min(1).max(PLAN_STEP_TITLE_MAX_CHARS),
  description: z.string().min(1).max(PLAN_STEP_DESCRIPTION_MAX_CHARS),
  depends_on: z.array(z.string()).optional(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']).default('pending'),
  requires_tool: z.boolean().optional(),
  // v1.2 扩展字段（均可选，向后兼容旧 plan）
  expected_output: z.string().max(PLAN_STEP_EXPECTED_OUTPUT_MAX_CHARS).optional(),
  verification_hint: z.string().max(PLAN_STEP_VERIFICATION_HINT_MAX_CHARS).optional(),
  retry_policy: StepRetryPolicySchema.optional(),
  task_type: z.enum(['reasoning', 'tool_use', 'delegation']).optional(),
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
  /** 步骤开始执行时间戳（ms，由 step_dispatch 节点写入 step_results 时附带） */
  started_at?: number
  /** 步骤结束时间戳（ms，由 step_finalize 节点写入） */
  finished_at?: number
  /** v1.2: 本步已重试次数（含首次执行；0 = 未重试） */
  retry_count?: number
  /** v1.2: 步骤降级模式标记（工具全失败但 LLM 产出降级内容，status 仍为 'done'） */
  degraded?: boolean
  /** v1.2: 重规划代际标签（用于隔离重规划前旧结果，由 dispatcher 写入） */
  replan?: number
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
    /** v1.2: 重试次数（前端展示重试状态用） */
    retry_count?: number
  }
}
