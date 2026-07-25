// P4 Plan-and-Execute: Planner 系统提示模板。
//
// 注入可用工具清单（name + description），约束 LLM 输出严格 JSON（PlanSchema）。
// 重规划时追加"上一轮失败步骤及原因"上下文段。
//
// v1.2 扩展（对应文档 §4.1 建议3/4/5/7）：
//   - 提示词引导 LLM 输出 expected_output / verification_hint / task_type 字段
//   - 工具清单标注 [realtime] 标签（来自 BaseTool.providesRealtimeData()），辅助 LLM 判断 requires_tool
//   - 部分重规划：上下文段含已完成步骤摘要，引导 LLM 仅重新生成失败步骤及后续步骤

import {
  PLAN_STEP_DESCRIPTION_MAX_CHARS,
  PLAN_STEP_EXPECTED_OUTPUT_MAX_CHARS,
  PLAN_STEP_TITLE_MAX_CHARS,
  PLAN_STEP_VERIFICATION_HINT_MAX_CHARS,
} from './types.js'

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

  return `You are a planning module of an AI agent. Your job is to decompose the user's goal into an ordered, executable, verifiable sequence of steps.

Available tools (you may reference them in step descriptions, but you MUST NOT call them yourself):
${toolCatalogText}

Tools tagged [realtime] provide external/real-time data (search_engine, datetime, http_request, etc.). For steps needing such data, set requires_tool=true and reference the tool in the description.

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
      "status": "pending",
      "requires_tool": false,
      "expected_output": "<what the step should produce, e.g. 'Beijing weather text with temperature/condition/wind'>",
      "verification_hint": "<how to verify the output, e.g. 'output must contain numeric temperature in -50~60 range'>",
      "task_type": "tool_use"
    }
  ]
}
4. step_id must follow the pattern step_<N> starting from step_1. depends_on is optional.
5. Do NOT include any reasoning, commentary, or explanation outside the JSON object.
6. requires_tool (boolean, default false): Set to true if this step requires external/real-time data (e.g. weather, news, stock prices, current date/time, API data, database queries). For such steps, name the specific tool to use in the description (e.g. "Call search_engine to fetch ..."). The executor MUST call a tool for requires_tool=true steps and is forbidden from fabricating data. Set to false for pure reasoning/summarization/formatting steps.
7. expected_output (string, optional but recommended, <= ${PLAN_STEP_EXPECTED_OUTPUT_MAX_CHARS} chars): Describe what a successful step should produce. This helps the executor verify its output.
8. verification_hint (string, optional, <= ${PLAN_STEP_VERIFICATION_HINT_MAX_CHARS} chars): A concrete check the executor can apply to validate the output (e.g. "must contain a numeric temperature", "must list at least 3 items").
9. task_type (enum, optional, default "tool_use"): One of "reasoning" (pure reasoning/summarization/formatting, no tools), "tool_use" (default, requires tool calls for external data), "delegation" (delegate to a sub-agent for complex subtasks — only use when multi-agent mode is enabled).
10. CRITICAL — title and description content constraints (violations will cause the plan to be rejected):
   - title MUST be a short natural-language phrase (<= ${PLAN_STEP_TITLE_MAX_CHARS} characters), NOT a JSON object or a nested plan.
   - description MUST be a concrete natural-language sentence (1-3 sentences, <= ${PLAN_STEP_DESCRIPTION_MAX_CHARS} characters, <= 10 lines), NOT a JSON object, NOT a nested plan, and MUST NOT contain plan-schema field names like "goal", "steps", "step_id", "depends_on".
   - NEVER embed a plan object, a step object, or any JSON structure inside title or description. If you feel the urge to write a plan inside a description, STOP — that is wrong; write a single sentence instruction instead.
   - Example of CORRECT description: "Call search_engine to fetch the latest AI Agent development news from the past 30 days, then summarize the top 5 trends."
   - Example of WRONG description: '{"goal": "...", "steps": [...]}' (this is a nested plan, not an instruction).${replanSection}`
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

  return `You are a planning module of an AI agent. Decompose the user's goal into a SHORT plan.

Available tools (reference in descriptions, do NOT call them yourself):
${toolCatalogText}

CRITICAL RULES (previous attempt FAILED — follow strictly):
1. Produce AT MOST ${maxSteps} steps. Fewer is better. Aim for 3-5 steps.
2. Each step title: <= ${PLAN_STEP_TITLE_MAX_CHARS} chars, natural language, NO JSON.
3. Each step description: 1-2 SHORT sentences, <= ${PLAN_STEP_DESCRIPTION_MAX_CHARS} chars, <= 5 lines, natural language only.
4. NEVER embed JSON, plan objects, or nested structures in title/description.
5. Output STRICT JSON only (no markdown, no commentary):
{
  "goal": "<restated user goal>",
  "steps": [
    {"step_id": "step_1", "title": "<short title>", "description": "<one sentence instruction>", "status": "pending", "requires_tool": false, "expected_output": "<expected output>", "task_type": "tool_use"}
  ]
}
6. requires_tool: true if the step needs external/real-time data (use [realtime]-tagged tools).
7. expected_output: short description of what success looks like (optional but recommended).
8. task_type: "reasoning" | "tool_use" | "delegation" (default "tool_use").

GOOD example description: "Call search_engine to fetch AI Agent trends from the last 30 days."
BAD example description (FORBIDDEN): {"goal": "...", "steps": [...]}${replanSection}`
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
