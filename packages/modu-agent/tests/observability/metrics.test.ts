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
      reg.record_tool_call('http_request', 'success', 0.5),
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
      reg.record_tool_call('code_executor', 'error'),
    ).not.toThrow()
    expect(() =>
      reg.record_tool_call('code_executor', 'error', 1.5),
    ).not.toThrow()
  })

  it('record_llm_tokens accepts various types', () => {
    const reg = new MetricsRegistry(false)
    expect(() => reg.record_llm_tokens('anthropic', 'claude-3', 'completion', 50)).not.toThrow()
    expect(() => reg.record_llm_tokens('zhipu', 'glm-4', 'total', 200)).not.toThrow()
  })

  // === P1-25：工具计数指标移除 session_id 高基数 label ===
  it('P1-25：tool_calls 指标仅含 tool_name/status label，不含 session_id', async () => {
    const reg = new MetricsRegistry(true)
    // MetricsRegistry 构造后异步动态 import prom-client 完成注册，等待初始化落定
    await new Promise((r) => setTimeout(r, 20))
    reg.record_tool_call('http_request', 'success', 0.1)
    reg.record_tool_call('http_request', 'error', 0.2)
    reg.record_tool_call('code_executor', 'success')

    const text = await reg.collect_text_async()
    expect(text).toContain('modu_agent_tool_calls_total')
    // label 顺序由 prom-client 按字母序输出（status 先于 tool_name），分别断言
    expect(text).toMatch(/tool_name="http_request"[^]*status="success"/)
    expect(text).toMatch(/tool_name="http_request"[^]*status="error"/)
    // 高基数 label 已移除
    expect(text).not.toContain('session_id=')
    // 同 tool/status 组合聚合成同一时间序列（计数 1，而不是每会话一条新序列）
    const successLine = text
      .split('\n')
      .find((l) => l.startsWith('modu_agent_tool_calls_total') && l.includes('http_request') && l.includes('status="success"'))
    expect(successLine).toBeDefined()
    expect(successLine!.trim().endsWith('1')).toBe(true)
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
