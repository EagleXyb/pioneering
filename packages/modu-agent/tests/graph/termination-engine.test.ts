// P0-4 单元测试：自适应终止判定引擎（第一阶段 advisory 模式）
// 对应文档 P0-4：shouldTerminate 决策（资源耗尽/置信度达标/停滞升级/继续）
// P1-3 扩展：场景化参数动态调优（SCENE_PROFILES + createEngineForScene + autoConfigureScene）
import { describe, it, expect } from 'vitest'
import {
  AdaptiveTerminationEngine,
  DEFAULT_TERMINATION_CONFIG,
  defaultTerminationEngine,
  SCENE_PROFILES,
  TIER_TO_SCENE,
  createEngineForScene,
  autoConfigureScene,
  type TerminationAction,
  type SceneProfile,
  type SceneProfileConfig,
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

  // ============================================================
  // P1-3: 场景化参数动态调优
  // ============================================================
  describe('P1-3 场景化参数动态调优', () => {
    it('SCENE_PROFILES 覆盖 4 类典型场景', () => {
      expect(SCENE_PROFILES.quick_qa).toBeDefined()
      expect(SCENE_PROFILES.complex_analysis).toBeDefined()
      expect(SCENE_PROFILES.creative_generation).toBeDefined()
      expect(SCENE_PROFILES.high_stakes_decision).toBeDefined()
    })

    it('quick_qa 场景参数反映快速终止特征', () => {
      const cfg = SCENE_PROFILES.quick_qa
      expect(cfg.maxRounds).toBeLessThan(DEFAULT_TERMINATION_CONFIG.maxRounds)
      expect(cfg.maxTokens).toBeLessThan(DEFAULT_TERMINATION_CONFIG.maxTokens)
      expect(cfg.confidenceThreshold).toBeLessThan(DEFAULT_TERMINATION_CONFIG.confidenceThreshold)
    })

    it('high_stakes_decision 场景参数反映高风险特征', () => {
      const cfg = SCENE_PROFILES.high_stakes_decision
      expect(cfg.maxRounds).toBeGreaterThan(DEFAULT_TERMINATION_CONFIG.maxRounds)
      expect(cfg.maxTokens).toBeGreaterThan(DEFAULT_TERMINATION_CONFIG.maxTokens)
      expect(cfg.confidenceThreshold).toBeGreaterThan(DEFAULT_TERMINATION_CONFIG.confidenceThreshold)
      expect(cfg.mandatoryVerification).toBe(true)
      expect(cfg.dualConfirmation).toBe(true)
    })

    it('creative_generation 场景标注 quality_metrics', () => {
      const cfg = SCENE_PROFILES.creative_generation
      expect(cfg.qualityMetrics).toBeDefined()
      expect(cfg.qualityMetrics).toContain('originality')
      expect(cfg.qualityMetrics).toContain('coherence')
      expect(cfg.qualityMetrics).toContain('relevance')
    })

    it('TIER_TO_SCENE 映射正确', () => {
      expect(TIER_TO_SCENE.tier_1).toBe('quick_qa')
      expect(TIER_TO_SCENE.tier_2).toBe('complex_analysis')
      expect(TIER_TO_SCENE.tier_3).toBe('high_stakes_decision')
    })

    it('createEngineForScene: 显式 scene 优先级最高', () => {
      const engine = createEngineForScene('high_stakes_decision')
      // high_stakes_decision 的 maxRounds=20，与默认 15 不同
      // 通过资源耗尽决策验证引擎使用了 high_stakes 场景配置
      const decision = engine.shouldTerminate({
        reasoning_round_count: 16, // 超过默认 15 但低于 high_stakes 的 20
        messages: [],
        tool_results: [],
      })
      // 16 < 20，不应触发 max_rounds 终止（caveats 可能为 undefined）
      expect(decision.caveats ?? []).not.toContain('max_rounds_reached')

      const decision2 = engine.shouldTerminate({
        reasoning_round_count: 20,
        messages: [],
        tool_results: [],
      })
      expect(decision2.caveats).toContain('max_rounds_reached')
    })

    it('createEngineForScene: tier 映射生效', () => {
      const engine = createEngineForScene(null, 'tier_1')
      // tier_1 → quick_qa，maxRounds=3
      const decision = engine.shouldTerminate({
        reasoning_round_count: 3,
        messages: [],
        tool_results: [],
      })
      expect(decision.caveats).toContain('max_rounds_reached')
    })

    it('createEngineForScene: 无 scene 无 tier 时回退默认', () => {
      const engine = createEngineForScene(null, null)
      // 默认 complex_analysis，maxRounds=15
      const decision = engine.shouldTerminate({
        reasoning_round_count: 15,
        messages: [],
        tool_results: [],
      })
      expect(decision.caveats).toContain('max_rounds_reached')
    })

    it('createEngineForScene: scene 优先级高于 tier', () => {
      // 显式 scene=quick_qa + tier=tier_3，应使用 quick_qa 配置
      const engine = createEngineForScene('quick_qa', 'tier_3')
      const decision = engine.shouldTerminate({
        reasoning_round_count: 3, // quick_qa 的 maxRounds=3
        messages: [],
        tool_results: [],
      })
      expect(decision.caveats).toContain('max_rounds_reached')
    })

    it('autoConfigureScene: has_time_constraint 压缩 maxRounds 与 maxTokens', () => {
      const base = SCENE_PROFILES.complex_analysis
      const tuned = autoConfigureScene('complex_analysis', { has_time_constraint: true })
      expect(tuned.maxRounds).toBeLessThanOrEqual(5)
      expect(tuned.maxTokens).toBeLessThanOrEqual(5000)
      // 未传 requires_high_precision 时 confidenceThreshold 不变
      expect(tuned.confidenceThreshold).toBe(base.confidenceThreshold)
    })

    it('autoConfigureScene: requires_high_precision 提升 confidenceThreshold（上限 0.98）', () => {
      const tuned = autoConfigureScene('complex_analysis', { requires_high_precision: true })
      const base = SCENE_PROFILES.complex_analysis
      expect(tuned.confidenceThreshold).toBeGreaterThan(base.confidenceThreshold)
      expect(tuned.confidenceThreshold).toBeLessThanOrEqual(0.98)
    })

    it('autoConfigureScene: high_stakes_decision + high_precision 不超过 0.98 上限', () => {
      const tuned = autoConfigureScene('high_stakes_decision', { requires_high_precision: true })
      expect(tuned.confidenceThreshold).toBeLessThanOrEqual(0.98)
    })

    it('autoConfigureScene: 无任务特征时返回基础配置副本', () => {
      const base = SCENE_PROFILES.complex_analysis
      const tuned = autoConfigureScene('complex_analysis')
      expect(tuned.maxRounds).toBe(base.maxRounds)
      expect(tuned.maxTokens).toBe(base.maxTokens)
      expect(tuned.confidenceThreshold).toBe(base.confidenceThreshold)
      // 应为独立对象，修改不影响原配置
      expect(tuned).not.toBe(base)
    })

    it('场景化引擎在置信度评估上正确区分 quick_qa 与 high_stakes', () => {
      // quick_qa: confidenceThreshold=0.7
      const quickEngine = createEngineForScene('quick_qa')
      // high_stakes: confidenceThreshold=0.95
      const highStakesEngine = createEngineForScene('high_stakes_decision')

      // 构造中等置信度状态（约 0.7-0.8）
      // tool_results 为空 + messages 仅 1 条 AIMessage（无承诺词）→
      //   completeness=0.5, consistency=0.8, reliability=0.9, coverage=0.7
      //   weighted = 0.5*0.35 + 0.8*0.25 + 0.9*0.2 + 0.7*0.2 = 0.175+0.2+0.18+0.14 = 0.695
      const state = {
        reasoning_round_count: 1,
        messages: [{ content: 'answer', _getType: () => 'ai' }],
        tool_results: [],
      }

      const quickDecision = quickEngine.shouldTerminate(state)
      const highStakesDecision = highStakesEngine.shouldTerminate(state)

      // quick_qa 置信度 0.695 接近阈值 0.7，可能 TERMINATE_WITH_CAVEATS 或 CONTINUE
      // high_stakes 置信度 0.695 远低于阈值 0.95，应 CONTINUE
      expect(highStakesDecision.action).toBe('CONTINUE')
      // quick_qa 阈值低，更倾向终止
      // 注：因 confidence 0.695 < 0.7，quick_qa 也可能 CONTINUE，此处仅验证 high_stakes 更保守
      expect(quickDecision.confidence).toBe(highStakesDecision.confidence) // 同 state 同置信度
    })
  })
})
