import { describe, it, expect } from 'vitest'
import { QualityMonitor } from '@/feedback/quality-monitor.js'

describe('QualityMonitor (rule mode)', () => {
  it('returns zero scores for empty response', () => {
    const qm = new QualityMonitor(null, 'rule')
    const r = qm.evaluate('prompt', '', {})
    expect(r.overall).toBe(0)
    expect(r.relevance).toBe(0)
  })

  it('evaluateAsync returns evaluator_mode "rule"', async () => {
    const qm = new QualityMonitor(null, 'rule')
    const r = await qm.evaluateAsync('prompt', '这是一个完整且相关的回答内容。', {})
    expect(r.evaluator_mode).toBe('rule')
    expect(r.overall).toBeGreaterThan(0)
  })

  it('low-confidence phrasing reduces confidence', () => {
    const qm = new QualityMonitor(null, 'rule')
    const r = qm.evaluate('prompt', '我不确定，可能大概也许是这样。', {})
    expect(r.confidence).toBeLessThan(1)
  })

  it('unknown-answer phrasing reduces completeness', () => {
    const qm = new QualityMonitor(null, 'rule')
    const r = qm.evaluate('prompt', '我不知道这个问题的答案，无法回答。', {})
    expect(r.completeness).toBeLessThan(1)
  })

  it('falls back to rule when llm mode has no evaluator', async () => {
    const qm = new QualityMonitor(null, 'llm')
    expect(qm.mode).toBe('rule') // downgraded because evaluator is null
    const r = await qm.evaluateAsync('prompt', '正常回答。', {})
    expect(['rule', 'rule_fallback']).toContain(r.evaluator_mode)
  })

  it('clamps LLM judge scores to [0,1]', () => {
    const qm = new QualityMonitor(null, 'rule')
    const parsed = (qm as any)._parseJudgeResponse(
      '{"relevance":2,"completeness":2,"accuracy":2,"confidence":2,"tool_success":2,"overall":2}',
    )
    expect(parsed.relevance).toBeLessThanOrEqual(1)
    expect(parsed.relevance).toBeGreaterThanOrEqual(0)
    expect(parsed.overall).toBeLessThanOrEqual(1)
  })
})
