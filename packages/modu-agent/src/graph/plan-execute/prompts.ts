// P4 Plan-and-Execute: Planner 系统提示模板。
//
// 注入可用工具清单（name + description），约束 LLM 输出严格 JSON（PlanSchema）。
// 重规划时追加"上一轮失败步骤及原因"上下文段。

import {
  PLAN_STEP_DESCRIPTION_MAX_CHARS,
  PLAN_STEP_TITLE_MAX_CHARS,
} from './types.js'

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
      "status": "pending",
      "requires_tool": false
    }
  ]
}
4. step_id must follow the pattern step_<N> starting from step_1. depends_on is optional.
5. Do NOT include any reasoning, commentary, or explanation outside the JSON object.
6. requires_tool (boolean, default false): Set to true if this step requires external/real-time data (e.g. weather, news, stock prices, current date/time, API data, database queries). For such steps, name the specific tool to use in the description (e.g. "Call search_engine to fetch ..."). The executor MUST call a tool for requires_tool=true steps and is forbidden from fabricating data. Set to false for pure reasoning/summarization/formatting steps.
7. CRITICAL — title and description content constraints (violations will cause the plan to be rejected):
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
    {"step_id": "step_1", "title": "<short title>", "description": "<one sentence instruction>", "status": "pending", "requires_tool": false}
  ]
}

GOOD example description: "Call search_engine to fetch AI Agent trends from the last 30 days."
BAD example description (FORBIDDEN): {"goal": "...", "steps": [...]}${replanSection}`
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
