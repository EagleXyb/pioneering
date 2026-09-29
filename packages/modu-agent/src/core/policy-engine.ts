// P1（T-10）：`PolicyEngine` 默认实现。
//
// 参照范式：`perception/pipeline.ts:26-34,86-90,92-110`
//   —— "注册表查找 + 逐项 try/catch 隔离 + 命中即短路 + 默认放行"。
//
// 设计约束：
//   - 位于 core 层，**只依赖 `core/interfaces/policy.ts`**（不 import 任何底座实现），
//     故 `ComponentRegistry` 可零循环依赖地懒构造它；
//   - 本实现只做"判定"，不含任何执行副作用（见 policy.ts 文件头 D-18 决策）。

import type {
  PolicyDecision,
  PolicyEngine,
  PolicyRule,
  PolicyStage,
  PolicySubject,
  PolicyContext,
} from './interfaces/policy.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[policy-engine] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[policy-engine] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[policy-engine] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[policy-engine] ${msg}`, ...args),
}

/** 缺省优先级（数值越小越先评估）。 */
const DEFAULT_PRIORITY = 100

/** 无规则命中 / 全部 allow 时的默认决策（等价现状）。 */
const ALLOW: PolicyDecision = { effect: 'allow', ruleId: 'default_allow' }

/**
 * 默认策略引擎。
 *
 * 规则按 `stage` 分桶、按 `priority` 升序评估；首个非 allow 决策短路返回。
 */
export class DefaultPolicyEngine implements PolicyEngine {
  private _rules: Map<string, PolicyRule> = new Map()

  use(rule: PolicyRule): void {
    if (!rule || !rule.id) {
      throw new TypeError('PolicyRule.id must be non-empty')
    }
    if (!rule.stage) {
      throw new TypeError(`PolicyRule '${rule.id}' must declare a stage`)
    }
    this._rules.set(rule.id, rule)
    logger.debug('Registered policy rule: %s (stage=%s)', rule.id, rule.stage)
  }

  listRules(stage?: PolicyStage): string[] {
    const all = [...this._rules.values()]
      .filter((r) => (stage ? r.stage === stage : true))
      .sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY))
    return all.map((r) => r.id)
  }

  async decide(
    stage: PolicyStage,
    subject: PolicySubject,
    ctx: PolicyContext = {},
  ): Promise<PolicyDecision> {
    const rules = [...this._rules.values()]
      .filter((r) => r.stage === stage)
      .sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY))

    // 记录最后一个携带改写文本（sanitizedText）的 allow 决策：
    // 全部规则放行时仍需把"允许但须改写"的结果透传给消费方（P3-C）。
    let allowWithOverride: PolicyDecision | null = null

    for (const rule of rules) {
      try {
        const decision = await rule.evaluate(subject, ctx)
        if (!decision || decision.effect === 'allow') {
          if (decision?.sanitizedText !== undefined) allowWithOverride = decision
          continue
        }
        // 命中即短路（deny / require_approval）
        return { ...decision, ruleId: decision.ruleId ?? rule.id }
      } catch (e: any) {
        // 逐项隔离：单规则异常不影响其余规则与主流程（复用 pipeline.ts 范式）
        logger.warning(
          "Policy rule '%s' (stage=%s) evaluate failed, skipping: %s",
          rule.id, stage, String(e?.message ?? e),
        )
      }
    }

    if (allowWithOverride) {
      return { ...allowWithOverride, ruleId: allowWithOverride.ruleId ?? 'default_allow' }
    }
    return { ...ALLOW }
  }
}

/**
 * 空策略引擎（无规则，恒返回 allow）。
 *
 * 用于"未装配策略引擎"的场景，保证调用方无需判空。
 */
export class NoopPolicyEngine implements PolicyEngine {
  use(_rule: PolicyRule): void {
    // no-op
  }

  listRules(_stage?: PolicyStage): string[] {
    return []
  }

  async decide(
    _stage: PolicyStage,
    _subject: PolicySubject,
    _ctx: PolicyContext = {},
  ): Promise<PolicyDecision> {
    return { ...ALLOW }
  }
}
