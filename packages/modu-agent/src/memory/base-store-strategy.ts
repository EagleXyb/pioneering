// P1（T-11）：主链路记忆策略实现 —— 包装 LangGraph `BaseStore`。
//
// 为什么是它：运行时**真在用**的记忆路径是 `BaseStore`
// （`graph/adapters/store-adapter.ts` 的 `ChromaStore` / `InMemoryStoreAdapter`），
// 经 `graph.ts` 注入 `memory_query` / `memory_update` 节点，
// 读写分别在 `nodes.ts` 的 `store.search([userId,'knowledge'], …)` 与
// `store.put([userId,'history'], …)`。
//
// 而 `BaseMemory` 家族（`InMemoryShortTermMemory` 等）在 P0 只被"注册"、
// 运行时零消费 —— 故 T-11 的主目标是把 **BaseStore 路径**抽象为可替换策略，
// 并让该策略成为 `ComponentRegistry` 中可被宿主替换的默认实现。
//
// 硬约束（与改造前逐字段等价）：
//   - `recall`  → `store.search([userId, 'knowledge'], { query, limit: topK ?? 5 })`
//   - `persist` → `store.put([userId, 'history'], item.id, { content, ...metadata })`
//   - 命名空间读写**共用同一来源**（本类的 `knowledgeNamespace` / `historyNamespace`），
//     消除改造前"写侧 chroma.ts 硬编码前缀 / 读侧 nodes.ts 硬编码 'knowledge'"的脱节。
//
// 注（D-17 决策）：`embedding` / `chunking` 的配置化**本轮不做**（P3 随场景包再议），
// 故本实现不引入新的配置键。

import type {
  MemoryItem,
  MemoryPersistContext,
  MemoryRecallContext,
  MemoryStrategy,
} from '../core/interfaces/memory-strategy.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[memory.base_store] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[memory.base_store] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[memory.base_store] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[memory.base_store] ${msg}`, ...args),
}

/** 默认知识命名空间（与改造前 `nodes.ts` 的 `[userId, 'knowledge']` 一致）。 */
export const DEFAULT_KNOWLEDGE_NAMESPACE = 'knowledge'

/** 默认历史命名空间（与改造前 `nodes.ts` 的 `[userId, 'history']` 一致）。 */
export const DEFAULT_HISTORY_NAMESPACE = 'history'

/** 默认召回条数上限（与改造前 `nodes.ts` 的 `limit: 5` 一致）。 */
export const DEFAULT_MEMORY_TOP_K = 5

export interface BaseStoreMemoryStrategyOptions {
  /** 策略 id（默认 'base_store'） */
  id?: string
  /** 知识命名空间（默认 'knowledge'） */
  knowledgeNamespace?: string
  /** 历史命名空间（默认 'history'） */
  historyNamespace?: string
}

/**
 * 基于 LangGraph `BaseStore` 的记忆策略。
 *
 * 行为与改造前 `memory_query` / `memory_update` 节点的 `store` 直连路径等价，
 * 差异仅在于"把 store 调用封装进策略"，从而使宿主可替换记忆后端。
 */
export class BaseStoreMemoryStrategy implements MemoryStrategy {
  readonly id: string
  private _store: any
  private _knowledgeNamespace: string
  private _historyNamespace: string

  constructor(store: any, opts: BaseStoreMemoryStrategyOptions = {}) {
    this._store = store
    this.id = opts.id ?? 'base_store'
    this._knowledgeNamespace = opts.knowledgeNamespace ?? DEFAULT_KNOWLEDGE_NAMESPACE
    this._historyNamespace = opts.historyNamespace ?? DEFAULT_HISTORY_NAMESPACE
  }

  /** 通用兜底策略：对任意 taskType 均可用（可由调用方注册为默认策略）。 */
  supports(_taskType?: string): boolean {
    return true
  }

  /** 底层 store（供诊断/测试断言）。 */
  get store(): any {
    return this._store
  }

  async recall(query: string, ctx: MemoryRecallContext): Promise<MemoryItem[]> {
    if (this._store === null || this._store === undefined) return []
    if (!query) return []

    const namespace = [
      ctx.userId,
      ctx.namespace?.[0] ?? this._knowledgeNamespace,
    ]
    const limit = ctx.topK ?? DEFAULT_MEMORY_TOP_K

    const rawItems = await this._store.search(namespace, { query, limit })

    const items: MemoryItem[] = []
    let idx = 0
    for (const raw of rawItems ?? []) {
      const value = (raw?.value ?? {}) as Record<string, any>
      const content =
        typeof value['content'] === 'string'
          ? (value['content'] as string)
          : JSON.stringify(value)
      items.push({
        id: String(raw?.key ?? idx),
        content,
        metadata: value,
        // 保留原始记录：`memory_query` 节点向 `state.knowledge` 注入时逐字段等价
        value,
      })
      idx += 1
    }
    return items
  }

  async persist(items: MemoryItem[], ctx: MemoryPersistContext): Promise<void> {
    if (this._store === null || this._store === undefined) return
    if (!items || items.length === 0) return

    const namespace = [
      ctx.userId,
      ctx.namespace?.[0] ?? this._historyNamespace,
    ]

    for (const item of items) {
      await this._store.put(namespace, item.id, {
        content: item.content,
        ...(item.metadata ?? {}),
      })
    }
    logger.debug(
      'Persisted %d memory item(s) to namespace [%s]',
      items.length, namespace.join('/'),
    )
  }
}

/**
 * 构造 BaseStore 记忆策略。
 *
 * @param store LangGraph BaseStore 实例（null 时策略为 no-op）
 */
export function createBaseStoreMemoryStrategy(
  store: any,
  opts: BaseStoreMemoryStrategyOptions = {},
): BaseStoreMemoryStrategy {
  return new BaseStoreMemoryStrategy(store, opts)
}
