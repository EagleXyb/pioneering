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
      lines.push(`Completed steps summary (for reference only, do NOT repeat this content):\n${summary}`)
      // P1-优化修复: 显式约束 LLM 仅产出当前步骤的新内容，禁止重复前序步骤的输出
      lines.push(
        '',
        'IMPORTANT: Do NOT repeat or rephrase content from previous steps. Only produce NEW output relevant to the CURRENT step. If the current step depends on previous results, reference them briefly and build upon them, do not copy.',
      )
    }

    // P1-优化: 针对需要外部/实时数据的步骤，显式约束 LLM 必须调用工具获取数据，
    // 禁止凭参数化记忆编造。requires_tool 为 true 的步骤强制工具调用提醒。
    // P1-优化修复: 加强措辞，明确列出可用工具名，关闭"声明无法获取"逃生路径
    const requiresTool = Boolean(currentStep['requires_tool'])
    if (requiresTool) {
      lines.push(
        '',
        'CRITICAL: This step requires external/real-time data. You MUST call an available tool to obtain the data — do NOT fabricate data from your parametric memory. Available tools include search_engine (for weather/news/prices), datetime (for current date/time), http_request (for API calls), and calculator. Calling a tool IS your way to access real-time data. Do NOT claim "I cannot access the internet" — use search_engine instead.',
      )
    }

    return new SystemMessage({ content: lines.join('\n') })
  }
}
