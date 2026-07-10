// 对应 Python: components/memory/vector/chroma.py
// ChromaLongTermMemory：基于 ChromaDB 的长期向量记忆
import * as crypto from 'crypto'
import { BaseMemory } from '../core/interfaces/memory.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[chroma] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[chroma] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[chroma] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[chroma] ${msg}`, ...args),
}

const _EMBEDDING_DIM = 384

// P2-12.2.1: ChromaDB 持久化默认路径
const _DEFAULT_CHROMA_PATH = './chroma_data'

/**
 * 简单哈希嵌入（确定性降级，无外部依赖）。
 * 对应 Python _simple_hash_embedding。
 *
 * 使用 SHA-256 迭代生成 dim 维向量，归一化后返回。
 */
function _simpleHashEmbedding(text: string, dim: number = _EMBEDDING_DIM): number[] {
  const raw = crypto.createHash('sha256').update(text, 'utf-8').digest()
  const values: number[] = []
  for (let i = 0; i < dim; i++) {
    const chunk = crypto.createHash('sha256').update(Buffer.concat([raw, Buffer.allocUnsafe(4)])).digest()
    // 写入 i 到 buffer
    const buf = Buffer.allocUnsafe(4)
    buf.writeUInt32LE(i, 0)
    const fullChunk = crypto.createHash('sha256').update(Buffer.concat([raw, buf])).digest()
    const bits = fullChunk.readUInt32LE(0)
    const val = (bits / 0xFFFFFFFF) * 2.0 - 1.0
    values.push(val)
  }
  let norm = 0
  for (const v of values) {
    norm += v * v
  }
  norm = Math.sqrt(norm)
  if (norm === 0) {
    return new Array(dim).fill(0.0)
  }
  return values.map((v) => v / norm)
}

/**
 * 基于 ChromaDB 的长期向量记忆。
 * 对应 Python ChromaLongTermMemory。
 *
 * 嵌入策略（三级降级）：
 *   1. SentenceTransformer（all-MiniLM-L6-v2）— TS 无等价库，降级
 *   2. ONNX Runtime（all-MiniLM-L6-v2）— TS 无等价库，降级
 *   3. hash embedding（确定性降级，无外部依赖）
 *
 * 注：Python 版通过 chromadb.utils.embedding_functions 获取语义嵌入；
 * TS 版 chromadb npm 包不提供等价 embedding_function，故默认使用 hash embedding。
 * 如需语义嵌入，可在外部注入 embedding 函数后调用 setEmbeddingFunction。
 */
export class ChromaLongTermMemory extends BaseMemory {
  private _collectionPrefix: string
  private _topK: number
  // P2-12.2.1: persist_path 默认从环境变量解析
  private _persistPath: string | null
  private _client: any = null
  // P2-12.2.2: 是否使用语义嵌入
  private _useSemanticEmbedding: boolean | null = null
  private _embedFn: ((texts: string[]) => number[][]) | null = null
  // 缓存已验证的嵌入维度
  private _embeddingDim: number | null = null

  constructor(
    collectionPrefix: string = 'modu_memory',
    topK: number = 5,
    persistPath?: string | null,
  ) {
    super()
    this._collectionPrefix = collectionPrefix
    this._topK = topK
    // P2-12.2.1: persist_path 默认从环境变量解析
    this._persistPath = ChromaLongTermMemory._resolvePersistPath(persistPath)
  }

  /**
   * P2-12.2.1: 解析 ChromaDB 持久化路径。
   *
   * 优先级：
   *     1. 显式传入的 persist_path（非 null）
   *     2. 环境变量 MODU_CHROMA_IN_MEMORY=1 → 内存模式（返回 null）
   *     3. 环境变量 MODU_CHROMA_PATH
   *     4. 默认路径 ./chroma_data
   */
  private static _resolvePersistPath(persistPath?: string | null): string | null {
    if (persistPath !== null && persistPath !== undefined) {
      return persistPath
    }
    const inMemoryEnv = (process.env.MODU_CHROMA_IN_MEMORY ?? '').toLowerCase()
    if (['1', 'true', 'yes'].includes(inMemoryEnv)) {
      logger.info('ChromaDB in-memory mode forced by MODU_CHROMA_IN_MEMORY env')
      return null
    }
    return process.env.MODU_CHROMA_PATH ?? _DEFAULT_CHROMA_PATH
  }

  /**
   * 获取 ChromaDB 客户端（延迟初始化）。
   * 对应 Python _get_client。
   *
   * 动态导入 chromadb npm 包；未安装时抛出错误。
   */
  private async _getClient(): Promise<any> {
    if (this._client === null) {
      let chromadb: any
      try {
        chromadb = await import('chromadb')
      } catch (e) {
        logger.error('chromadb package not available: %s', String(e))
        throw new Error(`chromadb not available: ${e}`)
      }

      // P2-12.3.2: 持久化模式优先，无 path 时退化为内存模式
      if (this._persistPath) {
        this._client = new chromadb.PersistentClient({ path: this._persistPath })
        logger.info('ChromaDB PersistentClient initialized: %s', this._persistPath)
      } else {
        this._client = new chromadb.Client()
        logger.info('ChromaDB in-memory client initialized')
      }
    }
    return this._client
  }

  /**
   * 嵌入文本列表。
   * 对应 Python _embed_texts。
   */
  private _embedTexts(texts: string[]): number[][] {
    if (this._useSemanticEmbedding === null) {
      this._initEmbeddingFunction()
    }
    if (this._useSemanticEmbedding && this._embedFn) {
      return this._embedFn(texts)
    }
    return texts.map((t) => _simpleHashEmbedding(t))
  }

  /**
   * P2-12.2.2: 三级降级初始化嵌入函数。
   *
   * 改进点：
   *     - 重命名 _use_semantic_embedding 准确反映语义（不仅限 SentenceTransformer）
   *     - 嵌入维度一致性校验
   *     - 更精细的错误日志，便于排查降级原因
   *
   * 注：Python 版尝试 SentenceTransformer → ONNX → hash；
   * TS 版无等价嵌入库，直接降级为 hash embedding。
   * 可通过 setEmbeddingFunction 注入外部嵌入函数启用语义嵌入。
   */
  private _initEmbeddingFunction(): void {
    // 第一级：SentenceTransformer（all-MiniLM-L6-v2）
    // TS 无等价库，跳过

    // 第二级：ONNX Runtime all-MiniLM-L6-v2
    // TS 无等价库，跳过

    // 第三级：hash embedding（确定性降级，无外部依赖）
    logger.warning(
      'Embedding backend: hash embedding (fallback) — ' +
      'SentenceTransformer and ONNX both unavailable in TS runtime',
    )
    this._useSemanticEmbedding = false
    this._embedFn = null
    this._embeddingDim = _EMBEDDING_DIM
  }

  /**
   * 外部注入嵌入函数（启用语义嵌入）。
   *
   * 用于在 TS 运行时中接入 @xenova/transformers 等库提供的嵌入模型。
   *
   * @param fn 嵌入函数，接收文本列表，返回向量列表
   * @param dim 嵌入维度（用于一致性校验）
   */
  setEmbeddingFunction(fn: (texts: string[]) => number[][], dim: number): void {
    this._useSemanticEmbedding = true
    this._embedFn = fn
    this._embeddingDim = dim
    logger.info('Embedding backend: external (dim=%d)', dim)
  }

  /**
   * 获取或创建集合。
   * 对应 Python _get_or_create_collection。
   */
  private async _getOrCreateCollection(userId: string): Promise<any> {
    const client = await this._getClient()
    const collectionName = `${this._collectionPrefix}_${userId}`
    return client.getOrCreateCollection({
      name: collectionName,
      metadata: { 'hnsw:space': 'cosine' },
    })
  }

  async query(
    userId: string,
    contextWindow: string,
    requiredFields: string[],
  ): Promise<Record<string, any>> {
    const queryText = contextWindow
    if (queryText.startsWith('last_')) {
      return { results: [] }
    }

    let collection: any
    try {
      collection = await this._getOrCreateCollection(userId)
    } catch (e) {
      logger.error('ChromaDB get collection error: %s', String(e))
      return { results: [] }
    }

    let count: number
    try {
      count = await collection.count()
    } catch (e) {
      logger.error('ChromaDB count error: %s', String(e))
      return { results: [] }
    }
    if (count === 0) {
      return { results: [] }
    }

    try {
      const queryEmbeddings = this._embedTexts([queryText])
      const results = await collection.query({
        queryEmbeddings,
        nResults: Math.min(this._topK, count),
      })

      const documents: string[] = results.documents?.[0] ?? []
      const metadatas: Array<Record<string, any>> = results.metadatas?.[0] ?? []
      const distances: number[] = results.distances?.[0] ?? []

      const items: Array<Record<string, any>> = []
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i]
        const meta = metadatas[i] ?? {}
        const dist = distances[i] ?? 0
        const item: Record<string, any> = { content: doc, relevance_score: Math.round((1 - dist) * 10000) / 10000 }
        for (const field of requiredFields) {
          if (field in meta) {
            item[field] = meta[field]
          }
        }
        items.push(item)
      }

      return { results: items }
    } catch (e) {
      logger.error('ChromaDB query error: %s', String(e))
      return { results: [] }
    }
  }

  async update(
    userId: string,
    newData: Record<string, any>,
    metadata: Record<string, any>,
  ): Promise<boolean> {
    let collection: any
    try {
      collection = await this._getOrCreateCollection(userId)
    } catch (e) {
      logger.error('ChromaDB get collection error: %s', String(e))
      return false
    }

    const text: string = newData.text ?? String(newData)

    const docId: string = metadata.doc_id ?? crypto.randomUUID()
    const enrichedMeta: Record<string, any> = { ...metadata }
    enrichedMeta['source_type'] = enrichedMeta['source_type'] ?? 'conversation'
    enrichedMeta['created_at'] = enrichedMeta['created_at'] ?? Math.floor(Date.now() / 1000)
    enrichedMeta['user_id'] = userId

    for (const [key, value] of Object.entries(newData)) {
      if (key !== 'text' && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
        enrichedMeta[key] = value
      }
    }

    try {
      const embeddings = this._embedTexts([text])
      await collection.upsert({
        ids: [docId],
        documents: [text],
        embeddings,
        metadatas: [enrichedMeta],
      })
      logger.debug('ChromaDB upsert: user=%s doc_id=%s', userId, docId)
      return true
    } catch (e) {
      logger.error('ChromaDB upsert error: %s', String(e))
      return false
    }
  }
}
