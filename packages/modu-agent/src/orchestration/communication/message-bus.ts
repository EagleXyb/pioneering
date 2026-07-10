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
      if (respEvent.metadata.request_id === request_id && !done) {
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

export class PersistentEventLog {
  private _log_file_path: string
  private _max_file_size: number
  private _domains: Set<string> | null
  private _enabled = false
  private _write_queue: AgentEvent[] = []
  private _writer_running = false

  constructor(
    log_file_path: string,
    max_file_size_mb = 10.0,
    domains?: string[] | null,
  ) {
    this._log_file_path = log_file_path
    this._max_file_size = Math.floor(max_file_size_mb * 1024 * 1024)
    this._domains = domains ? new Set(domains) : null
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
    this._writerLoop()
    logger.info('PersistentEventLog started: %s', this._log_file_path)
  }

  async stop(): Promise<void> {
    this._enabled = false
    this._writer_running = false
    // 等待队列排空
    while (this._write_queue.length > 0) {
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  private async _on_event(event: AgentEvent): Promise<void> {
    if (!this._enabled) {
      return
    }
    if (this._domains && !this._domains.has(event.domain)) {
      return
    }
    this._write_queue.push(event)
  }

  private async _writerLoop(): Promise<void> {
    while (this._writer_running) {
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
        const event_dict = {
          event_id: event.event_id,
          timestamp: event.timestamp.toISOString(),
          trace_id: event.trace_id,
          session_id: event.session_id,
          user_id: event.user_id,
          domain: event.domain,
          action: event.action,
          priority: event.priority,
          metadata: event.metadata,
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
