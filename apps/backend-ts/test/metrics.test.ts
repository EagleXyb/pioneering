/**
 * P4 回归：后端 LLM 指标
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  _resetBackendMetricsForTest,
  recordFirstToken,
  recordLlmOutcome,
  recordSseDisconnect,
  renderBackendMetrics,
} from '../src/core/metrics.ts'

beforeEach(() => {
  _resetBackendMetricsForTest()
})

describe('backend metrics', () => {
  it('无数据时输出空串（不污染既有注册表）', () => {
    expect(renderBackendMetrics()).toBe('')
  })

  it('输出请求、截断、鉴权、断线与 TTFT', () => {
    recordLlmOutcome('fast', { status: 'success', truncated: true })
    recordLlmOutcome('fast', { status: 'error', authError: true })
    recordFirstToken(0.4)
    recordSseDisconnect('chat')

    const text = renderBackendMetrics()
    expect(text).toContain('pioneering_llm_requests_total{model="fast",status="success"} 1')
    expect(text).toContain('pioneering_llm_requests_total{model="fast",status="error"} 1')
    expect(text).toContain('pioneering_llm_truncated_total{model="fast"} 1')
    expect(text).toContain('pioneering_llm_auth_errors_total{model="fast"} 1')
    expect(text).toContain('pioneering_sse_disconnects_total{channel="chat"} 1')
    expect(text).toContain('pioneering_llm_ttft_seconds_sum 0.4')
    expect(text).toContain('pioneering_llm_ttft_seconds_count 1')
  })

  it('重置后清空', () => {
    recordSseDisconnect('agent')
    _resetBackendMetricsForTest()
    expect(renderBackendMetrics()).toBe('')
  })
})
