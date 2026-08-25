// ============================================================
// Transport 层单测（云边双模阶段 0）
// 验证：
//   1. provider 默认返回 HttpTransport（kind='http'）
//   2. setAgentTransport 可切换通道
//   3. HttpTransport 四方法是对 agentService 的纯委托
//      （同参数、同返回值——行为零变化的构造性保证）
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AguiStreamCallbacks } from '../../api/agui'

// mock agentService：HttpTransport 应把调用原样转发到这里
// vi.hoisted：vi.mock 工厂被提升到文件顶部，其引用的变量必须同样提升
const {
  sendMessageStreamMock,
  resumeStreamMock,
  abortHitlMock,
  getHitlStateMock,
  stopGenerationMock
} = vi.hoisted(() => ({
  sendMessageStreamMock: vi.fn(() => new AbortController()),
  resumeStreamMock: vi.fn(() => new AbortController()),
  abortHitlMock: vi.fn(async () => ({ message: 'ok', aborted: true })),
  getHitlStateMock: vi.fn(async () => ({
    session_id: 's1',
    pending: false
  })),
  stopGenerationMock: vi.fn(async () => undefined)
}))

vi.mock('../../api/agent', () => ({
  agentService: {
    sendMessageStream: sendMessageStreamMock,
    resumeStream: resumeStreamMock,
    abortHitl: abortHitlMock,
    getHitlState: getHitlStateMock,
    stopGeneration: stopGenerationMock
  }
}))

// provider 需要在 mock 生效后导入
import { httpTransport } from '../http-transport'
import { getAgentTransport, setAgentTransport } from '../index'
import type { AgentTransport } from '../types'

const dummyCallbacks: AguiStreamCallbacks = {
  onChunk: () => {},
  onDone: () => {},
  onError: () => {}
}

describe('TransportProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // 每个用例前重置为默认 http 通道，避免用例间泄漏
    setAgentTransport(httpTransport)
  })

  it('默认返回 HttpTransport（阶段 0：恒为 http，行为零变化）', () => {
    const t = getAgentTransport()
    expect(t.kind).toBe('http')
    expect(t).toBe(httpTransport)
  })

  it('setAgentTransport 可切换通道（阶段 1 的特性开关依赖此能力）', () => {
    const fake: AgentTransport = {
      kind: 'ipc',
      sendMessage: () => new AbortController(),
      resume: () => new AbortController(),
      abort: async () => ({ message: '', aborted: false }),
      getState: async () => ({ session_id: '', pending: false }),
      stop: async () => ({ message: '', aborted: false })
    }
    setAgentTransport(fake)
    expect(getAgentTransport()).toBe(fake)
    expect(getAgentTransport().kind).toBe('ipc')
  })
})

describe('HttpTransport 委托语义', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sendMessage 原样委托 agentService.sendMessageStream', () => {
    const request = { sessionId: 's1', message: 'hello', stream: true }
    const ret = httpTransport.sendMessage(request, dummyCallbacks)
    expect(sendMessageStreamMock).toHaveBeenCalledTimes(1)
    expect(sendMessageStreamMock).toHaveBeenCalledWith(request, dummyCallbacks)
    expect(ret).toBeInstanceOf(AbortController)
  })

  it('resume 原样委托 agentService.resumeStream', () => {
    const request = { sessionId: 's1', approved: true }
    const ret = httpTransport.resume(request, dummyCallbacks)
    expect(resumeStreamMock).toHaveBeenCalledTimes(1)
    expect(resumeStreamMock).toHaveBeenCalledWith(request, dummyCallbacks)
    expect(ret).toBeInstanceOf(AbortController)
  })

  it('abort 委托 agentService.abortHitl，reason 缺省 user_cancel', async () => {
    const ret = await httpTransport.abort('s1')
    expect(abortHitlMock).toHaveBeenCalledTimes(1)
    expect(abortHitlMock).toHaveBeenCalledWith('s1', 'user_cancel')
    expect(ret).toEqual({ message: 'ok', aborted: true })

    await httpTransport.abort('s1', 'timeout')
    expect(abortHitlMock).toHaveBeenLastCalledWith('s1', 'timeout')
  })

  it('getState 原样委托 agentService.getHitlState', async () => {
    const ret = await httpTransport.getState('s1')
    expect(getHitlStateMock).toHaveBeenCalledTimes(1)
    expect(getHitlStateMock).toHaveBeenCalledWith('s1')
    expect(ret).toEqual({ session_id: 's1', pending: false })
  })

  it('stop 委托 agentService.stopGeneration（阶段 1 新增）', async () => {
    const ret = await httpTransport.stop('s1')
    expect(stopGenerationMock).toHaveBeenCalledTimes(1)
    expect(stopGenerationMock).toHaveBeenCalledWith('s1')
    expect(ret).toEqual({ message: 'stopped', aborted: true })
  })
})
