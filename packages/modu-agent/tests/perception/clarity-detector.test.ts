// 需求明确度检测器测试（阶段3：规则 + LLM 复判 + 高影响门控）
//
// 覆盖：
//   1. assessClarificationNeed —— 迁移后契约不变（开关/轮次/短输入/短语）
//   2. assessClarificationCoarse —— 路由粗筛（默认关闭复判时 === 规则判定）
//   3. detectClarification —— 节点精判：规则命中零 LLM 成本、LLM 低分触发、
//      槽位追问拼接、高分放行、解析失败保守放行、高影响门控
import { describe, it, expect } from 'vitest'
import {
  assessClarificationCoarse,
  assessClarificationNeed,
  detectClarification,
  isHighImpactInput,
} from '@/perception/clarity-detector.js'

/** 返回预设文本的 mock LLM（记录调用次数，验证"规则命中零 LLM 成本"） */
class JsonMockLlm {
  public calls = 0
  constructor(private readonly responses: string[]) {}

  async invoke(_messages: any[]): Promise<any> {
    const r = this.responses[Math.min(this.calls, this.responses.length - 1)]
    this.calls += 1
    return { content: r }
  }
}

const CFG = {
  enabled: true,
  max_clarify_rounds: 2,
  min_input_chars: 3,
  insufficient_patterns: ['帮我弄一下'],
  question_template: '你的需求还不太明确，方便补充一下具体想做什么吗？',
  default_options: [{ id: 'doc', label: '生成文档' }],
}

const JUDGE_CFG = {
  ...CFG,
  llm_judge: { enabled: true, clarity_threshold: 0.4, max_input_chars: 60 },
}

function makeState(text: string, over: Record<string, any> = {}) {
  return { cleaned_text: text, input_data: { prompt: text }, clarification_round: 0, ...over }
}

describe('assessClarificationNeed —— 迁移后契约不变', () => {
  it('开关关闭 / 轮次上限 / 空输入不澄清', () => {
    expect(assessClarificationNeed(makeState('帮我做'), { enabled: false }).reason).toBe('disabled')
    expect(
      assessClarificationNeed(makeState('短', { clarification_round: 2 }), CFG).reason,
    ).toBe('round_limit_reached')
    expect(assessClarificationNeed(makeState(''), CFG).reason).toBe('empty_input')
  })

  it('短输入与模糊短语触发，信息充分不触发', () => {
    expect(assessClarificationNeed(makeState('帮'), CFG).reason).toBe('input_too_short')
    expect(assessClarificationNeed(makeState('帮我弄一下'), CFG).reason).toContain(
      'insufficient_pattern',
    )
    expect(
      assessClarificationNeed(makeState('请生成一份季度销售总结文档，包含图表'), CFG).reason,
    ).toBe('sufficient')
  })
})

describe('assessClarificationCoarse —— 路由粗筛', () => {
  it('llm_judge 关闭（默认）时 === 规则判定：语义歧义不进候选', () => {
    // "帮我优化一下那个方案"（11 字）不短、不含短语 → 规则 sufficient
    const c = assessClarificationCoarse(makeState('帮我优化一下那个方案'), CFG)
    expect(c.needed).toBe(false)
    expect(c.reason).toBe('sufficient')
  })

  it('llm_judge 启用且输入在候选区间 → 进候选（供节点 LLM 精判）', () => {
    const c = assessClarificationCoarse(makeState('帮我优化一下那个方案'), JUDGE_CFG)
    expect(c.needed).toBe(true)
    expect(c.reason).toBe('llm_judge_candidate')
  })

  it('超出 max_input_chars 的长输入不进候选（避免浪费 LLM 调用）', () => {
    const long = '帮我优化一下那个方案，'.repeat(10)
    const c = assessClarificationCoarse(makeState(long), JUDGE_CFG)
    expect(c.needed).toBe(false)
  })
})

describe('detectClarification —— 节点精判', () => {
  it('规则命中时零 LLM 成本（不调用 LLM）', async () => {
    const llm = new JsonMockLlm(['{"clarity_score": 0}'])
    const r = await detectClarification(makeState('帮我弄一下'), CFG, llm)
    expect(r.needed).toBe(true)
    expect(r.source).toBe('rule')
    expect(llm.calls).toBe(0)
  })

  it('LLM 低分触发澄清，并拼接最多 2 条槽位追问', async () => {
    const llm = new JsonMockLlm([
      JSON.stringify({
        clarity_score: 0.2,
        missing_slots: [
          { slot: 'format', question: '需要什么格式？' },
          { slot: 'scope', question: '覆盖哪些范围？' },
          { slot: 'extra', question: '不需要展示的追问' },
        ],
        question: '你希望优化哪个方面、达到什么效果？',
      }),
    ])
    const r = await detectClarification(makeState('帮我优化一下那个方案'), JUDGE_CFG, llm)
    expect(r.needed).toBe(true)
    expect(r.source).toBe('llm')
    expect(r.clarity_score).toBe(0.2)
    expect(r.question).toContain('你希望优化哪个方面、达到什么效果？')
    expect(r.question).toContain('需要什么格式？')
    expect(r.question).toContain('覆盖哪些范围？')
    // 最多拼接 2 条槽位追问
    expect(r.question).not.toContain('不需要展示的追问')
    expect(r.missing_slots.length).toBe(3)
  })

  it('LLM 高分放行（reason 带评分）', async () => {
    const llm = new JsonMockLlm([JSON.stringify({ clarity_score: 0.9, missing_slots: [] })])
    const r = await detectClarification(makeState('帮我优化一下那个方案'), JUDGE_CFG, llm)
    expect(r.needed).toBe(false)
    expect(r.reason).toContain('llm_sufficient')
    expect(r.clarity_score).toBe(0.9)
  })

  it('LLM 输出不可解析 → 保守放行（不因判定异常打扰用户）', async () => {
    const llm = new JsonMockLlm(['抱歉，我无法判断。'])
    const r = await detectClarification(makeState('帮我优化一下那个方案'), JUDGE_CFG, llm)
    expect(r.needed).toBe(false)
    expect(r.reason).toBe('llm_judge_failed')
  })

  it('LLM 调用抛错 → 保守放行', async () => {
    const llm = {
      calls: 0,
      async invoke(): Promise<any> {
        this.calls += 1
        throw new Error('provider down')
      },
    }
    const r = await detectClarification(makeState('帮我优化一下那个方案'), JUDGE_CFG, llm)
    expect(r.needed).toBe(false)
    expect(r.reason).toBe('llm_judge_failed')
  })

  it('高影响门控：规则命中但非高影响 → 放行；命中高影响关键词 → 澄清', async () => {
    const gated = { ...CFG, high_impact_only: true }
    // "帮"（短输入规则命中）不含高影响词 → 被门控放行
    const low = await detectClarification(makeState('帮'), gated, null)
    expect(low.needed).toBe(false)
    expect(low.reason).toBe('low_impact')
    // 含"删除"（高影响默认关键词）→ 通过门控并澄清
    const high = await detectClarification(makeState('删除'), gated, null)
    expect(high.needed).toBe(true)
  })
})

describe('isHighImpactInput', () => {
  it('默认关键词集与自定义关键词', () => {
    expect(isHighImpactInput('帮我部署到生产环境')).toBe(true)
    expect(isHighImpactInput('写一首关于春天的诗')).toBe(false)
    expect(isHighImpactInput('帮我润色这段话', { high_impact_keywords: ['润色'] })).toBe(true)
    expect(isHighImpactInput('DEPLOY the service')).toBe(true) // 大小写不敏感
  })
})
