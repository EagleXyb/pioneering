// 复杂度评估器（对应文档 P0-1：Thought 分层推理框架）
//
// 根据用户查询评估任务复杂度，输出 Tier 分层结果：
//   - tier_1（快速响应）：明确意图 + 单一工具 + 无歧义，Thought 预算 1 轮
//   - tier_2（标准推理）：多步骤 + 工具组合 + 有条件分支，Thought 预算 2-4 轮
//   - tier_3（深度推理）：不确定性高 + 多源验证 + 决策影响大，Thought 预算 5+ 轮
//
// 设计要点：
//   1. LLM 评估失败时回退到规则化评估（基于 query 长度与关键词），保证不阻断主流程
//   2. 评估结果写入 state.complexity_assessment，供 makeAgentNode 调整温度、
//      routeAfterAgent 控制终止、P0-2 CoT 锚点按 tier 条件启用
//   3. 全部字段可选，缺失时回退到 tier_2（等价现状行为），向后兼容
//
// 风险控制（对应风险登记表 R-01）：
//   - 触及 state.ts（CoreState 新增字段）+ nodes.ts 的 routeAfterAgent
//   - 规避：字段全 optional + 规则化回退 + assessment_fallback 标记供监控

import type { ModuLLM, LLMMessage } from '../core/interfaces/llm.js'

/**
 * 复杂度层级。
 * - tier_1: 快速响应（1 轮 Thought）
 * - tier_2: 标准推理（2-4 轮 Thought）
 * - tier_3: 深度推理（5+ 轮 Thought）
 */
export type ComplexityTier = 'tier_1' | 'tier_2' | 'tier_3'

/**
 * 复杂度评估结果。
 */
export interface ComplexityAssessment {
  /** 任务复杂度层级 */
  tier: ComplexityTier
  /** 最大 Thought 轮数（推理预算） */
  reasoning_budget: number
  /** 子任务分解（tier_2/3 时非空，tier_1 可为空） */
  decomposition: string[]
  /** 最低可接受置信度（0.0-1.0），tier 越高阈值越高 */
  confidence_threshold: number
  /** 评估方式标记：'llm' | 'rule_fallback' */
  assessment_method: 'llm' | 'rule_fallback'
}

/**
 * Tier 到温度的映射（对应文档 P0-1 策略 A）。
 * tier_1 高温快速直答，tier_3 低温深思。
 */
export const TIER_TEMPERATURE_MAP: Record<ComplexityTier, number> = {
  tier_1: 0.7,
  tier_2: 0.5,
  tier_3: 0.2,
}

/**
 * Tier 到默认推理预算的映射。
 */
export const TIER_REASONING_BUDGET: Record<ComplexityTier, number> = {
  tier_1: 1,
  tier_2: 4,
  tier_3: 8,
}

/**
 * Tier 到置信度阈值的映射。
 */
export const TIER_CONFIDENCE_THRESHOLD: Record<ComplexityTier, number> = {
  tier_1: 0.6,
  tier_2: 0.75,
  tier_3: 0.9,
}

/**
 * 规则化评估关键词（用于回退路径）。
 *
 * 触发 tier_3 的关键词：高风险/多源验证/决策影响大
 * 触发 tier_1 的关键词：明确意图/单一工具/无歧义
 * 其余默认 tier_2
 */
const TIER_3_KEYWORDS = [
  // 高风险决策
  '风险评估', '风控', '决策', '审核', '审批', '投资建议', '合规', '审计',
  // 多源验证
  '对比分析', '交叉验证', '多方核实', '综合评估', '深度分析',
  // 高复杂度
  '复杂', '系统性', '端到端', '全链路', '架构设计',
  // 英文
  'risk assessment', 'compliance', 'audit', 'cross-validate', 'in-depth analysis',
  'decision support', 'architect', 'comprehensive',
]

const TIER_1_KEYWORDS = [
  // 明确意图
  '什么是', '什么是', '解释一下', '定义', '翻译', '计算', '查询', '今天',
  '现在时间', '当前日期', '天气',
  // 英文
  'what is', 'define', 'translate', 'calculate', 'today', 'current time', 'weather',
]

/**
 * 规则化复杂度评估（无 LLM 依赖的回退路径）。
 *
 * 基于 query 长度与关键词匹配判定 tier：
 *   - 命中 tier_3 关键词 → tier_3
 *   - 命中 tier_1 关键词 且 query 长度 < 100 字符 → tier_1
 *   - 否则 → tier_2（等价现状默认行为）
 */
export function assessByRule(userQuery: string): ComplexityAssessment {
  const query = userQuery ?? ''
  const lowerQuery = query.toLowerCase()

  // 优先判定 tier_3（高风险关键词优先级最高）
  const hitTier3 = TIER_3_KEYWORDS.some((kw) =>
    query.includes(kw) || lowerQuery.includes(kw.toLowerCase()),
  )
  if (hitTier3) {
    return {
      tier: 'tier_3',
      reasoning_budget: TIER_REASONING_BUDGET.tier_3,
      decomposition: [query],
      confidence_threshold: TIER_CONFIDENCE_THRESHOLD.tier_3,
      assessment_method: 'rule_fallback',
    }
  }

  // 判定 tier_1（简单查询 + 短文本）
  const hitTier1 = TIER_1_KEYWORDS.some((kw) =>
    query.includes(kw) || lowerQuery.includes(kw.toLowerCase()),
  )
  if (hitTier1 && query.length < 100) {
    return {
      tier: 'tier_1',
      reasoning_budget: TIER_REASONING_BUDGET.tier_1,
      decomposition: [],
      confidence_threshold: TIER_CONFIDENCE_THRESHOLD.tier_1,
      assessment_method: 'rule_fallback',
    }
  }

  // 默认 tier_2
  return {
    tier: 'tier_2',
    reasoning_budget: TIER_REASONING_BUDGET.tier_2,
    decomposition: [query],
    confidence_threshold: TIER_CONFIDENCE_THRESHOLD.tier_2,
    assessment_method: 'rule_fallback',
  }
}

/**
 * LLM 复杂度评估提示词（对应文档 P0-1 策略 A）。
 */
const _COMPLEXITY_ASSESSMENT_PROMPT = `Analyze the user's task and output a complexity assessment.

Task: {user_query}

Evaluation dimensions:
1. Step count: single-step(1) / multi-step(2-4) / complex-flow(5+)
2. Tool dependency: no-tool(0) / single-tool(1) / multi-tool-combo(2+)
3. Uncertainty: high-certainty(1) / partial-uncertain(2) / high-uncertain(3)
4. Risk level: low(1) / medium(2) / high(3)

Output format (JSON only, no markdown fences):
{
  "tier": "tier_1 | tier_2 | tier_3",
  "reasoning_budget": <max thought rounds, integer>,
  "decomposition": ["subtask1", "subtask2"],
  "confidence_threshold": <0.0-1.0>
}

Tier mapping:
- tier_1: clear intent + single tool + no ambiguity, budget=1
- tier_2: multi-step + tool combo + conditional branches, budget=2-4
- tier_3: high uncertainty + multi-source validation + high-stakes decision, budget=5+`

/**
 * 复杂度评估器。
 *
 * 优先使用 LLM 评估，失败时回退到规则化评估。
 * 所有异常被捕获并降级，保证不阻断主流程。
 */
export class ComplexityAssessor {
  constructor(private llm: ModuLLM | null = null) {}

  /**
   * 评估用户查询的复杂度。
   *
   * @param userQuery 用户原始查询文本
   * @returns 复杂度评估结果；LLM 不可用或失败时返回规则化评估结果
   */
  async assess(userQuery: string): Promise<ComplexityAssessment> {
    // LLM 不可用时直接走规则化评估
    if (!this.llm) {
      return assessByRule(userQuery)
    }

    try {
      const prompt = _COMPLEXITY_ASSESSMENT_PROMPT.replace('{user_query}', userQuery ?? '')
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a task complexity analyzer. Output only valid JSON.' },
        { role: 'user', content: prompt },
      ]

      const result = await this.llm.invoke(messages, {
        temperature: 0.0,
        maxTokens: 256,
      })

      return this._parseLlmResult(result.content, userQuery)
    } catch (e: any) {
      // LLM 评估失败，回退规则化评估
      // 不抛出异常，保证主流程不阻断
      const fallback = assessByRule(userQuery)
      // 标记为回退路径，供监控告警
      ;(fallback as any)._fallback_reason = String(e?.message ?? e)
      return fallback
    }
  }

  /**
   * 解析 LLM 返回的 JSON 结果。
   *
   * 解析失败时回退到规则化评估。
   */
  private _parseLlmResult(content: string, userQuery: string): ComplexityAssessment {
    try {
      // 容错：剥离可能的 markdown 代码块
      let jsonStr = content.trim()
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/,'')
      }

      const parsed = JSON.parse(jsonStr)
      const tier = this._normalizeTier(parsed['tier'])

      return {
        tier,
        reasoning_budget: this._normalizeBudget(parsed['reasoning_budget'], tier),
        decomposition: Array.isArray(parsed['decomposition'])
          ? parsed['decomposition'].map(String)
          : [],
        confidence_threshold: this._normalizeConfidence(parsed['confidence_threshold'], tier),
        assessment_method: 'llm',
      }
    } catch {
      // JSON 解析失败，回退规则化评估
      return assessByRule(userQuery)
    }
  }

  private _normalizeTier(tier: any): ComplexityTier {
    if (tier === 'tier_1' || tier === 'tier_3') return tier
    return 'tier_2' // 包括 undefined / 异常值
  }

  private _normalizeBudget(budget: any, tier: ComplexityTier): number {
    const n = Number(budget)
    if (Number.isFinite(n) && n >= 1 && n <= 20) return Math.floor(n)
    return TIER_REASONING_BUDGET[tier]
  }

  private _normalizeConfidence(conf: any, tier: ComplexityTier): number {
    const n = Number(conf)
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n
    return TIER_CONFIDENCE_THRESHOLD[tier]
  }
}

/**
 * 默认复杂度评估（等价现状行为）。
 *
 * 当 state 中无 complexity_assessment 时使用，返回 tier_2。
 */
export function defaultAssessment(): ComplexityAssessment {
  return {
    tier: 'tier_2',
    reasoning_budget: TIER_REASONING_BUDGET.tier_2,
    decomposition: [],
    confidence_threshold: TIER_CONFIDENCE_THRESHOLD.tier_2,
    assessment_method: 'rule_fallback',
  }
}
