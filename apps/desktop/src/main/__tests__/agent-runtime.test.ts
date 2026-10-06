// ============================================================
// Agent Runtime 单测（主进程 IPC 边界 + run 生命周期）
//
// 覆盖：
//   1. validateSendRequest —— IPC 边界校验 + agentMode 白名单归一化
//   2. validateResumeRequest —— P0 修复回归：answer / answerId 透传
//   3. startSend / startResume —— run 注册、重复 runId 拒绝、
//      AG-UI dict → AgentEventEnvelope 封装推送（解析失败丢弃）
//   4. stopRun / abortRunsForSender —— 中止语义
//   5. getHitlState / abortPending —— HITL 查询与中止（归属校验）
//   6. invalidateAgentGraphCache —— 图缓存主动失效（密钥变更配套）
//   7. ensureAgentEnv —— .env 加载（失败容错 / 不覆盖既有 env）
//
// 内核（@pioneering/modu-agent）整体 mock：不加载 LangGraph 重依赖，
// 便于精确控制流产出与断言调用次数。
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'

/** 内核 mock 的可编程状态（vi.mock 工厂提升执行，须经 vi.hoisted 共享） */
const kernel = vi.hoisted(() => ({
  streamEvents: [] as Array<Record<string, string>>,
  resumeEvents: [] as Array<Record<string, string>>,
  getRunnerCalls: 0,
  createAgentConfigs: [] as unknown[],
  resetCalls: 0,
  interruptState: null as Record<string, unknown> | null,
  resumeSyncResult: { status: 'ok' } as Record<string, unknown>
}))

vi.mock('@pioneering/modu-agent', () => {
  class AGUIStreamAdapter {
    constructor(public readonly traceId: string) {}
    transform_langgraph_events(iter: AsyncIterable<Record<string, string>>) {
      return iter
    }
  }
  return {
    get_runner: vi.fn(async () => {
      kernel.getRunnerCalls++
      // 默认 ReAct 缓存图：与 plan 图返回不同对象，便于断言 resume 选图
      return { fake: 'react-graph' }
    }),
    create_agent: vi.fn(async (cfg?: unknown) => {
      kernel.createAgentConfigs.push(cfg)
      return { fake: 'plan-graph' }
    }),
    reset_runner_cache: vi.fn(() => {
      kernel.resetCalls++
    }),
    stream_response: vi.fn(() =>
      (async function* () {
        for (const e of kernel.streamEvents) yield e
      })()
    ),
    resume_stream: vi.fn(() =>
      (async function* () {
        for (const e of kernel.resumeEvents) yield e
      })()
    ),
    resume_sync: vi.fn(async () => kernel.resumeSyncResult),
    get_interrupt_state: vi.fn(async () => kernel.interruptState),
    checkInterruptTimeout: vi.fn(async () => 'pending'),
    AGUIStreamAdapter,
    getRegistry: () => ({ getTool: () => undefined, registerTool: () => undefined }),
    getConfig: () => ({ get: (_k: string, d: unknown) => d }),
    CodeExecutorTool: class {}
  }
})

import {
  validateSendRequest,
  validateResumeRequest,
  startSend,
  startResume,
  stopRun,
  abortRunsForSender,
  abortPending,
  getHitlState,
  invalidateAgentGraphCache,
  ensureAgentEnv
} from '../agent-runtime'
import type { AgentEventEnvelope } from '../../shared/ipc-channels'

// ---- 测试辅助 ----

interface CapturedEvent {
  channel: string
  envelope: AgentEventEnvelope
}

function makeSender(destroyed = false) {
  const events: CapturedEvent[] = []
  return {
    events,
    send(channel: string, ...args: unknown[]) {
      events.push({ channel, envelope: args[0] as AgentEventEnvelope })
    },
    isDestroyed() {
      return destroyed
    }
  }
}

/** AG-UI 事件的 IPC 形态：{ data: "<json>" }（与 AGUIStreamAdapter 产出对齐） */
const agui = (event: Record<string, unknown>): Record<string, string> => ({
  data: JSON.stringify(event)
})

beforeEach(() => {
  kernel.streamEvents = []
  kernel.resumeEvents = []
  kernel.getRunnerCalls = 0
  kernel.createAgentConfigs = []
  kernel.resetCalls = 0
  kernel.interruptState = null
  kernel.resumeSyncResult = { status: 'ok' }
})

// ---- validateSendRequest ----

describe('validateSendRequest', () => {
  it('拒绝非对象 / 空 message / 超长 message', () => {
    expect(validateSendRequest(null)).toBeNull()
    expect(validateSendRequest('hi')).toBeNull()
    expect(validateSendRequest({ message: '   ' })).toBeNull()
    expect(validateSendRequest({ message: 'x'.repeat(100_001) })).toBeNull()
  })

  it('history 结构非法时拒绝，合法时保留', () => {
    expect(
      validateSendRequest({ message: 'hi', history: [{ role: 'user' }] })
    ).toBeNull()
    const ok = validateSendRequest({
      message: 'hi',
      sessionId: 's1',
      history: [{ role: 'user', content: '之前的问题' }]
    })
    expect(ok?.history).toEqual([{ role: 'user', content: '之前的问题' }])
  })

  it('history 超尺寸界时拒绝（⑰：条数 >100 / 单项 content >100k）', () => {
    const oversizedItems = Array.from({ length: 101 }, (_, i) => ({
      role: 'user',
      content: `m${i}`
    }))
    expect(
      validateSendRequest({ message: 'hi', history: oversizedItems })
    ).toBeNull()
    expect(
      validateSendRequest({
        message: 'hi',
        history: [{ role: 'user', content: 'x'.repeat(100_001) }]
      })
    ).toBeNull()
    // 边界内（100 条 / 恰好 100k）正常放行
    expect(
      validateSendRequest({
        message: 'hi',
        history: Array.from({ length: 100 }, () => ({
          role: 'assistant',
          content: 'x'.repeat(100_000)
        }))
      })
    ).not.toBeNull()
  })

  it('agentMode 白名单：plan_execute / react_agent 保留，其余归一化为 undefined', () => {
    const base = { sessionId: 's1', message: 'hi' }
    expect(validateSendRequest({ ...base, agentMode: 'plan_execute' })?.agentMode).toBe(
      'plan_execute'
    )
    expect(validateSendRequest({ ...base, agentMode: 'react_agent' })?.agentMode).toBe(
      'react_agent'
    )
    // 白名单外取值（含跨端未对齐的 rag_agent 与非字符串）一律丢弃，防止流入内核 configurable
    expect(validateSendRequest({ ...base, agentMode: 'rag_agent' })?.agentMode).toBeUndefined()
    expect(validateSendRequest({ ...base, agentMode: 42 })?.agentMode).toBeUndefined()
  })
})

// ---- validateResumeRequest（P0 修复回归）----

describe('validateResumeRequest', () => {
  it('保留澄清回答 answer / answerId（P0 修复回归）', () => {
    const r = validateResumeRequest({
      sessionId: 's1',
      approved: true,
      answer: '用方案 B',
      answerId: 'opt-2'
    })
    expect(r).not.toBeNull()
    expect(r!.answer).toBe('用方案 B')
    expect(r!.answerId).toBe('opt-2')
  })

  it('null 归一化为 undefined，modifiedArgs 保留', () => {
    const r = validateResumeRequest({
      sessionId: 's1',
      approved: false,
      answer: null,
      answerId: null,
      modifiedArgs: { call_1: { path: '/tmp/a.txt' } }
    })
    expect(r!.answer).toBeUndefined()
    expect(r!.answerId).toBeUndefined()
    expect(r!.modifiedArgs).toEqual({ call_1: { path: '/tmp/a.txt' } })
  })

  it('answer 非字符串 / sessionId 缺失 / approved 缺失时拒绝', () => {
    expect(validateResumeRequest({ sessionId: 's1', approved: true, answer: 123 })).toBeNull()
    expect(validateResumeRequest({ approved: true })).toBeNull()
    expect(validateResumeRequest({ sessionId: 's1' })).toBeNull()
  })
})

// ---- startSend / startResume ----

describe('startSend / startResume', () => {
  it('sessionId 缺失 → ok:false', () => {
    const res = startSend(makeSender(), 'r0', { message: 'hi' })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('sessionId')
  })

  it('runId 重复 → ok:false（在途 run 保护）', () => {
    const sender = makeSender()
    expect(startSend(sender, 'r1', { sessionId: 's1', message: 'hi' }).ok).toBe(true)
    expect(startSend(sender, 'r1', { sessionId: 's1', message: 'hi' }).ok).toBe(false)
    expect(startResume(sender, 'r1', { sessionId: 's1', approved: true }).ok).toBe(false)
  })

  it('AG-UI dict 按 runId/seq 封装推送，解析失败的事件被丢弃', async () => {
    kernel.streamEvents = [
      agui({ type: 'RUN_STARTED', threadId: 's1' }),
      { data: 'not-json' },
      agui({ type: 'TEXT_MESSAGE_CONTENT', delta: 'hi' })
    ]
    const sender = makeSender()
    expect(startSend(sender, 'r2', { sessionId: 's1', message: 'hi' }).ok).toBe(true)

    await vi.waitFor(() => expect(sender.events.length).toBe(2))
    expect(sender.events[0]!.channel).toBe('agent:event')
    expect(sender.events[0]!.envelope).toMatchObject({ runId: 'r2', seq: 0 })
    expect(sender.events[1]!.envelope).toMatchObject({ runId: 'r2', seq: 1 })
    expect((sender.events[0]!.envelope.event as { type: string }).type).toBe('RUN_STARTED')
    expect((sender.events[1]!.envelope.event as { type: string }).type).toBe(
      'TEXT_MESSAGE_CONTENT'
    )
  })

  it('resume 事件流同样经信封推送（runId 路由）', async () => {
    kernel.resumeEvents = [agui({ type: 'RUN_FINISHED', messageId: 'm1' })]
    const sender = makeSender()
    expect(startResume(sender, 'r3', { sessionId: 's1', approved: true }).ok).toBe(true)

    await vi.waitFor(() => expect(sender.events.length).toBe(1))
    expect(sender.events[0]!.envelope.runId).toBe('r3')
    expect((sender.events[0]!.envelope.event as { type: string }).type).toBe('RUN_FINISHED')
  })

  it('sender 已销毁（窗口关闭）时不推送事件', async () => {
    kernel.streamEvents = [agui({ type: 'RUN_STARTED' })]
    const sender = makeSender(true)
    startSend(sender, 'r4', { sessionId: 's1', message: 'hi' })

    await vi.waitFor(() => expect(kernel.getRunnerCalls).toBe(1))
    expect(sender.events.length).toBe(0)
  })

  it('默认模式复用缓存图；plan_execute 走 create_agent 建图期覆盖', async () => {
    kernel.streamEvents = [agui({ type: 'RUN_FINISHED' })]
    const { stream_response } = await import('@pioneering/modu-agent')

    // 默认（react_agent / 未指定）：复用 get_runner() 编译图缓存，不重建图
    startSend(makeSender(), 'r7', { sessionId: 's1', message: 'hi' })
    await vi.waitFor(() => expect(kernel.getRunnerCalls).toBe(1))
    expect(kernel.createAgentConfigs.length).toBe(0)

    // plan_execute：planner 节点集合由「建图期」configurable 决定，
    // 必须经 create_agent 传入，且运行时路由需同一份 extraConfigurable
    startSend(makeSender(), 'r8', {
      sessionId: 's1',
      message: 'hi',
      agentMode: 'plan_execute'
    })
    await vi.waitFor(() => expect(kernel.createAgentConfigs.length).toBe(1))
    expect(kernel.getRunnerCalls).toBe(1) // plan_execute 不复用缓存图
    const cfg = kernel.createAgentConfigs[0] as { configurable?: Record<string, unknown> }
    expect(cfg.configurable?.plan_execute_enabled).toBe(true)
    const lastCall = vi.mocked(stream_response).mock.calls.at(-1)
    expect(lastCall?.[6]).toEqual({ plan_execute_enabled: true })
  })

  it('plan_execute 会话：resume 复用 send 时的 plan 图并透传 plan_execute_enabled', async () => {
    // 回归缺陷①：send 走 create_agent 新建 plan 图（不入 get_runner 缓存），
    // resume 原固定取默认 ReAct 图，批准续跑路由到 step_finalize 时命中
    // 编译期不存在的目标而报错。修复后按会话复用图 + 透传运行时 configurable。
    const sid = 'plan-resume-sess'
    kernel.streamEvents = [agui({ type: 'RUN_PAUSED' })]
    startSend(makeSender(), 'rp1', {
      sessionId: sid,
      message: 'hi',
      agentMode: 'plan_execute'
    })
    await vi.waitFor(() => expect(kernel.createAgentConfigs.length).toBe(1))

    const { resume_stream } = await import('@pioneering/modu-agent')
    vi.mocked(resume_stream).mockClear()
    kernel.resumeEvents = [agui({ type: 'RUN_FINISHED' })]
    startResume(makeSender(), 'rp2', { sessionId: sid, approved: true })

    await vi.waitFor(() => expect(vi.mocked(resume_stream).mock.calls.length).toBe(1))
    const call = vi.mocked(resume_stream).mock.calls[0]!
    expect(call[0]).toEqual({ fake: 'plan-graph' })
    expect(call[1]).toBe(sid)
    expect(call[5]).toMatchObject({
      extraConfigurable: { plan_execute_enabled: true }
    })
  })

  it('默认会话：resume 走 get_runner 缓存图且不带 plan_execute_enabled', async () => {
    const sid = 'react-resume-sess'
    kernel.streamEvents = [agui({ type: 'RUN_FINISHED' })]
    startSend(makeSender(), 'rr1', { sessionId: sid, message: 'hi' })
    await vi.waitFor(() => expect(kernel.getRunnerCalls).toBe(1))

    const { resume_stream } = await import('@pioneering/modu-agent')
    vi.mocked(resume_stream).mockClear()
    kernel.resumeEvents = [agui({ type: 'RUN_FINISHED' })]
    startResume(makeSender(), 'rr2', { sessionId: sid, approved: true })

    await vi.waitFor(() => expect(vi.mocked(resume_stream).mock.calls.length).toBe(1))
    const call = vi.mocked(resume_stream).mock.calls[0]!
    expect(call[0]).toEqual({ fake: 'react-graph' })
    expect(call[5]?.extraConfigurable ?? null).toBeNull()
  })

  it('plan_execute 会话：abortPending 在 plan 图上 resume_sync 并透传 configurable', async () => {
    const sid = 'plan-abort-sess'
    kernel.streamEvents = [agui({ type: 'RUN_PAUSED' })]
    startSend(makeSender(), 'ra1', {
      sessionId: sid,
      message: 'hi',
      agentMode: 'plan_execute'
    })
    await vi.waitFor(() => expect(kernel.createAgentConfigs.length).toBe(1))

    kernel.interruptState = { session_id: sid, user_id: 'local_user' }
    const { resume_sync } = await import('@pioneering/modu-agent')
    vi.mocked(resume_sync).mockClear()
    const r = await abortPending(sid, 'user_cancel')
    expect(r.aborted).toBe(true)
    expect(vi.mocked(resume_sync).mock.calls.length).toBe(1)
    const call = vi.mocked(resume_sync).mock.calls[0]!
    expect(call[0]).toEqual({ fake: 'plan-graph' })
    expect(call[1]).toBe(sid)
    expect(call[5]).toEqual({ extraConfigurable: { plan_execute_enabled: true } })
  })

  it('图缓存失效后：会话 plan 图映射一并清空，resume 回退默认缓存图', async () => {
    const sid = 'plan-invalidate-sess'
    kernel.streamEvents = [agui({ type: 'RUN_PAUSED' })]
    startSend(makeSender(), 'ri1', {
      sessionId: sid,
      message: 'hi',
      agentMode: 'plan_execute'
    })
    await vi.waitFor(() => expect(kernel.createAgentConfigs.length).toBe(1))

    invalidateAgentGraphCache()

    const { resume_stream } = await import('@pioneering/modu-agent')
    vi.mocked(resume_stream).mockClear()
    kernel.resumeEvents = [agui({ type: 'RUN_FINISHED' })]
    startResume(makeSender(), 'ri2', { sessionId: sid, approved: true })
    await vi.waitFor(() => expect(vi.mocked(resume_stream).mock.calls.length).toBe(1))
    const call = vi.mocked(resume_stream).mock.calls[0]!
    expect(call[0]).toEqual({ fake: 'react-graph' })
  })

  it('流异常 → 推送 RUN_ERROR 事件后收敛', async () => {
    // 让 stream_response 在迭代时抛错：放入一条事件后由 adapter 之后的循环抛错不可行，
    // 改为直接替换实现——这里利用 kernel 状态构造"抛错的 generator"
    const { stream_response } = await import('@pioneering/modu-agent')
    const mocked = vi.mocked(stream_response)
    mocked.mockReturnValueOnce(
      (async function* () {
        yield agui({ type: 'RUN_STARTED' })
        throw new Error('boom')
        // eslint-disable-next-line no-unreachable
      })() as never
    )
    const sender = makeSender()
    expect(startSend(sender, 'r6', { sessionId: 's1', message: 'hi' }).ok).toBe(true)

    await vi.waitFor(() => expect(sender.events.length).toBe(2))
    const errEvent = sender.events[1]!.envelope.event as { type: string; message: string }
    expect(errEvent.type).toBe('RUN_ERROR')
    expect(errEvent.message).toContain('boom')
  })
})

// ---- stopRun / abortRunsForSender ----

describe('stopRun / abortRunsForSender', () => {
  it('stopRun 中止该会话的进行中 run', () => {
    startSend(makeSender(), 'r5', { sessionId: 's1', message: 'hi' })
    expect(stopRun('s1')).toEqual({ message: 'stopped', aborted: true })
  })

  it('无匹配会话时 aborted:false', () => {
    expect(stopRun('nope')).toEqual({ message: 'stopped', aborted: false })
  })

  it('abortRunsForSender 对无在途 run 的 sender 不抛错', () => {
    expect(() => abortRunsForSender(makeSender())).not.toThrow()
  })
})

// ---- getHitlState / abortPending ----

describe('getHitlState / abortPending', () => {
  it('无暂停项 → pending:false', async () => {
    const st = await getHitlState('s1')
    expect(st).toEqual({ session_id: 's1', pending: false })
  })

  it('暂停项归一化：kind / question / options / created_at 透传', async () => {
    kernel.interruptState = {
      session_id: 's1',
      kind: 'clarifying',
      question: '你要哪种方案？',
      options: [{ id: 'a', label: '方案 A' }],
      next_nodes: ['clarify'],
      pending_tool_calls: [],
      tool_requires_approval: false,
      trace_id: 't1',
      user_id: 'local_user',
      created_at: 123
    }
    const st = await getHitlState('s1')
    expect(st.pending).toBe(true)
    expect(st.kind).toBe('clarifying')
    expect(st.question).toBe('你要哪种方案？')
    expect(st.options).toEqual([{ id: 'a', label: '方案 A' }])
    expect(st.created_at).toBe(123)
  })

  it('归属他人（user_id 不匹配）→ pending:false（IDOR 兜底）', async () => {
    kernel.interruptState = { session_id: 's1', user_id: 'someone_else', kind: 'tool_confirm' }
    expect((await getHitlState('s1')).pending).toBe(false)
  })

  // T2：plan_confirm 的 artifacts 必须随状态查询透传（恢复时用于构造产物文件列表）
  it('T2：plan_confirm 的 artifacts 原样透传', async () => {
    const artifacts = [
      { name: 'spec.md', path: '/out/spec.md', mediaType: 'text/markdown', size: 128 },
      { name: 'tasks.md', path: '/out/tasks.md', mediaType: 'text/markdown', size: 64 }
    ]
    kernel.interruptState = {
      session_id: 's1',
      user_id: 'local_user',
      kind: 'plan_confirm',
      question: '是否按方案执行？',
      artifacts
    }
    const st = await getHitlState('s1')
    expect(st.pending).toBe(true)
    expect(st.kind).toBe('plan_confirm')
    expect(st.artifacts).toEqual(artifacts)
  })

  it('T2：无 artifacts 字段时缺省为 undefined（不污染其他类型）', async () => {
    kernel.interruptState = {
      session_id: 's1',
      user_id: 'local_user',
      kind: 'tool_confirm'
    }
    const st = await getHitlState('s1')
    expect(st.artifacts).toBeUndefined()
  })

  it('abortPending：无暂停项 → no_pending_interrupt', async () => {
    const r = await abortPending('s1', 'user_cancel')
    expect(r).toEqual({ message: 'no_pending_interrupt', aborted: false })
  })

  it('abortPending：有暂停项 → resume_sync 拒绝并回传 aborted', async () => {
    kernel.interruptState = { session_id: 's1', user_id: 'local_user' }
    const r = await abortPending('s1', 'user_cancel')
    expect(r).toEqual({ message: 'aborted', aborted: true })
  })

  it('abortPending：resume_sync 报错 → 回传 abort_failed 与错误码', async () => {
    kernel.interruptState = { session_id: 's1', user_id: 'local_user' }
    kernel.resumeSyncResult = { status: 'error', error_code: 'INTERRUPT_GONE' }
    const r = await abortPending('s1', 'timeout')
    expect(r.message).toBe('abort_failed')
    expect(r.aborted).toBe(false)
    expect(r.error).toBe('INTERRUPT_GONE')
  })
})

// ---- invalidateAgentGraphCache ----

describe('invalidateAgentGraphCache', () => {
  it('委托内核 reset_runner_cache（密钥变更后主动失效图缓存）', () => {
    invalidateAgentGraphCache()
    expect(kernel.resetCalls).toBe(1)
  })
})

// ---- ensureAgentEnv ----

describe('ensureAgentEnv', () => {
  it('依次尝试候选文件：读取失败跳过、仅填未设置变量、剥离成对引号', () => {
    process.env['TEST_AGENT_RUNTIME_EXISTING'] = 'keep-me'
    ensureAgentEnv(['/definitely/missing.env', '/virtual/found.env'], (p) => {
      if (p === '/virtual/found.env') {
        return [
          '# comment',
          'TEST_AGENT_RUNTIME_EXISTING=overwrite-attempt',
          'TEST_AGENT_RUNTIME_NEW="quoted-value"',
          ''
        ].join('\n')
      }
      throw new Error('ENOENT')
    })

    expect(process.env['TEST_AGENT_RUNTIME_EXISTING']).toBe('keep-me')
    expect(process.env['TEST_AGENT_RUNTIME_NEW']).toBe('quoted-value')

    delete process.env['TEST_AGENT_RUNTIME_EXISTING']
    delete process.env['TEST_AGENT_RUNTIME_NEW']
  })
})
