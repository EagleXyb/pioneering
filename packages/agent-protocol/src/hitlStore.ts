// ============================================================
// Hitl Store — HITL 暂停项队列与答复状态 (Zustand)
//
// 移植自 apps/desktop（2026-10），差异仅在依赖来源：
// desktop 版直接 import chatStore / transport / clarify-metrics；
// 本版通过 HitlHost 契约（host.ts）由宿主注入，状态机行为保持一致。
//
// 设计约束：
//   1. **单一状态机**：enqueue/dequeue/resolve/skip/dismiss 是唯一的队列变更入口。
//   2. **会话归属**：每个暂停项携带 sessionId；答复前自动切换到该会话，
//      避免"在 B 会话回答 A 会话的暂停项"造成跨会话串线。
//   3. **失败可见**：resume 未真正启动时回滚到 paused 并把原因写入 error；
//      绝不再静默早退导致 UI 永久卡在 resolving。
//   4. **超时收敛**：暂停项展示期间轮询 getState，后端自动拒绝/超时后
//      关闭卡片、收尾消息并提示用户。
// ============================================================

import { create } from 'zustand'
import { getHitlHost } from './host.js'
import type {
  HitlAbortReason,
  HitlItem,
  HitlItemInput,
  HitlResolveInput,
  HitlStateResponse,
  HitlStatus,
} from './types.js'
import { bindHitlStore } from './hitl-bridge.js'

/** 轮询间隔：暂停项展示期间向后端确认是否仍处于暂停态（超时/失效检测） */
const HITL_STATE_POLL_MS = 15000

/** 去重键：同一会话 + 类型 + 运行/问题标识 视为同一暂停项 */
function itemKey(item: HitlItemInput): string {
  if (item.kind === 'tool_confirm') {
    const ids = (item.toolCalls ?? []).map((tc) => tc.id).sort().join(',')
    return `${item.sessionId}|tool_confirm|${item.runId ?? ''}|${ids}`
  }
  return `${item.sessionId}|${item.kind}|${item.runId ?? ''}|${item.question ?? item.message ?? ''}`
}

export interface HitlState {
  /** 待答复暂停项队列（多次 interrupt 串行时排队，逐个展示） */
  pendingQueue: HitlItem[]
  /** 当前正在展示的暂停项 */
  currentItem: HitlItem | null
  status: HitlStatus
  /** 最近一次答复/恢复失败的原因（可见反馈，成功后清空） */
  error: string | null

  /** 入队暂停项：无展示项且非 resolving 时直接展示，否则排队（重复项忽略） */
  enqueue: (item: HitlItemInput) => void
  /** 出队当前项：展示队列下一项（resume 流结束/中止后调用） */
  dequeue: () => void
  /** 用户答复：回灌宿主 resumeHitl 续写同一条 assistant 消息 */
  resolve: (input: HitlResolveInput) => Promise<boolean>
  /** 丢弃当前项（等同拒绝）：通知宿主中止并展示下一项 */
  dismiss: (reason?: HitlAbortReason) => void
  /** 跳过当前项：以空回答继续（仅 clarifying/choice；tool_confirm 不可跳过） */
  skip: () => Promise<boolean>
  /** 进页/重连恢复：查 getHitlState，若有暂停项则补挂卡片并重建暂停容器 */
  recover: (threadId: string, runtime?: 'local' | 'cloud') => Promise<void>
  /** 主动向后端确认暂停项是否仍然有效（超时/失效则收敛） */
  refresh: () => Promise<void>
  /** 清空当前项的可见错误 */
  clearError: () => void
  /** 清空（登出/切会话） */
  reset: () => void
}

/** 轮询定时器（模块级单例：同一时刻只有一个暂停项在展示） */
let pollTimer: ReturnType<typeof setInterval> | null = null

function stopPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function startPolling(run: () => void): void {
  stopPolling()
  pollTimer = setInterval(run, HITL_STATE_POLL_MS)
}

export const useHitlStore = create<HitlState>((set, get) => ({
  pendingQueue: [],
  currentItem: null,
  status: 'idle',
  error: null,

  enqueue: (item) => {
    const withMeta: HitlItem = {
      ...item,
      createdAt: item.createdAt ?? Date.now(),
    }
    set((state) => {
      // 去重：同一暂停项重复入队（实时事件 + 恢复查询）时忽略
      const key = itemKey(withMeta)
      if (state.currentItem && itemKey(state.currentItem) === key) return state
      if (state.pendingQueue.some((i) => itemKey(i) === key)) return state
      // 无展示项且不在 resume 中 → 直接展示；resolving 中一律排队，
      // 避免覆盖 currentItem 后被 dequeue 丢弃
      if (!state.currentItem && state.status !== 'resolving') {
        return { currentItem: withMeta, status: 'paused', error: null }
      }
      return { pendingQueue: [...state.pendingQueue, withMeta] }
    })
    if (get().currentItem) startPolling(() => void get().refresh())
  },

  dequeue: () => {
    set((state) => {
      const [next, ...rest] = state.pendingQueue
      if (!next) return { currentItem: null, status: 'idle', pendingQueue: [] }
      return { currentItem: next, status: 'paused', pendingQueue: rest }
    })
    if (get().currentItem) startPolling(() => void get().refresh())
    else stopPolling()
  },

  resolve: async (input) => {
    const { currentItem, status } = get()
    if (!currentItem || status === 'resolving') return false

    const item = currentItem
    const host = getHitlHost()

    // 会话归属：暂停项不属于当前会话时先切换，保证答复落到正确的会话/线程
    if (host.getCurrentSessionId() !== item.sessionId) {
      host.selectSession?.(item.sessionId)
    }

    set({ status: 'resolving', error: null })
    const result = await host.resumeHitl(item.sessionId, {
      approved: input.approved,
      feedback: input.feedback ?? null,
      modifiedArgs: input.modifiedArgs ?? null,
      answer: input.answer ?? null,
      answerId: input.answerId ?? null,
    })

    if (!result.ok) {
      // 回滚：保留暂停项，暴露失败原因，用户可重试或放弃
      set({ status: 'paused', error: result.reason })
      return false
    }
    // 观测：空回答（answer/answerId 均空，含 skip() 路径）视为「跳过」，
    // 计入误触发率分子；其余记 answered。
    const isSkipLike = !(input.answer ?? '').trim() && !(input.answerId ?? '').trim()
    if (isSkipLike) host.trackSkipped?.(item.sessionId, item.kind)
    else host.trackAnswered?.(item.sessionId, item.kind)
    // 成功启动 resume 流：关卡等待流回调 dequeue（resolving 期间不渲染卡片）
    set({ currentItem: null })
    stopPolling()
    return true
  },

  dismiss: (reason = 'user_cancel') => {
    const { currentItem } = get()
    if (!currentItem) return
    const sessionId = currentItem.sessionId
    const host = getHitlHost()
    set({ currentItem: null, error: null })
    stopPolling()
    void Promise.resolve(host.abortHitl(sessionId, reason)).finally(() => {
      get().dequeue()
    })
  },

  skip: async () => {
    const { currentItem } = get()
    if (!currentItem) return false
    // 工具审批不可跳过（必须显式批准/拒绝），仅澄清类支持"跳过本问、继续执行"
    if (currentItem.kind === 'tool_confirm') return false
    return get().resolve({ approved: true, answer: '', answerId: '' })
  },

  recover: async (threadId, runtime) => {
    try {
      const host = getHitlHost()
      const st = await host.getState(threadId, runtime)
      if (!st) return

      const locallyPaused = host.getPausedSessionId() === threadId

      // 后端已无暂停项：超时自动拒绝，或（memory checkpointer）进程重启导致暂停态丢失
      if (st.expired || !st.pending) {
        if (locallyPaused) {
          host.trackExpired?.(threadId)
          host.finalizeHitlStale(
            threadId,
            st.expired ? '待确认的操作已超时，已自动取消。' : '待确认的操作已失效，请重新发起请求。'
          )
        }
        // 清掉属于该会话的残留暂停项
        set((state) => {
          const isSameSession = (i: HitlItem | null) => !!i && i.sessionId === threadId
          const wasCurrent = isSameSession(state.currentItem)
          const rest = state.pendingQueue.filter((i) => i.sessionId !== threadId)
          if (!wasCurrent) return { pendingQueue: rest }
          const [next, ...tail] = rest
          return next
            ? { currentItem: next, status: 'paused' as HitlStatus, pendingQueue: tail }
            : { currentItem: null, status: 'idle' as HitlStatus, pendingQueue: [] }
        })
        if (st.expired) {
          // 无卡片可承载提示时写宿主全局错误
          host.setGlobalError?.('待答复项已超时，服务端已自动拒绝。')
        }
        return
      }

      // 后端仍在暂停：归一化载荷（kind 已由后端显式提供，不再靠布尔值猜测）
      const toolCalls = (st.pending_tool_calls ?? []).map((tc) => ({
        id: String(tc.id ?? ''),
        name: String(tc.name ?? 'tool'),
        args: (tc.args ?? {}) as Record<string, unknown>,
      }))
      const kind: HitlItem['kind'] =
        st.kind ?? (toolCalls.length > 0 || st.tool_requires_approval ? 'tool_confirm' : 'clarifying')

      // 重建暂停容器：让宿主具备可续写的消息与暂停标记，
      // 否则答复会因"未处于等待答复状态"静默失败
      host.restoreHitlPause({
        sessionId: st.session_id || threadId,
        kind,
        message: st.message,
        question: st.question,
        toolCalls: toolCalls.length ? toolCalls : undefined,
      })

      get().enqueue({
        sessionId: st.session_id || threadId,
        kind,
        message: st.message || undefined,
        question: st.question ?? undefined,
        options: st.options ?? undefined,
        artifacts: st.artifacts ?? undefined,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        origin: 'recover',
      })
    } catch {
      // 宿主未就绪 / 无暂停项：静默，不打扰用户
    }
  },

  refresh: async () => {
    const { currentItem, status } = get()
    if (!currentItem || status === 'resolving') {
      stopPolling()
      return
    }
    const host = getHitlHost()
    const runtime = host.getSessionRuntime?.(currentItem.sessionId)
    try {
      const st: HitlStateResponse | null | undefined = await host.getState(
        currentItem.sessionId,
        runtime,
      )
      if (st && (st.expired || !st.pending)) {
        const reason = st.expired ? '待确认的操作已超时，已自动取消。' : '待确认的操作已失效。'
        host.trackExpired?.(currentItem.sessionId)
        host.finalizeHitlStale(currentItem.sessionId, reason)
        // 卡片即将关闭，提示改走全局错误提示条保证可见
        host.setGlobalError?.(
          `待答复项${st.expired ? '已超时，服务端已自动拒绝' : '已失效'}。`
        )
        get().dequeue()
      }
    } catch {
      // 网络抖动：保持现状，下次轮询再试
    }
  },

  clearError: () => set({ error: null }),

  reset: () => {
    stopPolling()
    set({ pendingQueue: [], currentItem: null, status: 'idle', error: null })
  },
}))

// 模块求值时把自己注册进 hitl-bridge（与 desktop 一致的自注册时序）。
bindHitlStore(useHitlStore)
