// T22 回归测试：浏览器 mock 的 agent/localChat 桩带 unavailable 标记后，
// ipc 模式必须回退 http 并告警，而不是被桩「屏蔽」成 ipc 可用。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

function setWindowApiAgent(agent: Record<string, unknown> | undefined) {
  const win = globalThis as unknown as {
    window?: { api?: { agent?: Record<string, unknown>; localChat?: Record<string, unknown> } }
  }
  win.window = {
    api: {
      agent,
      localChat: { unavailable: true }
    }
  }
}

function clearWindowApi() {
  const win = globalThis as unknown as { window?: unknown }
  delete win.window
}

describe('T22 transport 对浏览器 mock 的降级', () => {
  beforeEach(() => {
    vi.resetModules()
    // node 测试环境无 localStorage：stub 内存版（transport 读取处本身有 try/catch）
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear()
    })
  })
  afterEach(() => {
    clearWindowApi()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('agent 桩带 unavailable=true 时，ipc 模式回退为 http transport', async () => {
    setWindowApiAgent({
      unavailable: true,
      onEvent: () => () => {},
      send: async () => ({ ok: false })
    })
    localStorage.setItem('agent.transportMode', 'ipc')

    const transport = await import('../index')
    expect(transport.getAgentTransport().kind).toBe('http')
  })

  it('真实 preload（无 unavailable 标记）时 ipc 模式保持 ipc transport', async () => {
    setWindowApiAgent({
      onEvent: () => () => {},
      send: async () => ({ ok: true })
    })
    localStorage.setItem('agent.transportMode', 'ipc')

    const transport = await import('../index')
    expect(transport.getAgentTransport().kind).toBe('ipc')
  })

  it('localChat mock 带 unavailable 标记时 isLocalChatAvailable 为 false', async () => {
    setWindowApiAgent({ unavailable: true })
    const localChat = await import('../../localChat')
    expect(localChat.isLocalChatAvailable()).toBe(false)
  })
})
