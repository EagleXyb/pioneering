import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  DefaultPromptRegistry,
  getPromptRegistry,
  setPromptRegistry,
  resetPromptRegistry,
  renderPromptWithFallback,
} from '@/reasoning/prompt-registry.js'
import type { PromptRegistry, PromptTemplate } from '@/core/interfaces/prompt.js'
import {
  buildPlannerSystemPrompt,
  buildPlannerSystemPromptCompact,
} from '@/graph/plan-execute/prompts.js'
import {
  PLAN_STEP_DESCRIPTION_MAX_CHARS,
  PLAN_STEP_EXPECTED_OUTPUT_MAX_CHARS,
  PLAN_STEP_TITLE_MAX_CHARS,
  PLAN_STEP_VERIFICATION_HINT_MAX_CHARS,
} from '@/graph/plan-execute/types.js'
import {
  DOC_GEN_TASK_PROMPT_TEMPLATE,
  FEEDBACK_QUALITY_JUDGE_SYSTEM_TEMPLATE,
  FEEDBACK_QUALITY_JUDGE_USER_TEMPLATE,
  ORCHESTRATION_CONSENSUS_JUDGE_TEMPLATE,
  PLANNER_COMPACT_PROMPT_TEMPLATE,
  PLANNER_PROMPT_TEMPLATE,
  SUBAGENT_PROMPT_TEMPLATES,
  listBuiltinPromptIds,
  registerBuiltinPrompts,
} from '@/graph/prompt-templates.js'
import { _getSystemPrompt } from '@/graph/subgraph/builder.js'
import { resetRegistry } from '@/core/registry.js'
// P3（T-21）：残余站点的消费者（端到端断言"消费者真的经注册表渲染"）
import { QualityMonitor } from '@/feedback/quality-monitor.js'
import { LLMJudgeStrategy } from '@/orchestration/patterns/consensus.js'
import { getConfig } from '@/config/runtime-config.js'

// ============================================================
// P2（T-14）Prompt 注册表测试
//
// 两个目标：
//   1. 注册表语义（注册/覆盖/回退/未知 id/缺失变量）
//   2. **字符等价**（L3 门禁）：迁移后渲染结果与迁移前内联字面量逐字节一致
//      —— golden 字符串为迁移前源码的逐字副本（含数值常量硬编码，防常量漂移）
// ============================================================

// 数值常量硬编码断言：模板中的 <= N chars 文案依赖这些常量
const _NUMERIC_LOCK = {
  TITLE: 120,
  DESCRIPTION: 500,
  EXPECTED_OUTPUT: 300,
  VERIFICATION_HINT: 300,
}

const CATALOG = '- datetime: 获取当前日期时间\n- [realtime] search_engine: 搜索新闻'
const REPLAN_RAW = '- step_1: boom'
const REPLAN_SECTION = `\n\nPrevious attempt failed. Adjust the plan to avoid the failure:\n${REPLAN_RAW}\n`

/** 迁移前 `buildPlannerSystemPrompt` 的返回值（逐字副本）。 */
function goldenPlannerFull(catalog: string, maxSteps: number, replanSection: string): string {
  return `You are a planning module of an AI agent. Your job is to decompose the user's goal into an ordered, executable, verifiable sequence of steps.

Available tools (you may reference them in step descriptions, but you MUST NOT call them yourself):
${catalog}

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
7. expected_output (string, optional but recommended, <= ${_NUMERIC_LOCK.EXPECTED_OUTPUT} chars): Describe what a successful step should produce. This helps the executor verify its output.
8. verification_hint (string, optional, <= ${_NUMERIC_LOCK.VERIFICATION_HINT} chars): A concrete check the executor can apply to validate the output (e.g. "must contain a numeric temperature", "must list at least 3 items").
9. task_type (enum, optional, default "tool_use"): One of "reasoning" (pure reasoning/summarization/formatting, no tools), "tool_use" (default, requires tool calls for external data), "delegation" (delegate to a sub-agent for complex subtasks — only use when multi-agent mode is enabled).
10. CRITICAL — title and description content constraints (violations will cause the plan to be rejected):
   - title MUST be a short natural-language phrase (<= ${_NUMERIC_LOCK.TITLE} characters), NOT a JSON object or a nested plan.
   - description MUST be a concrete natural-language sentence (1-3 sentences, <= ${_NUMERIC_LOCK.DESCRIPTION} characters, <= 10 lines), NOT a JSON object, NOT a nested plan, and MUST NOT contain plan-schema field names like "goal", "steps", "step_id", "depends_on".
   - NEVER embed a plan object, a step object, or any JSON structure inside title or description. If you feel the urge to write a plan inside a description, STOP — that is wrong; write a single sentence instruction instead.
   - Example of CORRECT description: "Call search_engine to fetch the latest AI Agent development news from the past 30 days, then summarize the top 5 trends."
   - Example of WRONG description: '{"goal": "...", "steps": [...]}' (this is a nested plan, not an instruction).${replanSection}`
}

/** 迁移前 `buildPlannerSystemPromptCompact` 的返回值（逐字副本）。 */
function goldenPlannerCompact(catalog: string, maxSteps: number, replanSection: string): string {
  return `You are a planning module of an AI agent. Decompose the user's goal into a SHORT plan.

Available tools (reference in descriptions, do NOT call them yourself):
${catalog}

CRITICAL RULES (previous attempt FAILED — follow strictly):
1. Produce AT MOST ${maxSteps} steps. Fewer is better. Aim for 3-5 steps.
2. Each step title: <= ${_NUMERIC_LOCK.TITLE} chars, natural language, NO JSON.
3. Each step description: 1-2 SHORT sentences, <= ${_NUMERIC_LOCK.DESCRIPTION} chars, <= 5 lines, natural language only.
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

/** 迁移前 `_SYSTEM_PROMPT_TEMPLATES`（graph/subgraph/builder.ts）的逐字副本。 */
const GOLDEN_SUBAGENT_PROMPTS: Record<string, string> = {
  research:
    'You are a Research Agent. Your task is to investigate and gather information ' +
    'about the given topic. Provide thorough, factual findings.',
  coding:
    'You are a Code Agent. Your task is to write, analyze, or review code ' +
    'for the given requirement. Provide clear, correct implementations.',
  review:
    'You are a Review Agent. Your task is to review and evaluate the given content ' +
    'for quality, correctness, and completeness. Provide constructive feedback.',
  default:
    'You are a specialized Agent. Complete the assigned subtask accurately and concisely.',
}

/** 迁移前 `graph/nodes.ts` 文档生成任务类型提醒的逐字副本。 */
const GOLDEN_DOC_GEN_TASK =
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

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: 'test.tpl',
    version: '1.0.0',
    messages: [{ role: 'system', content: 'hello' }],
    ...overrides,
  }
}

describe('P2/T-14: PromptRegistry 语义', () => {
  it('register/get/has 与同 id 覆盖', () => {
    const reg = new DefaultPromptRegistry()
    const tpl = makeTemplate()
    reg.register(tpl)
    expect(reg.has('test.tpl')).toBe(true)
    expect(reg.get('test.tpl')?.messages[0].content).toBe('hello')

    reg.register(makeTemplate({ messages: [{ role: 'system', content: 'world' }] }))
    expect(reg.get('test.tpl')?.messages[0].content).toBe('world')
    expect(reg.list().length).toBe(1)
  })

  it('非法模板被拒绝（空 id / messages 非数组）', () => {
    const reg = new DefaultPromptRegistry()
    expect(() => reg.register({ ...makeTemplate(), id: '' })).toThrow(TypeError)
    expect(() => reg.register({ ...makeTemplate(), messages: undefined as any })).toThrow(TypeError)
  })

  it('未知 id 渲染返回空串（调用方据此回退）', () => {
    const reg = new DefaultPromptRegistry()
    expect(reg.render('nope', {})).toBe('')
    expect(reg.has('nope')).toBe(false)
  })

  it('变量替换：缺失变量保留原占位符（字符等价保证）', () => {
    const reg = new DefaultPromptRegistry()
    reg.register(makeTemplate({
      messages: [{ role: 'system', content: 'A={{a}} B={{b}} C={{c}}' }],
    }))
    expect(reg.render('test.tpl', { a: 1, c: 'x' })).toBe('A=1 B={{b}} C=x')
    // null/undefined 亦保留占位符（不产生空串）
    expect(reg.render('test.tpl', { a: null, b: undefined })).toBe('A={{a}} B={{b}} C={{c}}')
    // 单花括号不受影响（JSON 示例、{title}_{YYYY-MM-DD}.md 等）
    reg.register(makeTemplate({
      id: 'brace.tpl',
      messages: [{ role: 'system', content: '{"k": "v"} {title}_{YYYY-MM-DD}.md' }],
    }))
    expect(reg.render('brace.tpl', {})).toBe('{"k": "v"} {title}_{YYYY-MM-DD}.md')
  })

  it('多消息以双换行连接', () => {
    const reg = new DefaultPromptRegistry()
    reg.register(makeTemplate({
      messages: [
        { role: 'system', content: 'S1' },
        { role: 'user', content: 'U1' },
      ],
    }))
    expect(reg.render('test.tpl', {})).toBe('S1\n\nU1')
  })

  it('renderOr：注册表优先，未注册回退 fallback', () => {
    const reg = new DefaultPromptRegistry()
    const fallback = makeTemplate({ messages: [{ role: 'system', content: 'fallback {{v}}' }] })
    expect(reg.renderOr('test.tpl', { v: 'X' }, fallback)).toBe('fallback X')

    reg.register(makeTemplate({ messages: [{ role: 'system', content: 'registered {{v}}' }] }))
    expect(reg.renderOr('test.tpl', { v: 'X' }, fallback)).toBe('registered X')
  })

  it('list(taskType) 过滤：未声明 taskTypes 的模板总是返回', () => {
    const reg = new DefaultPromptRegistry()
    reg.register(makeTemplate({ id: 'a', taskTypes: ['x'] }))
    reg.register(makeTemplate({ id: 'b', taskTypes: ['y'] }))
    reg.register(makeTemplate({ id: 'c' }))
    expect(reg.list().map((t) => t.id)).toEqual(['a', 'b', 'c'])
    expect(reg.list('x').map((t) => t.id)).toEqual(['a', 'c'])
    expect(reg.list('z').map((t) => t.id)).toEqual(['c'])
  })

  it('内置模板注册幂等且覆盖后可被宿主替换（registerPrompt 语义）', () => {
    const reg = new DefaultPromptRegistry()
    const first = registerBuiltinPrompts(reg)
    const second = registerBuiltinPrompts(reg)
    expect(first).toBeGreaterThan(0)
    expect(second).toBe(first)
    expect(reg.list().length).toBe(first)
    expect(listBuiltinPromptIds()).toContain('plan_execute.planner')
    expect(listBuiltinPromptIds()).toContain('subagent.research')

    reg.register(makeTemplate({
      id: 'plan_execute.planner',
      messages: [{ role: 'system', content: 'CUSTOM' }],
    }))
    expect(reg.render('plan_execute.planner', {})).toBe('CUSTOM')
  })
})

describe('P2/T-14: 装配语义（宿主注册优先，装配层只填补缺失）', () => {
  beforeEach(() => {
    resetPromptRegistry()
  })
  afterEach(() => {
    resetPromptRegistry()
  })

  it('宿主先注册的同 id 模板不被内置模板覆盖（真实启动序列：宿主注册 → create_agent）', () => {
    const reg = new DefaultPromptRegistry()
    reg.register({
      id: 'subagent.research',
      version: 'host-1.0.0',
      messages: [{ role: 'system', content: 'HOST RESEARCH' }],
    })
    // 装配层（create_agent）随后注册内置模板
    // 计数 = 内置模板总数（P3/T-21 迁入 feedback×2 + orchestration×1 后为 10）
    const count = registerBuiltinPrompts(reg)
    expect(count).toBe(10)
    // 宿主版本保持生效
    expect(reg.render('subagent.research', {})).toBe('HOST RESEARCH')
    // 其余内置模板照常补齐
    expect(reg.has('plan_execute.planner')).toBe(true)
    expect(reg.has('agent.doc_generation_task')).toBe(true)
  })

  it('全局单例上重复调用 create_agent 的注册步骤不会回退宿主覆盖', () => {
    getPromptRegistry().register({
      id: 'agent.doc_generation_task',
      version: 'host-2.0.0',
      messages: [{ role: 'system', content: 'HOST DOC' }],
    })
    registerBuiltinPrompts()
    registerBuiltinPrompts()
    expect(getPromptRegistry().render('agent.doc_generation_task', {})).toBe('HOST DOC')
  })

  it('resetRegistry 一并清空 prompt 单例（避免跨用例污染）', () => {
    getPromptRegistry().register({
      id: 'subagent.coding',
      version: 'host-3.0.0',
      messages: [{ role: 'system', content: 'HOST CODING' }],
    })
    expect(getPromptRegistry().render('subagent.coding', {})).toBe('HOST CODING')
    resetRegistry()
    expect(getPromptRegistry().render('subagent.coding', {})).toBe('')
  })

  it('taskType 命中原型链属性名时回退 default 角色（不返回非模板值）', () => {
    // 迁移前 `taskType in _SYSTEM_PROMPT_TEMPLATES` 对 'toString' 为 true，
    // 会取到原型上的函数；此处加固为 hasOwnProperty。
    expect(_getSystemPrompt('toString')).toBe(GOLDEN_SUBAGENT_PROMPTS.default)
    expect(_getSystemPrompt('constructor')).toBe(GOLDEN_SUBAGENT_PROMPTS.default)
    expect(_getSystemPrompt('hasOwnProperty')).toBe(GOLDEN_SUBAGENT_PROMPTS.default)
    // 正常角色不受影响
    expect(_getSystemPrompt('review')).toBe(GOLDEN_SUBAGENT_PROMPTS.review)
  })
})

describe('P2/T-14: 字符等价（迁移前内联字面量 ⇄ 注册表渲染）', () => {
  beforeEach(() => {
    resetPromptRegistry()
  })
  afterEach(() => {
    resetPromptRegistry()
  })

  it('数值常量未漂移（模板文案依赖）', () => {
    expect(PLAN_STEP_TITLE_MAX_CHARS).toBe(_NUMERIC_LOCK.TITLE)
    expect(PLAN_STEP_DESCRIPTION_MAX_CHARS).toBe(_NUMERIC_LOCK.DESCRIPTION)
    expect(PLAN_STEP_EXPECTED_OUTPUT_MAX_CHARS).toBe(_NUMERIC_LOCK.EXPECTED_OUTPUT)
    expect(PLAN_STEP_VERIFICATION_HINT_MAX_CHARS).toBe(_NUMERIC_LOCK.VERIFICATION_HINT)
  })

  it('buildPlannerSystemPrompt 逐字节等价（首轮 / 重规划）', () => {
    expect(buildPlannerSystemPrompt(CATALOG, 5)).toBe(goldenPlannerFull(CATALOG, 5, ''))
    expect(buildPlannerSystemPrompt(CATALOG, 3, REPLAN_RAW))
      .toBe(goldenPlannerFull(CATALOG, 3, REPLAN_SECTION))
  })

  it('buildPlannerSystemPromptCompact 逐字节等价（首轮 / 重规划）', () => {
    expect(buildPlannerSystemPromptCompact(CATALOG, 3)).toBe(goldenPlannerCompact(CATALOG, 3, ''))
    expect(buildPlannerSystemPromptCompact(CATALOG, 2, REPLAN_RAW))
      .toBe(goldenPlannerCompact(CATALOG, 2, REPLAN_SECTION))
  })

  it('planner 模板经注册表渲染后仍逐字节等价（接线后不漂移）', () => {
    const count = registerBuiltinPrompts(getPromptRegistry())
    expect(count).toBeGreaterThan(0)
    expect(buildPlannerSystemPrompt(CATALOG, 4)).toBe(goldenPlannerFull(CATALOG, 4, ''))
    expect(buildPlannerSystemPromptCompact(CATALOG, 4)).toBe(goldenPlannerCompact(CATALOG, 4, ''))
  })

  it('子 Agent 角色模板逐字节等价（含未知 taskType 回退 default）', () => {
    for (const [taskType, expected] of Object.entries(GOLDEN_SUBAGENT_PROMPTS)) {
      expect(_getSystemPrompt(taskType)).toBe(expected)
    }
    expect(_getSystemPrompt('unknown_type')).toBe(GOLDEN_SUBAGENT_PROMPTS.default)
    // customPrompt / 配置覆盖优先级不变
    expect(_getSystemPrompt('research', 'custom')).toBe('custom')
    const cfg = { get: (key: string, dflt: any) => (key === 'agents.research.prompt' ? 'cfg-prompt' : dflt) }
    expect(_getSystemPrompt('research', null, cfg as any)).toBe('cfg-prompt')
  })

  it('子 Agent 角色模板可被宿主替换（不改内核源码）', () => {
    getPromptRegistry().register({
      id: 'subagent.research',
      version: '9.9.9',
      taskTypes: ['research'],
      messages: [{ role: 'system', content: 'CUSTOM RESEARCH AGENT' }],
    })
    expect(_getSystemPrompt('research')).toBe('CUSTOM RESEARCH AGENT')
    // 其它角色不受影响
    expect(_getSystemPrompt('coding')).toBe(GOLDEN_SUBAGENT_PROMPTS.coding)
  })

  it('agent.doc_generation_task 模板逐字节等价', () => {
    expect(renderPromptWithFallback('agent.doc_generation_task', {}, DOC_GEN_TASK_PROMPT_TEMPLATE))
      .toBe(GOLDEN_DOC_GEN_TASK)
    // 注册表注册后结果不变
    registerBuiltinPrompts(getPromptRegistry())
    expect(getPromptRegistry().render('agent.doc_generation_task', {})).toBe(GOLDEN_DOC_GEN_TASK)
  })

  it('内置模板 id 稳定性（防止 id 重命名导致宿主配置静默失效）', () => {
    expect(listBuiltinPromptIds().sort()).toEqual([
      'agent.doc_generation_task',
      // P3（T-21）：T-14 残余站点迁入（feedback / orchestration）
      'feedback.quality_judge_system',
      'feedback.quality_judge_user',
      'orchestration.consensus_judge',
      'plan_execute.planner',
      'plan_execute.planner.compact',
      'subagent.coding',
      'subagent.default',
      'subagent.research',
      'subagent.review',
    ])
  })

  it('PLANNER 模板对象与 registry 渲染一致（单实例无第二来源）', () => {
    const reg: PromptRegistry = new DefaultPromptRegistry()
    reg.register(PLANNER_PROMPT_TEMPLATE)
    reg.register(PLANNER_COMPACT_PROMPT_TEMPLATE)
    reg.register(SUBAGENT_PROMPT_TEMPLATES.research)
    expect(reg.render('plan_execute.planner', {
      toolCatalogText: CATALOG, maxSteps: 2, replanSection: '',
    })).toBe(goldenPlannerFull(CATALOG, 2, ''))
    expect(reg.render('subagent.research', {})).toBe(GOLDEN_SUBAGENT_PROMPTS.research)
  })

  it('setPromptRegistry / resetPromptRegistry 生命周期', () => {
    const custom = new DefaultPromptRegistry()
    custom.register(makeTemplate({ id: 'x', messages: [{ role: 'system', content: 'X' }] }))
    setPromptRegistry(custom)
    expect(getPromptRegistry().render('x', {})).toBe('X')
    resetPromptRegistry()
    expect(getPromptRegistry().render('x', {})).toBe('')
    expect(getPromptRegistry()).not.toBe(custom)
  })
})

// ============================================================
// P3（T-21）：T-14 残余站点迁移（feedback / orchestration）
//
// 覆盖：① 占位符语法统一（T-14 遗留的单花括号 `{task}` → `{{task}}`）；
//      ② 字符等价（golden 为迁移前源码逐字副本）；
//      ③ 消费者（QualityMonitor / LLMJudgeStrategy）真实经注册表渲染；
//      ④ 宿主替换与单点回滚。
// ============================================================

/** 迁移前 `QualityMonitor._JUDGE_SYSTEM_PROMPT` 的逐字副本。 */
const GOLDEN_QUALITY_JUDGE_SYSTEM =
  '你是一个严格的回复质量评估器。请从相关性、完整性、准确性、置信度、' +
  '工具调用成功率五个维度评估 Agent 回复质量，输出 0.00-1.00 之间的分数（保留 2 位小数）。' +
  '若回复未涉及工具调用，tool_success 默认为 1.0。' +
  '仅输出一个合法 JSON 对象，不要包含任何额外文字、Markdown 代码块或解释。'

/** 迁移前 `QualityMonitor._formatJudgeUserPrompt` 的返回值（逐字副本）。 */
function goldenQualityJudgeUser(prompt: string, response: string): string {
  return (
    `【用户问题】\n${prompt}\n\n` +
    `【Agent 回复】\n${response}\n\n` +
    `【评估维度】\n` +
    `1. relevance（相关性）：回复是否切题、与问题相关\n` +
    `2. completeness（完整性）：回复是否完整回答了问题的各个方面\n` +
    `3. accuracy（准确性）：回复中的事实信息是否准确无误\n` +
    `4. confidence（置信度）：回复表达是否明确、是否避免不必要的模糊\n` +
    `5. tool_success（工具调用成功率）：基于回复判断工具调用是否成功\n\n` +
    `【输出格式】\n` +
    `{"relevance": 0.85, "completeness": 0.80, "accuracy": 0.90, ` +
    `"confidence": 0.85, "tool_success": 1.0, "overall": 0.87, ` +
    `"reasoning": "简短说明"}`
  )
}

/** 迁移前 `LLMJudgeStrategy._JUDGE_PROMPT` 经单花括号 `.replace` 后的渲染结果。 */
function goldenConsensusJudge(task: string, candidates: string): string {
  return (
    'You are an impartial judge. Select the best answer from candidates.\n' +
    `Task: ${task}\nCandidates:\n${candidates}\n` +
    'Respond with ONLY JSON: {"winner": <index>, "reason": "<brief>"}'
  )
}

/** 可注入的假 ModuLLM（记录每次 invoke 的 messages）。 */
function fakeModuLlm(captured: any[][], reply: string): any {
  return {
    async invoke(messages: any[]) {
      captured.push(messages)
      return { content: reply }
    },
    async stream() {
      throw new Error('stream not used in tests')
    },
    bindTools() {
      return this
    },
  }
}

describe('P3/T-21: 残余站点迁移（character equivalence + 注册表消费）', () => {
  beforeEach(() => {
    resetPromptRegistry()
  })
  afterEach(() => {
    resetPromptRegistry()
  })

  it('feedback.quality_judge_system 逐字节等价，且与 QualityMonitor 兼容视图一致', () => {
    expect(
      renderPromptWithFallback(
        'feedback.quality_judge_system',
        {},
        FEEDBACK_QUALITY_JUDGE_SYSTEM_TEMPLATE,
      ),
    ).toBe(GOLDEN_QUALITY_JUDGE_SYSTEM)
    expect(QualityMonitor._JUDGE_SYSTEM_PROMPT).toBe(GOLDEN_QUALITY_JUDGE_SYSTEM)
    // 注册内置模板后仍等价
    registerBuiltinPrompts(getPromptRegistry())
    expect(getPromptRegistry().render('feedback.quality_judge_system', {})).toBe(GOLDEN_QUALITY_JUDGE_SYSTEM)
  })

  it('feedback.quality_judge_user 逐字节等价（含单花括号 JSON 示例不被误替换）', () => {
    registerBuiltinPrompts(getPromptRegistry())
    expect(
      renderPromptWithFallback('feedback.quality_judge_user', { prompt: 'P', response: 'R' }, FEEDBACK_QUALITY_JUDGE_USER_TEMPLATE),
    ).toBe(goldenQualityJudgeUser('P', 'R'))
    expect(getPromptRegistry().render('feedback.quality_judge_user', { prompt: 'x', response: 'y' }))
      .toBe(goldenQualityJudgeUser('x', 'y'))
  })

  it('端到端：QualityMonitor LLM 模式发出的 system/user 与迁移前逐字节一致', async () => {
    const captured: any[][] = []
    const monitor = new QualityMonitor(fakeModuLlm(captured, '{"overall": 0.9}'), 'llm')
    await monitor.evaluateAsync('问题', '回复', {})

    expect(captured.length).toBe(1)
    const messages = captured[0]
    expect(messages[0]).toEqual({ role: 'system', content: GOLDEN_QUALITY_JUDGE_SYSTEM })
    expect(messages[1]).toEqual({ role: 'user', content: goldenQualityJudgeUser('问题', '回复') })
  })

  it('宿主可替换 feedback.quality_judge_user（不改内核源码）', async () => {
    getPromptRegistry().register({
      id: 'feedback.quality_judge_user',
      version: '9.9.9',
      variables: ['prompt', 'response'],
      messages: [{ role: 'user', content: 'CUSTOM USER {{prompt}}/{{response}}' }],
    })
    const captured: any[][] = []
    const monitor = new QualityMonitor(fakeModuLlm(captured, '{"overall": 0.9}'), 'llm')
    await monitor.evaluateAsync('P', 'R', {})
    expect(captured[0][1].content).toBe('CUSTOM USER P/R')
  })

  it('orchestration.consensus_judge 渲染逐字节等价（单花括号 → {{var}} 语法统一）', () => {
    expect(
      renderPromptWithFallback(
        'orchestration.consensus_judge',
        { task: 'T', candidates: '[0] A\n[1] B' },
        ORCHESTRATION_CONSENSUS_JUDGE_TEMPLATE,
      ),
    ).toBe(goldenConsensusJudge('T', '[0] A\n[1] B'))
    registerBuiltinPrompts(getPromptRegistry())
    expect(getPromptRegistry().render('orchestration.consensus_judge', { task: 'T', candidates: 'C' }))
      .toBe(goldenConsensusJudge('T', 'C'))
  })

  it('端到端：LLMJudgeStrategy 发出的 judge prompt 与迁移前逐字节一致', async () => {
    const captured: any[][] = []
    const strategy = new LLMJudgeStrategy(fakeModuLlm(captured, '{"winner": 0, "reason": "ok"}'), '任务X')
    await strategy.aggregate([{ output: 'A' }, { output: 'B' }], 2)

    expect(captured.length).toBeGreaterThanOrEqual(1)
    expect(captured[0][0]).toEqual({
      role: 'user',
      content: goldenConsensusJudge('任务X', '[0] A\n[1] B'),
    })
  })

  it('宿主可替换 orchestration.consensus_judge', async () => {
    getPromptRegistry().register({
      id: 'orchestration.consensus_judge',
      version: '9.9.9',
      variables: ['task', 'candidates'],
      messages: [{ role: 'user', content: 'JUDGE {{task}} | {{candidates}}' }],
    })
    const captured: any[][] = []
    const strategy = new LLMJudgeStrategy(fakeModuLlm(captured, '{"winner": 0}'), 'TT')
    await strategy.aggregate([{ output: 'A' }], 1)
    expect(captured[0][0].content).toBe('JUDGE TT | [0] A')
  })

  it('prompt.registry.enabled=false 单点回滚：忽略宿主替换，回到内置模板', async () => {
    const cfg = getConfig()
    const prev = cfg.get('prompt.registry.enabled', true)
    getPromptRegistry().register({
      id: 'feedback.quality_judge_user',
      version: '9.9.9',
      messages: [{ role: 'user', content: 'CUSTOM' }],
    })
    try {
      cfg.set('prompt.registry.enabled', false)
      const captured: any[][] = []
      const monitor = new QualityMonitor(fakeModuLlm(captured, '{"overall": 0.9}'), 'llm')
      await monitor.evaluateAsync('P', 'R', {})
      expect(captured[0][1].content).toBe(goldenQualityJudgeUser('P', 'R'))
    } finally {
      cfg.set('prompt.registry.enabled', prev)
    }
  })

  it('模板变量声明与占位符一致（防漏声明导致渲染静默保留占位符）', () => {
    const cases: Array<[PromptTemplate, string[]]> = [
      [FEEDBACK_QUALITY_JUDGE_USER_TEMPLATE, ['prompt', 'response']],
      [ORCHESTRATION_CONSENSUS_JUDGE_TEMPLATE, ['task', 'candidates']],
      [FEEDBACK_QUALITY_JUDGE_SYSTEM_TEMPLATE, []],
    ]
    for (const [tpl, expectedVars] of cases) {
      expect(tpl.variables ?? []).toEqual(expectedVars)
      const content = tpl.messages.map((m) => m.content).join('\n\n')
      const found = [...content.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)].map((m) => m[1])
      expect([...new Set(found)].sort()).toEqual([...expectedVars].sort())
    }
  })
})
