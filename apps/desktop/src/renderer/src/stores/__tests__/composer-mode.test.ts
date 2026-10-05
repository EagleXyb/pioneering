// T10 回归测试：Composer 计划模式 → 新建会话 agentMode='plan_execute'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { AgentTransport } from '@renderer/services/transport'
import { setAgentTransport } from '@renderer/services/transport'
import type { ChatState } from '@renderer/stores/chatStore'
import { useChatStore } from '@renderer/stores/chatStore'
// 与真实应用一致：hitlStore 模块求值时自注册到 hitl-bridge（selectSession 等会经桥调用）
import '@renderer/stores/hitlStore'

// 云端 Agent 会话创建打桩（local 通道在 node 环境不可用，走云端分支即可覆盖模式解析）
const createAgentSession = vi.fn()

vi.mock('@renderer/services/api/agent', () => ({
  agentService: {
    createSession: (...args: unknown[]) => createAgentSession(...args)
  }
}))

vi.mock('@renderer/services/api/chat', () => ({
  chatService: {
    createSession: vi.fn(),
    stopGeneration: vi.fn(),
    getSessions: vi.fn(),
    sendFeedback: vi.fn(),
    deleteSession: vi.fn(),
    shareSession: vi.fn()
  }
}))

function fakeTransport(captured: Array<{ agentMode?: string; model?: string }>): AgentTransport {
  return {
    kind: 'http',
    sendMessage: (req) => {
      captured.push({ agentMode: req.agentMode, model: req.model })
      return new AbortController()
    },
    resume: () => new AbortController(),
    abort: async () => ({ message: 'aborted', aborted: true }),
    getState: async () => ({ session_id: 's1', pending: false }),
    stop: async () => ({ message: 'stopped', aborted: true })
  } as AgentTransport
}

function resetStore() {
  useChatStore.setState({
    sessions: [],
    currentSessionId: null,
    isDraftNewSession: false,
    messages: {},
    streamingContent: '',
    streamingThinking: '',
    streamingToolCalls: [],
    streamingTraceNodes: {},
    streamingTraceRootOrder: [],
    streamingMessageId: null,
    isStreaming: false,
    abortController: null,
    hitlPending: null,
    hitlPausedSessionId: null,
    hitlPausedMessageId: null,
    agentMode: false,
    planMode: false,
    error: null
  } as Partial<ChatState>)
}

describe('T10 计划模式开关联动', () => {
  beforeEach(() => {
    resetStore()
    createAgentSession.mockReset()
  })

  it('开启计划模式隐含开启 Agent 模式', () => {
    useChatStore.getState().setPlanMode(true)
    expect(useChatStore.getState().planMode).toBe(true)
    expect(useChatStore.getState().agentMode).toBe(true)
  })

  it('关闭 Agent 模式时连带关闭计划模式', () => {
    useChatStore.getState().setPlanMode(true)
    useChatStore.getState().setAgentMode(false)
    expect(useChatStore.getState().agentMode).toBe(false)
    expect(useChatStore.getState().planMode).toBe(false)
  })

  it('关闭计划模式不强制关闭 Agent 模式', () => {
    useChatStore.getState().setPlanMode(true)
    useChatStore.getState().setPlanMode(false)
    expect(useChatStore.getState().planMode).toBe(false)
    expect(useChatStore.getState().agentMode).toBe(true)
  })

  it('selectSession 按会话 agentMode 同步徽标', () => {
    useChatStore.setState({
      sessions: [
        {
          id: 'p1',
          title: '计划会话',
          isArchived: false,
          createdAt: '',
          updatedAt: '',
          agentMode: 'plan_execute'
        },
        {
          id: 'a1',
          title: 'Agent 会话',
          isArchived: false,
          createdAt: '',
          updatedAt: '',
          agentMode: 'react_agent'
        }
      ]
    } as Partial<ChatState>)
    useChatStore.getState().selectSession('p1')
    expect(useChatStore.getState().planMode).toBe(true)
    expect(useChatStore.getState().agentMode).toBe(true)
    useChatStore.getState().selectSession('a1')
    expect(useChatStore.getState().planMode).toBe(false)
    expect(useChatStore.getState().agentMode).toBe(true)
  })
})

describe('T10 计划模式建会话与请求透传', () => {
  beforeEach(() => {
    resetStore()
    createAgentSession.mockReset()
  })

  it('计划模式下首条消息懒创建 plan_execute 会话，请求携带 agentMode=plan_execute', async () => {
    createAgentSession.mockResolvedValue({
      id: 'new-plan',
      title: '新对话',
      isArchived: false,
      createdAt: '',
      updatedAt: '',
      agentMode: 'plan_execute'
    })
    const captured: Array<{ agentMode?: string; model?: string }> = []
    setAgentTransport(fakeTransport(captured))

    useChatStore.getState().setPlanMode(true)
    await useChatStore.getState().sendMessage('帮我规划并完成调研')

    expect(createAgentSession).toHaveBeenCalledTimes(1)
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ agentMode: 'plan_execute' })
    )
    expect(captured).toHaveLength(1)
    expect(captured[0]!.agentMode).toBe('plan_execute')
  })

  it('createSession 显式入参优先于开关', async () => {
    createAgentSession.mockResolvedValue({
      id: 'new-explicit',
      title: 't',
      isArchived: false,
      createdAt: '',
      updatedAt: '',
      agentMode: 'plan_execute'
    })
    const captured: Array<{ agentMode?: string; model?: string }> = []
    setAgentTransport(fakeTransport(captured))

    const session = await useChatStore.getState().createSession('显式计划', 'plan_execute')
    expect(session.agentMode).toBe('plan_execute')
    expect(createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ title: '显式计划', agentMode: 'plan_execute' })
    )
  })
})
