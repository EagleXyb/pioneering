// P1-22：三传输共用的握手超时助手 connectWithTimeout。
import { describe, it, expect, vi } from 'vitest'

import { connectWithTimeout } from '@/mcp/transport.js'
import { MCPConnectionError } from '@/mcp/errors.js'

describe('P1-22 · connectWithTimeout 统一握手超时', () => {
  it('doConnect 超过时限未完成：抛 MCPConnectionError 且执行 cleanup', async () => {
    vi.useFakeTimers()
    const cleanup = vi.fn(async () => {})
    const never = new Promise<void>(() => {}) // 永久挂起
    // 先挂 rejection 处理器，再推进定时器（避免假定时器同步 reject 时瞬态 unhandled）
    const errorPromise = connectWithTimeout('sse (http://x)', 200, () => never, cleanup)
      .then(() => { throw new Error('should have timed out') }, (e) => e)

    await vi.advanceTimersByTimeAsync(201)
    const err = await errorPromise
    expect(err).toBeInstanceOf(MCPConnectionError)
    expect(String(err.message)).toContain('handshake timed out after 200ms')
    expect(cleanup).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('doConnect 自身抛错：错误原样上抛且执行 cleanup', async () => {
    const cleanup = vi.fn(async () => {})
    const boom = async () => {
      throw new Error('connection refused')
    }
    await expect(connectWithTimeout('stdio (x)', 1000, boom, cleanup))
      .rejects.toThrow('connection refused')
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('doConnect 成功完成：不抛错、不调 cleanup、定时器清理', async () => {
    vi.useFakeTimers()
    const cleanup = vi.fn(async () => {})
    await connectWithTimeout('ws (ws://x)', 500, async () => {
      await vi.advanceTimersByTimeAsync(10)
    }, cleanup)
    expect(cleanup).not.toHaveBeenCalled()
    // 推进超过超时时限也不产生残留 rejection
    await vi.advanceTimersByTimeAsync(600)
    vi.useRealTimers()
  })

  it('timeoutMs<=0：不包超时，直接等待 doConnect', async () => {
    const cleanup = vi.fn(async () => {})
    await connectWithTimeout('label', 0, async () => undefined, cleanup)
    expect(cleanup).not.toHaveBeenCalled()
  })
})
