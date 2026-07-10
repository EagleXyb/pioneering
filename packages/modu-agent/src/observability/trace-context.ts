// 对应 Python: observability/trace_context.py
// OTel trace context 注入/提取模块
// 提供跨服务/跨进程的 trace_id 传播能力，使分布式追踪能够贯通调用链

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[trace_context] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[trace_context] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[trace_context] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[trace_context] ${msg}`, ...args),
}

// 业务层 trace_id 的 header 名
const _MODU_TRACE_ID_HEADER = 'x-modu-trace-id'
const _MODU_USER_ID_HEADER = 'x-modu-user-id'
const _MODU_SESSION_ID_HEADER = 'x-modu-session-id'

/** 从 headers 中提取的 trace 上下文 */
export interface TraceContext {
  /** 业务层 trace_id（字符串，可能为空） */
  trace_id: string
  /** 用户 ID（字符串，可能为空） */
  user_id: string
  /** 会话 ID（字符串，可能为空） */
  session_id: string
  /** OTel Context 对象（null=无 OTel span） */
  otel_context: any
}

/**
 * 将 trace context 注入到 headers 字典（用于跨服务调用）。
 *
 * 同时注入：
 *   - OTel W3C traceparent/baggage（若当前有活跃 span）
 *   - 业务层 trace_id/user_id/session_id（自定义 header）
 *
 * Args:
 *   headers: 待注入的 headers 字典（会被原地修改并返回）
 *   trace_id: 业务层 trace_id（与 OTel trace_id 独立）
 *   user_id: 用户 ID
 *   session_id: 会话 ID
 *
 * Returns:
 *   注入后的 headers 字典（与入参同一对象）
 */
export function inject_trace_context(
  headers: Record<string, string>,
  trace_id: string = '',
  user_id: string = '',
  session_id: string = '',
): Record<string, string> {
  // 1. 注入业务层字段
  if (trace_id) {
    headers[_MODU_TRACE_ID_HEADER] = trace_id
  }
  if (user_id) {
    headers[_MODU_USER_ID_HEADER] = user_id
  }
  if (session_id) {
    headers[_MODU_SESSION_ID_HEADER] = session_id
  }

  // 2. 注入 OTel W3C trace context
  // OTel SDK 包未在 package.json 中声明，使用动态 import + try/catch 降级
  try {
    // 使用全局缓存的 OTel API（若 tracing 模块已初始化）
    const otelApi = (globalThis as any).__modu_otel_api
    if (otelApi && otelApi.propagate) {
      otelApi.propagate.inject(otelApi.context.active(), headers, {
        set: (carrier: Record<string, string>, key: string, value: string) => {
          carrier[key] = value
        },
      })
    }
  } catch (e) {
    logger.debug('OTel context injection failed (likely no active span): %s', String(e))
  }

  return headers
}

/**
 * 从 headers 字典提取 trace context。
 *
 * 提取内容：
 *   - OTel span context（若有），并设为当前 active span（用于后续 span 继承）
 *   - 业务层 trace_id/user_id/session_id
 *
 * Args:
 *   headers: 包含 trace context 的 headers 字典
 *
 * Returns:
 *   提取的上下文，包含 trace_id/user_id/session_id/otel_context
 */
export function extract_trace_context(
  headers: Record<string, string>,
): TraceContext {
  const result: TraceContext = {
    trace_id: '',
    user_id: '',
    session_id: '',
    otel_context: null,
  }

  // 1. 提取业务层字段
  result.trace_id = headers[_MODU_TRACE_ID_HEADER] ?? ''
  result.user_id = headers[_MODU_USER_ID_HEADER] ?? ''
  result.session_id = headers[_MODU_SESSION_ID_HEADER] ?? ''

  // 2. 提取 OTel context（不自动设为 active，避免副作用）
  try {
    const otelApi = (globalThis as any).__modu_otel_api
    if (otelApi && otelApi.propagate) {
      const context = otelApi.propagate.extract(otelApi.context.active(), headers, {
        get: (carrier: Record<string, string>, key: string) => carrier[key],
        keys: (carrier: Record<string, string>) => Object.keys(carrier),
      })
      if (context) {
        result.otel_context = context
      }
    }
  } catch (e) {
    logger.debug('OTel context extraction failed: %s', String(e))
  }

  return result
}

/**
 * 将提取的 OTel context 设为当前 active context。
 *
 * 返回一个 detach token，调用 ``detach_otel_context(token)`` 可恢复原 context。
 * 通常用于：从 headers 提取 context 后，在处理请求前 attach，
 * 处理完成后 detach。
 *
 * Args:
 *   context: 从 ``extract_trace_context`` 获取的 otel_context
 *
 * Returns:
 *   detach token（null=无需 detach，context 为空或 attach 失败）
 */
export function attach_otel_context(context: any): any {
  if (context === null || context === undefined) {
    return null
  }
  try {
    const otelApi = (globalThis as any).__modu_otel_api
    if (!otelApi || !otelApi.context) return null
    return otelApi.context.attach(context)
  } catch (e) {
    logger.debug('OTel context attach failed: %s', String(e))
    return null
  }
}

/**
 * 恢复原 OTel context（与 ``attach_otel_context`` 配对使用）。
 *
 * Args:
 *   token: ``attach_otel_context`` 返回的 token
 */
export function detach_otel_context(token: any): void {
  if (token === null || token === undefined) {
    return
  }
  try {
    const otelApi = (globalThis as any).__modu_otel_api
    if (!otelApi || !otelApi.context) return
    otelApi.context.detach(token)
  } catch (e) {
    logger.debug('OTel context detach failed: %s', String(e))
  }
}
