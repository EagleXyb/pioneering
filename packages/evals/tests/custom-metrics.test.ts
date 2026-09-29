// custom-metrics.test.ts
//
// P3-D：自定义注册指标端到端（注册 → runner 消费 → 报告聚合）。
import { describe, expect, it, afterAll } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runEvaluation } from '../src/runner.js'
import { loadGlobalConfig } from '../src/config-loader.js'
import { buildDataset, loadDatasetRegistry, loadPreprocessing } from '../src/dataset-loader.js'
import {
  CustomMetricRegistry,
  resetCustomMetricRegistry,
} from '../src/metrics.js'
import type {
  AgentRunResult,
  EvalCase,
  ThresholdsConfig,
} from '../src/types.js'

const tmp = mkdtempSync(join(tmpdir(), 'evals-custom-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

async function run(metrics: CustomMetricRegistry) {
  const registry = loadDatasetRegistry()
  const smoke = buildDataset(registry, 'smoke', loadPreprocessing())

  const executor = async (c: EvalCase): Promise<AgentRunResult> => ({
    caseId: c.id,
    ok: true,
    response: `这是 ${c.id} 的有效回答`,
    toolCalls: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    iteration: 1,
    reasoningRoundCount: 1,
    latencyMs: 20,
  })

  const globalCfg = loadGlobalConfig()
  globalCfg.judge = { mode: 'rule' }
  globalCfg.runner = { concurrency: 2, timeout_ms: 1000, retries: 0 }
  globalCfg.report = { baseline: 'none' }

  const thresholds: ThresholdsConfig = {
    version: 1,
    metrics: {
      output_relevance: { category: 'output', weight: 0.5, threshold: 0.1, gate: 'block' },
      custom_length: { category: 'output', weight: 0.5, threshold: 0.5, gate: 'block' },
    },
  }

  return runEvaluation({
    dataset: smoke,
    executor,
    thresholds,
    globalConfig: globalCfg,
    outputDir: tmp,
    withBaseline: false,
    customMetrics: metrics,
  })
}

describe('P3-D 自定义指标注册', () => {
  it('注册指标被 runner 消费并进入报告', async () => {
    resetCustomMetricRegistry()
    const metrics = new CustomMetricRegistry()
    metrics.register({
      key: 'custom_length',
      category: 'output',
      compute: (ctx) => (ctx.agentRun.response.length > 5 ? 1 : 0),
    })

    const { report, caseResults } = await run(metrics)

    for (const cr of caseResults) {
      expect(cr.metrics['custom_length']).toBe(1)
    }
    expect(report.metrics['custom_length']).toBeDefined()
    expect(report.metrics['custom_length'].avg).toBe(1)
  })

  it('指标返回 null 时该用例不产出该 key', async () => {
    resetCustomMetricRegistry()
    const metrics = new CustomMetricRegistry()
    metrics.register({
      key: 'custom_length',
      category: 'output',
      compute: () => null,
    })

    const { caseResults } = await run(metrics)
    for (const cr of caseResults) {
      expect('custom_length' in cr.metrics).toBe(false)
    }
  })

  it('指标抛错时被隔离，不影响其他指标与用例 pass', async () => {
    resetCustomMetricRegistry()
    const metrics = new CustomMetricRegistry()
    metrics.register({
      key: 'custom_length',
      category: 'output',
      compute: () => { throw new Error('boom') },
    })

    const { caseResults } = await run(metrics)
    expect(caseResults.length).toBeGreaterThan(0)
    for (const cr of caseResults) {
      expect(cr.pass).toBe(true) // 其他 block 指标正常
    }
  })
})
