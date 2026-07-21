// P4 Plan-and-Execute: 执行器（Executor）步骤上下文注入器。
//
// 由 graph.ts 在 plan_execute 模式下传入 makeAgentNode 的 planContextInjector 参数，
// 产出形如 "Current step 2/5: ..." 的 SystemMessage，注入 ReAct 循环的消息尾部。
//
// 三层上下文通道中的 LLM 可见通道（方案 §3.3-2）：
//   当前步骤描述 + 前序步骤结果摘要（截断 step_summary_max_chars）。
import { SystemMessage } from '@langchain/core/messages'

import { getConfig } from '../../config/runtime-config.js'
import type { ModuAgentState } from '../state.js'

/** 步骤摘要截断辅助。 */
function _truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }
  return text.slice(0, maxChars) + '...'
}

/**
 * 创建步骤上下文注入器。
 *
 * @returns 注入器函数：读取 state.current_step / step_results，产出 SystemMessage；
 *          非执行阶段或无当前步骤时返回 null（不注入）
 */
export function makePlanContextInjector(): (
  state: ModuAgentState,
) => SystemMessage | null {
  return function planContextInjector(state: ModuAgentState): SystemMessage | null {
    if (state.plan_phase !== 'executing') {
      return null
    }

    const plan = state.plan ?? []
    const currentStep = state.current_step ?? {}
    if (Object.keys(currentStep).length === 0 || plan.length === 0) {
      return null
    }

    const idx = state.current_step_index ?? 0
    const title = String(currentStep['title'] ?? '')
    const description = String(currentStep['description'] ?? '')
    const stepId = String(currentStep['step_id'] ?? `step_${idx + 1}`)

    const lines: string[] = [
      `Current step ${idx + 1}/${plan.length} (${stepId}): ${title}`,
      description,
    ]

    // 前序步骤摘要（仅本代际，截断防上下文膨胀）
    const replanCount = state.replan_count ?? 0
    const maxChars = Number(getConfig().get('plan_execute.step_summary_max_chars', 500))
    const completed = (state.step_results ?? []).filter(
      (r) => (r?.['replan'] ?? 0) === replanCount,
    )
    if (completed.length > 0) {
      const summary = completed
        .map((r) => {
          const output = _truncate(String(r?.['output'] ?? ''), maxChars)
          return `- ${r?.['step_id'] ?? 'unknown'} (${r?.['status'] ?? 'unknown'}): ${output}`
        })
        .join('\n')
      lines.push(`Completed steps summary:\n${summary}`)
    }

    return new SystemMessage({ content: lines.join('\n') })
  }
}
