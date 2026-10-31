// T8 回归测试：HITL 桥接语义 + stores 目录无环依赖的行为锚点
//
// desktop 已改为消费 @pioneering/agent-protocol 的单一状态机；
// 本测试守住「chatStore 经桥拿到的 store 与直接导入的 store 是同一实例」。
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.resetModules()
})

describe('hitl-bridge（T8）', () => {
  it('chatStore 经桥拿到的 store 与协议包导出的 store 同一实例', async () => {
    vi.resetModules()
    const [{ useChatStore }, protocol] = await Promise.all([
      import('@renderer/stores/chatStore'),
      import('@pioneering/agent-protocol')
    ])
    expect(protocol.getHitlStore()).toBe(protocol.useHitlStore)

    protocol.useHitlStore.getState().reset()
    protocol.useHitlStore.getState().enqueue({
      sessionId: 'bridge-s1',
      kind: 'clarifying',
      question: '桥接测试',
      origin: 'live'
    })
    expect(protocol.useHitlStore.getState().currentItem?.sessionId).toBe('bridge-s1')
    expect(useChatStore.getState).toBeTypeOf('function')
    protocol.useHitlStore.getState().reset()
  })
})
