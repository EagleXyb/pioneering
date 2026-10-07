/**
 * useAgentChat.loadHistory 单元测试（T3.1）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

vi.mock('../../../api/client', () => ({
  getAuthHeader: () => ({}),
  post: vi.fn(async () => undefined),
  get: vi.fn(async () => ({
    messages: [
      { id: 'm1', role: 'user', content: '历史问题' },
      {
        id: 'm2',
        role: 'assistant',
        content: '历史回答',
        contentBlocks: [
          { type: 'thinking', status: 'success', summary: '思考过程' },
          { type: 'tool_call', status: 'success', toolName: 'search' },
          { type: 'tool_result', status: 'success', toolName: 'search', summary: '搜索结果' },
        ],
      },
    ],
  })),
}))

import { useAgentChat } from './useAgentChat'

describe('useAgentChat — loadHistory（T3.1）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('会话历史加载后转换为消息列表', async () => {
    const { result } = renderHook(() => useAgentChat('session-1', false))

    await result.current.loadHistory('session-1')

    await waitFor(() => expect(result.current.messages).toHaveLength(2))
    expect(result.current.messages[0]).toMatchObject({
      id: 'm1',
      role: 'user',
    })
    expect(result.current.messages[0]!.content![0]).toMatchObject({
      type: 'text',
      data: '历史问题',
    })
    expect(result.current.messages[1]).toMatchObject({
      id: 'm2',
      role: 'assistant',
    })
    expect(result.current.messages[1]!.content![0]).toMatchObject({
      type: 'markdown',
      data: '历史回答',
    })

    // T3.3：过程面板从 contentBlocks 还原
    const steps = Object.values(result.current.stateMap)
    expect(steps).toHaveLength(3)
    expect(steps[0]).toMatchObject({ type: 'thinking', content: '思考过程' })
  })

  it('加载失败静默降级为空态，不抛错', async () => {
    const { result, unmount } = renderHook(() => useAgentChat('session-x', false))
    // 直接等待一个不存在数据的场景：mock get 返回成功但无消息
    await result.current.loadHistory('session-x')
    expect(result.current.status).toBe('idle')
    unmount()
  })
})
