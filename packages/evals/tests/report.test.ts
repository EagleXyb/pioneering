// report 测试：聚合 / 阈值判定 / baseline delta
import { describe, expect, it } from 'vitest'
import { aggregate, computeDelta, metricMeetsThreshold } from '../src/report.js'
import type { EvalCaseResult, MetricThresholdDef, ThresholdsConfig } from '../src/types.js'

const thresholds: ThresholdsConfig = {
  version: 1,
  metrics: {
    output_relevance: { category: 'output', weight: 0.5, threshold: 0.6, gate: 'block' },
    system_task_success: { category: 'system', weight: 0.5, threshold: 0.8, gate: 'block' },
    process_redundant_calls: {
      category: 'process', weight: 0.3, threshold: 0.34, gate: 'warn', higherIsBetter: false,
    },
  },
}

function caseResult(
  id: string,
  metrics: Record<string, number>,
  pass: boolean,
  failed: string[] = [],
): EvalCaseResult {
  return {
    caseId: id,
    category: 'core',
    tags: [],
    metrics,
    pass,
    failedBlockMetrics: failed,
    agentRun: {
      caseId: id, ok: true, response: 'r', toolCalls: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      iteration: 1, reasoningRoundCount: 1, latencyMs: 10,
    },
  }
}

describe('metricMeetsThreshold', () => {
  const def: MetricThresholdDef = { category: 'output', weight: 1, threshold: 0.6, gate: 'block' }
  it('higher_is_better=true: >= 阈值达标', () => {
    expect(metricMeetsThreshold(0.6, def)).toBe(true)
    expect(metricMeetsThreshold(0.59, def)).toBe(false)
  })
  it('higher_is_better=false: <= 阈值达标', () => {
    expect(metricMeetsThreshold(0.34, { ...def, higherIsBetter: false, threshold: 0.34 })).toBe(true)
    expect(metricMeetsThreshold(0.35, { ...def, higherIsBetter: false, threshold: 0.34 })).toBe(false)
  })
})

describe('aggregate', () => {
  it('聚合 avg/passRate/层级分/总分', () => {
    const report = aggregate(
      'smoke',
      [
        caseResult('a', { output_relevance: 0.8, system_task_success: 1 }, true),
        caseResult('b', { output_relevance: 0.4, system_task_success: 0 }, false, ['output_relevance', 'system_task_success']),
      ],
      thresholds,
      '2026-08-20T00:00:00Z',
      '2026-08-20T00:00:01Z',
    )
    expect(report.caseCount).toBe(2)
    expect(report.passCount).toBe(1)
    expect(report.casePassRate).toBeCloseTo(0.5)
    expect(report.metrics['output_relevance'].avg).toBeCloseTo(0.6)
    expect(report.metrics['output_relevance'].passRate).toBeCloseTo(0.5)
    expect(report.failures).toHaveLength(1)
    expect(report.failures[0].caseId).toBe('b')
    // 层级分：output 层只有 output_relevance（avg 0.6）；system 层只有 task_success（avg 0.5）
    expect(report.layerScores.output).toBeCloseTo(0.6)
    expect(report.layerScores.system).toBeCloseTo(0.5)
    // 总分 = (0.6*0.5 + 0.5*0.5) / 1.0（redundant 无数据不参与）
    expect(report.overallScore).toBeCloseTo(0.55)
  })

  it('不适用指标（无数据）不进入聚合', () => {
    const report = aggregate(
      'x',
      [caseResult('a', { output_relevance: 0.9 }, true)],
      thresholds,
      't0', 't1',
    )
    expect(report.metrics['system_task_success']).toBeUndefined()
    expect(report.metrics['process_redundant_calls']).toBeUndefined()
  })
})

describe('computeDelta', () => {
  it('逐指标差值与总分差值', () => {
    const r1 = aggregate('x', [caseResult('a', { output_relevance: 0.9 }, true)], thresholds, 't0', 't1')
    const r2 = aggregate('x', [caseResult('a', { output_relevance: 0.6 }, true)], thresholds, 't0', 't2')
    const delta = computeDelta(r2, r1)
    expect(delta['output_relevance']).toBeCloseTo(-0.3)
    expect(delta['overall_score']).toBeLessThan(0)
  })

  it('无 baseline -> 空对象', () => {
    const r = aggregate('x', [caseResult('a', {}, true)], thresholds, 't0', 't1')
    expect(computeDelta(r, null)).toEqual({})
  })
})
