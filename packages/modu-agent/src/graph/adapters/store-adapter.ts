// 对应 Python: modu_graph/adapters/store_adapter.py
// 记忆适配器：ChromaLongTermMemory → LangGraph BaseStore。
//
// 将现有 ChromaLongTermMemory 包装为 LangGraph BaseStore，
// 使 LangGraph 图可通过 Store API 检索长期记忆。
//
// 短期记忆由 LangGraph Checkpointer（MemorySaver / SqliteSaver）按 thread_id
// 自动管理整个 State，无需手写 query/update。
//
// 复用现有 ChromaLongTermMemory 的 _embed_texts / collection 逻辑，
// 不修改原组件代码。
import {
  BaseStore,
  type Item,
  type Operation,
  type OperationResults,
} from '@langchain/langgraph'
import { ChromaLongTermMemory } from '../../memory/chroma.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.store_adapter] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.store_adapter] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.store_adapter] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.store_adapter] ${msg}`, ...args),
}

// Store 命名空间分隔符
const _NAMESPACE_SEP = '/'

/** 将命名空间数组转为字符串键。 */
function _namespaceToStr(namespace: string[]): string {
  return namespace.join(_NAMESPACE_SEP)
}

/** SearchItem：Item + score（LangGraph 内部 SearchItem 的等价类型）。 */
type SearchItem = Item & { score?: number }

/**
 * 将 ChromaLongTermMemory 包装为 LangGraph BaseStore。
 *
 * 复用现有 ChromaLongTermMemory 的 _embed_texts / _get_or_create_collection 逻辑。
 * 内部委托给 ChromaLongTermMemory 实例，不修改原组件代码。
 *
 * 命名空间映射：
 *   LangGraph Store 使用 (user_id, "knowledge") 作为 namespace
 *   ChromaLongTermMemory 使用 user_id 作为 collection 后缀
 *   → 将 namespace 第一个元素作为 user_id
 */
export class ChromaStore extends BaseStore {
  private _chroma: ChromaLongTermMemory
  private _topK: number

  constructor(
    chromaMemory?: ChromaLongTermMemory | null,
    collectionPrefix: string = 'modu_memory',
    topK: number = 5,
    persistPath?: string | null,
  ) {
    super()
    // ChromaLongTermMemory 尚未迁移，此处假设构造函数签名兼容
    this._chroma = chromaMemory || new ChromaLongTermMemory(
      collectionPrefix,
      topK,
      persistPath,
    )
    this._topK = topK
  }

  /** 从命名空间提取 user_id。 */
  private _resolveUserId(namespace: string[]): string {
    if (namespace && namespace.length > 0) {
      return namespace[0]
    }
    return 'default'
  }

  /**
   * 根据 key 获取单个记忆项。
   *
   * ChromaLongTermMemory 不支持按 key 精确查找，此处通过
   * collection 的 get 方法实现。
   */
  async get(namespace: string[], key: string): Promise<Item | null> {
    const userId = this._resolveUserId(namespace)
    try {
      const collection = await (this._chroma as any)._getOrCreateCollection(userId)
      const result = await collection.get({ ids: [key] })
      const documents = result.documents || []
      if (documents.length > 0) {
        const now = new Date()
        return {
          namespace,
          key,
          value: { content: documents[0] },
          createdAt: now,
          updatedAt: now,
        }
      }
    } catch (e: any) {
      logger.error('ChromaStore.get error: %s', String(e))
    }
    return null
  }

  /**
   * 语义检索长期记忆。
   *
   * 委托给 ChromaLongTermMemory.query() 进行向量检索。
   */
  async search(
    namespacePrefix: string[],
    options?: {
      filter?: Record<string, any>
      limit?: number
      offset?: number
      query?: string
    },
  ): Promise<SearchItem[]> {
    const userId = this._resolveUserId(namespacePrefix)
    const query = options?.query
    const limit = options?.limit ?? 10

    if (!query) {
      // 无查询文本时返回空（Chroma 不支持纯浏览）
      return []
    }

    try {
      const result = await (this._chroma as any).query(
        userId,
        query,
        ['content'],
      )
      const items: SearchItem[] = []
      const entries = result.results || []
      for (const entry of entries) {
        const content = entry.content || ''
        const relevance = entry.relevance_score || 0.0
        const now = new Date()
        const value: Record<string, any> = { content }
        for (const [k, v] of Object.entries(entry)) {
          if (k !== 'content') value[k] = v
        }
        items.push({
          namespace: namespacePrefix,
          key: `${userId}_${items.length}_${Date.now()}`,
          value,
          createdAt: now,
          updatedAt: now,
          score: relevance,
        })
        if (items.length >= limit) {
          break
        }
      }
      return items
    } catch (e: any) {
      logger.error('ChromaStore.search error: %s', String(e))
      return []
    }
  }

  /**
   * 写入长期记忆。
   *
   * 委托给 ChromaLongTermMemory.update()。
   */
  async put(
    namespace: string[],
    key: string,
    value: Record<string, any>,
    index?: false | string[],
  ): Promise<void> {
    const userId = this._resolveUserId(namespace)

    let text = value.content || ''
    if (!text) {
      text = value.text || ''
    }

    if (!text) {
      logger.warning('ChromaStore.put: no text content in value')
      return
    }

    const metadata: Record<string, any> = {
      doc_id: key,
      created_at: Math.floor(Date.now() / 1000),
      source_type: value.source_type || 'conversation',
      namespace: _namespaceToStr(namespace),
    }

    // 将 value 中的额外字段加入 metadata
    for (const [k, v] of Object.entries(value)) {
      if (k !== 'content' && k !== 'text' && typeof v !== 'object' && typeof v !== 'function') {
        metadata[k] = v
      }
    }

    try {
      await (this._chroma as any).update(
        userId,
        { text },
        metadata,
      )
    } catch (e: any) {
      logger.error('ChromaStore.put error: %s', String(e))
    }
  }

  /** 删除单个记忆项。 */
  async delete(namespace: string[], key: string): Promise<void> {
    const userId = this._resolveUserId(namespace)
    try {
      const collection = await (this._chroma as any)._getOrCreateCollection(userId)
      await collection.delete({ ids: [key] })
    } catch (e: any) {
      logger.error('ChromaStore.delete error: %s', String(e))
    }
  }

  /** 批量操作（简化实现：逐个执行）。 */
  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: any[] = []
    for (const op of operations as any[]) {
      try {
        if (op.value != null) {
          await this.put(op.namespace, op.key, op.value)
          results.push(null)
        } else if (op.key != null) {
          await this.delete(op.namespace, op.key)
          results.push(null)
        } else if (op.namespacePrefix != null) {
          // SearchOperation
          const searchResult = await this.search(op.namespacePrefix, op)
          results.push(searchResult)
        } else if (op.namespace != null && op.key != null) {
          // GetOperation
          const item = await this.get(op.namespace, op.key)
          results.push(item)
        } else {
          results.push(null)
        }
      } catch (e: any) {
        logger.error('ChromaStore.batch op error: %s', String(e))
        results.push(null)
      }
    }
    return results as OperationResults<Op>
  }

  /** 列出命名空间（简化实现）。 */
  async listNamespaces(_options?: {
    prefix?: string[]
    suffix?: string[]
    maxDepth?: number
    limit?: number
    offset?: number
  }): Promise<string[][]> {
    return []
  }

  /** 启动 Store（ChromaStore 无需特殊初始化）。 */
  start(): void {
    // no-op
  }

  /** 停止 Store。 */
  stop(): void {
    // no-op
  }
}

/**
 * 轻量级内存 Store（不依赖 Chroma）。
 *
 * 用于测试或无 Chroma 环境，替代 ChromaStore。
 */
export class InMemoryStoreAdapter extends BaseStore {
  private _store: Map<string, Map<string, SearchItem>> = new Map()

  private _key(namespace: string[]): string {
    return _namespaceToStr(namespace)
  }

  async get(namespace: string[], key: string): Promise<Item | null> {
    const ns = this._store.get(this._key(namespace))
    if (!ns) {
      return null
    }
    return ns.get(key) || null
  }

  async search(
    namespacePrefix: string[],
    options?: {
      filter?: Record<string, any>
      limit?: number
      offset?: number
      query?: string
    },
  ): Promise<SearchItem[]> {
    const ns = this._store.get(this._key(namespacePrefix)) || new Map()
    const items = [...ns.values()]
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 10
    return items.slice(offset, offset + limit)
  }

  async put(
    namespace: string[],
    key: string,
    value: Record<string, any>,
    _index?: false | string[],
  ): Promise<void> {
    const nsKey = this._key(namespace)
    if (!this._store.has(nsKey)) {
      this._store.set(nsKey, new Map())
    }
    const now = new Date()
    this._store.get(nsKey)!.set(key, {
      namespace,
      key,
      value,
      createdAt: now,
      updatedAt: now,
      score: 1.0,
    })
  }

  async delete(namespace: string[], key: string): Promise<void> {
    const ns = this._store.get(this._key(namespace))
    if (!ns) {
      return
    }
    ns.delete(key)
  }

  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    const results: any[] = []
    for (const op of operations as any[]) {
      try {
        if (op.value != null) {
          await this.put(op.namespace, op.key, op.value)
          results.push(null)
        } else if (op.key != null) {
          await this.delete(op.namespace, op.key)
          results.push(null)
        } else if (op.namespacePrefix != null) {
          const searchResult = await this.search(op.namespacePrefix, op)
          results.push(searchResult)
        } else if (op.namespace != null && op.key != null) {
          const item = await this.get(op.namespace, op.key)
          results.push(item)
        } else {
          results.push(null)
        }
      } catch (e: any) {
        logger.error('InMemoryStoreAdapter.batch op error: %s', String(e))
        results.push(null)
      }
    }
    return results as OperationResults<Op>
  }

  async listNamespaces(_options?: {
    prefix?: string[]
    suffix?: string[]
    maxDepth?: number
    limit?: number
    offset?: number
  }): Promise<string[][]> {
    return []
  }

  start(): void {
    // no-op
  }

  stop(): void {
    // no-op
  }
}
