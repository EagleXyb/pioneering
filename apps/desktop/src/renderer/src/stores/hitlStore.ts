// ============================================================
// Hitl Store — HITL 暂停项队列与答复状态 (Zustand)
// 阶段二 2.5：独立于 chatStore 的暂停项 UI 状态。
// 单向协作：只消费 chatStore 入队的暂停项；答复时把 resume
// 请求回灌给 chatStore（resumeHitl 续写同一条 assistant 消息）。
// ============================================================

import { create } from 'zustand'
import type { UserQuestionRequestPayload } from '@shared/types'
import { agentService } from '../services/api/agent'
import { useChatStore } from './chatStore'

/**
 * 状态机：idle=无待答复项；paused=暂停项弹窗等待答复；
 * awaiting=澄清/多选输入中（一期 tool_confirm 未使用，为图1/图2 预留）；
 * resolving=resume 请求进行中（弹窗已关，流续写同消息）。
 */
export type HitlStatus = 'idle' | 'paused' | 'awaiting' | 'resolving'

/** 暂停项（与 UserQuestionRequestPayload 对齐，供三类弹窗渲染） */
export interface HitlItem {
  sessionId: string
  runId?: string
  kind: UserQuestionRequestPayload['kind']
  message?: string
  /** kind='tool_confirm' 时携带待审批的工具调用列表 */
  toolCalls?: UserQuestionRequestPayload['tool_calls']
  /** kind='clarifying' 时携带澄清问题文本 */
  question?: string
  /** kind='choice' 时携带多选选项 */
  options?: UserQuestionRequestPayload['options']
}

export interface HitlState {
  /** 待答复暂停项队列（多次 interrupt 串行时排队，逐个弹窗） */
  pendingQueue: HitlItem[]
  /** 当前正在展示的暂停项 */
  currentItem: HitlItem | null
  status: HitlStatus

  /** 入队暂停项：无展示项时直接设为 currentItem，否则排队 */
  enqueue: (item: HitlItem) => void
  /** 出队当前项：展示队列下一项（resume 流结束/中止后由 chatStore 调用） */
  dequeue: () => void
  /** 用户答复：关窗并转发给 chatStore.resumeHitl 续写同一条 assistant 消息 */
  resolve: (
    approved: boolean,
    feedback?: string | null,
    modifiedArgs?: Record<string, Record<string, unknown>> | null
  ) => Promise<void>
  /** 丢弃当前项（等同拒绝）：通知 chatStore 中止后端，保证暂停态收敛 */
  dismiss: () => void
  /** 跳过当前项：不答复，直接展示队列下一项（留给后端超时治理） */
  skip: () => void
  /** 进页/重连恢复：查 getHitlState，若有暂停项则补挂弹窗 */
  recover: (threadId: string) => Promise<void>
  /** 清空（登出/切会话） */
  reset: () => void
}

export const useHitlStore = create<HitlState>((set, get) => ({
  pendingQueue: [],
  currentItem: null,
  status: 'idle',

  enqueue: (item) => {
    set((state) => {
      // 无正在展示项 → 直接展示（status=paused）；已有展示项 → 排队等待串行处理
      if (!state.currentItem) {
        return { currentItem: item, status: 'paused' }
      }
      return { pendingQueue: [...state.pendingQueue, item] }
    })
  },

  dequeue: () => {
    set((state) => {
      const [next, ...rest] = state.pendingQueue
      if (!next) {
        return { currentItem: null, status: 'idle', pendingQueue: [] }
      }
      return { currentItem: next, status: 'paused', pendingQueue: rest }
    })
  },

  resolve: async (approved, feedback = null, modifiedArgs = null) => {
    const { currentItem } = get()
    if (!currentItem) return
    // 关窗并置 resolving；resume 流结束后由 chatStore.dequeue() 出队展示下一项
    set({ currentItem: null, status: 'resolving' })
    try {
      await useChatStore.getState().resumeHitl(approved, feedback, modifiedArgs)
    } catch {
      set({ status: 'idle' })
    }
  },

  dismiss: () => {
    const { currentItem } = get()
    if (!currentItem) return
    // 等同拒绝：通知 chatStore 中止后端，保证暂停态收敛；清空队列
    set({ currentItem: null, status: 'idle', pendingQueue: [] })
    void useChatStore.getState().abortHitl().catch(() => {})
  },

  skip: () => {
    set((state) => {
      const [next, ...rest] = state.pendingQueue
      if (!next) {
        return { currentItem: null, status: 'idle', pendingQueue: [] }
      }
      return { currentItem: next, status: 'paused', pendingQueue: rest }
    })
  },

  recover: async (threadId) => {
    try {
      const st = await agentService.getHitlState(threadId)
      if (!st || !st.pending) return
      // 后端结构化数据字段可能与前端枚举不完全一致，做一次防御性归一
      const toolCalls = (st.pending_tool_calls ?? []).map((tc) => ({
        id: String(tc.id ?? ''),
        name: String(tc.name ?? 'tool'),
        args: (tc.args ?? {}) as Record<string, unknown>
      }))
      get().enqueue({
        sessionId: st.session_id || threadId,
        kind: st.tool_requires_approval ? 'tool_confirm' : 'clarifying',
        toolCalls: toolCalls.length ? toolCalls : undefined,
        message: '会话恢复：存在未答复的审批项，请确认是否继续。'
      })
    } catch {
      // 后端未就绪 / 无暂停项：静默，不打扰用户
    }
  },

  reset: () => set({ pendingQueue: [], currentItem: null, status: 'idle' })
}))
