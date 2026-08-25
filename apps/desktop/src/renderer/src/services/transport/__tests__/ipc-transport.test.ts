// ============================================================
// IpcTransport 单测（云边双模阶段 1-5）
// 验证：
//   1. send/resume：invoke 立即受理，事件经 AGENT_EVENT 按 runId 路由分发
//   2. 终态事件（RUN_FINISHED / RUN_PAUSED）后自动退订，后续事件忽略
//   3. 其他 runId 的事件被过滤
//   4. invoke 失败（ok:false / reject）→ onError
//   5. AbortController.abort() 静默退订（对齐 HTTP 模式：不触发 onDone/onError）
//   6. abort / getState / stop 委托语义
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AgentEventEnvelope } from '@shared/ipc-channels'
import type { AguiStreamCallbacks } from '../../api/agui'
import { ipcTransport } from '../ipc-transport'

/** preload agent API 的可测 mock：捕获 onEvent 订阅，供用例主动推送事件 */
function makeAgentApiMock() {
  const listeners: Array<(envelope: AgentEventEnvelope) => void> = []
  const sendMock = vi.fn(
    async (_runId: string, _request: unknown): Promise<{ ok: boolean; error?: string }> => ({ ok: true })
  )
  const resumeMock = vi.fn(
    async (_runId: string, _request: unknown): Promise<{ ok: boolean; error?: string }> => ({ ok: true })
  )
  const abortMock = vi.fn(
    async (
      _sessionId: string,
      _reason?: string
    ): Promise<{ message: string; aborted: boolean; error?: string }> => ({
      message: 'aborted',
      aborted: true
    })
  )
  const stateMock = vi.fn(async (_threadId: string) => ({ session_id: 's1', pending: false }))
  const stopMock = vi.fn(
    async (_sessionId: string): Promise<{ message: string; aborted: boolean }> => ({
      message: 'stopped',
      aborted: true
    })
  )
  return {
    sendMock,
    resumeMock,
    abortMock,
    stateMock,
    stopMock,
    api: {
      send: sendMock,
      resume: resumeMock,
      abort: abortMock,
      state: stateMock,
      stop: stopMock,
      onEvent: (cb: (envelope: AgentEventEnvelope) => void): (() => void) => {
        listeners.push(cb)
        return () => {
          const i = listeners.indexOf(cb)
          if (i >= 0) listeners.splice(i, 1)
        }
      }
    },
    /** 模拟主进程推送一条事件 */
    emit: (envelope: AgentEventEnvelope) => {
      for (const l of [...listeners]) l(envelope)
    },
    /** 当前订阅数（验证退订） */
    listenerCount: () => listeners.length
  }
}

type AgentApiMock = ReturnType<typeof makeAgentApiMock>

/** node 测试环境无 window：注入最小全局（ipc-transport 惰性读取 window.api.agent） */
function installWindowApi(mock: AgentApiMock): void {
  ;(globalThis as { window?: unknown }).window = { api: { agent: mock.api } }
}

function makeCallbacks(): AguiStreamCallbacks & {
  chunks: string[]
  done: unknown[]
  errors: string[]
  paused: unknown[]
} {
  const chunks: string[] = []
  const done: unknown[] = []
  const errors: string[] = []
  const paused: unknown[] = []
  return {
    chunks,
    done,
    errors,
    paused,
    onChunk: (d) => chunks.push(d),
    onDone: (meta) => done.push(meta),
    onError: (e) => errors.push(e),
    onRunPaused: (p) => paused.push(p)
  }
}

describe('IpcTransport 流式语义', () => {
  let mock: AgentApiMock

  beforeEach(() => {
    vi.clearAllMocks()
    mock = makeAgentApiMock()
    installWindowApi(mock)
  })

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('send：invoke 带 runId 受理，事件按 runId 路由分发到回调', async () => {
    const cb = makeCallbacks()
    const controller = ipcTransport.sendMessage(
      { sessionId: 's1', message: 'hello' },
      cb
    )
    expect(controller).toBeInstanceOf(AbortController)
    await Promise.resolve() // 等 invoke 的 then 链（受理成功不触发回调）

    const runId = mock.sendMock.mock.calls[0]![0] as string
    expect(mock.sendMock).toHaveBeenCalledTimes(1)
    expect(runId).toMatch(/^send-/)

    mock.emit({ runId, seq: 0, event: { type: 'RUN_STARTED', threadId: 's1' } })
    mock.emit({ runId, seq: 1, event: { type: 'TEXT_MESSAGE_CONTENT', delta: '你好' } })
    expect(cb.chunks).toEqual(['你好'])
    expect(cb.errors).toEqual([])
  })

  it('其他 runId 的事件被过滤（多 run 并发互不串流）', async () => {
    const cb = makeCallbacks()
    ipcTransport.sendMessage({ sessionId: 's1', message: 'hi' }, cb)
    await Promise.resolve()
    const runId = mock.sendMock.mock.calls[0]![0] as string

    mock.emit({ runId: 'other-run', seq: 0, event: { type: 'TEXT_MESSAGE_CONTENT', delta: 'X' } })
    expect(cb.chunks).toEqual([])

    mock.emit({ runId, seq: 0, event: { type: 'TEXT_MESSAGE_CONTENT', delta: 'Y' } })
    expect(cb.chunks).toEqual(['Y'])
  })

  it('RUN_FINISHED 终态：触发 onDone 并自动退订，后续事件忽略', async () => {
    const cb = makeCallbacks()
    ipcTransport.sendMessage({ sessionId: 's1', message: 'hi' }, cb)
    await Promise.resolve()
    const runId = mock.sendMock.mock.calls[0]![0] as string
    const before = mock.listenerCount()

    mock.emit({ runId, seq: 0, event: { type: 'RUN_STARTED', threadId: 's1' } })
    mock.emit({ runId, seq: 1, event: { type: 'RUN_FINISHED' } })
    expect(cb.done).toHaveLength(1)
    expect(mock.listenerCount()).toBe(before - 1)

    mock.emit({ runId, seq: 2, event: { type: 'TEXT_MESSAGE_CONTENT', delta: 'late' } })
    expect(cb.chunks).toEqual([])
  })

  it('RUN_PAUSED 终态：触发 onRunPaused（不触发 onDone）并自动退订', async () => {
    const cb = makeCallbacks()
    ipcTransport.sendMessage({ sessionId: 's1', message: 'hi' }, cb)
    await Promise.resolve()
    const runId = mock.sendMock.mock.calls[0]![0] as string

    mock.emit({ runId, seq: 0, event: { type: 'RUN_PAUSED', threadId: 's1', runId } })
    expect(cb.paused).toHaveLength(1)
    expect(cb.done).toHaveLength(0)
    expect(mock.listenerCount()).toBe(0)
  })

  it('resume：走 AGENT_RESUME 通道，返回独立 runId 的事件流', async () => {
    const cb = makeCallbacks()
    ipcTransport.resume({ sessionId: 's1', approved: true }, cb)
    await Promise.resolve()
    expect(mock.resumeMock).toHaveBeenCalledTimes(1)
    expect(mock.sendMock).not.toHaveBeenCalled()
    const runId = mock.resumeMock.mock.calls[0]![0] as string
    expect(runId).toMatch(/^resume-/)

    mock.emit({ runId, seq: 0, event: { type: 'TEXT_MESSAGE_CONTENT', delta: '续写' } })
    expect(cb.chunks).toEqual(['续写'])
  })

  it('invoke 返回 ok:false → onError 携带错误信息', async () => {
    mock.sendMock.mockResolvedValue({ ok: false, error: 'sessionId is required' })
    const cb = makeCallbacks()
    ipcTransport.sendMessage({ message: 'hi' }, cb)
    await Promise.resolve()
    await Promise.resolve()
    expect(cb.errors).toEqual(['sessionId is required'])
    expect(mock.listenerCount()).toBe(0)
  })

  it('invoke reject → onError', async () => {
    mock.sendMock.mockRejectedValue(new Error('boom'))
    const cb = makeCallbacks()
    ipcTransport.sendMessage({ sessionId: 's1', message: 'hi' }, cb)
    await Promise.resolve()
    await Promise.resolve()
    expect(cb.errors).toEqual(['Error: boom'])
  })

  it('abort() 静默退订：不触发 onDone/onError（对齐 HTTP 模式 abort 语义）', async () => {
    const cb = makeCallbacks()
    const controller = ipcTransport.sendMessage({ sessionId: 's1', message: 'hi' }, cb)
    await Promise.resolve()
    expect(mock.listenerCount()).toBe(1)

    controller.abort()
    expect(mock.listenerCount()).toBe(0)

    mock.emit({ runId: 'whatever', seq: 0, event: { type: 'RUN_FINISHED' } })
    expect(cb.done).toHaveLength(0)
    expect(cb.errors).toHaveLength(0)
  })

  it('preload agent API 不可用 → onError 且不订阅', () => {
    ;(globalThis as { window?: unknown }).window = { api: {} }
    const cb = makeCallbacks()
    ipcTransport.sendMessage({ sessionId: 's1', message: 'hi' }, cb)
    expect(cb.errors).toHaveLength(1)
    expect(mock.listenerCount()).toBe(0)
  })
})

describe('IpcTransport 非流式委托语义', () => {
  let mock: AgentApiMock

  beforeEach(() => {
    vi.clearAllMocks()
    mock = makeAgentApiMock()
    installWindowApi(mock)
  })

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('abort 委托 agent.abort，reason 缺省 user_cancel', async () => {
    const ret = await ipcTransport.abort('s1')
    expect(mock.abortMock).toHaveBeenCalledWith('s1', 'user_cancel')
    expect(ret).toEqual({ message: 'aborted', aborted: true })

    await ipcTransport.abort('s1', 'timeout')
    expect(mock.abortMock).toHaveBeenLastCalledWith('s1', 'timeout')
  })

  it('abort 返回 error → 抛异常（对齐 HttpTransport 失败语义）', async () => {
    mock.abortMock.mockResolvedValue({ message: 'abort_failed', aborted: false, error: 'E1' })
    await expect(ipcTransport.abort('s1')).rejects.toThrow('E1')
  })

  it('getState 委托 agent.state', async () => {
    const ret = await ipcTransport.getState('s1')
    expect(mock.stateMock).toHaveBeenCalledWith('s1')
    expect(ret).toEqual({ session_id: 's1', pending: false })
  })

  it('stop 委托 agent.stop', async () => {
    const ret = await ipcTransport.stop('s1')
    expect(mock.stopMock).toHaveBeenCalledWith('s1')
    expect(ret).toEqual({ message: 'stopped', aborted: true })
  })
})
