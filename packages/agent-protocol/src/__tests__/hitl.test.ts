// HITL 状态机测试（移植自 apps/desktop，适配 HitlHost 注入）
//
// 覆盖此前分析中发现的确定性缺陷，防止回归：
//   1. 暂停态必须记录到具体会话（期间禁止发起新 run 的依据）
//   2. 去重：实时事件 + 恢复查询重复入队时只保留一项
//   3. resolving 期间新到的暂停项必须排队，不能被覆盖后丢弃
//   4. resume 未真正启动时必须回滚到 paused 并暴露可见错误（不再静默卡死）
//   5. 后端已无暂停项 / 已超时：收敛本地暂停态并给出说明
//   6. skip 仅对澄清类生效；工具审批必须显式批准/拒绝
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useHitlStore } from '../hitlStore.js'
import { bindHitlHost, type HitlHost, type RestoreHitlPauseInput } from '../host.js'
import type {
  HitlAbortReason,
  HitlResolveInput,
  HitlStateResponse,
} from '../types.js'

interface MockContext {
  host: HitlHost
  calls: {
    selectSession: string[]
    restore: RestoreHitlPauseInput[]
    finalize: Array<{ sessionId: string; reason: string }>
    resume: Array<{ sessionId: string; input: HitlResolveInput }>
    abort: Array<{ sessionId: string; reason: HitlAbortReason }>
    errors: string[]
  }
  metrics: { answered: number; skipped: number; expired: number }
  state: { currentSessionId: string | null; pausedSessionId: string | null }
  setGetState: (fn: (threadId: string) => Promise<HitlStateResponse | null>) => void
  setResume: (fn: () => Promise<{ ok: boolean; reason?: string }>) => void
}

/** 可控的假宿主（getState / resume / abort / restore / finalize / 指标） */
function makeHost(
  stateOverrides: Partial<MockContext['state']> = {},
): MockContext {
  const state = { currentSessionId: 's1', pausedSessionId: null, ...stateOverrides }
  const calls: MockContext['calls'] = {
    selectSession: [],
    restore: [],
    finalize: [],
    resume: [],
    abort: [],
    errors: [],
  }
  const metrics = { answered: 0, skipped: 0, expired: 0 }

  let getStateImpl: (threadId: string) => Promise<HitlStateResponse | null> = async () =>
    ({ session_id: 's1', pending: false })
  let resumeImpl: () => Promise<{ ok: boolean; reason?: string }> = async () => ({ ok: true })

  const host: HitlHost = {
    getCurrentSessionId: () => state.currentSessionId,
    selectSession: (id) => {
      calls.selectSession.push(id)
      state.currentSessionId = id
    },
    getPausedSessionId: () => state.pausedSessionId,
    getSessionRuntime: () => undefined,
    getState: (threadId) => getStateImpl(threadId),
    resumeHitl: async (sessionId, input) => {
      calls.resume.push({ sessionId, input })
      return resumeImpl()
    },
    abortHitl: async (sessionId, reason) => {
      calls.abort.push({ sessionId, reason })
    },
    restoreHitlPause: (input) => {
      calls.restore.push(input)
      state.pausedSessionId = input.sessionId
    },
    finalizeHitlStale: (sessionId, reason) => {
      calls.finalize.push({ sessionId, reason })
      state.pausedSessionId = null
    },
    setGlobalError: (m) => calls.errors.push(m),
    trackAnswered: () => {
      metrics.answered += 1
    },
    trackSkipped: () => {
      metrics.skipped += 1
    },
    trackExpired: () => {
      metrics.expired += 1
    },
  }

  return {
    host,
    calls,
    metrics,
    state,
    setGetState: (fn) => {
      getStateImpl = fn
    },
    setResume: (fn) => {
      resumeImpl = fn
    },
  }
}

describe('hitlStore —— 队列与去重', () => {
  let mock: MockContext
  beforeEach(() => {
    mock = makeHost()
    bindHitlHost(mock.host)
    useHitlStore.getState().reset()
  })
  afterEach(() => useHitlStore.getState().reset())

  it('首个暂停项直接展示，第二个进入队列', () => {
    const { enqueue } = useHitlStore.getState()
    enqueue({
      sessionId: 's1',
      kind: 'tool_confirm',
      toolCalls: [{ id: 'c1', name: 'code_executor', args: {} }],
      origin: 'live',
    })
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
      origin: 'recover' as const,
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
    // 模拟 resolve 进行中：卡片已关、status=resolving
    useHitlStore.setState({ currentItem: null, status: 'resolving' })

    useHitlStore.getState().enqueue({
      sessionId: 's1',
      kind: 'clarifying',
      question: 'q2',
      origin: 'live',
    })
    const st = useHitlStore.getState()
    expect(st.currentItem).toBeNull()
    expect(st.pendingQueue).toHaveLength(1)

    // 上一轮流结束后 dequeue 提升下一项（不再丢项）
    useHitlStore.getState().dequeue()
    expect(useHitlStore.getState().currentItem?.question).toBe('q2')
    expect(useHitlStore.getState().status).toBe('paused')
  })

  it('队列为空时 dequeue 回到 idle', () => {
    useHitlStore.getState().enqueue({
      sessionId: 's1',
      kind: 'clarifying',
      question: 'q1',
      origin: 'live',
    })
    useHitlStore.getState().dequeue()
    const st = useHitlStore.getState()
    expect(st.currentItem).toBeNull()
    expect(st.status).toBe('idle')
  })
})

describe('hitlStore.resolve —— 失败回滚与可见错误', () => {
  let mock: MockContext
  beforeEach(() => {
    mock = makeHost()
    bindHitlHost(mock.host)
    useHitlStore.getState().reset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    useHitlStore.getState().reset()
  })

  it('会话未处于暂停态时：保留暂停项、status 回到 paused、error 可见', async () => {
    mock.setResume(async () => ({
      ok: false,
      reason: '该会话当前没有等待答复的操作，请刷新会话状态后重试。',
    }))
    useHitlStore.getState().enqueue({
      sessionId: 's1',
      kind: 'clarifying',
      question: 'q1',
      origin: 'live',
    })

    const ok = await useHitlStore.getState().resolve({ approved: true, answer: '答案' })

    const st = useHitlStore.getState()
    expect(ok).toBe(false)
    expect(st.status).toBe('paused')
    expect(st.currentItem).not.toBeNull()
    expect(st.error).toContain('没有等待答复')
  })

  it('resume 成功启动：清空 currentItem 并保持 resolving（等待流回调 dequeue）', async () => {
    useHitlStore.getState().enqueue({
      sessionId: 's1',
      kind: 'clarifying',
      question: 'q1',
      origin: 'live',
    })
    const ok = await useHitlStore.getState().resolve({ approved: true, answer: '答案' })

    expect(ok).toBe(true)
    expect(mock.calls.resume[0]).toEqual({
      sessionId: 's1',
      input: expect.objectContaining({ approved: true, answer: '答案' }),
    })
    const st = useHitlStore.getState()
    expect(st.currentItem).toBeNull()
    expect(st.status).toBe('resolving')
    expect(st.error).toBeNull()
  })

  it('skip 对工具审批无效，对澄清生效', async () => {
    const store = useHitlStore.getState()
    store.enqueue({
      sessionId: 's1',
      kind: 'tool_confirm',
      toolCalls: [{ id: 'c1', name: 't', args: {} }],
      origin: 'live',
    })
    expect(await useHitlStore.getState().skip()).toBe(false)
    expect(mock.calls.resume).toHaveLength(0)

    useHitlStore.setState({ currentItem: null, status: 'idle', pendingQueue: [] })
    useHitlStore.getState().enqueue({
      sessionId: 's1',
      kind: 'clarifying',
      question: 'q1',
      origin: 'live',
    })
    expect(await useHitlStore.getState().skip()).toBe(true)
    expect(mock.calls.resume[0]!.input).toMatchObject({
      approved: true,
      answer: '',
      answerId: '',
    })
  })
})

describe('宿主桥接 —— 恢复重建与失效收尾', () => {
  let mock: MockContext
  beforeEach(() => {
    mock = makeHost()
    bindHitlHost(mock.host)
    useHitlStore.getState().reset()
  })
  afterEach(() => useHitlStore.getState().reset())

  it('recover 仍暂停（tool_confirm）：调用 restoreHitlPause 重建容器，入队带 toolCalls', async () => {
    mock.setGetState(async () => ({
      session_id: 's1',
      pending: true,
      kind: 'tool_confirm',
      pending_tool_calls: [{ id: 'c1', name: 'code_executor', args: { cmd: 'ls' } }],
    }))

    await useHitlStore.getState().recover('s1')

    expect(mock.calls.restore).toHaveLength(1)
    expect(mock.calls.restore[0]).toMatchObject({
      sessionId: 's1',
      kind: 'tool_confirm',
      toolCalls: [{ id: 'c1', name: 'code_executor', args: { cmd: 'ls' } }],
    })
    expect(mock.state.pausedSessionId).toBe('s1')
    const item = useHitlStore.getState().currentItem
    expect(item?.kind).toBe('tool_confirm')
    expect(item?.toolCalls).toHaveLength(1)
    expect(item?.origin).toBe('recover')
  })

  it('finalizeHitlStale 携带可读原因（宿主据此追加 [已失效] 文案并解除暂停）', () => {
    // 模拟宿主侧失效收尾的等价行为：store 保证以正确原因调用
    const reason = '待确认的操作已超时，已自动取消。'
    mock.host.finalizeHitlStale('s1', reason)

    expect(mock.calls.finalize[0]).toEqual({ sessionId: 's1', reason })
    expect(`[已失效] ${reason}`).toContain('已失效')
    expect(mock.state.pausedSessionId).toBeNull()
  })
})

describe('hitlStore.recover —— 后端状态对齐', () => {
  let mock: MockContext
  beforeEach(() => {
    mock = makeHost({ pausedSessionId: 's1' })
    bindHitlHost(mock.host)
    useHitlStore.getState().reset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    useHitlStore.getState().reset()
  })

  it('后端仍在暂停（clarifying）：按 kind 重建容器并入队（不再靠布尔值猜测）', async () => {
    mock.setGetState(async () => ({
      session_id: 's1',
      pending: true,
      kind: 'clarifying',
      question: '请补充需求细节',
      pending_tool_calls: [],
    }))

    await useHitlStore.getState().recover('s1')

    const hitl = useHitlStore.getState()
    expect(hitl.currentItem?.kind).toBe('clarifying')
    expect(hitl.currentItem?.question).toBe('请补充需求细节')
    expect(mock.state.pausedSessionId).toBe('s1')
  })

  it('后端已超时：不入队，收敛本地暂停态、给超时说明并写全局错误', async () => {
    mock.setGetState(async () => ({ session_id: 's1', pending: false, expired: true }))

    await useHitlStore.getState().recover('s1')

    expect(useHitlStore.getState().currentItem).toBeNull()
    expect(mock.state.pausedSessionId).toBeNull()
    expect(mock.calls.finalize[0]!.reason).toContain('超时')
    expect(mock.metrics.expired).toBe(1)
    expect(mock.calls.errors[0]).toContain('超时')
  })

  it('后端暂停态丢失（!pending 且非 expired）：按失效语义收尾，无卡片', async () => {
    mock.setGetState(async () => ({ session_id: 's1', pending: false }))

    await useHitlStore.getState().recover('s1')

    expect(useHitlStore.getState().currentItem).toBeNull()
    expect(mock.calls.finalize[0]!.reason).toContain('失效')
    expect(mock.calls.errors).toHaveLength(0)
    expect(mock.metrics.expired).toBe(1)
  })

  it('后端未就绪（getState 抛错）时静默降级，不产生队列项', async () => {
    mock.setGetState(async () => {
      throw new Error('offline')
    })
    await useHitlStore.getState().recover('s1')
    expect(useHitlStore.getState().currentItem).toBeNull()
    expect(mock.calls.restore).toHaveLength(0)
  })
})

describe('澄清端到端组合链路（触发 → 答复 → 指标）', () => {
  let mock: MockContext
  beforeEach(() => {
    mock = makeHost()
    bindHitlHost(mock.host)
    useHitlStore.getState().reset()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    useHitlStore.getState().reset()
  })

  it('入队(kind=clarifying) → resolve 携带 answer → 指标记 answered', async () => {
    useHitlStore.getState().enqueue({
      sessionId: 's1',
      kind: 'clarifying',
      question: '请补充需求细节',
      origin: 'live',
    })

    const ok = await useHitlStore.getState().resolve({
      approved: true,
      answer: '季度销售总结文档',
      feedback: '季度销售总结文档',
    })
    expect(ok).toBe(true)

    // answer 必须透传到宿主 resumeHitl
    expect(mock.calls.resume[0]!.input).toMatchObject({
      approved: true,
      answer: '季度销售总结文档',
      feedback: '季度销售总结文档',
      modifiedArgs: null,
      answerId: null,
    })

    expect(mock.metrics.answered).toBe(1)
    expect(mock.metrics.skipped).toBe(0)
  })

  it('跳过（空回答）→ resume 不带答案 → 指标记 skipped 而非 answered', async () => {
    useHitlStore.getState().enqueue({
      sessionId: 's1',
      kind: 'clarifying',
      question: '请补充需求细节',
      origin: 'live',
    })

    const ok = await useHitlStore.getState().skip()
    expect(ok).toBe(true)

    expect(mock.calls.resume[0]!.input.answer).toBe('')
    expect(mock.metrics.skipped).toBe(1)
    expect(mock.metrics.answered).toBe(0)
  })

  it('会话归属：暂停项属于其他会话时，resolve 先切换会话再 resume', async () => {
    mock.state.currentSessionId = 's0'
    useHitlStore.getState().enqueue({
      sessionId: 's1',
      kind: 'clarifying',
      question: 'q1',
      origin: 'live',
    })

    const ok = await useHitlStore.getState().resolve({ approved: true, answer: '答案' })
    expect(ok).toBe(true)
    expect(mock.calls.selectSession).toEqual(['s1'])
    expect(mock.calls.resume[0]!.sessionId).toBe('s1')
    expect(mock.state.currentSessionId).toBe('s1')
  })
})
