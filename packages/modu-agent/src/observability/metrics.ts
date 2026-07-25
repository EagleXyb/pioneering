// 对应 Python: observability/metrics.py
// MetricsRegistry + get_metrics_registry 全局单例 + record_request 方法
// prom-client 未在 package.json 中声明，使用动态 import + try/catch 降级
import { getConfig } from '../config/runtime-config.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[metrics] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[metrics] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[metrics] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[metrics] ${msg}`, ...args),
}

// 全局单例
let _metrics_registry: MetricsRegistry | null = null

function _is_metrics_config_enabled(): boolean {
  try {
    return Boolean(getConfig().get('observability.metrics.enabled', false))
  } catch {
    return false
  }
}

/**
 * Prometheus 指标注册中心。
 *
 * 封装 prom-client 的 Counter/Histogram/Gauge，提供业务语义化的指标记录接口。
 * 当 metrics 未启用时，所有 record_* 方法退化为无操作。
 */
export class MetricsRegistry {
  private _enabled: boolean
  private _registry: any = null
  private _qps: any = null
  private _latency: any = null
  private _evolution_count: any = null
  private _consensus_failures: any = null
  private _active_sessions: any = null
  // 对应文档 §2.4 建议3：带维度的指标（新增，不修改原有指标）
  private _tool_calls: any = null
  private _llm_token_usage: any = null
  private _tool_latency: any = null

  constructor(enabled?: boolean | null) {
    if (enabled === undefined || enabled === null) {
      enabled = _is_metrics_config_enabled()
    }
    this._enabled = enabled

    if (!enabled) {
      logger.debug('MetricsRegistry: metrics disabled (no-op mode)')
      return
    }

    this._initPromClient()
  }

  private async _initPromClient(): Promise<void> {
    try {
      const promClient = await import('prom-client')

      const Registry = promClient.Registry ?? promClient.default?.Registry
      const Counter = promClient.Counter ?? promClient.default?.Counter
      const Gauge = promClient.Gauge ?? promClient.default?.Gauge
      const Histogram = promClient.Histogram ?? promClient.default?.Histogram

      this._registry = new Registry()

      this._qps = new Counter({
        name: 'modu_requests_total',
        help: 'Total number of ModuAgent requests',
        labelNames: ['status'],
        registers: [this._registry],
      })
      this._latency = new Histogram({
        name: 'modu_request_duration_seconds',
        help: 'Request latency in seconds',
        registers: [this._registry],
      })
      this._evolution_count = new Counter({
        name: 'modu_evolution_total',
        help: 'Total number of evolution triggers',
        registers: [this._registry],
      })
      this._consensus_failures = new Counter({
        name: 'modu_consensus_failures_total',
        help: 'Total number of consensus failures',
        registers: [this._registry],
      })
      this._active_sessions = new Gauge({
        name: 'modu_active_sessions',
        help: 'Number of active sessions',
        registers: [this._registry],
      })

      // 对应文档 §2.4 建议3：带维度的指标
      // 工具调用计数（按 tool_name / status / session_id 维度）
      this._tool_calls = new Counter({
        name: 'modu_agent_tool_calls_total',
        help: 'Total number of tool calls with status and tool_name dimensions',
        labelNames: ['tool_name', 'status', 'session_id'],
        registers: [this._registry],
      })
      // 工具调用延迟（按 tool_name 维度）
      this._tool_latency = new Histogram({
        name: 'modu_agent_tool_latency_seconds',
        help: 'Tool call latency in seconds',
        labelNames: ['tool_name'],
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30],
        registers: [this._registry],
      })
      // LLM token 用量（按 provider / model / type 维度）
      this._llm_token_usage = new Counter({
        name: 'modu_agent_token_usage_total',
        help: 'Total LLM token usage with provider/model/type dimensions',
        labelNames: ['provider', 'model', 'type'],
        registers: [this._registry],
      })
      logger.info('MetricsRegistry: metrics enabled')
    } catch (e) {
      logger.warning('MetricsRegistry: init failed, falling back to no-op: %s', String(e))
      this._enabled = false
      this._registry = null
      this._tool_calls = null
      this._tool_latency = null
      this._llm_token_usage = null
    }
  }

  get enabled(): boolean {
    return this._enabled && this._registry !== null
  }

  get registry(): any {
    return this._registry
  }

  /** 记录一次请求。 */
  record_request(status: string = 'success', duration?: number | null): void {
    if (!this.enabled) return
    try {
      this._qps.labels({ status }).inc()
      if (duration !== undefined && duration !== null) {
        this._latency.observe(duration)
      }
    } catch (e) {
      logger.debug('record_request failed: %s', String(e))
    }
  }

  /** 记录一次进化触发。 */
  record_evolution(): void {
    if (!this.enabled) return
    try {
      this._evolution_count.inc()
    } catch (e) {
      logger.debug('record_evolution failed: %s', String(e))
    }
  }

  /** 记录一次共识失败。 */
  record_consensus_failure(): void {
    if (!this.enabled) return
    try {
      this._consensus_failures.inc()
    } catch (e) {
      logger.debug('record_consensus_failure failed: %s', String(e))
    }
  }

  /** 活跃会话数 +1。 */
  inc_active_sessions(): void {
    if (!this.enabled) return
    try {
      this._active_sessions.inc()
    } catch (e) {
      logger.debug('inc_active_sessions failed: %s', String(e))
    }
  }

  /** 活跃会话数 -1。 */
  dec_active_sessions(): void {
    if (!this.enabled) return
    try {
      this._active_sessions.dec()
    } catch (e) {
      logger.debug('dec_active_sessions failed: %s', String(e))
    }
  }

  /** 设置活跃会话数绝对值。 */
  set_active_sessions(value: number): void {
    if (!this.enabled) return
    try {
      this._active_sessions.set(value)
    } catch (e) {
      logger.debug('set_active_sessions failed: %s', String(e))
    }
  }

  // ============================================================
  // 对应文档 §2.4 建议3：带维度的指标记录方法
  // ============================================================

  /**
   * 记录一次工具调用（对应文档 §2.4 建议3）。
   *
   * @param tool_name  工具名称（如 'http_request' / 'code_executor'）
   * @param status     调用状态（'success' / 'error' / 'rate_limited' 等）
   * @param session_id 会话 ID（可选，用于 per-session 维度分析）
   * @param duration   调用耗时（秒，可选，记录到 latency histogram）
   */
  record_tool_call(
    tool_name: string,
    status: string = 'success',
    session_id: string = '',
    duration?: number | null,
  ): void {
    if (!this.enabled) return
    try {
      this._tool_calls.labels({ tool_name, status, session_id }).inc()
      if (duration !== undefined && duration !== null) {
        this._tool_latency.labels({ tool_name }).observe(duration)
      }
    } catch (e) {
      logger.debug('record_tool_call failed: %s', String(e))
    }
  }

  /**
   * 记录 LLM token 用量（对应文档 §2.4 建议3）。
   *
   * @param provider LLM 提供商（如 'openai' / 'anthropic' / 'zhipu'）
   * @param model    模型名称（如 'gpt-4' / 'claude-3-opus'）
   * @param type     token 类型（'prompt' / 'completion' / 'total'）
   * @param count    token 数量
   */
  record_llm_tokens(
    provider: string,
    model: string,
    type: string,
    count: number,
  ): void {
    if (!this.enabled) return
    try {
      this._llm_token_usage.labels({ provider, model, type }).inc(count)
    } catch (e) {
      logger.debug('record_llm_tokens failed: %s', String(e))
    }
  }

  /** 以 Prometheus exposition format 输出所有指标。 */
  collect_text(): string {
    if (!this.enabled) return ''
    try {
      // prom-client 15.x 的 register.metrics() 返回 Promise<string>
      const result = this._registry.metrics()
      if (typeof result === 'string') {
        return result
      }
      // P1-8 修复：Promise 无法同步返回，记录警告引导使用 collect_text_async
      logger.warning('collect_text: registry.metrics() returned Promise, use collect_text_async() instead')
      return ''
    } catch (e) {
      logger.debug('collect_text failed: %s', String(e))
      return ''
    }
  }

  /** 异步获取 Prometheus exposition format 文本。 */
  async collect_text_async(): Promise<string> {
    if (!this.enabled) return ''
    try {
      const result = await this._registry.metrics()
      return result
    } catch (e) {
      logger.debug('collect_text_async failed: %s', String(e))
      return ''
    }
  }
}

/** 获取全局 MetricsRegistry 单例。 */
export function get_metrics_registry(): MetricsRegistry {
  if (_metrics_registry === null) {
    _metrics_registry = new MetricsRegistry()
  }
  return _metrics_registry
}

/** 检查 metrics 是否实际启用。 */
export function is_metrics_enabled(): boolean {
  try {
    return get_metrics_registry().enabled
  } catch {
    return false
  }
}

/** 重置全局 metrics registry 单例（测试清理用）。 */
export function reset_metrics_registry(): void {
  _metrics_registry = null
}
