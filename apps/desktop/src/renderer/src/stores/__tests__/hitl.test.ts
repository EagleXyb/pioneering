// HITL 状态机测试（阶段三收敛）
//
// 覆盖此前分析中发现的确定性缺陷，防止回归：
//   1. 暂停态必须记录到具体会话（期间禁止发起新 run 的依据）
//   2. 去重：实时事件 + 恢复查询重复入队时只保留一项
//   3. resolving 期间新到的暂停项必须排队，不能被覆盖后丢弃
//   4. resume 未真正启动时必须回滚到 paused 并暴露可见错误（不再静默卡死）
//   5. 后端已无暂停项 / 已超时：收敛本地暂停态并给出说明
//   6. skip 仅对澄清类生效；工具审批必须显式批准/拒绝
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Message } from '@shared/types'
import type { AgentTransport } from '@renderer/services/transport'
import { setAgentTransport } from '@renderer/services/transport'
import {
  useChatStore,
  pauseStreamingMessage,
  selectIsHitlPaused,
  type ChatState
} from '@renderer/stores/chatStore'
import { useHitlStore } from '@renderer/stores/hitlStore'
import { resolveHitlSurface } from '@renderer/lib/hitl-surface'
import {
  getClarifyMetrics,
  resetClarifyMetrics,
  trackClarifyTriggered
} from '@renderer/services/clarify-metrics'

function makeChatState(partial: Partial<ChatState> = {}): ChatState {
  return {
    sessions: [{ id: 's1', title: 't', isArchived: false, createdAt: '', updatedAt: '' }],
    sessionsLoading: false,
    currentSessionId: 's1',
    messages: {},
    messagesLoading: false,
    messagesNextCursor: {},
    messagesHasMore: {},
    streamingContent: '',
    streamingThinking: '',
    streamingToolCalls: [],
    streamingTraceNodes: {},
    streamingTraceRootOrder: [],
    streamingMessageId: 'm1',
    isStreaming: true,
    abortController: null,
    hitlPending: null,
    hitlPausedSessionId: null,
    hitlPausedMessageId: null,
    agentMode: false,
    error: null,
    ...partial
  } as unknown as ChatState
}

const pausedMsg: Message = {
  id: 'm1',
  sessionId: 's1',
  role: 'assistant',
  content: '半截内容',
  timestamp: 0
} as Message

/** 可控的假 Transport（getState / abort / resume） */
function makeTransport(overrides: Partial<AgentTransport> = {}): AgentTransport {
  return {
    kind: 'http',
    sendMessage: () => new AbortController(),
    resume: () => new AbortController(),
    abort: async () => ({ message: 'aborted', aborted: true }),
    getState: async () => ({ session_id: 's1', pending: false }),
    stop: async () => ({ message: 'stopped', aborted: true }),
    ...overrides
  } as AgentTransport
}

describe('pauseStreamingMessage —— 暂停态会话归属', () => {
  it('记录会话级暂停标记并保留消息 id（供 resume 定位）', () => {
    const state = makeChatState({ messages: { s1: [pausedMsg] } })
    const next = pauseStreamingMessage(state, 's1', 'm1', { paused: true })

    expect(next.hitlPausedSessionId).toBe('s1')
    expect(next.hitlPausedMessageId).toBe('m1')
    expect(next.streamingMessageId).toBe('m1')
    expect(next.isStreaming).toBe(false)
    const updated = (next.messages!['s1'] as Message[])[0]!
    expect(updated.paused).toBe(true)
  })

  it('selectIsHitlPaused 按会话判定（切到其它会话即为 false）', () => {
    expect(selectIsHitlPaused({ hitlPausedSessionId: 's1', currentSessionId: 's1' })).toBe(true)
    expect(selectIsHitlPaused({ hitlPausedSessionId: 's1', currentSessionId: 's2' })).toBe(false)
    expect(selectIsHitlPaused({ hitlPausedSessionId: null, currentSessionId: 's1' })).toBe(false)
  })
})

describe('hitlStore —— 队列与去重', () => {
  beforeEach(() => {
    useHitlStore.getState().reset()
    useChatStore.setState({
      hitlPausedSessionId: null,
      hitlPausedMessageId: null,
      currentSessionId: 's1'
    })
  })
  afterEach(() => useHitlStore.getState().reset())

  it('首个暂停项直接展示，第二个进入队列', () => {
    const { enqueue } = useHitlStore.getState()
    enqueue({ sessionId: 's1', kind: 'tool_confirm', toolCalls: [{ id: 'c1', name: 'code_executor', args: {} }], origin: 'live' })
    enqueue({ sessionId: 's1', kind: 'clarifying', question: '补充什么？', origin: 'live' })

    const st = useHitlStore.getState()
    expect(st.currentItem?.kind).toBe('tool_confirm')
    expect(st.status).toBe('paused')
    expect(st.pendingQueue).toHaveLength(1)
  })

  it('同一暂停项重复入队被忽略（实时事件 + 恢复查询）', () => {
    const item = {
      sessionId: 's1',
      kind: 'tool_confirm' as const,
      toolCalls: [{ id: 'c1', name: 'code_executor', args: {} }],
      origin: 'recover' as const
    }
    useHitlStore.getState().enqueue(item)
    useHitlStore.getState().enqueue(item)

    const st = useHitlStore.getState()
    expect(st.pendingQueue).toHaveLength(0)
    expect(st.currentItem).not.toBeNull()
  })

  it('resolving 期间新到的暂停项进入队列而非覆盖当前项', () => {
    const store = useHitlStore.getState()
    store.enqueue({ sessionId: 's1', kind: 'clarifying', question: 'q1', origin: 'live' })
    // 模拟 resolve 进行中：弹窗已关、status=resolving
    useHitlStore.setState({ currentItem: null, status: 'resolving' })

    useHitlStore.getState().enqueue({ sessionId: 's1', kind: 'clarifying', question: 'q2', origin: 'live' })
    const st = useHitlStore.getState()
    expect(st.currentItem).toBeNull()
    expect(st.pendingQueue).toHaveLength(1)

    // 上一轮流结束后 dequeue 提升下一项（不再丢项）
    useHitlStore.getState().dequeue()
    expect(useHitlStore.getState().currentItem?.question).toBe('q2')
    expect(useHitlStore.getState().status).toBe('paused')
  })

  it('队列为空时 dequeue 回到 idle', () => {
    useHitlStore.getState().enqueue({ sessionId: 's1', kind: 'clarifying', question: 'q1', origin: 'live' })
    useHitlStore.getState().dequeue()
    const st = useHitlStore.getState()
    expect(st.currentItem).toBeNull()
    expect(st.status).toBe('idle')
  })
})

describe('hitlStore.resolve —— 失败回滚与可见错误', () => {
  beforeEach(() => {
    useHitlStore.getState().reset()
    useChatStore.setState({
      currentSessionId: 's1',
      hitlPausedSessionId: null,
      hitlPausedMessageId: null,
      messages: {}
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    useHitlStore.getState().reset()
  })

  it('会话未处于暂停态时：保留暂停项、status 回到 paused、error 可见', async () => {
    useHitlStore.getState().enqueue({ sessionId: 's1', kind: 'clarifying', question: 'q1', origin: 'live' })

    const ok = await useHitlStore.getState().resolve({ approved: true, answer: '答案' })

    const st = useHitlStore.getState()
    expect(ok).toBe(false)
    expect(st.status).toBe('paused')
    expect(st.currentItem).not.toBeNull()
    expect(st.error).toContain('没有等待答复')
  })

  it('resume 成功启动：清空 currentItem 并保持 resolving（等待流回调 dequeue）', async () => {
    useChatStore.setState({
      currentSessionId: 's1',
      hitlPausedSessionId: 's1',
      hitlPausedMessageId: 'm1',
      messages: { s1: [pausedMsg] }
    })
    const spy = vi
      .spyOn(useChatStore.getState(), 'resumeHitl')
      .mockResolvedValue({ ok: true })

    useHitlStore.getState().enqueue({ sessionId: 's1', kind: 'clarifying', question: 'q1', origin: 'live' })
    const ok = await useHitlStore.getState().resolve({ approved: true, answer: '答案' })

    expect(ok).toBe(true)
    expect(spy).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ approved: true, answer: '答案' })
    )
    const st = useHitlStore.getState()
    expect(st.currentItem).toBeNull()
    expect(st.status).toBe('resolving')
    expect(st.error).toBeNull()
  })

  it('skip 对工具审批无效，对澄清生效', async () => {
    const store = useHitlStore.getState()
    store.enqueue({ sessionId: 's1', kind: 'tool_confirm', toolCalls: [{ id: 'c1', name: 't', args: {} }], origin: 'live' })
    expect(await useHitlStore.getState().skip()).toBe(false)

    useHitlStore.setState({ currentItem: null, status: 'idle', pendingQueue: [] })
    useChatStore.setState({ hitlPausedSessionId: 's1', hitlPausedMessageId: 'm1' })
    vi.spyOn(useChatStore.getState(), 'resumeHitl').mockResolvedValue({ ok: true })

    useHitlStore.getState().enqueue({ sessionId: 's1', kind: 'clarifying', question: 'q1', origin: 'live' })
    expect(await useHitlStore.getState().skip()).toBe(true)
  })
})

describe('chatStore —— 恢复重建与失效收尾', () => {
  beforeEach(() => {
    useHitlStore.getState().reset()
    useChatStore.setState({
      currentSessionId: 's1',
      messages: {},
      hitlPausedSessionId: null,
      hitlPausedMessageId: null,
      hitlPending: null
    })
  })
  afterEach(() => useHitlStore.getState().reset())

  it('restoreHitlPause 建立可续写的暂停容器并写入暂停标记', () => {
    useChatStore.getState().restoreHitlPause({
      sessionId: 's1',
      kind: 'clarifying',
      question: '你想做什么？'
    })

    const st = useChatStore.getState()
    expect(st.hitlPausedSessionId).toBe('s1')
    expect(st.hitlPausedMessageId).toBeTruthy()
    const msg = st.messages['s1']!.at(-1)!
    expect(msg.paused).toBe(true)
    expect(msg.pausedKind).toBe('clarifying')
  })

  it('finalizeHitlStale 追加失效说明并解除暂停标记', () => {
    useChatStore.getState().restoreHitlPause({ sessionId: 's1', kind: 'tool_confirm' })
    useChatStore.getState().finalizeHitlStale('s1', '待确认的操作已超时，已自动取消。')

    const st = useChatStore.getState()
    expect(st.hitlPausedSessionId).toBeNull()
    expect(st.hitlPausedMessageId).toBeNull()
    const msg = st.messages['s1']!.at(-1)!
    expect(msg.paused).toBe(false)
    expect(msg.content).toContain('已失效')
  })
})

describe('hitlStore.recover —— 后端状态对齐', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    useHitlStore.getState().reset()
    useChatStore.setState({
      currentSessionId: 's1',
      messages: {},
      hitlPausedSessionId: null,
      hitlPausedMessageId: null,
      hitlPending: null
    })
  })

  it('后端仍在暂停：按 kind 重建容器并入队（不再靠布尔值猜测）', async () => {
    useChatStore.setState({ currentSessionId: 's1', messages: {}, hitlPausedSessionId: null })
    setAgentTransport(
      makeTransport({
        getState: async () => ({
          session_id: 's1',
          pending: true,
          kind: 'clarifying',
          question: '请补充需求细节',
          pending_tool_calls: []
        })
      })
    )

    await useHitlStore.getState().recover('s1', 'cloud')

    const hitl = useHitlStore.getState()
    expect(hitl.currentItem?.kind).toBe('clarifying')
    expect(hitl.currentItem?.question).toBe('请补充需求细节')
    const chat = useChatStore.getState()
    expect(chat.hitlPausedSessionId).toBe('s1')
  })

  it('后端已超时：不入队，收敛本地暂停态并给出说明', async () => {
    useChatStore.setState({ currentSessionId: 's1', messages: {}, hitlPausedSessionId: null })
    useChatStore.getState().restoreHitlPause({ sessionId: 's1', kind: 'tool_confirm' })
    setAgentTransport(
      makeTransport({
        getState: async () => ({ session_id: 's1', pending: false, expired: true })
      })
    )

    await useHitlStore.getState().recover('s1', 'cloud')

    expect(useHitlStore.getState().currentItem).toBeNull()
    expect(useChatStore.getState().hitlPausedSessionId).toBeNull()
    expect(useChatStore.getState().messages['s1']!.at(-1)!.content).toContain('超时')
  })

  it('后端未就绪（getState 抛错）时静默降级，不产生队列项', async () => {
    setAgentTransport(
      makeTransport({
        getState: async () => {
          throw new Error('offline')
        }
      })
    )
    await useHitlStore.getState().recover('s1', 'cloud')
    expect(useHitlStore.getState().currentItem).toBeNull()
  })
})

// ============================================================
// 澄清端到端组合链路（阶段0 + 阶段2 + 阶段4 串联验证）
//
// 单层测试各自锁定局部契约，本组验证"串起来"仍然成立：
//   事件(kind=clarifying) → 内联可答决策 → resume 携带 answer → 指标记录
// ============================================================
describe('澄清端到端组合链路（阶段0/2/4 串联）', () => {
  beforeEach(() => {
    useHitlStore.getState().reset()
    resetClarifyMetrics()
    useChatStore.setState({
      currentSessionId: 's1',
      messages: {},
      hitlPausedSessionId: null,
      hitlPausedMessageId: null
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    useHitlStore.getState().reset()
    resetClarifyMetrics()
  })

  it('入队(kind=clarifying) → 内联可答 → resume 携带 answer → 指标记 answered', async () => {
    const resumed: Array<Record<string, unknown>> = []
    setAgentTransport(
      makeTransport({
        resume: (req) => {
          resumed.push(req as unknown as Record<string, unknown>)
          return new AbortController()
        }
      })
    )
    // 暂停容器就绪（HITL 暂停态：消息保留 streamingMessageId 供续写）
    useChatStore.setState({
      sessions: [{ id: 's1', title: 't', isArchived: false, createdAt: '', updatedAt: '' }],
      hitlPausedSessionId: 's1',
      hitlPausedMessageId: 'm1',
      messages: { s1: [pausedMsg] }
    })

    // 流回调侧（chatStore.onHumanInputRequest）的等价行为：埋点 + 入队
    trackClarifyTriggered('s1', 'clarifying')
    useHitlStore.getState().enqueue({
      sessionId: 's1',
      kind: 'clarifying',
      question: '请补充需求细节',
      origin: 'live'
    })

    // 阶段4：澄清由输入框内联澄清条承载（不占用模态弹窗）
    const st = useHitlStore.getState()
    expect(resolveHitlSurface(st.currentItem, st.status, 's1')).toBe('inline')

    // 用户在内联条作答（ChatArea.handleHitlAnswer 的等价调用）
    const ok = await useHitlStore.getState().resolve({
      approved: true,
      answer: '季度销售总结文档',
      feedback: '季度销售总结文档'
    })
    expect(ok).toBe(true)

    // 修复链路：answer 必须透传到 transport.resume（本地经 IPC / 云端经 REST）
    expect(resumed).toHaveLength(1)
    expect(resumed[0]).toMatchObject({
      sessionId: 's1',
      approved: true,
      answer: '季度销售总结文档'
    })

    // 阶段2 指标：触发计一次、回答计一次、不计入跳过
    const m = getClarifyMetrics()
    expect(m.triggered).toBe(1)
    expect(m.answered).toBe(1)
    expect(m.skipped).toBe(0)
  })

  it('跳过（空回答）→ resume 不带答案 → 指标记 skipped 而非 answered', async () => {
    const resumed: Array<Record<string, unknown>> = []
    setAgentTransport(
      makeTransport({
        resume: (req) => {
          resumed.push(req as unknown as Record<string, unknown>)
          return new AbortController()
        }
      })
    )
    useChatStore.setState({
      sessions: [{ id: 's1', title: 't', isArchived: false, createdAt: '', updatedAt: '' }],
      hitlPausedSessionId: 's1',
      hitlPausedMessageId: 'm1',
      messages: { s1: [pausedMsg] }
    })

    trackClarifyTriggered('s1', 'clarifying')
    useHitlStore.getState().enqueue({
      sessionId: 's1',
      kind: 'clarifying',
      question: '请补充需求细节',
      origin: 'live'
    })

    // skip() 等价于 resolve({approved:true, answer:'', answerId:''})
    const ok = await useHitlStore.getState().skip()
    expect(ok).toBe(true)

    const m = getClarifyMetrics()
    expect(m.triggered).toBe(1)
    expect(m.skipped).toBe(1)
    expect(m.answered).toBe(0)
  })
})
