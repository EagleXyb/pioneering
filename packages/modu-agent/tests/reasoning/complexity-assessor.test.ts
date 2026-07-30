// P0-1 单元测试：复杂度评估器
// 对应文档 P0-1 执行建议：单元测试覆盖三类 tier 判定
import { describe, it, expect } from 'vitest'
import {
  assessByRule,
  ComplexityAssessor,
  TIER_REASONING_BUDGET,
  TIER_CONFIDENCE_THRESHOLD,
  TIER_TEMPERATURE_MAP,
  defaultAssessment,
  type ComplexityTier,
} from '@/reasoning/complexity-assessor.js'

describe('P0-1 ComplexityAssessor', () => {
  // ============================================================
  // 规则化评估：三类 tier 判定（文档明确要求）
  // ============================================================
  describe('assessByRule - 三类 tier 判定', () => {
    it('命中高风险关键词 → tier_3', () => {
      const cases = [
        '请进行风险评估并给出投资建议',
        'compliance audit for cross-validate',
        '需要深度分析与综合评估',
        '架构设计端到端全链路',
      ]
      for (const q of cases) {
        const r = assessByRule(q)
        expect(r.tier).toBe('tier_3')
        expect(r.reasoning_budget).toBe(TIER_REASONING_BUDGET.tier_3)
        expect(r.confidence_threshold).toBe(TIER_CONFIDENCE_THRESHOLD.tier_3)
        expect(r.assessment_method).toBe('rule_fallback')
      }
    })

    it('命中简单意图关键词且短文本 → tier_1', () => {
      const cases = [
        '什么是 React',
        '今天天气如何',
        'define AI',
        'calculate 1+1',
      ]
      for (const q of cases) {
        const r = assessByRule(q)
        expect(r.tier).toBe('tier_1')
        expect(r.reasoning_budget).toBe(TIER_REASONING_BUDGET.tier_1)
        expect(r.confidence_threshold).toBe(TIER_CONFIDENCE_THRESHOLD.tier_1)
        expect(r.decomposition).toEqual([])
      }
    })

    it('普通多步骤问题 → tier_2（默认）', () => {
      // 注意：避免命中 tier_1（查询/计算/今天等）与 tier_3（风险/审计等）关键词
      const r = assessByRule('帮我整理这份文档的内容并输出摘要')
      expect(r.tier).toBe('tier_2')
      expect(r.reasoning_budget).toBe(TIER_REASONING_BUDGET.tier_2)
      expect(r.confidence_threshold).toBe(TIER_CONFIDENCE_THRESHOLD.tier_2)
    })

    it('tier_1 关键词但长文本 → 降级 tier_2（避免简单意图但复杂上下文）', () => {
      const longQuery = '什么是机器学习'.padEnd(120, ' 详细说明')
      const r = assessByRule(longQuery)
      expect(r.tier).toBe('tier_2')
    })

    it('tier_3 关键词优先级高于 tier_1', () => {
      // 同时含 tier_1 和 tier_3 关键词，应判 tier_3
      const r = assessByRule('什么是风险评估')
      expect(r.tier).toBe('tier_3')
    })
  })

  // ============================================================
  // Tier 映射常量
  // ============================================================
  describe('tier 映射常量', () => {
    it('温度映射：tier_1 高温 > tier_2 > tier_3 低温', () => {
      expect(TIER_TEMPERATURE_MAP.tier_1).toBeGreaterThan(TIER_TEMPERATURE_MAP.tier_2)
      expect(TIER_TEMPERATURE_MAP.tier_2).toBeGreaterThan(TIER_TEMPERATURE_MAP.tier_3)
    })

    it('推理预算映射：tier_3 > tier_2 > tier_1', () => {
      expect(TIER_REASONING_BUDGET.tier_3).toBeGreaterThan(TIER_REASONING_BUDGET.tier_2)
      expect(TIER_REASONING_BUDGET.tier_2).toBeGreaterThan(TIER_REASONING_BUDGET.tier_1)
    })

    it('置信度阈值映射：tier_3 > tier_2 > tier_1', () => {
      expect(TIER_CONFIDENCE_THRESHOLD.tier_3).toBeGreaterThan(TIER_CONFIDENCE_THRESHOLD.tier_2)
      expect(TIER_CONFIDENCE_THRESHOLD.tier_2).toBeGreaterThan(TIER_CONFIDENCE_THRESHOLD.tier_1)
    })
  })

  // ============================================================
  // 默认评估（等价现状行为）
  // ============================================================
  describe('defaultAssessment', () => {
    it('返回 tier_2，等价现状默认行为', () => {
      const r = defaultAssessment()
      expect(r.tier).toBe('tier_2')
      expect(r.reasoning_budget).toBe(TIER_REASONING_BUDGET.tier_2)
      expect(r.assessment_method).toBe('rule_fallback')
    })
  })

  // ============================================================
  // LLM 评估器（无 LLM 时回退规则化）
  // ============================================================
  describe('ComplexityAssessor.assess', () => {
    it('llm=null 时回退规则化评估', async () => {
      const assessor = new ComplexityAssessor(null)
      const r = await assessor.assess('风险评估')
      expect(r.tier).toBe('tier_3')
      expect(r.assessment_method).toBe('rule_fallback')
    })

    it('llm=null 时简单查询回退 tier_1', async () => {
      const assessor = new ComplexityAssessor(null)
      const r = await assessor.assess('什么是 AI')
      expect(r.tier).toBe('tier_1')
      expect(r.assessment_method).toBe('rule_fallback')
    })

    it('空查询不抛异常，返回 tier_2', async () => {
      const assessor = new ComplexityAssessor(null)
      const r = await assessor.assess('')
      expect(r.tier).toBe('tier_2')
    })
  })

  // ============================================================
  // 向后兼容性
  // ============================================================
  describe('向后兼容', () => {
    it('所有 tier 类型合法', () => {
      const tiers: ComplexityTier[] = ['tier_1', 'tier_2', 'tier_3']
      for (const t of tiers) {
        expect(TIER_TEMPERATURE_MAP[t]).toBeDefined()
        expect(TIER_REASONING_BUDGET[t]).toBeDefined()
        expect(TIER_CONFIDENCE_THRESHOLD[t]).toBeDefined()
      }
    })
  })
})
