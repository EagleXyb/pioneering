// bounded-memory-saver.ts
//
// P1-7：MemorySaver LRU 有界淘汰。
//
// 背景：build_checkpointer 的共享 MemorySaver 是进程级单例，storage/writes 按
// thread_id 无限增长（长跑多会话进程内存单调上升）。当前 langgraph 版本的
// MemorySaver 没有 deleteThread API（storage/writes 为公开结构），故以子类方式
// 在写入路径维护 thread 访问序，超阈值 LRU 淘汰最久未用 thread 的全部检查点。
import type { RunnableConfig } from '@langchain/core/runnables'
import { MemorySaver } from '@langchain/langgraph'
import type { Checkpoint, CheckpointListOptions, CheckpointMetadata, CheckpointTuple } from '@langchain/langgraph-checkpoint'
import type { PendingWrite } from '@langchain/langgraph-checkpoint'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[bounded-memory-saver] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[bounded-memory-saver] ${msg}`, ...args),
}

/** 从 RunnableConfig 中取 thread_id（取不到返回 null）。 */
function _threadIdOf(config: RunnableConfig): string | null {
  const tid = (config?.configurable as Record<string, unknown> | undefined)?.['thread_id']
  return typeof tid === 'string' && tid.length > 0 ? tid : null
}

/**
 * 带 LRU thread 淘汰的内存检查点器。
 *
 * 语义：
 *   - 任意 put / putWrites / getTuple 命中的 thread_id 刷新为最近访问；
 *   - thread 数超过 maxThreads 时，淘汰访问序最旧的 thread（删除其 storage/writes）；
 *   - 被淘汰 thread 的 resume 将回到冷启动语义（调用方应按需持久化 sqlite）。
 */
export class BoundedMemorySaver extends MemorySaver {
  private readonly _maxThreads: number
  /** LRU 访问序：Set 迭代顺序即插入顺序，每次访问 delete+add 置尾，最旧在首。 */
  private readonly _threadOrder: Set<string> = new Set()

  constructor(maxThreads: number) {
    super()
    if (!Number.isFinite(maxThreads) || maxThreads < 1) {
      throw new TypeError(`BoundedMemorySaver maxThreads must be a positive integer, got ${maxThreads}`)
    }
    this._maxThreads = Math.floor(maxThreads)
  }

  /** 当前持有的 thread 数（测试/可观测用）。 */
  get threadCount(): number {
    return this._threadOrder.size
  }

  /** 淘汰阈值（测试用）。 */
  get maxThreads(): number {
    return this._maxThreads
  }

  private _touch(threadId: string): void {
    this._threadOrder.delete(threadId)
    this._threadOrder.add(threadId)
  }

  /**
   * 删除单个 thread 的全部检查点数据。
   *
   * MemorySaver 内部结构：
   *   - `storage` 按 threadId 直建索引：storage[threadId][ns][checkpointId]
   *   - `writes` 的键是复合键 `JSON.stringify([threadId, checkpointNs, checkpointId])`，
   *     不能直接 delete writes[threadId]，需遍历按 thread 段匹配清除。
   */
  private _purgeThread(threadId: string): void {
    delete (this.storage as Record<string, unknown>)[threadId]
    const writes = this.writes as Record<string, unknown>
    // thread_id 段的 JSON 字符串前缀（双引号转义，防止畸形 id 误匹配）
    const prefix = `[${JSON.stringify(threadId)},`
    for (const key of Object.keys(writes)) {
      if (key.startsWith(prefix)) delete writes[key]
    }
  }

  private _evictIfNeeded(): void {
    while (this._threadOrder.size > this._maxThreads) {
      const oldest = this._threadOrder.values().next().value as string | undefined
      if (oldest === undefined) break
      this._purgeThread(oldest)
      this._threadOrder.delete(oldest)
      logger.info('Evicted oldest thread checkpoint (LRU, max=%s): %s', this._maxThreads, oldest)
    }
  }

  override async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const result = await super.put(config, checkpoint, metadata)
    const threadId = _threadIdOf(config)
    if (threadId) {
      this._touch(threadId)
      this._evictIfNeeded()
    }
    return result
  }

  override async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    await super.putWrites(config, writes, taskId)
    const threadId = _threadIdOf(config)
    if (threadId) {
      this._touch(threadId)
      this._evictIfNeeded()
    }
  }

  override async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const tuple = await super.getTuple(config)
    if (tuple) {
      const threadId = _threadIdOf(config)
      if (threadId) this._touch(threadId)
    }
    return tuple
  }

  override async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = _threadIdOf(config)
    if (threadId) this._touch(threadId)
    yield* super.list(config, options)
  }
}
