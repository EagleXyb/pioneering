// P4 Plan-and-Execute: Planner 系统提示模板。
//
// 注入可用工具清单（name + description），约束 LLM 输出严格 JSON（PlanSchema）。
// 重规划时追加"上一轮失败步骤及原因"上下文段。
//
// v1.2 扩展（对应文档 §4.1 建议3/4/5/7）：
//   - 提示词引导 LLM 输出 expected_output / verification_hint / task_type 字段
//   - 工具清单标注 [realtime] 标签（来自 BaseTool.providesRealtimeData()），辅助 LLM 判断 requires_tool
//   - 部分重规划：上下文段含已完成步骤摘要，引导 LLM 仅重新生成失败步骤及后续步骤

// P2（T-14）: 提示词收敛为可注册模板（注册表优先，未接线时回退内置模板对象）。
// 模板字面量已迁至 `graph/prompt-templates.ts`（单一事实源，含 PLAN_STEP_* 数值插值），
// 渲染结果与迁移前逐字节一致（见 tests/reasoning/prompt-registry.test.ts）。
import { renderPromptWithFallback } from '../../reasoning/prompt-registry.js'
import {
  PLANNER_COMPACT_PROMPT_TEMPLATE,
  PLANNER_PROMPT_TEMPLATE,
} from '../prompt-templates.js'

/** 工具清单条目截断长度（字符）。 */
const _TOOL_DESC_MAX_CHARS = 200

/**
 * 构建工具清单文本（注入 Planner 提示词）。
 *
 * v1.2: 若工具元信息含 providesRealtimeData=true，前缀标注 [realtime]，
 * 帮助 LLM 识别哪些工具提供实时/外部数据，从而正确设置 requires_tool。
 *
 * @param tools registry.listTools() 返回的工具元信息列表
 * @returns 形如 "- [realtime] tool_name: description" 的多行文本
 */
export function buildToolCatalogText(
  tools: Record<string, Record<string, any>> | Array<Record<string, any>>,
): string {
  const entries = Array.isArray(tools) ? tools : Object.values(tools ?? {})
  if (entries.length === 0) {
    return '(no tools available)'
  }
  const lines: string[] = []
  for (const t of entries) {
    const name = String(t?.['name'] ?? 'unknown')
    let desc = String(t?.['description'] ?? '')
    if (desc.length > _TOOL_DESC_MAX_CHARS) {
      desc = desc.slice(0, _TOOL_DESC_MAX_CHARS) + '...'
    }
    // v1.2: 标注实时数据工具，辅助 LLM 判断 requires_tool
    const realtimeTag = t?.['provides_realtime_data'] === true ? '[realtime] ' : ''
    lines.push(`- ${realtimeTag}${name}: ${desc}`)
  }
  return lines.join('\n')
}

/**
 * 构建 Planner 系统提示词。
 *
 * @param toolCatalogText 工具清单文本（buildToolCatalogText 产出）
 * @param maxSteps 单计划最大步骤数
 * @param replanContext 重规划上下文（首轮为空串；重规划时含失败步骤及原因 + 已完成步骤摘要）
 * @returns 完整系统提示词
 */
export function buildPlannerSystemPrompt(
  toolCatalogText: string,
  maxSteps: number,
  replanContext: string = '',
): string {
  const replanSection = replanContext
    ? `\n\nPrevious attempt failed. Adjust the plan to avoid the failure:\n${replanContext}\n`
    : ''

  // P2（T-14）: 经 Prompt 注册表渲染（宿主可注册同 id 模板替换），
  // 未接线/未注册时回退内置模板对象 → 与迁移前逐字节一致。
  return renderPromptWithFallback(
    'plan_execute.planner',
    { toolCatalogText, maxSteps, replanSection },
    PLANNER_PROMPT_TEMPLATE,
  )
}

/**
 * 构建 Planner 系统提示词（重试专用简洁版）。
 *
 * 用于首次规划失败后的重试：通过更严格的约束降低弱模型塌陷概率：
 *   1. 进一步限制步骤数（caller 传入减半后的 maxSteps）
 *   2. 更严格的输出格式约束（强调"短"）
 *   3. 提供 one-shot 示例引导正确格式
 *
 * @param toolCatalogText 工具清单文本
 * @param maxSteps 重试时的最大步骤数（应小于首次的 maxSteps）
 * @param replanContext 重规划上下文
 * @returns 简洁版系统提示词
 */
export function buildPlannerSystemPromptCompact(
  toolCatalogText: string,
  maxSteps: number,
  replanContext: string = '',
): string {
  const replanSection = replanContext
    ? `\n\nPrevious attempt failed. Adjust the plan to avoid the failure:\n${replanContext}\n`
    : ''

  // P2（T-14）: 同上，经 Prompt 注册表渲染。
  return renderPromptWithFallback(
    'plan_execute.planner.compact',
    { toolCatalogText, maxSteps, replanSection },
    PLANNER_COMPACT_PROMPT_TEMPLATE,
  )
}

/**
 * 构建重规划上下文段：上一轮失败步骤及原因 + 已完成步骤摘要（部分重规划）。
 *
 * v1.2 扩展（对应文档 §4.1 建议4）：
 *   - 失败步骤：保留原 error 信息
 *   - 已完成步骤：仅含 step_id / title / output 摘要，引导 LLM 复用已完成步骤，
 *     仅重新生成失败步骤及后续步骤（部分重规划），而非全量重生成
 *
 * @param failedSteps 失败的步骤结果列表（StepResult）
 * @param completedSteps 已完成的步骤结果列表（可选，部分重规划时传入）
 * @returns 重规划上下文文本
 */
export function buildReplanContext(
  failedSteps: Array<Record<string, any>>,
  completedSteps?: Array<Record<string, any>>,
): string {
  const hasFailed = failedSteps && failedSteps.length > 0
  const hasCompleted = completedSteps && completedSteps.length > 0
  if (!hasFailed && !hasCompleted) {
    return ''
  }

  const sections: string[] = []

  if (hasCompleted) {
    sections.push('Completed steps (REUSE these — do NOT regenerate them, only generate steps for the failed and remaining work):')
    for (const s of completedSteps!) {
      const stepId = String(s?.['step_id'] ?? 'unknown')
      const output = String(s?.['output'] ?? '').slice(0, 200)
      sections.push(`  - ${stepId}: ${output}`)
    }
  }

  if (hasFailed) {
    sections.push('Failed steps (regenerate these with a different approach):')
    for (const s of failedSteps) {
      const stepId = String(s?.['step_id'] ?? 'unknown')
      const error = String(s?.['error'] ?? s?.['output'] ?? 'unknown error')
      sections.push(`  - ${stepId}: ${error}`)
    }
  }

  return sections.join('\n')
}
