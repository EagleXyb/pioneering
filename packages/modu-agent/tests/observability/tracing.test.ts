import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  OtelSpanManager,
  get_span_manager,
  reset_span_manager,
  is_tracing_enabled,
} from '@/observability/tracing.js'

/**
 * OtelSpanManager 测试（对应文档 §2.4 建议1）。
 *
 * OTel SDK 未安装时 OtelSpanManager 降级为 no-op，
 * 验证 ready() / span() / enabled 行为正确。
 */
describe('OtelSpanManager', () => {
  beforeEach(() => {
    reset_span_manager()
  })

  afterEach(() => {
    reset_span_manager()
  })

  it('returns disabled state when tracing not enabled', () => {
    const mgr = new OtelSpanManager('test-service', false)
    expect(mgr.enabled).toBe(false)
  })

  it('ready() resolves immediately when tracing disabled', async () => {
    const mgr = new OtelSpanManager('test-service', false)
    await expect(mgr.ready()).resolves.toBeUndefined()
  })

  it('span() returns NoopSpanHandle when disabled', () => {
    const mgr = new OtelSpanManager('test-service', false)
    const handle = mgr.span('test.span', 'trace-1', { user_id: 'u1' })
    expect(handle).toBeDefined()
    // NoopSpanHandle 不抛异常
    expect(() => handle.end()).not.toThrow()
  })

  it('span() supports Symbol.dispose (using syntax)', () => {
    const mgr = new OtelSpanManager('test-service', false)
    using handle = mgr.span('test.span')
    // 离开作用域时自动调用 [Symbol.dispose]
    expect(handle).toBeDefined()
  })

  it('span() recordError does not throw when disabled', () => {
    const mgr = new OtelSpanManager('test-service', false)
    const handle = mgr.span('test.span')
    expect(() => handle.recordError(new Error('test error'))).not.toThrow()
  })

  it('span() accepts trace_id and attributes', () => {
    const mgr = new OtelSpanManager('test-service', false)
    const handle = mgr.span('test.span', 'trace-123', {
      user_id: 'user-1',
      session_id: 'sess-1',
    })
    expect(() => handle.end()).not.toThrow()
  })

  it('get_span_manager returns singleton', () => {
    const m1 = get_span_manager()
    const m2 = get_span_manager()
    expect(m1).toBe(m2)
  })

  it('is_tracing_enabled returns false when SDK not available', () => {
    // OTel SDK 未安装，tracing 配置默认 disabled
    expect(is_tracing_enabled()).toBe(false)
  })

  it('ready() can be called multiple times', async () => {
    const mgr = new OtelSpanManager('test-service', false)
    await mgr.ready()
    await mgr.ready()
    // 不抛异常即可
    expect(true).toBe(true)
  })
})
