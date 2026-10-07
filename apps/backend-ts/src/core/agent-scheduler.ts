/**
 * Agent TTL 清理调度器（T2.2）
 *
 * 周期 sweep 已注册的待答复会话：
 *   - 超时（approval_timeout）→ 自动拒绝
 *   - 已无中断（用户已处理 / checkpointer 丢失）→ 自动注销
 *
 * 会话在 run 暂停（ctx.runPaused）后由路由层 trackInterruptSession。
 */
import {
  get_runner,
  sweepExpiredInterrupts,
  checkInterruptTimeout,
} from '@pioneering/modu-agent'

/** 扫频：每 60s 一次（对齐方案 T2.2） */
const DEFAULT_INTERVAL_MS = 60_000

/** 待检查会话集合 */
const tracked = new Set<string>()

let timer: NodeJS.Timeout | null = null
let sweeping = false

/** 注册待答复会话（RUN_PAUSED 后调用） */
export function trackInterruptSession(sessionId: string): void {
  tracked.add(sessionId)
}

/** 注销会话（用户主动处理后可选调用；sweep 也会自动剔除） */
export function untrackInterruptSession(sessionId: string): void {
  tracked.delete(sessionId)
}

/** 当前跟踪的会话（测试/诊断用） */
export function getTrackedInterruptSessions(): string[] {
  return [...tracked]
}

/** 单次 tick：sweep 并清理已终结会话 */
export async function sweepOnce(): Promise<void> {
  if (sweeping || tracked.size === 0) return
  sweeping = true
  const ids = [...tracked]
  try {
    const graph = await get_runner()
    const results = await sweepExpiredInterrupts(graph, ids)
    for (const id of ids) {
      const r = results[id]
      if (r === 'expired' || r === 'no_interrupt' || r === 'resume_failed') {
        tracked.delete(id)
      }
    }
  } catch (e) {
    console.warn('[agent-scheduler] sweep failed:', e)
  } finally {
    sweeping = false
  }
}

/** 启动周期调度（幂等） */
export function startInterruptScheduler(
  intervalMs: number = DEFAULT_INTERVAL_MS,
): void {
  if (timer !== null) return
  timer = setInterval(() => void sweepOnce(), intervalMs)
  // 不使定时器独占事件循环
  if (typeof timer.unref === 'function') timer.unref()
}

/** 停止调度（应用关闭时） */
export function stopInterruptScheduler(): void {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

/** 单会话立即检查（诊断/复用） */
export async function checkSessionInterrupt(
  sessionId: string,
): Promise<string> {
  const graph = await get_runner()
  return checkInterruptTimeout(graph, sessionId)
}
