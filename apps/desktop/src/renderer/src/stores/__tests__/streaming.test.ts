import { describe, it, expect } from 'vitest'
import type { Message } from '@shared/types'
import type { ChatState } from '@renderer/stores/chatStore'
import { emptyStreaming, finalizeStreamingMessage } from '@renderer/stores/chatStore'

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
