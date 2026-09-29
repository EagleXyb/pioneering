// 对应 Python: orchestration/communication/message_bus.py
// EventBus + 全局单例 get_event_bus + PersistentEventLog
import fs from 'fs'
import { mkdir, appendFile, stat, rename, unlink } from 'fs/promises'
import path from 'path'

import type { AgentEvent, EventPriority } from './protocol.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[event-bus] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[event-bus] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[event-bus] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[event-bus] ${msg}`, ...args),
}

export type EventHandler = (event: AgentEvent) => Promise<void> | void

// ============================================================
// Subscription
// ============================================================

export interface SubscriptionOptions {
  handler: EventHandler
  domain?: string | null
  action?: string | null
  priority_filter?: EventPriority | null
}

export class Subscription {
  handler: EventHandler
  domain: string | null
  action: string | null
  priority_filter: EventPriority | null

  constructor(opts: SubscriptionOptions) {
    this.handler = opts.handler
    this.domain = opts.domain ?? null
    this.action = opts.action ?? null
    this.priority_filter = opts.priority_filter ?? null
  }

  matches(event: AgentEvent): boolean {
    if (this.domain && this.domain !== event.domain) {
      return false
    }
    if (this.action && this.action !== event.action) {
      return false
    }
    if (this.priority_filter && this.priority_filter !== event.priority) {
      return false
    }
    return true
  }
}

// ============================================================
// EventBus
// ============================================================

export class EventBus {
  private _subscriptions: Subscription[] = []
  private _domainIndex: Map<string, Subscription[]> = new Map()

  subscribe(
    handler: EventHandler,
    domain?: string | null,
    action?: string | null,
    priority_filter?: EventPriority | null,
  ): () => void {
    const sub = new Subscription({ handler, domain, action, priority_filter })
    this._subscriptions.push(sub)
    if (domain) {
      let list = this._domainIndex.get(domain)
      if (!list) {
        list = []
        this._domainIndex.set(domain, list)
      }
      list.push(sub)
    }

    return () => {
      const idx = this._subscriptions.indexOf(sub)
      if (idx >= 0) {
        this._subscriptions.splice(idx, 1)
      }
      if (domain) {
        const list = this._domainIndex.get(domain)
        if (list) {
          const i2 = list.indexOf(sub)
          if (i2 >= 0) {
            list.splice(i2, 1)
          }
        }
      }
    }
  }

  async publish(event: AgentEvent): Promise<void> {
    let matched = this._domainIndex.get(event.domain)
    if (!matched || matched.length === 0) {
      matched = this._subscriptions
    }

    const tasks: Promise<void>[] = []
    for (const sub of matched) {
      if (sub.matches(event)) {
        tasks.push(this._safeInvoke(sub.handler, event))
      }
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks)
    }
  }

  private async _safeInvoke(handler: EventHandler, event: AgentEvent): Promise<void> {
    try {
      await handler(event)
    } catch (e) {
      logger.error(
        'Event handler error: event_id=%s domain=%s action=%s error=%s',
        event.event_id, event.domain, event.action, String(e),
      )
    }
  }

  async request(event: AgentEvent, timeoutMs = 5000): Promise<AgentEvent | null> {
    let resolveFn!: (val: AgentEvent | null) => void
    const responsePromise = new Promise<AgentEvent | null>((resolve) => {
      resolveFn = resolve
    })
    let done = false
    const request_id = event.event_id

    const responseHandler = (respEvent: AgentEvent): void => {
      // metadata 已放宽为 Record<string, unknown>，按 key 读取并比较（对应文档 §2.2 建议2）
      if (respEvent.metadata['request_id'] === request_id && !done) {
        done = true
        resolveFn(respEvent)
      }
    }

    const unsub = this.subscribe(
      responseHandler,
      event.domain,
      `${event.action}_response`,
    )

    await this.publish(event)

    const timeoutPromise = new Promise<AgentEvent | null>((resolve) => {
      setTimeout(() => {
        if (!done) {
          done = true
          resolve(null)
        }
      }, timeoutMs)
    })

    try {
      return await Promise.race([responsePromise, timeoutPromise])
    } finally {
      unsub()
    }
  }
}

// ============================================================
// PersistentEventLog（对应 Python PersistentEventLog）
// ============================================================

/**
 * 持久化事件日志配置。
 *
 * 对应文档 §2.2 建议5：事件 TTL。
 */
export interface PersistentEventLogOptions {
  /** 日志文件路径 */
  log_file_path: string
  /** 单文件最大大小（MB），超过后滚动 */
  max_file_size_mb?: number
  /** 仅持久化指定 domain 的事件；null/undefined 表示全部 */
  domains?: string[] | null
  /**
   * 事件 TTL（毫秒），超过此时长的事件不入库。
   * 0 或负数表示不启用 TTL（保留全部历史）。
   * 对应文档 §2.2 建议5：事件 TTL。
   */
  event_ttl_ms?: number
}

export class PersistentEventLog {
  private _log_file_path: string
  private _max_file_size: number
  private _domains: Set<string> | null
  private _event_ttl_ms: number
  private _enabled = false
  private _write_queue: AgentEvent[] = []
  private _writer_running = false
  private _writerPromise: Promise<void> | null = null

  constructor(
    log_file_path_or_opts: string | PersistentEventLogOptions,
    max_file_size_mb = 10.0,
    domains?: string[] | null,
  ) {
    // 兼容旧签名（string, number, string[]）与新签名（PersistentEventLogOptions）
    if (typeof log_file_path_or_opts === 'string') {
      this._log_file_path = log_file_path_or_opts
      this._max_file_size = Math.floor(max_file_size_mb * 1024 * 1024)
      this._domains = domains ? new Set(domains) : null
      this._event_ttl_ms = 0
    } else {
      const opts = log_file_path_or_opts
      this._log_file_path = opts.log_file_path
      this._max_file_size = Math.floor((opts.max_file_size_mb ?? 10.0) * 1024 * 1024)
      this._domains = opts.domains ? new Set(opts.domains) : null
      this._event_ttl_ms = opts.event_ttl_ms ?? 0
    }
  }

  async start(event_bus: EventBus): Promise<void> {
    const log_dir = path.dirname(this._log_file_path)
    if (log_dir && !fs.existsSync(log_dir)) {
      try {
        await mkdir(log_dir, { recursive: true })
      } catch (e) {
        logger.warning('Cannot create log directory %s: %s', log_dir, String(e))
        return
      }
    }

    this._enabled = true
    event_bus.subscribe(this._on_event.bind(this))
    this._writer_running = true
    this._writerPromise = this._writerLoop()
    logger.info('PersistentEventLog started: %s', this._log_file_path)
  }

  async stop(): Promise<void> {
    this._enabled = false
    this._writer_running = false
    // 等待 writerLoop 处理完剩余队列后退出（writerLoop 在 _writer_running=false
    // 后仍会处理完 _write_queue 中的事件再退出，避免死锁与数据丢失）
    if (this._writerPromise) {
      await this._writerPromise
      this._writerPromise = null
    }
  }

  private async _on_event(event: AgentEvent): Promise<void> {
    if (!this._enabled) {
      return
    }
    if (this._domains && !this._domains.has(event.domain)) {
      return
    }
    // TTL 过滤（对应文档 §2.2 建议5）：超过 TTL 的事件直接丢弃，不入库
    if (this._event_ttl_ms > 0) {
      const age = Date.now() - event.timestamp.getTime()
      if (age > this._event_ttl_ms) {
        return
      }
    }
    this._write_queue.push(event)
  }

  private async _writerLoop(): Promise<void> {
    // 在 _writer_running 为 true 时持续运行；被 stop() 置为 false 后，
    // 仍需处理完队列中剩余事件再退出，避免数据丢失
    while (this._writer_running || this._write_queue.length > 0) {
      if (this._write_queue.length === 0) {
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      const event = this._write_queue.shift()!
      try {
        if (fs.existsSync(this._log_file_path)) {
          const stats = await stat(this._log_file_path)
          if (stats.size > this._max_file_size) {
            await this._rotateLog()
          }
        }
        // P0（T-03）：落盘 payload。
        // 审计事件的关键语义（event_type / decision / details）位于 payload，
        // 若仅落 metadata 则审计日志缺少决策依据。二进制载荷（Uint8Array）不落 JSON 行。
        const event_dict: Record<string, any> = {
          event_id: event.event_id,
          timestamp: event.timestamp.toISOString(),
          trace_id: event.trace_id,
          session_id: event.session_id,
          user_id: event.user_id,
          domain: event.domain,
          action: event.action,
          priority: event.priority,
          metadata: event.metadata,
          schema_version: event.schema_version,
        }
        const payload: any = event.payload
        if (payload !== undefined && payload !== null && !(payload instanceof Uint8Array)) {
          event_dict['payload'] = payload
        }
        const line = JSON.stringify(event_dict) + '\n'
        await appendFile(this._log_file_path, line, 'utf-8')
      } catch (e) {
        logger.warning('Failed to write event log: %s', String(e))
      }
    }
  }

  private async _rotateLog(): Promise<void> {
    const rotated_path = this._log_file_path + '.1'
    try {
      if (fs.existsSync(rotated_path)) {
        await unlink(rotated_path)
      }
      await rename(this._log_file_path, rotated_path)
      logger.info('Event log rotated: %s → %s', this._log_file_path, rotated_path)
    } catch (e) {
      logger.warning('Log rotation failed: %s', String(e))
    }
  }
}

// ============================================================
// 全局单例（对应 Python get_event_bus / reset_event_bus）
// ============================================================

let _event_bus: EventBus | null = null

export function get_event_bus(override?: EventBus | null): EventBus {
  if (override !== undefined && override !== null) {
    _event_bus = override
  }
  if (_event_bus === null) {
    _event_bus = new EventBus()
  }
  return _event_bus
}

export function reset_event_bus(): void {
  _event_bus = null
}

export function override_event_bus(event_bus: EventBus): { restore: () => void } {
  const old = _event_bus
  _event_bus = event_bus
  return {
    restore: () => {
      _event_bus = old
    },
  }
}

// ============================================================
// 持久化事件日志 boot（P0 T-03）
// ============================================================
//
// 背景：`PersistentEventLog` 实现完整，但全仓从未实例化 → 审计事件无处落盘。
// 本函数由 create_agent 调用，按 `event_bus.*` 配置启动持久化日志。
//
// 硬约束（默认行为零变化）：
//   - 仅当 `event_bus.log_file_path` 非空时启动；默认 `''` → 不创建文件、不订阅。
//   - 启动失败仅告警并降级（审计为旁路，不影响主流程）。
//   - 进程内幂等：重复调用返回同一实例。

let _persistent_event_log: PersistentEventLog | null = null

/** 获取当前持久化事件日志实例（未启动时为 null）。 */
export function get_persistent_event_log(): PersistentEventLog | null {
  return _persistent_event_log
}

/**
 * 按配置启动持久化事件日志。
 *
 * 消费的配置键：
 *   - event_bus.log_file_path（空字符串 = 不启动）
 *   - event_bus.log_max_file_size_mb
 *   - event_bus.log_domains（null = 全部 domain；['security'] 可仅落审计事件）
 *   - event_bus.event_ttl_ms
 *
 * @param config    运行时配置（null 时不启动）
 * @param event_bus 事件总线（默认全局单例）
 * @returns 已启动的实例；未启动返回 null
 */
export async function start_persistent_event_log_from_config(
  config?: { get: (key: string, defaultValue?: any) => any } | null,
  event_bus?: EventBus | null,
): Promise<PersistentEventLog | null> {
  if (_persistent_event_log !== null) {
    return _persistent_event_log
  }
  if (!config) {
    return null
  }

  let logFilePath = ''
  let maxFileSizeMb = 10.0
  let domains: string[] | null = null
  let eventTtlMs = 0
  try {
    logFilePath = String(config.get('event_bus.log_file_path', '') ?? '')
    maxFileSizeMb = Number(config.get('event_bus.log_max_file_size_mb', 10.0)) || 10.0
    const rawDomains = config.get('event_bus.log_domains', null)
    domains = Array.isArray(rawDomains) ? rawDomains.map(String) : null
    eventTtlMs = Number(config.get('event_bus.event_ttl_ms', 0)) || 0
  } catch (e: any) {
    logger.warning('read event_bus config failed: %s', String(e?.message ?? e))
    return null
  }

  if (!logFilePath) {
    logger.debug('event_bus.log_file_path empty, PersistentEventLog not started (no-op)')
    return null
  }

  const bus = event_bus ?? get_event_bus()
  const log = new PersistentEventLog({
    log_file_path: logFilePath,
    max_file_size_mb: maxFileSizeMb,
    domains,
    event_ttl_ms: eventTtlMs,
  })
  try {
    await log.start(bus)
    _persistent_event_log = log
    logger.info(
      'PersistentEventLog started via boot: path=%s domains=%s',
      logFilePath, domains ? domains.join(',') : '(all)',
    )
    return log
  } catch (e: any) {
    logger.warning('PersistentEventLog start failed, audit persistence disabled: %s', String(e?.message ?? e))
    return null
  }
}

/** 停止并清空持久化事件日志（测试清理 / 优雅停机用）。 */
export async function stop_persistent_event_log(): Promise<void> {
  const log = _persistent_event_log
  _persistent_event_log = null
  if (log) {
    try {
      await log.stop()
    } catch (e: any) {
      logger.warning('PersistentEventLog stop failed: %s', String(e?.message ?? e))
    }
  }
}

/** 仅重置引用，不停止（测试清理用）。 */
export function reset_persistent_event_log(): void {
  _persistent_event_log = null
}
