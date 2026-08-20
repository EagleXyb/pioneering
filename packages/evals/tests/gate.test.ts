// gate 测试：门禁规则评估 / block-warn-pass / delta 回归 / 伪指标
import { describe, expect, it } from 'vitest'
import { evaluateGate } from '../src/gate.js'
import type { EvalReport, GateDef } from '../src/types.js'

function makeReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    runId: 'run-x',
    datasetName: 'smoke',
    startedAt: 't0',
    finishedAt: 't1',
    caseCount: 10,
    passCount: 10,
    casePassRate: 1,
    overallScore: 0.9,
    layerScores: { output: 0.9, process: 0.9, system: 0.9 },
    metrics: {
      system_task_success: {
        key: 'system_task_success', category: 'system',
        avg: 0.95, min: 0, max: 1, p50: 1, passRate: 0.95, count: 10,
      },
      output_relevance: {
        key: 'output_relevance', category: 'output',
        avg: 0.8, min: 0, max: 1, p50: 0.8, passRate: 0.9, count: 10,
      },
    },
    perCategory: {},
    failures: [],
    delta: { overall_score: -0.02 },
    baselineRunId: 'run-prev',
    ...overrides,
  }
}

describe('evaluateGate', () => {
  it('全部达标 -> pass, exitCode=0', () => {
    const gate: GateDef = {
      datasets: ['smoke'],
      rules: [
        { metric: 'system_task_success', op: '>=', value: 0.9, action: 'block' },
        { metric: 'output_relevance', op: '>=', value: 0.7, action: 'block' },
      ],
    }
    const result = evaluateGate('ci', gate, { smoke: makeReport() })
    expect(result.decision).toBe('pass')
    expect(result.exitCode).toBe(0)
  })

  it('block 规则违反 -> block, exitCode=1', () => {
    const gate: GateDef = {
      datasets: ['smoke'],
      rules: [{ metric: 'system_task_success', op: '>=', value: 0.99, action: 'block' }],
    }
    const result = evaluateGate('ci', gate, { smoke: makeReport() })
    expect(result.decision).toBe('block')
    expect(result.exitCode).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.summary).toContain('BLOCK')
  })

  it('warn 规则违反 -> warn 但不阻断（exitCode=0）', () => {
    const gate: GateDef = {
      datasets: ['smoke'],
      rules: [
        { metric: 'system_task_success', op: '>=', value: 0.9, action: 'block' },
        { metric: 'output_relevance', op: '>=', value: 0.99, action: 'warn' },
      ],
    }
    const result = evaluateGate('ci', gate, { smoke: makeReport() })
    expect(result.decision).toBe('warn')
    expect(result.exitCode).toBe(0)
    expect(result.warnings).toHaveLength(1)
  })

  it('delta 规则：总分下降超阈值 -> warn（回归检测）', () => {
    const gate: GateDef = {
      datasets: ['smoke'],
      rules: [{ metric: 'overall_score', scope: 'delta', op: '>=', value: -0.01, action: 'warn' }],
    }
    // delta.overall_score = -0.02 < -0.01 -> 触发
    const result = evaluateGate('ci', gate, { smoke: makeReport() })
    expect(result.warnings).toHaveLength(1)
    expect(result.decision).toBe('warn')
  })

  it('伪指标 case_pass_rate / regression_failure_count', () => {
    const report = makeReport({
      casePassRate: 0.86,
      failures: [
        { caseId: 'reg-1', category: 'regression', failedMetrics: ['system_task_success'] },
      ],
    })
    const gate: GateDef = {
      datasets: ['smoke'],
      rules: [
        { metric: 'case_pass_rate', op: '>=', value: 0.85, action: 'block' },
        { metric: 'regression_failure_count', op: '<=', value: 0, action: 'block' },
      ],
    }
    const result = evaluateGate('release', gate, { smoke: report })
    expect(result.decision).toBe('block')   // regression_failure_count=1 违反
    expect(result.failures.map((f) => f.rule.metric)).toContain('regression_failure_count')
  })

  it('指标无数据 -> 降级 warn 不误杀', () => {
    const gate: GateDef = {
      datasets: ['smoke'],
      rules: [{ metric: 'system_ground_truth_match', op: '>=', value: 0.7, action: 'block' }],
    }
    const result = evaluateGate('ci', gate, { smoke: makeReport() })  // 无该指标数据
    expect(result.decision).toBe('warn')
    expect(result.failures).toHaveLength(0)
  })

  it('多数据集：任一数据集 block 即整体 block', () => {
    const gate: GateDef = {
      datasets: ['full', 'regression'],
      rules: [{ metric: 'system_task_success', op: '>=', value: 0.9, action: 'block' }],
    }
    const bad = makeReport({
      datasetName: 'regression',
      metrics: {
        system_task_success: {
          key: 'system_task_success', category: 'system',
          avg: 0.5, min: 0, max: 1, p50: 0.5, passRate: 0.5, count: 2,
        },
      },
    })
    const result = evaluateGate('release', gate, { full: makeReport(), regression: bad })
    expect(result.decision).toBe('block')
    expect(result.failures[0].datasetName).toBe('regression')
  })
})
