import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  MetricsRegistry,
  reset_metrics_registry,
  get_metrics_registry,
} from '@/observability/metrics.js'

/**
 * MetricsRegistry 测试（对应文档 §2.4 建议3）。
 *
 * prom-client 未安装时 MetricsRegistry 降级为 no-op，
 * 仅验证 record_* 方法不抛异常且 enabled 状态正确。
 */
describe('MetricsRegistry', () => {
  beforeEach(() => {
    reset_metrics_registry()
  })

  afterEach(() => {
    reset_metrics_registry()
  })

  it('returns disabled state when prom-client not available', () => {
    const reg = new MetricsRegistry(false)
    expect(reg.enabled).toBe(false)
  })

  it('record_request is no-op when disabled', () => {
    const reg = new MetricsRegistry(false)
    expect(() => reg.record_request('success', 0.1)).not.toThrow()
  })

  it('record_tool_call is no-op when disabled', () => {
    const reg = new MetricsRegistry(false)
    expect(() =>
      reg.record_tool_call('http_request', 'success', 'sess-1', 0.5),
    ).not.toThrow()
  })

  it('record_llm_tokens is no-op when disabled', () => {
    const reg = new MetricsRegistry(false)
    expect(() =>
      reg.record_llm_tokens('openai', 'gpt-4', 'prompt', 100),
    ).not.toThrow()
  })

  it('record_tool_call accepts optional duration', () => {
    const reg = new MetricsRegistry(false)
    expect(() =>
      reg.record_tool_call('code_executor', 'error', 'sess-2'),
    ).not.toThrow()
    expect(() =>
      reg.record_tool_call('code_executor', 'error', 'sess-2', 1.5),
    ).not.toThrow()
  })

  it('record_llm_tokens accepts various types', () => {
    const reg = new MetricsRegistry(false)
    expect(() => reg.record_llm_tokens('anthropic', 'claude-3', 'completion', 50)).not.toThrow()
    expect(() => reg.record_llm_tokens('zhipu', 'glm-4', 'total', 200)).not.toThrow()
  })

  it('collect_text returns empty string when disabled', () => {
    const reg = new MetricsRegistry(false)
    expect(reg.collect_text()).toBe('')
  })

  it('collect_text_async returns empty string when disabled', async () => {
    const reg = new MetricsRegistry(false)
    expect(await reg.collect_text_async()).toBe('')
  })

  it('get_metrics_registry returns singleton', () => {
    const r1 = get_metrics_registry()
    const r2 = get_metrics_registry()
    expect(r1).toBe(r2)
  })
})
