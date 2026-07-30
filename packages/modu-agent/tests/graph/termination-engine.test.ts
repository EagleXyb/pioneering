// P0-4 单元测试：自适应终止判定引擎（第一阶段 advisory 模式）
// 对应文档 P0-4：shouldTerminate 决策（资源耗尽/置信度达标/停滞升级/继续）
import { describe, it, expect } from 'vitest'
import {
  AdaptiveTerminationEngine,
  DEFAULT_TERMINATION_CONFIG,
  defaultTerminationEngine,
  type TerminationAction,
} from '@/graph/termination-engine.js'

describe('P0-4 AdaptiveTerminationEngine', () => {
  // ============================================================
  // 默认配置与实例
  // ============================================================
  describe('默认配置', () => {
    it('DEFAULT_TERMINATION_CONFIG 含必要字段', () => {
      expect(DEFAULT_TERMINATION_CONFIG.maxRounds).toBeGreaterThan(0)
      expect(DEFAULT_TERMINATION_CONFIG.maxTokens).toBeGreaterThan(0)
      expect(DEFAULT_TERMINATION_CONFIG.confidenceThreshold).toBeGreaterThan(0)
      expect(DEFAULT_TERMINATION_CONFIG.confidenceThreshold).toBeLessThanOrEqual(1)
      expect(DEFAULT_TERMINATION_CONFIG.stagnationThreshold).toBeGreaterThan(0)
      expect(DEFAULT_TERMINATION_CONFIG.convergenceWindow).toBeGreaterThan(0)
    })

    it('defaultTerminationEngine 为可用实例', () => {
      expect(defaultTerminationEngine).toBeInstanceOf(AdaptiveTerminationEngine)
    })
  })

  // ============================================================
  // 决策：资源耗尽 → TERMINATE_WITH_CAVEATS
  // ============================================================
  describe('资源耗尽决策', () => {
    it('round_count >= maxRounds → TERMINATE_WITH_CAVEATS', () => {
      const engine = new AdaptiveTerminationEngine({ ...DEFAULT_TERMINATION_CONFIG, maxRounds: 5 })
      const decision = engine.shouldTerminate({
        reasoning_round_count: 5,
        messages: [],
        tool_results: [],
      })
      expect(decision.action).toBe('TERMINATE_WITH_CAVEATS')
      expect(decision.caveats).toContain('max_rounds_reached')
      expect(decision.reason).toContain('Resource limit')
    })

    it('token_usage >= maxTokens → TERMINATE_WITH_CAVEATS', () => {
      const engine = new AdaptiveTerminationEngine({ ...DEFAULT_TERMINATION_CONFIG, maxTokens: 100 })
      // 构造大消息使 token 估算超限
      const bigMsg = { content: 'x'.repeat(500), _getType: () => 'human' }
      const decision = engine.shouldTerminate({
        reasoning_round_count: 0,
        messages: [bigMsg],
        tool_results: [],
      })
      expect(decision.action).toBe('TERMINATE_WITH_CAVEATS')
      expect(decision.caveats).toContain('max_tokens_reached')
    })
  })

  // ============================================================
  // 决策：置信度达标 + 收敛 → TERMINATE
  // ============================================================
  describe('置信度达标决策', () => {
    it('高置信度 + 低信息增益 → TERMINATE', () => {
      const engine = new AdaptiveTerminationEngine({
        ...DEFAULT_TERMINATION_CONFIG,
        confidenceThreshold: 0.7,
      })
      // 构造高置信度 state：有 tool_results + 无 tool_calls + 无承诺词 + 全 success
      // 构造两条相似 AIMessage 使信息增益接近 0（收敛）
      const decision = engine.shouldTerminate({
        reasoning_round_count: 2,
        messages: [
          { content: 'the final answer is 42', _getType: () => 'ai' },
          { content: 'the final answer is 42', _getType: () => 'ai' },
        ],
        tool_results: [{ status: 'success' }, { status: 'success' }],
        complexity_assessment: { decomposition: ['t1', 't2'] },
      })
      // confidence 应较高（completeness 0.9 + consistency 0.8 + reliability 0.9 + coverage 1.0）
      expect(decision.confidence).toBeGreaterThan(0.7)
      // 信息增益低（两条相同消息 → similarity=1 → gain=0）
      expect(decision.information_gain).toBeLessThan(0.05)
      expect(['TERMINATE', 'TERMINATE_WITH_CAVEATS']).toContain(decision.action)
    })
  })

  // ============================================================
  // 决策：停滞 + 低置信度 → ESCALATE
  // ============================================================
  describe('停滞升级决策', () => {
    it('连续 N 轮低增益 + 低置信度 → ESCALATE', () => {
      const engine = new AdaptiveTerminationEngine({
        ...DEFAULT_TERMINATION_CONFIG,
        confidenceThreshold: 0.9, // 高阈值使置信度难以达标
        stagnationThreshold: 3,
      })
      const decision = engine.shouldTerminate({
        reasoning_round_count: 4,
        messages: [{ content: 'same content', _getType: () => 'ai' }],
        tool_results: [],
        information_gain_history: [0.01, 0.02, 0.01], // 连续 3 轮低增益
      })
      expect(decision.action).toBe('ESCALATE')
      expect(decision.caveats).toContain('stagnation_with_low_confidence')
    })
  })

  // ============================================================
  // 决策：默认 → CONTINUE
  // ============================================================
  describe('继续推理决策', () => {
    it('低置信度 + 无停滞 → CONTINUE', () => {
      const engine = new AdaptiveTerminationEngine({
        ...DEFAULT_TERMINATION_CONFIG,
        confidenceThreshold: 0.9,
        stagnationThreshold: 5,
      })
      const decision = engine.shouldTerminate({
        reasoning_round_count: 1,
        messages: [{ content: 'thinking', _getType: () => 'ai' }],
        tool_results: [],
        information_gain_history: [0.5], // 高增益，未停滞
      })
      expect(decision.action).toBe('CONTINUE')
    })
  })

  // ============================================================
  // 置信度评估维度
  // ============================================================
  describe('置信度评估维度', () => {
    it('dimensions 含 completeness/consistency/reliability/coverage', () => {
      const engine = new AdaptiveTerminationEngine()
      const decision = engine.shouldTerminate({
        reasoning_round_count: 0,
        messages: [],
        tool_results: [],
      })
      expect(decision.dimensions).toBeDefined()
      expect(decision.dimensions.completeness).toBeGreaterThanOrEqual(0)
      expect(decision.dimensions.consistency).toBeGreaterThanOrEqual(0)
      expect(decision.dimensions.reliability).toBeGreaterThanOrEqual(0)
      expect(decision.dimensions.coverage).toBeGreaterThanOrEqual(0)
    })

    it('含失败工具结果时 reliability 降低', () => {
      const engine = new AdaptiveTerminationEngine()
      const d1 = engine.shouldTerminate({
        messages: [],
        tool_results: [{ status: 'success' }],
      })
      const d2 = engine.shouldTerminate({
        messages: [],
        tool_results: [{ status: 'failed' }],
      })
      expect(d2.dimensions.reliability).toBeLessThan(d1.dimensions.reliability)
    })
  })

  // ============================================================
  // advisory 模式：不改变路由（第一阶段核心约束）
  // ============================================================
  describe('advisory 模式（第一阶段）', () => {
    it('shouldTerminate 始终返回合法 TerminationAction', () => {
      const engine = new AdaptiveTerminationEngine()
      const validActions: TerminationAction[] = ['TERMINATE', 'TERMINATE_WITH_CAVEATS', 'CONTINUE', 'ESCALATE']
      const states = [
        { reasoning_round_count: 0, messages: [], tool_results: [] },
        { reasoning_round_count: 100, messages: [], tool_results: [] },
        { messages: [{ content: 'x', _getType: () => 'ai' }], tool_results: [] },
      ]
      for (const s of states) {
        const d = engine.shouldTerminate(s)
        expect(validActions).toContain(d.action)
        expect(d.confidence).toBeGreaterThanOrEqual(0)
        expect(d.confidence).toBeLessThanOrEqual(1)
        expect(d.information_gain).toBeGreaterThanOrEqual(0)
        expect(d.information_gain).toBeLessThanOrEqual(1)
        expect(typeof d.reason).toBe('string')
      }
    })
  })
})
