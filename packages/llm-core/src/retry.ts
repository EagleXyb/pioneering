// 重试与退避（P1）
//
// 约束：只对"未产生任何输出"的失败重试；一旦已经向客户端吐出内容，
// 重试会造成正文重复，必须交由上层决定（新开一轮或直接失败）。
import { LLMError, isRetryable } from '@pioneering/llm-contracts'

export interface RetryOptions {
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  signal?: AbortSignal | null
  isRetryable?: (e: unknown) => boolean
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void
}

/** 可被 signal 打断的延时。 */
export function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new LLMError('ABORTED', '请求已中止'))
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    ;(timer as unknown as { unref?: () => void }).unref?.()

    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new LLMError('ABORTED', '请求已中止'))
    }
    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** 指数退避延时（无抖动，便于测试与复现）。 */
export function backoffDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1))
}

/**
 * 执行一次可重试调用。
 *
 * @param fn 入参为第几次尝试（从 1 开始）
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 2)
  const baseDelayMs = Math.max(0, opts.baseDelayMs ?? 300)
  const maxDelayMs = Math.max(baseDelayMs, opts.maxDelayMs ?? 3_000)
  const retryable = opts.isRetryable ?? isRetryable

  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) throw new LLMError('ABORTED', '请求已中止')
    try {
      return await fn(attempt)
    } catch (e) {
      lastError = e
      const canRetry = attempt < maxAttempts && retryable(e) && !opts.signal?.aborted
      if (!canRetry) throw e
      const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs)
      opts.onRetry?.(attempt, e, delayMs)
      await sleep(delayMs, opts.signal)
    }
  }
  throw lastError
}
