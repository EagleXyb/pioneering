// P2（T-14）: 内置 Prompt 模板（内核默认值的**唯一事实源**）。
//
// 迁移来源（逐字面量搬运，字符等价由 `tests/reasoning/prompt-registry.test.ts` 锁定）：
//   - `graph/plan-execute/prompts.ts:68-106`   → plan_execute.planner
//   - `graph/plan-execute/prompts.ts:131-153`  → plan_execute.planner.compact
//   - `graph/subgraph/builder.ts:27-39`        → subagent.research / coding / review / default
//   - `graph/nodes.ts:1048-1059`               → agent.doc_generation_task
//
// 说明（`agent.default_system`）：默认防幻觉 system prompt 的字面量**保留在
//   `graph/factory.ts`（`_DEFAULT_ANTI_HALLUCINATION_PROMPT`）**——避免对超长
//   多语言字面量做无收益搬运；该字面量在 `factory.ts` 内被包装为 `PromptTemplate`
//   并注册进注册表，因而同样是"可注册"的扩展点。
//
// 变量替换：仅 `{{name}}` 参与渲染；数值常量（PLAN_STEP_*）在模板构造期插值，
//   使其继续以 `plan-execute/types.js` 为单一来源，避免数值漂移。
//
// 装配：`registerBuiltinPrompts()` 由 `graph/factory.ts` 的 `create_agent` 调用
//   （幂等；宿主同 id 注册优先，不被回退覆盖）。未接线时调用点通过
//   `renderPromptWithFallback` 回退到本文件的模板对象 → 输出仍与迁移前一致。

import type { PromptRegistry, PromptTemplate } from '../core/interfaces/prompt.js'
import { getPromptRegistry } from '../reasoning/prompt-registry.js'
import {
  PLAN_STEP_DESCRIPTION_MAX_CHARS,
  PLAN_STEP_EXPECTED_OUTPUT_MAX_CHARS,
  PLAN_STEP_TITLE_MAX_CHARS,
  PLAN_STEP_VERIFICATION_HINT_MAX_CHARS,
} from './plan-execute/types.js'

const _SYSTEM = (content: string) => [{ role: 'system' as const, content }]
const _USER = (content: string) => [{ role: 'user' as const, content }]

// ------------------------------------------------------------------
// Plan-and-Execute: Planner（完整版 / 重试简洁版）
// ------------------------------------------------------------------

const _PLANNER_CONTENT = `You are a planning module of an AI agent. Your job is to decompose the user's goal into an ordered, executable, verifiable sequence of steps.

Available tools (you may reference them in step descriptions, but you MUST NOT call them yourself):
{{toolCatalogText}}

Tools tagged [realtime] provide external/real-time data (search_engine, datetime, http_request, etc.). For steps needing such data, set requires_tool=true and reference the tool in the description.

Rules:
1. Produce at most {{maxSteps}} steps, ordered by execution sequence.
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
   - Example of WRONG description: '{"goal": "...", "steps": [...]}' (this is a nested plan, not an instruction).{{replanSection}}`

const _PLANNER_COMPACT_CONTENT = `You are a planning module of an AI agent. Decompose the user's goal into a SHORT plan.

Available tools (reference in descriptions, do NOT call them yourself):
{{toolCatalogText}}

CRITICAL RULES (previous attempt FAILED — follow strictly):
1. Produce AT MOST {{maxSteps}} steps. Fewer is better. Aim for 3-5 steps.
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
BAD example description (FORBIDDEN): {"goal": "...", "steps": [...]}{{replanSection}}`

/** Plan-and-Execute Planner 系统提示模板（完整版）。 */
export const PLANNER_PROMPT_TEMPLATE: PromptTemplate = {
  id: 'plan_execute.planner',
  version: '1.0.0',
  messages: _SYSTEM(_PLANNER_CONTENT),
  variables: ['toolCatalogText', 'maxSteps', 'replanSection'],
}

/** Plan-and-Execute Planner 系统提示模板（首次规划失败后的重试简洁版）。 */
export const PLANNER_COMPACT_PROMPT_TEMPLATE: PromptTemplate = {
  id: 'plan_execute.planner.compact',
  version: '1.0.0',
  messages: _SYSTEM(_PLANNER_COMPACT_CONTENT),
  variables: ['toolCatalogText', 'maxSteps', 'replanSection'],
}

// ------------------------------------------------------------------
// 多 Agent: 子 Agent 角色系统提示（按 task_type 区分）
// ------------------------------------------------------------------

/**
 * 子 Agent 角色模板（迁移自 `graph/subgraph/builder.ts:27-39` 的
 * `_SYSTEM_PROMPT_TEMPLATES`；`taskTypes` 用于 `list(taskType)` 过滤）。
 */
export const SUBAGENT_PROMPT_TEMPLATES: Record<string, PromptTemplate> = {
  research: {
    id: 'subagent.research',
    version: '1.0.0',
    taskTypes: ['research'],
    messages: _SYSTEM(
      'You are a Research Agent. Your task is to investigate and gather information ' +
      'about the given topic. Provide thorough, factual findings.',
    ),
  },
  coding: {
    id: 'subagent.coding',
    version: '1.0.0',
    taskTypes: ['coding'],
    messages: _SYSTEM(
      'You are a Code Agent. Your task is to write, analyze, or review code ' +
      'for the given requirement. Provide clear, correct implementations.',
    ),
  },
  review: {
    id: 'subagent.review',
    version: '1.0.0',
    taskTypes: ['review'],
    messages: _SYSTEM(
      'You are a Review Agent. Your task is to review and evaluate the given content ' +
      'for quality, correctness, and completeness. Provide constructive feedback.',
    ),
  },
  default: {
    id: 'subagent.default',
    version: '1.0.0',
    taskTypes: ['default'],
    messages: _SYSTEM(
      'You are a specialized Agent. Complete the assigned subtask accurately and concisely.',
    ),
  },
}

/** 子 Agent 默认角色 id（taskType 未命中时回退）。 */
export const SUBAGENT_DEFAULT_TEMPLATE_ID = 'subagent.default'

// ------------------------------------------------------------------
// Agent: 任务类型上下文（文档生成强提醒）
// ------------------------------------------------------------------

const _DOC_GEN_TASK_CONTENT =
  `TASK TYPE: document_generation\n\n` +
  `This is a DOCUMENT GENERATION task. You MUST:\n` +
  `1. First gather necessary information (e.g., call search_engine, datetime as needed)\n` +
  `2. Then organize the information into a well-structured Markdown document\n` +
  `3. Call the doc_writer tool with auto_name=true, a descriptive title, and the full Markdown content\n` +
  `4. After doc_writer succeeds, produce a final response following the document delivery format\n` +
  `Do NOT end the conversation without calling doc_writer. The doc_writer tool is your document output channel.\n\n` +
  `LANGUAGE: All narration, thinking, and the final answer MUST be in the same language as the user's message. ` +
  `If the user speaks Chinese, think and answer in Chinese — do NOT use English for intermediate narration.\n` +
  `FINAL ANSWER: Keep it clean and concise. Do NOT repeat intermediate reasoning in the final answer.`

/** 文档生成任务类型上下文模板（`agentNode` 按 `state.task_type` 注入）。 */
export const DOC_GEN_TASK_PROMPT_TEMPLATE: PromptTemplate = {
  id: 'agent.doc_generation_task',
  version: '1.0.0',
  taskTypes: ['document_generation'],
  messages: _SYSTEM(_DOC_GEN_TASK_CONTENT),
}

// ------------------------------------------------------------------
// Feedback: 回复质量 LLM Judge（P3/T-21 自 feedback/quality-monitor.ts 迁入）
// ------------------------------------------------------------------

const _QUALITY_JUDGE_SYSTEM_CONTENT =
  '你是一个严格的回复质量评估器。请从相关性、完整性、准确性、置信度、' +
  '工具调用成功率五个维度评估 Agent 回复质量，输出 0.00-1.00 之间的分数（保留 2 位小数）。' +
  '若回复未涉及工具调用，tool_success 默认为 1.0。' +
  '仅输出一个合法 JSON 对象，不要包含任何额外文字、Markdown 代码块或解释。'

/** 回复质量评估 system prompt（`QualityMonitor` LLM Judge 模式）。 */
export const FEEDBACK_QUALITY_JUDGE_SYSTEM_TEMPLATE: PromptTemplate = {
  id: 'feedback.quality_judge_system',
  version: '1.0.0',
  messages: _SYSTEM(_QUALITY_JUDGE_SYSTEM_CONTENT),
}

// 注：末行 JSON 示例为**单花括号**（非模板占位符）；仅 `{{prompt}}` / `{{response}}`
//     参与渲染 → 渲染结果与迁移前逐字节一致。
const _QUALITY_JUDGE_USER_CONTENT =
  '【用户问题】\n{{prompt}}\n\n' +
  '【Agent 回复】\n{{response}}\n\n' +
  '【评估维度】\n' +
  '1. relevance（相关性）：回复是否切题、与问题相关\n' +
  '2. completeness（完整性）：回复是否完整回答了问题的各个方面\n' +
  '3. accuracy（准确性）：回复中的事实信息是否准确无误\n' +
  '4. confidence（置信度）：回复表达是否明确、是否避免不必要的模糊\n' +
  '5. tool_success（工具调用成功率）：基于回复判断工具调用是否成功\n\n' +
  '【输出格式】\n' +
  '{"relevance": 0.85, "completeness": 0.80, "accuracy": 0.90, ' +
  '"confidence": 0.85, "tool_success": 1.0, "overall": 0.87, ' +
  '"reasoning": "简短说明"}'

/** 回复质量评估 user prompt（`{{prompt}}` / `{{response}}`）。 */
export const FEEDBACK_QUALITY_JUDGE_USER_TEMPLATE: PromptTemplate = {
  id: 'feedback.quality_judge_user',
  version: '1.0.0',
  messages: _USER(_QUALITY_JUDGE_USER_CONTENT),
  variables: ['prompt', 'response'],
}

// ------------------------------------------------------------------
// Orchestration: 多 Agent 共识 LLM Judge（P3/T-21 自 patterns/consensus.ts 迁入）
// ------------------------------------------------------------------

// 注：占位符**由单花括号统一为 `{{var}}`**（迁移前的 `.replace('{task}', ...)`
//     与本轮注册表语法不一致；两者渲染结果逐字节一致，末尾 JSON 示例不受影响）。
const _CONSENSUS_JUDGE_CONTENT =
  'You are an impartial judge. Select the best answer from candidates.\n' +
  'Task: {{task}}\nCandidates:\n{{candidates}}\n' +
  'Respond with ONLY JSON: {"winner": <index>, "reason": "<brief>"}'

/** 多 Agent 共识 LLM Judge prompt（`{{task}}` / `{{candidates}}`）。 */
export const ORCHESTRATION_CONSENSUS_JUDGE_TEMPLATE: PromptTemplate = {
  id: 'orchestration.consensus_judge',
  version: '1.0.0',
  messages: _USER(_CONSENSUS_JUDGE_CONTENT),
  variables: ['task', 'candidates'],
}

// ------------------------------------------------------------------
// 装配
// ------------------------------------------------------------------

/** 全部内置模板（注册顺序无关，同 id 覆盖）。 */
export const BUILTIN_PROMPT_TEMPLATES: PromptTemplate[] = [
  PLANNER_PROMPT_TEMPLATE,
  PLANNER_COMPACT_PROMPT_TEMPLATE,
  ...Object.values(SUBAGENT_PROMPT_TEMPLATES),
  DOC_GEN_TASK_PROMPT_TEMPLATE,
  // P3（T-21）：T-14 残余站点（feedback / orchestration）迁入
  FEEDBACK_QUALITY_JUDGE_SYSTEM_TEMPLATE,
  FEEDBACK_QUALITY_JUDGE_USER_TEMPLATE,
  ORCHESTRATION_CONSENSUS_JUDGE_TEMPLATE,
]

/**
 * 幂等注册全部内置模板（**装配层默认填充**语义）。
 *
 * 关键约定（与 `ComponentRegistry.registerPrompt` 的"覆盖"语义区分）：
 *   本函数**只填补缺失项**，不覆盖已存在的同 id 模板 —— 否则 `create_agent`
 *   每次调用都会把宿主事先注册的同 id 模板悄悄改回内置版本，使
 *   "替换 prompt 不改内核源码"在真实启动序列（宿主先注册 → create_agent）下失效。
 *
 * 因此：
 *   - 首次调用：注册全部内置模板；
 *   - 重复调用：无操作（幂等）；
 *   - 宿主先注册同 id：内置模板不覆盖，宿主版本保持生效。
 *
 * @returns 内置模板 id 总数（供日志/验收断言；非"本次实际写入条数"）
 */
export function registerBuiltinPrompts(registry?: PromptRegistry): number {
  const reg = registry ?? getPromptRegistry()
  for (const tpl of BUILTIN_PROMPT_TEMPLATES) {
    // `has` 是 PromptRegistry 契约方法；极端实现缺失时退化为"未注册"
    if (typeof reg.has === 'function' && reg.has(tpl.id)) continue
    reg.register(tpl)
  }
  return BUILTIN_PROMPT_TEMPLATES.length
}

/** 内置模板 id 清单（供验收断言使用）。 */
export function listBuiltinPromptIds(): string[] {
  return BUILTIN_PROMPT_TEMPLATES.map((t) => t.id)
}
