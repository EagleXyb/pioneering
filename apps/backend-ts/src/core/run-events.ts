/**
 * 运行事件缓冲（P5）
 *
 * 为 SSE 提供三重能力：
 *   1. 每个事件分配单调递增的 seq（输出为 `id: <seq>`）
 *   2. 断线后按 `Last-Event-ID` 重放已产生的事件
 *   3. 运行仍在进行时，订阅者可继续接收后续事件
 *
 * 当前实现为进程内存储（TTL 5 分钟）。多实例/跨重启的回放需要任务事件表，
 * 接口保持可替换：`subscribe` 的语义与终态的事件流一致。
 */

export interface RunEvent {
  seq: number
  /** 完整 SSE 帧（`data: {...}\n\n`），回放时前缀 `id:` */
  frame: string
}

export interface RunSubscription {
  /** seq > afterSeq 的历史事件（按 seq 升序） */
  backlog: RunEvent[]
  /** 订阅时运行已结束：backlog 写完即可关闭 */
  finished: boolean
  unsubscribe: () => void
}

interface RunEntry {
  ownerId: string
  events: RunEvent[]
  nextSeq: number
  listeners: Set<(event: RunEvent) => void>
  finished: boolean
  timer: ReturnType<typeof setTimeout> | null
}

export interface StartRunOptions {
  /** 运行结束后的保留时间（回放窗口） */
  ttlMs?: number
  /** 单次运行最多缓存事件数（超出后不再缓存，仅继续推送） */
  maxEvents?: number
}

const DEFAULT_TTL_MS = 5 * 60_000
const DEFAULT_MAX_EVENTS = 10_000

export class RunEventHub {
  private readonly _runs = new Map<string, RunEntry>()

  start(runId: string, ownerId: string, opts: StartRunOptions = {}): void {
    this._delete(runId)
    const entry: RunEntry = {
      ownerId,
      events: [],
      nextSeq: 1,
      listeners: new Set(),
      finished: false,
      timer: null,
    }
    const ttlMs = Math.max(10_000, opts.ttlMs ?? DEFAULT_TTL_MS)
    const maxEvents = Math.max(100, opts.maxEvents ?? DEFAULT_MAX_EVENTS)

    // 未结束的运行也设硬上限，避免进程长期持有
    entry.timer = setTimeout(() => this._delete(runId), ttlMs * 6)
    ;(entry.timer as unknown as { unref?: () => void }).unref?.()
    ;(entry as RunEntry & { maxEvents?: number }).maxEvents = maxEvents

    this._runs.set(runId, entry)
  }

  ownerOf(runId: string): string | undefined {
    return this._runs.get(runId)?.ownerId
  }

  /** 发布一帧，返回分配到的 seq；运行不存在或已结束时返回 null。 */
  publish(runId: string, frame: string): number | null {
    const entry = this._runs.get(runId)
    if (!entry || entry.finished) return null

    const seq = entry.nextSeq++
    const maxEvents = (entry as RunEntry & { maxEvents?: number }).maxEvents ?? DEFAULT_MAX_EVENTS
    if (entry.events.length < maxEvents) {
      entry.events.push({ seq, frame })
    }

    for (const listener of entry.listeners) {
      try {
        listener({ seq, frame })
      } catch {
        // 单个订阅者异常不影响其他订阅者
      }
    }
    return seq
  }

  /** 标记运行结束：通知订阅者，保留回放窗口。 */
  finish(runId: string): void {
    const entry = this._runs.get(runId)
    if (!entry || entry.finished) return
    entry.finished = true
    for (const listener of entry.listeners) {
      try {
        ;(listener as (e: RunEvent | null) => void)(null)
      } catch {
        // 忽略
      }
    }
    entry.listeners.clear()
    if (entry.timer) clearTimeout(entry.timer)
    const ttlMs = DEFAULT_TTL_MS
    entry.timer = setTimeout(() => this._delete(runId), ttlMs)
    ;(entry.timer as unknown as { unref?: () => void }).unref?.()
  }

  /**
   * 订阅运行事件。
   *
   * @param afterSeq 只回放 seq > afterSeq 的事件（`Last-Event-ID`）
   * @param listener 新事件回调；运行结束时收到 null
   * @returns null 表示运行不存在（已被 TTL 清理）
   */
  subscribe(
    runId: string,
    afterSeq: number,
    listener: (event: RunEvent | null) => void,
  ): RunSubscription | null {
    const entry = this._runs.get(runId)
    if (!entry) return null

    const backlog = entry.finished
      ? entry.events.filter((e) => e.seq > afterSeq)
      : entry.events.filter((e) => e.seq > afterSeq)

    if (entry.finished) {
      return { backlog, finished: true, unsubscribe: () => undefined }
    }

    entry.listeners.add(listener)
    return {
      backlog,
      finished: false,
      unsubscribe: () => {
        entry.listeners.delete(listener)
      },
    }
  }

  isFinished(runId: string): boolean {
    return this._runs.get(runId)?.finished ?? true
  }

  _reset(): void {
    for (const entry of this._runs.values()) {
      if (entry.timer) clearTimeout(entry.timer)
    }
    this._runs.clear()
  }

  private _delete(runId: string): void {
    const entry = this._runs.get(runId)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.listeners.clear()
    this._runs.delete(runId)
  }
}

export const runEventHub = new RunEventHub()
