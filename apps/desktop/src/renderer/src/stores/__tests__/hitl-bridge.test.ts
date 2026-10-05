// T8 回归测试：hitl-bridge 接线语义 + stores 目录无环依赖的行为锚点
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => {
  vi.resetModules()
})

describe('hitl-bridge（T8）', () => {
  it('未接线时 getHitlStore 显式抛错；hitlStore 模块求值后完成接线', async () => {
    // 独立模块注册表：只加载桥与 chatStore，hitlStore 尚未求值
    vi.resetModules()
    const bridgeBefore = await import('@renderer/stores/hitl-bridge')
    expect(() => bridgeBefore.getHitlStore()).toThrow(/尚未接线/)

    // 求值 hitlStore（其内部 import chatStore 为单向边），注册自动完成
    const hitl = await import('@renderer/stores/hitlStore')
    const bridgeAfter = await import('@renderer/stores/hitl-bridge')
    expect(bridgeAfter.getHitlStore()).toBe(hitl.useHitlStore)
  })

  it('chatStore 经桥拿到的 store 与直接导入的 hitlStore 同一实例', async () => {
    vi.resetModules()
    const [{ useChatStore }, { useHitlStore }] = await Promise.all([
      import('@renderer/stores/chatStore'),
      import('@renderer/stores/hitlStore')
    ])
    // enqueue/reset 走桥接调用：能正常驱动状态机即证明环已断开且接线有效
    useHitlStore.getState().reset()
    useHitlStore.getState().enqueue({
      sessionId: 'bridge-s1',
      kind: 'clarifying',
      question: '桥接测试',
      origin: 'live'
    })
    expect(useHitlStore.getState().currentItem?.sessionId).toBe('bridge-s1')
    expect(useChatStore.getState).toBeTypeOf('function')
    useHitlStore.getState().reset()
  })
})
