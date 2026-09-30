// P1-23：死连接懒重连 + 传输 onclose 失活通知。
import { describe, it, expect, vi } from 'vitest'

import { MCPClient, MCPSession } from '@/mcp/client.js'
import { Transport } from '@/mcp/transport.js'
import { MCPConnectionError } from '@/mcp/errors.js'

/** 最小桩传输：可切换连接状态、记录调用次数。 */
class StubTransport extends Transport {
  connected = false
  requestCount = 0
  failNext = false
  async connect(): Promise<void> {
    this.connected = true
    // 模拟 SDK 传输 onclose 链接（桩内直接挂一个可外部触发的闭包）
    const fakeSdk = { onclose: undefined as (() => void) | undefined, onerror: undefined as any }
    this._wireSdkLifecycleHooks(fakeSdk as any)
    ;(this as any)._fireSdkClose = () => fakeSdk.onclose?.()
  }
  async disconnect(): Promise<void> {
    this._intentionalClose = true
    this.connected = false
  }
  async request(): Promise<Record<string, any>> {
    this.requestCount += 1
    if (this.failNext) {
      this.failNext = false
      this.connected = false
      throw new MCPConnectionError('socket hung up')
    }
    return { ok: true, n: this.requestCount }
  }
  async notify(): Promise<void> {}
  get connected(): boolean {
    return this.connected
  }
}

function makeSession(transport: Transport): MCPSession {
  return new MCPSession('srv', transport)
}

describe('P1-23 · MCPClient 死连接懒重连', () => {
  it('会话失活时 callTool 自动重连一次并在新会话上完成调用', async () => {
    const client = new MCPClient()
    ;(client as any)._serverConfigs.set('srv', { name: 'srv', transport: 'stdio', command: 'x' })

    const dead = makeSession(new StubTransport())
    // 死会话：未连接
    ;(client as any)._sessions.set('srv', dead)

    const fresh = makeSession(new StubTransport())
    await fresh.connect()
    const openSpy = vi.fn(async () => {
      ;(client as any)._sessions.set('srv', fresh)
      return fresh
    })
    ;(client as any)._openSession = openSpy

    const r = await client.callTool('srv__echo', { a: 1 })
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(true)
  })

  it('调用中途连接错误：懒重连一次后重试；非连接类错误不触发重连', async () => {
    const client = new MCPClient()
    ;(client as any)._serverConfigs.set('srv', { name: 'srv', transport: 'stdio', command: 'x' })

    const t = new StubTransport()
    const alive = makeSession(t)
    await alive.connect()
    ;(client as any)._sessions.set('srv', alive)

    const fresh = makeSession(new StubTransport())
    await fresh.connect()
    const openSpy = vi.fn(async () => {
      ;(client as any)._sessions.set('srv', fresh)
      return fresh
    })
    ;(client as any)._openSession = openSpy

    // 第一次调用：传输抛连接错误 → 重连 → 重试成功
    t.failNext = true
    const r = await client.callTool('srv__echo', {})
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(true)

    // 非连接类错误（普通 Error）原样上抛，不重连
    openSpy.mockClear()
    vi.spyOn(fresh, 'callTool').mockRejectedValueOnce(new Error('boom'))
    await expect(client.callTool('srv__echo', {})).rejects.toThrow('boom')
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('无缓存配置时拒绝重连（MCPConnectionError），不伪造会话', async () => {
    const client = new MCPClient()
    await expect(client.callTool('never__tool', {})).rejects.toBeInstanceOf(MCPConnectionError)
  })
})

describe('P1-23 · Transport onclose 失活钩子', () => {
  it('SDK 传输 onclose 触发时回调上层；主动 disconnect 期间抑制', async () => {
    const t = new StubTransport()
    const onClose = vi.fn()
    t.onUnexpectedClose(onClose)
    await t.connect()

    // 模拟远端断开
    ;(t as any)._fireSdkClose()
    expect(onClose).toHaveBeenCalledTimes(1)

    // 再连接一次后主动 disconnect：关闭期间不触发意外回调
    onClose.mockClear()
    await t.connect()
    await t.disconnect()
    ;(t as any)._fireSdkClose()
    expect(onClose).not.toHaveBeenCalled()
  })
})
