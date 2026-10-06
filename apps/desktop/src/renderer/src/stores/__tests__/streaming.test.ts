import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Message } from '@shared/types'
import type { AgentTransport } from '@renderer/services/transport'
import { setAgentTransport } from '@renderer/services/transport'
import { chatService } from '@renderer/services/api/chat'
import type { ChatState } from '@renderer/stores/chatStore'
import { emptyStreaming, finalizeStreamingMessage, useChatStore } from '@renderer/stores/chatStore'

// 构造最小可用的 ChatState（仅含纯函数读取的字段，其余用类型断言绕过）
function makeState(partial: Partial<ChatState> = {}): ChatState {
  return {
    sessions: [],
    sessionsLoading: false,
    currentSessionId: null,
    messages: {},
    messagesLoading: false,
    messagesNextCursor: {},
    messagesHasMore: {},
    streamingContent: 'live-content',
    streamingThinking: 'live-thinking',
    streamingToolCalls: [],
    streamingTraceNodes: {},
    streamingTraceRootOrder: [],
    streamingMessageId: 'm1',
    isStreaming: true,
    abortController: new AbortController(),
    agentMode: false,
    error: null,
    ...partial
  } as unknown as ChatState
}

const baseMsg: Message = {
  id: 'm1',
  sessionId: 's1',
  role: 'assistant',
  content: 'old',
  timestamp: 0
} as Message

describe('emptyStreaming', () => {
  it('将所有流式字段归零', () => {
    const next = emptyStreaming()
    expect(next.streamingContent).toBe('')
    expect(next.streamingThinking).toBe('')
    expect(next.streamingToolCalls).toEqual([])
    expect(next.streamingTraceNodes).toEqual({})
    expect(next.streamingTraceRootOrder).toEqual([])
    expect(next.streamingMessageId).toBeNull()
    expect(next.isStreaming).toBe(false)
    expect(next.abortController).toBeNull()
  })
})

describe('finalizeStreamingMessage', () => {
  it('命中目标消息：浅合并 patch 并清空流式状态', () => {
    const state = makeState({ messages: { s1: [baseMsg] } })
    const next = finalizeStreamingMessage(state, 's1', 'm1', {
      content: 'final',
      toolCalls: [{ id: 't1', name: 'search', status: 'completed', arguments: {} }]
    })

    // 流式字段已清空
    expect(next.isStreaming).toBe(false)
    expect(next.streamingContent).toBe('')
    expect(next.streamingMessageId).toBeNull()

    // 消息被 patch 覆盖（保留 prev 其余字段）
    const updated = (next.messages!['s1'] as Message[])[0]!
    expect(updated.id).toBe('m1')
    expect(updated.sessionId).toBe('s1')
    expect(updated.content).toBe('final')
    expect(updated.toolCalls).toEqual([{ id: 't1', name: 'search', status: 'completed', arguments: {} }])
    // 未 patch 的字段保留原值
    expect(updated.timestamp).toBe(0)
  })

  it('未命中目标消息（已删除）：仅清空流式状态，不修改 messages', () => {
    const state = makeState({ messages: { s1: [baseMsg] } })
    const next = finalizeStreamingMessage(state, 's1', 'not-exist', { content: 'x' })

    expect(next.isStreaming).toBe(false)
    expect(next.streamingMessageId).toBeNull()
    // messages 不变（仍为原数组引用，未生成新消息）
    expect(next.messages).toBeUndefined()
  })

  it('patch 浅合并：仅覆盖传入字段，保留 prev 其余属性', () => {
    const withThinking: Message = {
      ...baseMsg,
      thinking: { content: 'prev-think' }
    } as Message
    const state = makeState({ messages: { s1: [withThinking] } })
    const next = finalizeStreamingMessage(state, 's1', 'm1', { content: 'new' })

    const updated = (next.messages!['s1'] as Message[])[0]!
    expect(updated.content).toBe('new')
    expect(updated.thinking).toEqual({ content: 'prev-think' })
  })
})

describe('onError 错误内容构造契约（回归锚点）', () => {
  // 复刻 chatStore onError 闭包中的 content 计算：
  //   baseContent ? `${baseContent}\n\n[Error] ${error}` : `[Error] ${error}`
  const buildErrorContent = (baseContent: string | undefined, error: string) =>
    baseContent ? `${baseContent}\n\n[Error] ${error}` : `[Error] ${error}`

  it('有正文时追加 \n\n[Error] 前缀', () => {
    expect(buildErrorContent('回答了一半', '超时')).toBe('回答了一半\n\n[Error] 超时')
  })

  it('无正文时仅 [Error] 前缀', () => {
    expect(buildErrorContent(undefined, '网络错误')).toBe('[Error] 网络错误')
    expect(buildErrorContent('', '网络错误')).toBe('[Error] 网络错误')
  })
})

// ============================================================
// T1：流式中抢占发送必须终止旧 run（不能只做渲染端退订）
// 对应修复任务清单 T1 / 报告 §3.1-11：IPC 模式下 abortController.abort()
// 只是渲染端退订，旧 run 在主进程继续跑到自然结束，成为烧 token 的孤儿 run。
// ============================================================
describe('sendMessage 抢占发送（T1）', () => {
  const stopSpy = vi.fn()
  let sendStreamSpy: ReturnType<typeof vi.spyOn>
  let stopGenerationSpy: ReturnType<typeof vi.spyOn>

  function makeTransport(overrides: Partial<AgentTransport> = {}): AgentTransport {
    stopSpy.mockResolvedValue({ message: 'stopped', aborted: true })
    return {
      kind: 'http',
      sendMessage: vi.fn(() => new AbortController()),
      resume: vi.fn(() => new AbortController()),
      abort: vi.fn(async () => ({ message: 'aborted', aborted: true })),
      getState: vi.fn(async () => ({ session_id: 's1', pending: false })),
      stop: stopSpy,
      ...overrides
    } as unknown as AgentTransport
  }

  function seedStore(sessionOverrides: { agentMode?: string; runtime?: 'local' | 'cloud' }, globalAgentMode = false) {
    useChatStore.setState({
      sessions: [
        {
          id: 's1',
          title: '进行中的会话',
          isArchived: false,
          createdAt: '',
          updatedAt: '',
          messageCount: 1,
          ...sessionOverrides
        }
      ],
      currentSessionId: 's1',
      isDraftNewSession: false,
      messages: {
        s1: [
          { id: 'u1', sessionId: 's1', role: 'user', content: '第一条', timestamp: 1 } as Message,
          { id: 'a1', sessionId: 's1', role: 'assistant', content: '', timestamp: 2 } as Message
        ]
      },
      streamingContent: '',
      streamingThinking: '',
      streamingToolCalls: [],
      streamingTraceNodes: {},
      streamingTraceRootOrder: [],
      streamingAttachments: [],
      streamingMessageId: 'a1',
      isStreaming: true,
      abortController: new AbortController(),
      hitlPending: null,
      hitlPausedSessionId: null,
      hitlPausedMessageId: null,
      agentMode: globalAgentMode,
      error: null
    } as Partial<ChatState>)
  }

  beforeEach(() => {
    stopSpy.mockClear()
    setAgentTransport(makeTransport())
    // 普通聊天通道打桩，避免真实 SSE 网络请求
    sendStreamSpy = vi
      .spyOn(chatService, 'sendMessageStream')
      .mockImplementation(() => new AbortController())
    stopGenerationSpy = vi
      .spyOn(chatService, 'stopGeneration')
      .mockImplementation(() => Promise.resolve())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Agent 会话抢占：调用 transport.stop(sid) 终止旧 run', async () => {
    seedStore({ agentMode: 'react_agent' })
    await useChatStore.getState().sendMessage('第二条消息')
    expect(stopSpy).toHaveBeenCalledTimes(1)
    expect(stopSpy).toHaveBeenCalledWith('s1')
    expect(stopGenerationSpy).not.toHaveBeenCalled()
  })

  it('全局 Agent 模式开启时，普通会话抢占也走 transport.stop', async () => {
    seedStore({}, true)
    await useChatStore.getState().sendMessage('第二条消息')
    expect(stopSpy).toHaveBeenCalledWith('s1')
  })

  it('普通聊天会话抢占：走 chatService.stopGeneration（不打 Agent stop）', async () => {
    seedStore({})
    await useChatStore.getState().sendMessage('第二条消息')
    expect(stopGenerationSpy).toHaveBeenCalledTimes(1)
    expect(stopGenerationSpy).toHaveBeenCalledWith('s1')
    expect(stopSpy).not.toHaveBeenCalled()
    expect(sendStreamSpy).toHaveBeenCalled()
  })

  it('T6：model=Auto 归一化为不下发 model 字段', async () => {
    seedStore({})
    sendStreamSpy.mockImplementation(() => new AbortController())
    sendStreamSpy.mockClear()
    await useChatStore.getState().sendMessage('走默认模型', { model: 'Auto' })
    const req = sendStreamSpy.mock.calls[0]?.[0] as { model?: string } | undefined
    expect(req).toBeDefined()
    expect(req!.model).toBeUndefined()
  })

  it('T6：显式模型名正常透传', async () => {
    seedStore({ agentMode: 'react_agent' })
    // Agent 通道：直接捕获 transport.sendMessage 入参
    const captured: Array<{ model?: string }> = []
    const t2 = makeTransport({
      sendMessage: ((req: { model?: string }) => {
        captured.push({ model: req.model })
        return new AbortController()
      }) as AgentTransport['sendMessage']
    })
    setAgentTransport(t2)
    await useChatStore.getState().sendMessage('指定模型', { model: 'deepseek-v4-flash' })
    expect(captured).toHaveLength(1)
    expect(captured[0]!.model).toBe('deepseek-v4-flash')
  })

  it('无在途流（abortController 为空）时不触发任何停止调用', async () => {
    seedStore({ agentMode: 'react_agent' })
    useChatStore.setState({ abortController: null, isStreaming: false } as Partial<ChatState>)
    await useChatStore.getState().sendMessage('新消息')
    expect(stopSpy).not.toHaveBeenCalled()
    expect(stopGenerationSpy).not.toHaveBeenCalled()
  })

  // ============================================================
  // ③：错误终态（含 60s idle 超时）必须联动终止底层 run。
  // 原实现 onError 只 finalize UI 并把 abortController 置 null，不调
  // abort/stop——IPC 主进程孤儿 run 继续烧 token，之后抢占也清理不到。
  // ============================================================
  it('③ onError 终态联动 transport.stop + abort（idle 超时不留孤儿 run）', async () => {
    seedStore({ agentMode: 'react_agent' })
    // 起点无在途流，避免抢占分支的 stop 干扰计数；终止所需的 controller
    // 由本次 sendMessage 启动后写入 store
    useChatStore.setState({ abortController: null } as Partial<ChatState>)

    let startedController: AbortController | null = null
    const errorTransport = makeTransport({
      sendMessage: ((_req: unknown, cb: { onError: (msg: string) => void }) => {
        startedController = new AbortController()
        // 模拟 RUN_ERROR / idle 超时终态：IPC/SSE 事件在真实链路中均异步
        // 到达（此时 controller 已写入 store，终止逻辑才能取到并 abort）
        queueMicrotask(() => cb.onError('Stream idle timeout (60s without data)'))
        return startedController
      }) as AgentTransport['sendMessage']
    })
    setAgentTransport(errorTransport)

    const sendPromise = useChatStore.getState().sendMessage('触发超时的问题')
    // 错误终态经微任务到达：停止联动与 UI 收尾均发生在 controller 注册之后
    await vi.waitFor(() => expect(stopSpy).toHaveBeenCalledTimes(1))
    await sendPromise

    // 底层 run 被通知停止（按会话 id），渲染端 controller 被 abort
    expect(stopSpy).toHaveBeenCalledWith('s1')
    expect((startedController as AbortController | null)?.signal.aborted).toBe(true)
    // UI 已收尾：无在途 controller、错误可见（证明终态路径本身未被破坏）
    expect(useChatStore.getState().abortController).toBeNull()
    expect(useChatStore.getState().error).toContain('idle timeout')
  })

  it('③ 普通聊天会话 onError 终态走 chatService.stopGeneration', async () => {
    seedStore({})
    useChatStore.setState({ abortController: null } as Partial<ChatState>)
    sendStreamSpy.mockImplementation(((_req: unknown, cb: { onError: (msg: string) => void }) => {
      queueMicrotask(() => cb.onError('Stream idle timeout (60s without data)'))
      return new AbortController()
    }) as unknown as typeof chatService.sendMessageStream)

    const sendPromise = useChatStore.getState().sendMessage('普通聊天超时')
    await vi.waitFor(() => expect(stopGenerationSpy).toHaveBeenCalledTimes(1))
    await sendPromise

    expect(stopGenerationSpy).toHaveBeenCalledWith('s1')
    expect(stopSpy).not.toHaveBeenCalled()
  })
})
