import { describe, it, expect } from 'vitest'
import {
  inject_trace_context,
  extract_trace_context,
} from '@/observability/trace-context.js'

/**
 * TraceContext 注入/提取测试（对应文档 §2.4 建议2）。
 *
 * OTel SDK 未安装时 inject/extract 仅处理业务层 header，
 * 验证 W3C traceparent 注入逻辑在 OTel 可用时能正常工作（此处验证业务层部分）。
 */
describe('TraceContext', () => {
  it('inject_trace_context adds business headers', () => {
    const headers: Record<string, string> = {}
    inject_trace_context(headers, 'trace-123', 'user-1', 'sess-1')
    expect(headers['x-modu-trace-id']).toBe('trace-123')
    expect(headers['x-modu-user-id']).toBe('user-1')
    expect(headers['x-modu-session-id']).toBe('sess-1')
  })

  it('inject_trace_context skips empty values', () => {
    const headers: Record<string, string> = {}
    inject_trace_context(headers, '', '', '')
    expect(headers['x-modu-trace-id']).toBeUndefined()
    expect(headers['x-modu-user-id']).toBeUndefined()
    expect(headers['x-modu-session-id']).toBeUndefined()
  })

  it('inject_trace_context preserves existing headers', () => {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    inject_trace_context(headers, 'trace-456')
    expect(headers['content-type']).toBe('application/json')
    expect(headers['x-modu-trace-id']).toBe('trace-456')
  })

  it('inject_trace_context returns the same headers object', () => {
    const headers: Record<string, string> = {}
    const result = inject_trace_context(headers, 'trace-789')
    expect(result).toBe(headers)
  })

  it('extract_trace_context reads business headers', () => {
    const headers: Record<string, string> = {
      'x-modu-trace-id': 'trace-abc',
      'x-modu-user-id': 'user-xyz',
      'x-modu-session-id': 'sess-def',
    }
    const ctx = extract_trace_context(headers)
    expect(ctx.trace_id).toBe('trace-abc')
    expect(ctx.user_id).toBe('user-xyz')
    expect(ctx.session_id).toBe('sess-def')
  })

  it('extract_trace_context returns empty for missing headers', () => {
    const ctx = extract_trace_context({})
    expect(ctx.trace_id).toBe('')
    expect(ctx.user_id).toBe('')
    expect(ctx.session_id).toBe('')
  })

  it('inject + extract roundtrip preserves business fields', () => {
    const headers: Record<string, string> = {}
    inject_trace_context(headers, 'trace-roundtrip', 'user-rt', 'sess-rt')
    const ctx = extract_trace_context(headers)
    expect(ctx.trace_id).toBe('trace-roundtrip')
    expect(ctx.user_id).toBe('user-rt')
    expect(ctx.session_id).toBe('sess-rt')
  })
})
