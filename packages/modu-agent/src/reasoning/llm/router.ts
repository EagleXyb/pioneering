// LLM 模型路由器
//
// 对应文档 §2.1 模型路由层建议：
//   新增 LLMRouter，按 task_type / estimated_complexity / cost_budget 路由到不同模型，
//   支持配置化路由规则。实现简单问题用 flash/mini、复杂问题用 pro/max 的成本优化策略。
//
// 设计：
//   - LLMRouter 接口定义在 core/interfaces/llm.ts
//   - RuleBasedLLMRouter 为参考实现，按 llm.router.rules 配置匹配
//   - 路由规则按数组顺序匹配，首个命中规则胜出，无命中则走 default_route
import type { LLMRouteContext, LLMRouter, ModuLLM } from '../../core/interfaces/llm.js'
import { getConfig } from '../../config/runtime-config.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[llm.router] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[llm.router] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[llm.router] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[llm.router] ${msg}`, ...args),
}

/**
 * 路由规则匹配条件。
 *
 * 所有条件为 AND 关系（全部命中才匹配）。
 * 字段值支持单值或数组（数组表示 OR）。
 */
export interface RouteRuleCondition {
  task_type?: string | string[]
  estimated_complexity?: 'low' | 'medium' | 'high' | Array<'low' | 'medium' | 'high'>
  /** 成本预算上限（ctx.costBudget <= 此值时命中） */
  cost_budget_max?: number
}

/**
 * 路由规则。
 *
 * when 条件命中时，使用 route 指向的命名路由。
 */
export interface RouteRule {
  when: RouteRuleCondition
  route: string
}

/**
 * 路由定义（命名路由 → LLM 实例工厂）。
 *
 * 宿主在构造 RuleBasedLLMRouter 时注入路由表，每个路由名对应一个 ModuLLM 实例工厂。
 * 工厂模式便于按需构造（如首次访问时懒加载）。
 */
export type RouteTable = Record<string, () => ModuLLM>

/**
 * 规则匹配检查：条件是否命中上下文。
 *
 * 所有条件 AND 关系，字段值数组表示 OR。
 */
function _matchCondition(ctx: LLMRouteContext, cond: RouteRuleCondition): boolean {
  if (cond.task_type !== undefined) {
    if (ctx.taskType === undefined) return false
    if (!_matchValue(ctx.taskType, cond.task_type)) return false
  }
  if (cond.estimated_complexity !== undefined) {
    if (ctx.estimatedComplexity === undefined) return false
    if (!_matchValue(ctx.estimatedComplexity, cond.estimated_complexity)) return false
  }
  if (cond.cost_budget_max !== undefined) {
    if (ctx.costBudget === undefined) return false
    if (ctx.costBudget > cond.cost_budget_max) return false
  }
  return true
}

function _matchValue<T>(actual: T, expected: T | T[]): boolean {
  if (Array.isArray(expected)) {
    return expected.includes(actual)
  }
  return actual === expected
}

/**
 * 基于规则的 LLM 路由器。
 *
 * 从 RuntimeConfig llm.router 读取规则配置，按顺序匹配 RouteRule，
 * 首个命中规则的 route 名胜出，无命中则走 default_route。
 *
 * 路由对应的 ModuLLM 实例由宿主通过 routeTable 注入。
 *
 * 示例配置：
 *   llm:
 *     router:
 *       enabled: true
 *       default_route: 'default'
 *       routes:
 *         default: { provider: 'deepseek', model: 'deepseek-chat' }
 *         pro:     { provider: 'deepseek', model: 'deepseek-reasoner' }
 *       rules:
 *         - when: { task_type: 'planning' }
 *           route: 'pro'
 *         - when: { estimated_complexity: 'high' }
 *           route: 'pro'
 */
export class RuleBasedLLMRouter implements LLMRouter {
  private _routeTable: RouteTable
  private _rules: RouteRule[]
  private _defaultRoute: string
  private _instanceCache: Map<string, ModuLLM> = new Map()

  constructor(routeTable: RouteTable, rules?: RouteRule[], defaultRoute?: string) {
    this._routeTable = routeTable
    this._defaultRoute = defaultRoute ?? this._readDefaultRouteFromConfig()
    this._rules = rules ?? this._readRulesFromConfig()

    if (!this._routeTable[this._defaultRoute]) {
      throw new Error(
        `RuleBasedLLMRouter: default route '${this._defaultRoute}' not found in route table. ` +
        `Available routes: ${Object.keys(this._routeTable).join(', ')}`,
      )
    }
  }

  route(ctx: LLMRouteContext): ModuLLM {
    // 按顺序匹配规则，首个命中胜出
    for (const rule of this._rules) {
      if (_matchCondition(ctx, rule.when)) {
        const llm = this._getOrCreate(rule.route)
        if (llm) {
          logger.debug(
            'Route matched: rule=%j → route=%s (task=%s complexity=%s)',
            rule.when, rule.route, ctx.taskType, ctx.estimatedComplexity,
          )
          return llm
        }
      }
    }

    // 无命中，走默认路由
    const fallback = this._getOrCreate(this._defaultRoute)
    if (!fallback) {
      throw new Error(`RuleBasedLLMRouter: default route '${this._defaultRoute}' factory returned null`)
    }
    logger.debug(
      'No rule matched, using default route=%s (task=%s complexity=%s)',
      this._defaultRoute, ctx.taskType, ctx.estimatedComplexity,
    )
    return fallback
  }

  /**
   * 获取或创建路由对应的 LLM 实例（懒加载 + 缓存）。
   */
  private _getOrCreate(routeName: string): ModuLLM | null {
    const cached = this._instanceCache.get(routeName)
    if (cached) return cached

    const factory = this._routeTable[routeName]
    if (!factory) {
      logger.warning("Route '%s' not found in route table", routeName)
      return null
    }

    try {
      const llm = factory()
      this._instanceCache.set(routeName, llm)
      return llm
    } catch (e) {
      logger.error("Failed to construct LLM for route '%s': %s", routeName, String(e))
      return null
    }
  }

  private _readDefaultRouteFromConfig(): string {
    try {
      return String(getConfig().get('llm.router.default_route', 'default'))
    } catch {
      return 'default'
    }
  }

  private _readRulesFromConfig(): RouteRule[] {
    try {
      const rules = getConfig().get('llm.router.rules', [])
      if (!Array.isArray(rules)) return []
      return rules as RouteRule[]
    } catch {
      return []
    }
  }
}

/**
 * 直通路由器（不路由，直接返回固定 LLM 实例）。
 *
 * 用于 llm.router.enabled=false 时的默认行为，保持接口一致性。
 */
export class PassthroughLLMRouter implements LLMRouter {
  private _llm: ModuLLM

  constructor(llm: ModuLLM) {
    this._llm = llm
  }

  route(_ctx: LLMRouteContext): ModuLLM {
    return this._llm
  }
}
