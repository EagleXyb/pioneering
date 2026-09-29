// P0（T-06）：激活 `memory.default_strategy`。
//
// 背景：`memory.default_strategy` 已声明于 DEFAULT_CONFIG（runtime-config.ts:70），
// 但运行时无任何 `get()` 消费点（仅 fromEnv 写入）→ 属"声明但未消费"的配置键。
// 本模块把该配置键接到实际行为：按策略 id 选择并注册记忆组件。
//
// 硬约束（默认行为零变化）：
//   - 默认策略 'cache' → 注册 InMemoryShortTermMemory（纯内存，无外部依赖、无副作用）。
//   - 未知策略 id → 仅 debug 日志并跳过，不抛异常、不注册任何东西。
//   - 幂等：同名组件已注册则直接返回。
//
// 说明：本模块是 P0 的"最小接线"。P1 的 MemoryStrategy 统一契约
// （recall/persist + supports(taskType)）将在此基础上替换为策略注册表。

import { getConfig, type RuntimeConfig } from '../config/runtime-config.js'
import type { ComponentRegistry } from '../core/registry.js'
import { InMemoryShortTermMemory } from './short-term-memory.js'
// P1（T-11）: 主链路记忆策略（包装 langgraph BaseStore）
import { BaseStoreMemoryStrategy } from './base-store-strategy.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[memory.strategy] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[memory.strategy] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[memory.strategy] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[memory.strategy] ${msg}`, ...args),
}

/** 映射到 InMemoryShortTermMemory 的策略别名。 */
const _SHORT_TERM_ALIASES = new Set([
  'cache',
  'short_term',
  'short-term',
  'short_term_memory',
  'in_memory',
])

/**
 * 读取 `memory.default_strategy` 并注册对应记忆组件。
 *
 * @param registry      组件注册表
 * @param runtimeConfig 运行时配置（null 时使用全局单例）
 * @returns 已注册的策略 id；未知策略或注册失败返回 null
 */
export function registerMemoryStrategyFromConfig(
  registry: ComponentRegistry,
  runtimeConfig?: RuntimeConfig | null,
): string | null {
  let strategy = 'cache'
  try {
    const cfg = runtimeConfig ?? getConfig()
    strategy = String(cfg.get('memory.default_strategy', 'cache') ?? 'cache')
  } catch (e: any) {
    logger.debug('read memory.default_strategy failed, using default: %s', String(e?.message ?? e))
    strategy = 'cache'
  }

  if (!strategy) {
    return null
  }

  // 幂等：已注册则跳过
  if (registry.getMemory(strategy) !== undefined) {
    return strategy
  }

  if (_SHORT_TERM_ALIASES.has(strategy)) {
    try {
      registry.registerMemory(strategy, new InMemoryShortTermMemory())
      logger.info("Registered memory component for strategy '%s'", strategy)
      return strategy
    } catch (e: any) {
      logger.warning("Failed to register memory for strategy '%s': %s", strategy, String(e?.message ?? e))
      return null
    }
  }

  logger.debug(
    "memory.default_strategy '%s' has no built-in implementation, skipping registration",
    strategy,
  )
  return null
}

// ============================================================
// P1（T-11）：主链路记忆策略（BaseStore 路径）注册
// ============================================================

/** BaseStore 记忆策略的注册 id。 */
export const BASE_STORE_MEMORY_STRATEGY_ID = 'base_store'

/**
 * 注册"包装 langgraph BaseStore"的记忆策略，并返回解析后的策略实例。
 *
 * 与 {@link registerMemoryStrategyFromConfig} 的区别：
 *   - 后者注册的是 `BaseMemory` 家族（`registry.registerMemory`，**兼容旁路**，
 *     主链路不消费 —— 见实施计划 §0.1 #8）；
 *   - 本函数注册的是**主链路真在用的 BaseStore 路径**的策略实现
 *     （`MemoryStrategy` 契约），使宿主可替换记忆后端。
 *
 * 默认语义（零变化）：
 *   - `store` 为空 → 不注册，返回 null（调用方沿用 `store` 直连路径）；
 *   - 已注册同 id（宿主先行注册）→ 不覆盖，返回既有策略（**宿主覆盖优先**）；
 *   - 注册时不强制设为默认（`ComponentRegistry.registerMemoryStrategy` 会在
 *     无默认时自动选首个注册者），避免覆盖宿主已设置的默认策略。
 *
 * @param registry      组件注册表
 * @param store         langgraph BaseStore 实例
 * @returns 已注册的策略实例；store 为空时返回 null
 */
export function registerBaseStoreMemoryStrategy(
  registry: ComponentRegistry,
  store: any,
): BaseStoreMemoryStrategy | null {
  if (store === null || store === undefined) {
    return null
  }
  const existing = registry.getMemoryStrategy(BASE_STORE_MEMORY_STRATEGY_ID)
  if (existing !== undefined) {
    logger.debug(
      "Memory strategy '%s' already registered, keeping existing implementation",
      BASE_STORE_MEMORY_STRATEGY_ID,
    )
    // 宿主可能注册了自定义实现；仅在类型匹配时返回其引用
    return existing instanceof BaseStoreMemoryStrategy ? existing : null
  }
  const strategy = new BaseStoreMemoryStrategy(store, { id: BASE_STORE_MEMORY_STRATEGY_ID })
  try {
    registry.registerMemoryStrategy(strategy)
    logger.info("Registered base-store memory strategy (id='%s')", BASE_STORE_MEMORY_STRATEGY_ID)
  } catch (e: any) {
    logger.warning(
      "Failed to register base-store memory strategy: %s",
      String(e?.message ?? e),
    )
    return null
  }
  return strategy
}
