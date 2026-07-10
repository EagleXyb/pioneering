// 对应 Python: modu_graph/adapters/retry.py
// 重试包装器（P2-8）：为工具调用与 LLM 调用提供指数退避重试。
//
// 设计目标：
//   - 工具调用：在 wrap_modu_tool func 内嵌入重试循环，保持 StructuredTool 类型不变
//   - LLM 调用：优先使用 LangChain Runnable.withRetry()，不可用时降级为无重试
//
// 仅重试瞬时故障（网络/超时/5xx），不重试参数错误或客户端错误（4xx），
// 避免对必然失败的请求做无意义重试。
//
// 配置项（runtime_config）：
//   tools.retry.max_attempts = 3       // 工具调用最大尝试次数（含首次）
//   tools.retry.base_delay   = 0.5     // 指数退避基础延迟（秒）
//   tools.retry.max_delay    = 5.0     // 单次延迟上限（秒）
//   llm.retry.max_attempts   = 2       // LLM 调用最大尝试次数
import type { RuntimeConfig } from '../../config/runtime-config.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.retry] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.retry] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.retry] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.retry] ${msg}`, ...args),
}

// Node.js 网络错误代码
const _RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

/**
 * 判断异常是否可重试。
 *
 * 对于 HTTP 错误，只重试 429（RateLimit）和 5xx（Server Error）；
 * 对于 Node.js 网络错误（ECONNRESET 等），直接返回 true；
 * 其他错误默认不可重试。
 */
export function isRetryableException(exc: any): boolean {
  if (!exc) return false

  // 检查 HTTP status_code（openai API 错误等）
  const statusCode = exc.status ?? exc.status_code ?? exc.response?.status
  if (statusCode != null) {
    // 429 RateLimit 或 5xx Server Error → 可重试
    // 4xx Client Error（除 429）→ 不可重试
    return statusCode === 429 || statusCode >= 500
  }

  // 检查 Node.js 错误代码（网络层异常）
  const errorCode = exc.code
  if (errorCode && _RETRYABLE_ERROR_CODES.has(errorCode)) {
    return true
  }

  // TypeError（fetch 网络失败常抛出 TypeError）
  if (exc instanceof TypeError) {
    return true
  }

  // 检查是否是超时类错误
  if (exc instanceof Error && /timeout|timed?\s*out/i.test(exc.message)) {
    return true
  }

  return false
}

/**
 * 包装工具 invoke 函数，添加指数退避重试。
 *
 * 用于 wrap_modu_tool 内部，保持返回值为 StructuredTool（不改变类型）。
 *
 * @param func 原始 invoke 函数（异步）
 * @param toolName 工具名（用于日志）
 * @param config RuntimeConfig 实例
 * @returns 带重试的 invoke 函数
 */
export function with_tool_retry(
  func: (input: Record<string, any>) => Promise<string>,
  toolName: string,
  config: RuntimeConfig,
): (input: Record<string, any>) => Promise<string> {
  const retryCfg = config.get('tools.retry', {}) || {}
  const maxAttempts = parseInt(retryCfg.max_attempts ?? 3, 10)
  const baseDelay = parseFloat(retryCfg.base_delay ?? 0.5)
  const maxDelay = parseFloat(retryCfg.max_delay ?? 5.0)

  if (maxAttempts <= 1) {
    return func
  }

  return async function _invokeWithRetry(input: Record<string, any>): Promise<string> {
    let lastExc: any = null
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await func(input)
      } catch (e: any) {
        if (!isRetryableException(e)) {
          // 不可重试异常（参数错误等），立即抛出
          throw e
        }
        lastExc = e
        if (attempt < maxAttempts - 1) {
          // 指数退避：base_delay * 2^attempt，钳制到 max_delay
          const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
          logger.warning(
            "Tool '%s' attempt %d/%d failed (%s: %s), retrying in %.2fs",
            toolName,
            attempt + 1,
            maxAttempts,
            e.constructor?.name || 'Error',
            String(e).slice(0, 200),
            delay,
          )
          await new Promise((resolve) => setTimeout(resolve, delay * 1000))
        } else {
          logger.error(
            "Tool '%s' exhausted %d attempts, last error: %s",
            toolName,
            maxAttempts,
            String(e).slice(0, 200),
          )
        }
      }
    }
    // 理论不可达（循环内必 return 或 throw），但作为保险
    if (lastExc) {
      throw lastExc
    }
    throw new Error(`Tool '${toolName}' retry loop exited unexpectedly`)
  }
}

/**
 * 为 LangChain ChatModel 应用重试。
 *
 * 优先使用 LangChain 的 withRetry() 方法（需 langchain_core 支持），
 * 不可用时降级为无重试并记录警告。
 *
 * @param llm ChatModel 实例（如 ChatOpenAI）
 * @param config RuntimeConfig 实例
 * @returns 带重试的 Runnable，或原 llm（降级时）
 */
export function apply_llm_retry(llm: any, config: RuntimeConfig): any {
  const retryCfg = config.get('llm.retry', {}) || {}
  const maxAttempts = parseInt(retryCfg.max_attempts ?? 2, 10)

  if (maxAttempts <= 1) {
    return llm
  }

  try {
    // LangChain JS withRetry：onFailedAttempt 抛出时停止重试
    return llm.withRetry({
      stopAfterAttempt: maxAttempts,
      onFailedAttempt: (error: any) => {
        if (!isRetryableException(error)) {
          // 不可重试异常，停止重试
          throw error
        }
        // 可重试异常，记录并允许重试
        logger.warning(
          'LLM attempt failed (%s: %s), will retry',
          error.constructor?.name || 'Error',
          String(error).slice(0, 200),
        )
      },
    })
  } catch (e: any) {
    logger.warning(
      'Failed to apply withRetry to LLM (%s), running without retry: %s',
      llm.constructor?.name,
      String(e),
    )
    return llm
  }
}
