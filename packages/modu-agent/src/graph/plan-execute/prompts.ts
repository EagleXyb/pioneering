// P4 Plan-and-Execute: Planner 系统提示模板。
//
// 注入可用工具清单（name + description），约束 LLM 输出严格 JSON（PlanSchema）。
// 重规划时追加"上一轮失败步骤及原因"上下文段。

/** 工具清单条目截断长度（字符）。 */
const _TOOL_DESC_MAX_CHARS = 200

/**
 * 构建工具清单文本（注入 Planner 提示词）。
 *
 * @param tools registry.listTools() 返回的工具元信息列表
 * @returns 形如 "- tool_name: description" 的多行文本
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
    lines.push(`- ${name}: ${desc}`)
  }
  return lines.join('\n')
}

/**
 * 构建 Planner 系统提示词。
 *
 * @param toolCatalogText 工具清单文本（buildToolCatalogText 产出）
 * @param maxSteps 单计划最大步骤数
 * @param replanContext 重规划上下文（首轮为空串；重规划时含失败步骤及原因）
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

  return `You are a planning module of an AI agent. Your job is to decompose the user's goal into an ordered, executable, verifiable sequence of steps.

Available tools (you may reference them in step descriptions, but you MUST NOT call them yourself):
${toolCatalogText}

Rules:
1. Produce at most ${maxSteps} steps, ordered by execution sequence.
2. Each step must be self-contained: a clear title and a concrete description telling the executor WHAT to do (the executor decides HOW).
3. Output STRICT JSON only, matching this schema (no markdown fences, no extra text):
{
  "goal": "<restated user goal>",
  "steps": [
    {
      "step_id": "step_1",
      "title": "<short step title>",
      "description": "<concrete instruction for the executor>",
      "depends_on": ["step_0"],
      "status": "pending"
    }
  ]
}
4. step_id must follow the pattern step_<N> starting from step_1. depends_on is optional.
5. Do NOT include any reasoning, commentary, or explanation outside the JSON object.${replanSection}`
}

/**
 * 构建重规划上下文段：上一轮失败步骤及原因。
 *
 * @param failedSteps 失败的步骤结果列表（StepResult）
 * @returns 重规划上下文文本
 */
export function buildReplanContext(
  failedSteps: Array<Record<string, any>>,
): string {
  if (!failedSteps || failedSteps.length === 0) {
    return ''
  }
  const lines: string[] = []
  for (const s of failedSteps) {
    const stepId = String(s?.['step_id'] ?? 'unknown')
    const error = String(s?.['error'] ?? s?.['output'] ?? 'unknown error')
    lines.push(`- ${stepId}: ${error}`)
  }
  return lines.join('\n')
}
