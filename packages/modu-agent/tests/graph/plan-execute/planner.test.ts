import { describe, it, expect } from 'vitest'
import {
  _inferRequiresTool,
  _isStepContentReasonable,
  _parsePlan,
} from '@/graph/plan-execute/planner.js'
import {
  PLAN_STEP_DESCRIPTION_MAX_CHARS,
  PLAN_STEP_TITLE_MAX_CHARS,
} from '@/graph/plan-execute/types.js'

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
