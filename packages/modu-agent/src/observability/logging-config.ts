// 对应 Python: observability/logging_config.py
// JsonFormatter + configure_structured_logging
// 将传统 console 日志格式化为 JSON，便于 ELK/Loki 等日志聚合系统消费
import { getConfig } from '../config/runtime-config.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[logging_config] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[logging_config] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[logging_config] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[logging_config] ${msg}`, ...args),
}

// ============================================================
// 日志级别常量（对应 Python logging 模块的级别）
// ============================================================
export const LogLevel = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
  CRITICAL: 50,
} as const
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel]

/** 已知的标准日志属性，不放入 extra */
const _STANDARD_ATTRS = new Set([
  'timestamp', 'level', 'levelno', 'logger', 'message',
  'module', 'function', 'line', 'trace_id', 'span_id',
  'extra', 'exc_info', 'stack_info', 'asctime',
])

/**
 * 结构化日志条目接口。
 *
 * 对应 Python logging.LogRecord 的关键字段。
 */
export interface LogEntry {
  timestamp?: string
  level: string
  levelno?: number
  logger: string
  message: string
  module?: string
  function?: string
  line?: number
  trace_id?: string
  span_id?: string
  extra?: Record<string, any>
  exc_info?: string
  stack_info?: string
  [key: string]: any
}

/**
 * 将 LogEntry 格式化为单行 JSON。
 *
 * 输出字段：
 *   - timestamp: ISO 8601 时间戳
 *   - level: 日志级别
 *   - logger: logger 名称
 *   - message: 日志消息
 *   - trace_id: 链路追踪 ID（从 entry.trace_id 或 OTel 当前 span 提取）
 *   - span_id: OTel span ID（若有）
 *   - module: 模块名
 *   - function: 函数名
 *   - line: 行号
 *   - extra: 业务自定义字段
 *
 * 异常信息：
 *   - exc_info: 异常堆栈字符串（若有）
 */
export class JsonFormatter {
  /**
   * 将 LogEntry 格式化为 JSON 字符串。
   */
  format(entry: LogEntry): string {
    const created = entry.timestamp ? Date.parse(entry.timestamp) : Date.now()
    const logEntry: Record<string, any> = {
      timestamp: entry.timestamp ?? this._formatTime(created),
      level: entry.level,
      logger: entry.logger,
      message: entry.message,
      module: entry.module ?? '',
      function: entry.function ?? '',
      line: entry.line ?? 0,
    }

    // trace_id 注入：优先从 entry 显式字段，其次从 OTel 当前 span
    let trace_id = entry.trace_id
    let span_id = entry.span_id
    if (trace_id === undefined || trace_id === null) {
      const [otelTraceId, otelSpanId] = this._extractOtelContext()
      if (otelTraceId) trace_id = otelTraceId
      if (otelSpanId && (span_id === undefined || span_id === null)) {
        span_id = otelSpanId
      }
    }
    if (trace_id) logEntry.trace_id = trace_id
    if (span_id) logEntry.span_id = span_id

    // 业务自定义字段（非标准属性）
    const extra: Record<string, any> = {}
    for (const [key, value] of Object.entries(entry)) {
      if (!_STANDARD_ATTRS.has(key) && !key.startsWith('_')) {
        try {
          JSON.stringify(value)
          extra[key] = value
        } catch {
          extra[key] = String(value)
        }
      }
    }
    if (Object.keys(extra).length > 0) {
      logEntry.extra = extra
    }

    // 异常信息
    if (entry.exc_info) logEntry.exc_info = entry.exc_info
    if (entry.stack_info) logEntry.stack_info = entry.stack_info

    // 序列化为单行 JSON
    try {
      return JSON.stringify(logEntry)
    } catch {
      // 序列化失败时降级为纯文本
      return `${logEntry.timestamp} [${logEntry.level}] ${logEntry.logger}: ${logEntry.message}`
    }
  }

  /**
   * 将时间戳转为 ISO 8601 字符串（含毫秒）。
   */
  private _formatTime(createdMs: number): string {
    const d = new Date(createdMs)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    const ms = String(d.getMilliseconds()).padStart(3, '0')
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}.${ms}`
  }

  /**
   * 从当前 OTel span 提取 trace_id 和 span_id。
   *
   * Returns:
   *   [trace_id, span_id] 元组，无 span 时均为 undefined
   */
  private _extractOtelContext(): [string | undefined, string | undefined] {
    // OTel SDK 包未在 package.json 中声明，使用动态 import + try/catch 降级
    // 注意：这是同步调用的热点路径，OTel 已初始化时通过缓存的 API 提取
    try {
      // 使用全局缓存的 OTel API（若 tracing 模块已初始化）
      const otelApi = (globalThis as any).__modu_otel_api
      if (!otelApi) return [undefined, undefined]
      const span = otelApi.trace.getSpan(otelApi.context.active())
      if (!span) return [undefined, undefined]
      const ctx = span.spanContext()
      if (ctx && ctx.isValid) {
        return [
          // trace_id 是 32 字符十六进制字符串
          typeof ctx.traceId === 'string' ? ctx.traceId : ctx.trace_id,
          typeof ctx.spanId === 'string' ? ctx.spanId : ctx.span_id,
        ]
      }
    } catch {
      // ignore
    }
    return [undefined, undefined]
  }
}

// ============================================================
// 全局结构化日志状态
// ============================================================

let _structured_enabled = false
let _log_level: number = LogLevel.INFO

// 保存原始 console 方法引用
const _originalConsole = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  log: console.log.bind(console),
}

/**
 * 配置全局结构化日志。
 *
 * 当 enabled=true 时，将 console 方法替换为 JSON 格式输出。
 * 当 enabled=false 时，恢复默认 printf 风格格式。
 *
 * Args:
 *   enabled: 是否启用结构化日志。undefined=从 RuntimeConfig 读取
 *   level: 日志级别（如 "INFO"/"DEBUG"）。undefined=从 RuntimeConfig 读取
 */
export function configure_structured_logging(
  enabled?: boolean | null,
  level?: string | null,
): void {
  if (enabled === undefined || enabled === null || level === undefined || level === null) {
    try {
      const config = getConfig()
      if (enabled === undefined || enabled === null) {
        enabled = Boolean(config.get('observability.logging.structured', false))
      }
      if (level === undefined || level === null) {
        level = String(config.get('observability.logging.level', 'INFO'))
      }
    } catch {
      if (enabled === undefined || enabled === null) enabled = false
      if (level === undefined || level === null) level = 'INFO'
    }
  }

  _structured_enabled = enabled
  _log_level = get_log_level_int(level ?? 'INFO')

  if (enabled) {
    const formatter = new JsonFormatter()

    const shouldLog = (levelno: number): boolean => levelno >= _log_level

    console.debug = (...args: any[]) => {
      if (!shouldLog(LogLevel.DEBUG)) return
      const entry = _argsToEntry('DEBUG', 'console', args)
      _originalConsole.log(formatter.format(entry))
    }
    console.info = (...args: any[]) => {
      if (!shouldLog(LogLevel.INFO)) return
      const entry = _argsToEntry('INFO', 'console', args)
      _originalConsole.log(formatter.format(entry))
    }
    console.warn = (...args: any[]) => {
      if (!shouldLog(LogLevel.WARNING)) return
      const entry = _argsToEntry('WARNING', 'console', args)
      _originalConsole.log(formatter.format(entry))
    }
    console.error = (...args: any[]) => {
      if (!shouldLog(LogLevel.ERROR)) return
      const entry = _argsToEntry('ERROR', 'console', args)
      _originalConsole.log(formatter.format(entry))
    }
  } else {
    // 恢复原始 console 方法
    console.debug = _originalConsole.debug
    console.info = _originalConsole.info
    console.warn = _originalConsole.warn
    console.error = _originalConsole.error
    console.log = _originalConsole.log
  }

  logger.info('Structured logging configured: enabled=%s level=%s', enabled, level)
}

/**
 * 将 console 参数列表转换为 LogEntry。
 */
function _argsToEntry(level: string, loggerName: string, args: any[]): LogEntry {
  const message = args
    .map((a) => {
      if (typeof a === 'string') return a
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    })
    .join(' ')
  return {
    level,
    logger: loggerName,
    message,
  }
}

/**
 * 将字符串日志级别转为 LogLevel 常量。
 */
export function get_log_level_int(level: string): number {
  const upper = level.toUpperCase()
  switch (upper) {
    case 'DEBUG': return LogLevel.DEBUG
    case 'INFO': return LogLevel.INFO
    case 'WARNING': return LogLevel.WARNING
    case 'ERROR': return LogLevel.ERROR
    case 'CRITICAL': return LogLevel.CRITICAL
    default: return LogLevel.INFO
  }
}

/** 检查结构化日志是否已启用。 */
export function is_structured_logging_enabled(): boolean {
  return _structured_enabled
}

/** 获取当前日志级别。 */
export function get_current_log_level(): number {
  return _log_level
}
