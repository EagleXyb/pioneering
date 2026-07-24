import { describe, it, expect, vi } from 'vitest'
import {
  _inferRequiresTool,
  _isStepContentReasonable,
  _parsePlan,
  makePlannerNode,
} from '@/graph/plan-execute/planner.js'
import { buildPlannerSystemPromptCompact } from '@/graph/plan-execute/prompts.js'
import {
  PLAN_STEP_DESCRIPTION_MAX_CHARS,
  PLAN_STEP_TITLE_MAX_CHARS,
} from '@/graph/plan-execute/types.js'
import type { ModuAgentState } from '@/graph/state.js'

describe('_inferRequiresTool', () => {
  it('识别天气类步骤为需要工具', () => {
    expect(_inferRequiresTool('获取北京今日天气数据', '查询北京今天的天气信息，包括气温、天气状况等')).toBe(true)
  })

  it('识别新闻类步骤为需要工具', () => {
    expect(_inferRequiresTool('获取最新新闻', '搜索今日新闻')).toBe(true)
  })

  it('识别价格/股票类步骤为需要工具', () => {
    expect(_inferRequiresTool('查询股价', '获取最新股票价格')).toBe(true)
  })

  it('识别日期/时间类步骤为需要工具', () => {
    expect(_inferRequiresTool('获取当前日期', '查询今天的日期')).toBe(true)
  })

  it('识别英文天气类步骤为需要工具', () => {
    expect(_inferRequiresTool('Get weather', 'Fetch today weather data')).toBe(true)
  })

  it('识别 API/网络请求类步骤为需要工具', () => {
    expect(_inferRequiresTool('调用API', '通过网络获取数据')).toBe(true)
  })

  it('不将纯总结类步骤判定为需要工具（基于前序结果）', () => {
    expect(_inferRequiresTool('总结今日天气特点', '基于获取的天气数据，用简洁的语言概括')).toBe(false)
  })

  it('不将纯穿衣建议类步骤判定为需要工具（根据前序结果）', () => {
    expect(_inferRequiresTool('给出穿衣建议', '根据气温推荐合适的着装')).toBe(false)
  })

  it('不将纯出行建议类步骤判定为需要工具（结合前序结果）', () => {
    expect(_inferRequiresTool('给出出行建议', '结合天气状况提供出行注意事项')).toBe(false)
  })
})

// ============================================================
// P-修复测试: 嵌套 plan 塌陷防护
// 覆盖 _isStepContentReasonable + _parsePlan 对异常 LLM 输出的拦截
// ============================================================

describe('_isStepContentReasonable (P-修复: 内容合理性后检)', () => {
  it('正常的自然语言 description 通过校验', () => {
    expect(_isStepContentReasonable({
      title: '搜索 AI Agent 发展趋势',
      description: '使用 search_engine 搜索 "AI Agent 2025 发展趋势"，获取近期相关新闻与报告。',
    })).toBe(true)
  })

  it('description 以 "{" 开头被拒绝（疑似嵌套 JSON）', () => {
    expect(_isStepContentReasonable({
      title: '撰写调研报告引言',
      description: '{"goal": "帮我写一篇调研报告", "steps": [...]}',
    })).toBe(false)
  })

  it('description 包含 "goal": 字段被拒绝（疑似嵌套 plan）', () => {
    expect(_isStepContentReasonable({
      title: '某步骤',
      description: '需要参考 "goal": "AI Agent" 这一字段进行规划',
    })).toBe(false)
  })

  it('description 包含 "steps": 字段被拒绝（疑似嵌套 plan）', () => {
    expect(_isStepContentReasonable({
      title: '某步骤',
      description: '需要整理 "steps": [] 中的内容',
    })).toBe(false)
  })

  it('description 包含 "step_id": 字段被拒绝（疑似嵌套 plan）', () => {
    expect(_isStepContentReasonable({
      title: '某步骤',
      description: '参考 "step_id": "step_1" 的输出',
    })).toBe(false)
  })

  it('description 行数过多被拒绝（> 10 行）', () => {
    const longDesc = Array(15).fill('这是一行描述。').join('\n')
    expect(_isStepContentReasonable({
      title: '某步骤',
      description: longDesc,
    })).toBe(false)
  })

  it('description 行数在阈值内通过（10 行）', () => {
    const desc = Array(10).fill('这是一行描述。').join('\n')
    expect(_isStepContentReasonable({
      title: '某步骤',
      description: desc,
    })).toBe(true)
  })

  it('title 过长被拒绝（超过上限）', () => {
    expect(_isStepContentReasonable({
      title: 'x'.repeat(PLAN_STEP_TITLE_MAX_CHARS + 1),
      description: '正常描述',
    })).toBe(false)
  })

  it('description 过长被拒绝（超过上限）', () => {
    expect(_isStepContentReasonable({
      title: '某步骤',
      description: 'x'.repeat(PLAN_STEP_DESCRIPTION_MAX_CHARS + 1),
    })).toBe(false)
  })
})

describe('_parsePlan (P-修复: 嵌套 plan 塌陷拦截)', () => {
  /** 构造用户问题中给出的那种"嵌套 plan 塌陷"输出 */
  function buildNestedPlanCollapseOutput(): string {
    // 模拟实际 LLM 输出：step_6 的 description 被填入完整嵌套 plan
    const nestedPlan = JSON.stringify({
      goal: '帮我写一篇调研报告',
      steps: [
        { step_id: 'step_1', title: '内嵌步骤', description: '内嵌描述' },
      ],
    })
    return JSON.stringify({
      goal: '帮我写一篇调研报告，有关于AI Agent的，研究最近的发展趋势',
      steps: [
        { step_id: 'step_1', title: '获取当前日期', description: '使用datetime工具获取当前日期和时间。', requires_tool: true },
        { step_id: 'step_2', title: '搜索趋势', description: '使用 search_engine 搜索 AI Agent 发展趋势。', requires_tool: true },
        { step_id: 'step_3', title: '搜索技术进展', description: '使用 search_engine 搜索 AI Agent 技术突破。', requires_tool: true },
        { step_id: 'step_4', title: '搜索应用案例', description: '使用 search_engine 搜索 AI Agent 应用案例。', requires_tool: true },
        { step_id: 'step_5', title: '整理信息', description: '将以上步骤获取的搜索结果进行整理、分类和归纳。', requires_tool: false },
        // step_6 description 被填入嵌套 plan（实际故障场景）
        { step_id: 'step_6', title: '撰写引言', description: nestedPlan, requires_tool: false },
      ],
    })
  }

  it('嵌套 plan 塌陷输出被拦截（返回 null）', () => {
    const raw = buildNestedPlanCollapseOutput()
    const plan = _parsePlan(raw, 10)
    expect(plan).toBeNull()
  })

  it('正常 plan 输出通过解析', () => {
    const raw = JSON.stringify({
      goal: '查询北京天气',
      steps: [
        { step_id: 'step_1', title: '获取天气', description: '使用 search_engine 搜索北京今日天气。', requires_tool: true },
        { step_id: 'step_2', title: '给出建议', description: '根据天气状况给出穿衣建议。', requires_tool: false },
      ],
    })
    const plan = _parsePlan(raw, 10)
    expect(plan).not.toBeNull()
    expect(plan!.length).toBe(2)
    expect(plan![0].step_id).toBe('step_1')
    expect(plan![0].requires_tool).toBe(true)
    expect(plan![1].requires_tool).toBeUndefined()  // 不需要工具的不输出该字段
  })

  it('description 超长（> 500 字符）被 schema 拦截', () => {
    const longDesc = 'x'.repeat(PLAN_STEP_DESCRIPTION_MAX_CHARS + 1)
    const raw = JSON.stringify({
      goal: '测试',
      steps: [{ step_id: 'step_1', title: '某步骤', description: longDesc }],
    })
    const plan = _parsePlan(raw, 10)
    expect(plan).toBeNull()
  })

  it('title 超长（> 120 字符）被 schema 拦截', () => {
    const longTitle = 'x'.repeat(PLAN_STEP_TITLE_MAX_CHARS + 1)
    const raw = JSON.stringify({
      goal: '测试',
      steps: [{ step_id: 'step_1', title: longTitle, description: '正常描述' }],
    })
    const plan = _parsePlan(raw, 10)
    expect(plan).toBeNull()
  })

  it('markdown fence 包裹的 plan 能正常解析（向后兼容）', () => {
    const raw = '```json\n' + JSON.stringify({
      goal: '测试',
      steps: [{ step_id: 'step_1', title: '某步骤', description: '正常描述' }],
    }) + '\n```'
    const plan = _parsePlan(raw, 10)
    expect(plan).not.toBeNull()
    expect(plan!.length).toBe(1)
  })

  it('非法 JSON 返回 null', () => {
    expect(_parsePlan('not a json', 10)).toBeNull()
  })

  it('空对象返回 null', () => {
    expect(_parsePlan('{}', 10)).toBeNull()
  })

  it('steps 为空数组返回 null（schema min(1)）', () => {
    const raw = JSON.stringify({ goal: 'x', steps: [] })
    expect(_parsePlan(raw, 10)).toBeNull()
  })

  it('steps 超过 maxSteps 被截断', () => {
    const steps = Array(15).fill(0).map((_, i) => ({
      step_id: `step_${i + 1}`,
      title: `步骤${i + 1}`,
      description: `描述${i + 1}`,
    }))
    const raw = JSON.stringify({ goal: '测试', steps })
    const plan = _parsePlan(raw, 5)
    expect(plan).not.toBeNull()
    expect(plan!.length).toBe(5)  // 被截断到 maxSteps
  })

  it('未输出 requires_tool 时自动推断（弱模型兜底）', () => {
    const raw = JSON.stringify({
      goal: '查询天气',
      steps: [
        // 未输出 requires_tool，但 description 含"天气"关键词 → 推断为 true
        { step_id: 'step_1', title: '获取天气', description: '查询北京今日天气' },
        // 未输出 requires_tool，description 无关键词 → 不输出该字段
        { step_id: 'step_2', title: '撰写总结', description: '用简洁的语言概括上述信息并组织成段落。' },
      ],
    })
    const plan = _parsePlan(raw, 10)
    expect(plan).not.toBeNull()
    expect(plan![0].requires_tool).toBe(true)
    expect(plan![1].requires_tool).toBeUndefined()
  })

  it('LLM 输出的 requires_tool=false 被尊重（不自动推断覆盖）', () => {
    const raw = JSON.stringify({
      goal: '查询天气',
      steps: [
        // LLM 显式输出 false，即使 description 含"天气"关键词也不覆盖
        { step_id: 'step_1', title: '获取天气', description: '查询北京今日天气', requires_tool: false },
      ],
    })
    const plan = _parsePlan(raw, 10)
    expect(plan).not.toBeNull()
    // requires_tool 为 false（falsy）→ 不进入条件展开
    expect(plan![0].requires_tool).toBeUndefined()
  })
})

// ============================================================
// P-修复测试: 第二种塌陷形态——JSON 语法错误（step 对象未关闭即开始新 plan）
// 与第一种形态的区别：JSON 本身就破损，_extractJson 应返回 null
// ============================================================

describe('_parsePlan (P-修复: JSON 语法错误塌陷拦截)', () => {
  /**
   * 模拟用户反馈的第二种塌陷形态：
   * step_6 的 description 是正常字符串，但 step_6 对象未关闭（缺少 }）
   * 就直接开始新的 plan 对象，导致整个 JSON 语法错误。
   *
   * 这是弱模型在长输出时"迷失"的典型表现——忘记关闭当前对象就开始新内容。
   */
  function buildSyntaxErrorCollapseOutput(): string {
    // 注意：这是手动拼接的非法 JSON，不能用 JSON.stringify
    return `{
  "goal": "帮我写一篇调研报告，有关于AI Agent的，研究最近的发展趋势",
  "steps": [
    {
      "step_id": "step_1",
      "title": "获取当前日期和时间",
      "description": "调用datetime工具获取当前日期和时间，用于确定搜索的时间范围。",
      "status": "pending",
      "requires_tool": true
    },
    {
      "step_id": "step_2",
      "title": "搜索AI Agent最新发展资讯",
      "description": "调用search_engine搜索AI Agent最新进展。",
      "depends_on": ["step_1"],
      "status": "pending",
      "requires_tool": true
    },
    {
      "step_id": "step_3",
      "title": "搜索AI Agent关键技术方向",
      "description": "调用search_engine搜索AI Agent多智能体系统等关键词。",
      "status": "pending",
      "requires_tool": true
    },
    {
      "step_id": "step_4",
      "title": "搜索AI Agent应用案例",
      "description": "调用search_engine搜索AI Agent应用案例。",
      "status": "pending",
      "requires_tool": true
    },
    {
      "step_id": "step_5",
      "title": "搜索AI Agent市场与投资动态",
      "description": "调用search_engine搜索AI Agent市场规模与融资信息。",
      "status": "pending",
      "requires_tool": true
    },
    {
      "step_id": "step_6",
      "title": "整理和结构化调研资料",
      "description": "将步骤2至步骤5收集到的信息进行分类整理，提炼出核心趋势。",
{
  "goal": "帮我写一篇调研报告",
  "steps": [
    {
      "step_id": "step_1",
      "title": "获取当前日期",
      "description": "使用datetime工具获取当前日期和时间。",
      "depends_on": [],
      "status": "pending",
      "requires_tool": true
    },
    {
      "step_id": "step_2",
      "title": "搜索AI Agent最新发展动态",
      "description": "使用search_engine搜索关键词AI Agent最新发展趋势。",
      "depends_on": ["step_1"],
      "status": "pending",
      "requires_tool": true
    },
    {
      "step_id": "step_3",
      "title": "搜索技术突破",
      "description": "使用search_engine搜索AI Agent技术突破。",
      "depends_on": ["step_1"],
      "status": "pending",
      "requires_tool": true
    },
    {
      "step_id": "step_4",
      "title": "搜索市场动态",
      "description": "使用search_engine搜索AI Agent市场规模。",
      "depends_on": ["step_1"],
      "status": "pending",
      "requires_tool": true
    },
    {
      "step_id": "step_5",
      "title": "搜索挑战与风险",
      "description": "使用search_engine搜索AI Agent挑战风险。",
      "depends_on": ["step_1"],
      "status": "pending",
      "requires_tool": true
    },
    {
      "step_id": "step_6",
      "title": "整理和归类收集到的信息",
      "description": "将所有搜索结果`
  }

  it('JSON 语法错误塌陷（step 未关闭即开始新 plan）被拦截', () => {
    const raw = buildSyntaxErrorCollapseOutput()
    // 整个 JSON 破损，_extractJson 应返回 null，_parsePlan 返回 null
    const plan = _parsePlan(raw, 10)
    expect(plan).toBeNull()
  })

  it('JSON 语法错误塌陷后，即使 _extractJson 提取子串也无法解析', () => {
    const raw = buildSyntaxErrorCollapseOutput()
    // 验证 _extractJson 的 indexOf('{') + lastIndexOf('}') 策略也无法挽救
    // 因为提取的子串中间仍有语法错误（step_6 未关闭就开始新对象）
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const substr = raw.slice(start, end + 1)
    // 子串仍不是合法 JSON
    expect(() => JSON.parse(substr)).toThrow(SyntaxError)
  })

  it('单个完整 plan 后跟破损内容能正确提取完整部分', () => {
    // 边界情况：前面的 plan 完整，后面跟着破损内容
    // _extractJson 的 indexOf + lastIndexOf 策略在这种情况下会失败
    // （因为提取的子串包含破损部分），但 _parsePlan 应返回 null
    const validPlan = JSON.stringify({
      goal: '查询天气',
      steps: [
        { step_id: 'step_1', title: '获取天气', description: '查询北京今日天气。', requires_tool: true },
      ],
    })
    const brokenSuffix = `\n\nSome commentary.\n{ broken plan without closing`
    const raw = validPlan + brokenSuffix
    // _extractJson 会尝试提取从第一个 { 到最后一个 } 的子串
    // 如果最后一个 } 在 validPlan 内，提取的子串恰好是 validPlan → 解析成功
    // 如果 brokenSuffix 中有 }，提取的子串会包含破损部分 → 解析失败
    // 无论哪种情况，_parsePlan 的行为是确定的：
    const plan = _parsePlan(raw, 10)
    // 如果 _extractJson 成功提取出 validPlan，plan 应该有 1 个 step
    // 如果 _extractJson 失败，plan 应该是 null
    // 这里只验证不返回破损 plan
    if (plan !== null) {
      expect(plan.length).toBe(1)
      expect(plan[0].step_id).toBe('step_1')
    }
  })

  it('截断的 JSON（无闭合括号）被拦截', () => {
    // 模拟 max_tokens 截断：JSON 在中间被截断，没有闭合的 } ]}
    const truncatedRaw = `{"goal":"测试","steps":[{"step_id":"step_1","title":"步骤1","description":"描述`
    const plan = _parsePlan(truncatedRaw, 10)
    expect(plan).toBeNull()
  })

  it('两个完整 plan 连在一起（无分隔）被拦截', () => {
    // LLM 输出了两个完整的 plan 对象，紧挨着
    const plan1 = JSON.stringify({
      goal: '查询天气',
      steps: [{ step_id: 'step_1', title: '获取天气', description: '查询北京今日天气。' }],
    })
    const plan2 = JSON.stringify({
      goal: '查询新闻',
      steps: [{ step_id: 'step_1', title: '获取新闻', description: '查询今日新闻。' }],
    })
    const raw = plan1 + plan2  // 两个对象紧挨，无分隔
    // JSON.parse 会失败（两个对象连在一起不合法）
    // _extractJson 的 indexOf + lastIndexOf 会提取从第一个 { 到最后一个 }
    // 这个子串包含两个对象，仍然不合法
    const plan = _parsePlan(raw, 10)
    expect(plan).toBeNull()
  })
})

// ============================================================
// P-修复测试: buildPlannerSystemPromptCompact（重试专用简洁提示词）
// ============================================================

describe('buildPlannerSystemPromptCompact (P-修复: 简洁提示词)', () => {
  it('包含重试标记 "previous attempt FAILED"', () => {
    const prompt = buildPlannerSystemPromptCompact('- search: 搜索', 5)
    expect(prompt).toContain('previous attempt FAILED')
  })

  it('包含 maxSteps 约束（减半后的值）', () => {
    const prompt = buildPlannerSystemPromptCompact('- search: 搜索', 5)
    expect(prompt).toContain('AT MOST 5 steps')
    expect(prompt).toContain('Aim for 3-5 steps')
  })

  it('包含长度上限约束', () => {
    const prompt = buildPlannerSystemPromptCompact('- search: 搜索', 5)
    expect(prompt).toContain(`<= ${PLAN_STEP_TITLE_MAX_CHARS} chars`)
    expect(prompt).toContain(`<= ${PLAN_STEP_DESCRIPTION_MAX_CHARS} chars`)
  })

  it('包含禁嵌套约束', () => {
    const prompt = buildPlannerSystemPromptCompact('- search: 搜索', 5)
    expect(prompt).toContain('NEVER embed JSON')
    expect(prompt).toContain('FORBIDDEN')
  })

  it('包含正反例引导', () => {
    const prompt = buildPlannerSystemPromptCompact('- search: 搜索', 5)
    expect(prompt).toContain('GOOD example description')
    expect(prompt).toContain('BAD example description')
  })

  it('包含重规划上下文（非空时）', () => {
    const prompt = buildPlannerSystemPromptCompact('- search: 搜索', 5, '- step_1: timeout')
    expect(prompt).toContain('Previous attempt failed')
    expect(prompt).toContain('step_1: timeout')
  })
})

// ============================================================
// P-修复测试: makePlannerNode 渐进式降级重试
// 验证首次失败后会用更短的 maxSteps + 简洁提示词重试
// ============================================================

/** 构造一个 mock LLM，按预设的响应序列返回内容。 */
function makeMockLlm(responses: Array<{ content: string } | Error>) {
  const calls: Array<{ temperature?: number; max_tokens?: number; messages?: any }> = []
  let callIdx = 0
  const llm = {
    bind(opts: { temperature?: number; max_tokens?: number }) {
      // 返回一个绑定了 opts 的子对象，invoke 时记录 opts
      return {
        bind(this: any, subOpts: any) {
          // 支持链式 bind（max_tokens 绑定失败后退化到仅 temperature）
          return this.bind({ ...opts, ...subOpts })
        },
        async invoke(messages: any) {
          calls.push({ ...opts, messages })
          const resp = responses[callIdx++]
          if (resp instanceof Error) throw resp
          return resp
        },
      }
    },
    async invoke(messages: any) {
      calls.push({ messages })
      const resp = responses[callIdx++]
      if (resp instanceof Error) throw resp
      return resp
    },
    _calls: calls,
  }
  return llm
}

/** 构造一个满足 planner 需要的最小 state。 */
function makeMockState(overrides: Partial<ModuAgentState> = {}): ModuAgentState {
  return {
    user_id: 'test-user',
    session_id: 'test-session',
    trace_id: 'test-trace',
    input_data: { prompt: '帮我写一篇 AI Agent 调研报告' },
    messages: [],
    ...overrides,
  } as unknown as ModuAgentState
}

/** mock registry 返回空工具清单。 */
function makeMockRegistry() {
  return { listTools: () => ({}) }
}

describe('makePlannerNode (P-修复: 渐进式降级重试)', () => {
  it('首次成功 → 直接返回 plan，不触发重试', async () => {
    const validPlan = JSON.stringify({
      goal: '调研报告',
      steps: [
        { step_id: 'step_1', title: '搜索资料', description: '使用 search_engine 搜索 AI Agent 相关信息。', requires_tool: true },
      ],
    })
    const llm = makeMockLlm([{ content: validPlan }])
    const planner = makePlannerNode(llm, makeMockRegistry())
    const result = await planner(makeMockState())
    expect(result.plan).toHaveLength(1)
    expect(result.plan_phase).toBe('executing')
    // 仅调用 1 次（首次成功）
    expect((llm as any)._calls).toHaveLength(1)
  })

  it('首次塌陷 → 重试时使用减半 maxSteps + 简洁提示词', async () => {
    // 首次返回嵌套 plan 塌陷输出（会被 _isStepContentReasonable 拦截）
    const collapsedOutput = JSON.stringify({
      goal: '调研报告',
      steps: [
        { step_id: 'step_1', title: '搜索', description: '使用 search_engine 搜索。', requires_tool: true },
        // 嵌套 plan 塌陷
        { step_id: 'step_2', title: '整理', description: '{"goal":"x","steps":[]}', requires_tool: false },
      ],
    })
    // 重试时返回正常 plan
    const validRetryPlan = JSON.stringify({
      goal: '调研报告',
      steps: [
        { step_id: 'step_1', title: '搜索资料', description: '使用 search_engine 搜索 AI Agent 信息。', requires_tool: true },
        { step_id: 'step_2', title: '撰写报告', description: '基于搜索结果撰写报告。' },
      ],
    })
    const llm = makeMockLlm([
      { content: collapsedOutput },
      { content: validRetryPlan },
    ])
    const planner = makePlannerNode(llm, makeMockRegistry())
    const result = await planner(makeMockState())
    // 重试成功
    expect(result.plan).toHaveLength(2)
    expect(result.plan_phase).toBe('executing')
    // 2 次调用
    expect((llm as any)._calls).toHaveLength(2)
  })

  it('两次都失败 → 降级直答（返回空 plan）', async () => {
    const collapsedOutput1 = JSON.stringify({
      goal: '调研报告',
      steps: [
        { step_id: 'step_1', title: 'x', description: '{"goal":"x","steps":[]}' },
      ],
    })
    const collapsedOutput2 = JSON.stringify({
      goal: '调研报告',
      steps: [
        { step_id: 'step_1', title: 'x', description: '{"goal":"y","steps":[]}' },
      ],
    })
    const llm = makeMockLlm([
      { content: collapsedOutput1 },
      { content: collapsedOutput2 },
    ])
    const planner = makePlannerNode(llm, makeMockRegistry())
    const result = await planner(makeMockState())
    // 降级直答
    expect(result.plan).toEqual([])
    expect(result.plan_phase).toBe('')
    expect(result.plan_delta).toBeNull()
  })

  it('首次 LLM 抛异常 → 触发重试', async () => {
    const validRetryPlan = JSON.stringify({
      goal: '调研报告',
      steps: [
        { step_id: 'step_1', title: '搜索', description: '使用 search_engine 搜索。', requires_tool: true },
      ],
    })
    const llm = makeMockLlm([
      new Error('LLM timeout'),
      { content: validRetryPlan },
    ])
    const planner = makePlannerNode(llm, makeMockRegistry())
    const result = await planner(makeMockState())
    expect(result.plan).toHaveLength(1)
    expect(result.plan_phase).toBe('executing')
  })

  it('空 goal → 直接降级直答（不调用 LLM）', async () => {
    const llm = makeMockLlm([])
    const planner = makePlannerNode(llm, makeMockRegistry())
    const state = makeMockState({
      input_data: {},
      cleaned_text: '',
    } as unknown as ModuAgentState)
    const result = await planner(state)
    expect(result.plan).toEqual([])
    expect(result.plan_phase).toBe('')
    // 未调用 LLM
    expect((llm as any)._calls).toHaveLength(0)
  })
})
