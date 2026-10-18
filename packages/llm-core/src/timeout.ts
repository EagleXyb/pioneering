// 超时控制（P1）
//
// 流式场景用空闲超时：每收到一个 chunk 重置计时，总时长不设上限；
// 非流式场景用总时长超时。两者都支持外部 signal（用户停止生成）。

export interface IdleTimeout {
  /** 传给 fetch 的 signal */
  signal: AbortSignal
  /** 收到数据后调用，重置计时 */
  refresh(): void
  /** 结束后调用，清理定时器与监听 */
  dispose(): void
  /** 是否因空闲超时触发（用于区分用户主动中止） */
  readonly timedOut: boolean
}

/**
 * 创建空闲超时控制器。
 *
 * @param idleMs 空闲阈值（<=0 表示不限制）
 * @param external 外部 signal；触发时一并中止
 */
export function createIdleTimeout(idleMs: number, external?: AbortSignal | null): IdleTimeout {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null
  let timedOut = false

  const refresh = () => {
    if (idleMs <= 0) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timedOut = true
      controller.abort(new Error(`LLM stream idle timeout (${idleMs}ms)`))
    }, idleMs)
    // Node 环境下避免定时器阻止进程退出
    ;(timer as unknown as { unref?: () => void }).unref?.()
  }

  const onExternalAbort = () => controller.abort(external?.reason)
  if (external) {
    if (external.aborted) controller.abort(external.reason)
    else external.addEventListener('abort', onExternalAbort, { once: true })
  }
  refresh()

  const dispose = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    external?.removeEventListener('abort', onExternalAbort)
  }

  return {
    signal: controller.signal,
    refresh,
    dispose,
    get timedOut() {
      return timedOut
    },
  }
}
