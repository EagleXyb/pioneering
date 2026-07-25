// 对应 Python: observability/tracing.py
// OtelSpanManager + get_span_manager 全局单例 + span() 方法
import { performance } from 'perf_hooks'

import { getConfig } from '../config/runtime-config.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[tracing] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[tracing] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[tracing] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[tracing] ${msg}`, ...args),
}

// 全局单例（首次访问时懒初始化）
let _span_manager: OtelSpanManager | null = null

function _is_tracing_config_enabled(): boolean {
  try {
    return Boolean(getConfig().get('observability.tracing.enabled', false))
  } catch {
    return false
  }
}

// ============================================================
// SpanHandle —— span() 返回的句柄，支持手动 end()/recordError() 和 Symbol.dispose
// ============================================================

export interface SpanHandle {
  /** 正常结束 span（记录 elapsed_ms，设置 OK 状态） */
  end(): void
  /** 记录异常并结束 span（设置 ERROR 状态） */
  recordError(error: unknown): void
  /** Symbol.dispose —— 等同于 end()（用于 `using` 语法） */
  [Symbol.dispose](): void
}

/** 无操作 SpanHandle（tracing 未启用时使用） */
class NoopSpanHandle implements SpanHandle {
  private _name: string
  private _start: number
  private _attrs: Record<string, any>
  private _ended = false

  constructor(name: string, attrs: Record<string, any>) {
    this._name = name
    this._start = performance.now()
    this._attrs = attrs
    logger.debug('span.noop.start: %s attrs=%s', name, attrs)
  }

  end(): void {
    if (this._ended) return
    this._ended = true
    const elapsed_ms = performance.now() - this._start
    logger.debug('span.noop.end: %s elapsed=%.2fms attrs=%s', this._name, elapsed_ms, this._attrs)
  }

  recordError(error: unknown): void {
    if (this._ended) return
    this._ended = true
    const elapsed_ms = performance.now() - this._start
    logger.error(
      'span.noop.error: %s elapsed=%.2fms error=%s attrs=%s',
      this._name, elapsed_ms, String(error), this._attrs,
    )
  }

  [Symbol.dispose](): void {
    this.end()
  }
}

/** OTel SpanHandle（tracing 启用时使用） */
class OtelSpanHandle implements SpanHandle {
  private _name: string
  private _start: number
  private _attrs: Record<string, any>
  private _span: any
  private _token: any
  private _otelApi: any
  private _ended = false

  constructor(name: string, attrs: Record<string, any>, span: any, token: any, otelApi: any) {
    this._name = name
    this._start = performance.now()
    this._attrs = attrs
    this._span = span
    this._token = token
    this._otelApi = otelApi
  }

  end(): void {
    if (this._ended) return
    this._ended = true
    const elapsed_ms = performance.now() - this._start
    try {
      this._span.setAttribute('elapsed_ms', elapsed_ms)
      this._span.end()
      this._otelApi.context.detach(this._token)
    } catch {
      // ignore
    }
    logger.debug('span.end: %s elapsed=%.2fms attrs=%s', this._name, elapsed_ms, this._attrs)
  }

  recordError(error: unknown): void {
    if (this._ended) return
    this._ended = true
    const elapsed_ms = performance.now() - this._start
    try {
      this._span.recordException(error)
      const { Status, StatusCode } = this._otelApi
      this._span.setStatus(Status(StatusCode.ERROR, String(error)))
      this._span.setAttribute('elapsed_ms', elapsed_ms)
      this._span.end()
      this._otelApi.context.detach(this._token)
    } catch {
      // ignore
    }
    logger.error(
      'span.error: %s elapsed=%.2fms error=%s attrs=%s',
      this._name, elapsed_ms, String(error), this._attrs,
    )
  }

  [Symbol.dispose](): void {
    this.end()
  }
}

// ============================================================
// OtelSpanManager
// ============================================================

export class OtelSpanManager {
  private _service_name: string
  private _enabled: boolean
  private _provider: any = null
  private _tracer: any = null
  private _otelApi: any = null
  // 对应文档 §2.4 建议1：保存 _initOtel 的 Promise，供 ready() 显式等待
  private _initPromise: Promise<void> = Promise.resolve()

  constructor(service_name: string = 'modu-agent', enabled?: boolean | null) {
    this._service_name = service_name
    if (enabled === undefined || enabled === null) {
      enabled = _is_tracing_config_enabled()
    }
    this._enabled = enabled

    if (!enabled) {
      logger.debug('OtelSpanManager: tracing disabled (no-op mode)')
      return
    }

    this._initPromise = this._initOtel()
  }

  /**
   * 显式等待 OTel SDK 初始化完成（对应文档 §2.4 建议1）。
   *
   * OTel SDK 动态 import 是异步的，首次调用 span() 时 SDK 可能尚未就绪。
   * 调用方可通过 `await get_span_manager().ready()` 显式等待初始化完成，
   * 确保后续 span() 调用能正常创建 OTel span（而非退化为 no-op）。
   *
   * 注意：此方法不改变默认行为（仍为异步初始化），仅提供显式等待选项。
   * 若 tracing 未启用，此方法立即返回。
   *
   * @returns 初始化 Promise（resolve 后 SDK 就绪或已降级为 no-op）
   */
  async ready(): Promise<void> {
    await this._initPromise
  }

  private async _initOtel(): Promise<void> {
    // OTel SDK 包未在 package.json 中声明，使用动态 import + try/catch 降级
    try {
      const otelApi = await import('@opentelemetry/api')
      const sdkResources = await import('@opentelemetry/resources')
      const sdkTrace = await import('@opentelemetry/sdk-trace-base')

      const Resource = sdkResources.Resource ?? sdkResources.default?.Resource
      const TracerProvider = sdkTrace.TracerProvider ?? sdkTrace.default?.TracerProvider

      const resource = Resource.create({ 'service.name': this._service_name })
      const provider = new TracerProvider({ resource })

      // set_tracer_provider 只能调用一次
      try {
        otelApi.trace.setTracerProvider(provider)
      } catch (e) {
        logger.debug('set_tracer_provider skipped (likely already set): %s', String(e))
        try {
          provider.shutdown()
        } catch {
          // ignore
        }
      }

      this._provider = provider
      this._tracer = otelApi.trace.getTracer(this._service_name)
      this._otelApi = otelApi
      // 暴露到全局，供 trace-context.ts / logging-config.ts 同步访问
      ;(globalThis as any).__modu_otel_api = otelApi
      logger.info('OtelSpanManager: tracing enabled (service=%s)', this._service_name)
    } catch (e) {
      logger.warning('OtelSpanManager: tracing init failed, falling back to no-op: %s', String(e))
      this._enabled = false
      this._provider = null
      this._tracer = null
      this._otelApi = null
    }
  }

  get enabled(): boolean {
    return this._enabled && this._tracer !== null
  }

  /**
   * 与原 runner._span 签名兼容的 span 方法。
   *
   * 返回 SpanHandle，支持：
   *   - 手动 end() / recordError(e)
   *   - `using` 语法（Symbol.dispose）
   *
   * tracing 未启用时退化为无操作（仅记录日志）。
   *
   * Note: OTel SDK 初始化是异步的，首次调用时可能尚未完成。
   * 在 enabled=false 期间所有 span 退化为 no-op，与 Python 版行为一致。
   */
  span(name: string, trace_id: string = '', attributes: Record<string, any> = {}): SpanHandle {
    const attrs: Record<string, any> = { trace_id, ...attributes }

    if (!this.enabled || this._tracer === null || this._otelApi === null) {
      return new NoopSpanHandle(name, attrs)
    }

    try {
      // 同步路径：使用已初始化的 tracer 和缓存的 otelApi
      const otelApi = this._otelApi
      const span = this._tracer.startSpan(name)
      if (trace_id) {
        span.setAttribute('trace_id', trace_id)
      }
      for (const [k, v] of Object.entries(attributes)) {
        try {
          span.setAttribute(k, v)
        } catch {
          span.setAttribute(k, String(v))
        }
      }
      const context = otelApi.trace.setSpan(otelApi.context.active(), span)
      const token = otelApi.context.attach(context)
      return new OtelSpanHandle(name, attrs, span, token, otelApi)
    } catch {
      // OTel API 不可用——退化为 no-op
      return new NoopSpanHandle(name, attrs)
    }
  }
}

// ============================================================
// 全局单例
// ============================================================

export function get_span_manager(service_name: string = 'modu-agent'): OtelSpanManager {
  if (_span_manager === null) {
    _span_manager = new OtelSpanManager(service_name)
  }
  return _span_manager
}

export function reset_span_manager(): void {
  if (_span_manager !== null) {
    const provider = (_span_manager as any)._provider
    if (provider !== null && provider !== undefined) {
      try {
        provider.shutdown()
      } catch {
        // ignore
      }
    }
  }
  _span_manager = null
  // 清除全局 OTel API 缓存
  delete (globalThis as any).__modu_otel_api
}

export function is_tracing_enabled(): boolean {
  try {
    return get_span_manager().enabled
  } catch {
    return false
  }
}
