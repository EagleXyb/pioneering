// runner + evolution-bridge 端到端测试：fake executor 驱动完整评测流水线
// （不调真实 LLM；judge 用 rule 模式）
import { describe, expect, it, afterAll } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EvaluationRunner, runEvaluation } from '../src/runner.js'
import { loadGlobalConfig, loadThresholds } from '../src/config-loader.js'
import { buildDataset, loadDatasetRegistry, loadPreprocessing } from '../src/dataset-loader.js'
import { buildEvolutionSignals } from '../src/evolution-bridge.js'
import type { AgentRunResult, EvalCase, ThresholdsConfig } from '../src/types.js'

const tmp = mkdtempSync(join(tmpdir(), 'evals-run-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

/** 构造 fake executor：按 case id 脚本化返回结果。 */
function fakeExecutor(
  script: Record<string, Partial<AgentRunResult> | 'timeout'>,
): (c: EvalCase) => Promise<AgentRunResult> {
  return async (c) => {
    const s = script[c.id]
    if (s === 'timeout') {
      // 模拟超时：永不 resolve（runner 的 withTimeout 会掐断）
      await new Promise(() => { /* hang */ })
      throw new Error('unreachable')
    }
    return {
      caseId: c.id,
      ok: true,
      response: `回答 ${c.id} 的结果：4053`,
      toolCalls: [
        { toolName: 'calculator', args: { expr: '1+1' }, success: true },
      ],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      iteration: 1,
      reasoningRoundCount: 1,
      latencyMs: 50,
      ...(s ?? {}),
    } as AgentRunResult
  }
}

// 最小化 global 配置（覆盖真实 global.yaml 的并发/超时，测试更快）
function testGlobalConfig() {
  const cfg = loadGlobalConfig()
  return {
    ...cfg,
    judge: { ...cfg.judge, mode: 'rule' as const },
    runner: { concurrency: 4, timeout_ms: 1000, retries: 0 },
    report: { ...cfg.report, baseline: 'none' },
    evolution_bridge: { enabled: true, min_quality_score: 0.6, severity: 'medium' },
  }
}

// 精简阈值（聚焦可判定的 block 指标）
const testThresholds: ThresholdsConfig = {
  version: 1,
  metrics: {
    output_relevance: { category: 'output', weight: 0.3, threshold: 0.1, gate: 'block' },
    system_task_success: { category: 'system', weight: 0.4, threshold: 0.8, gate: 'block' },
    system_ground_truth_match: { category: 'system', weight: 0.3, threshold: 0.5, gate: 'block' },
    process_tool_success_rate: { category: 'process', weight: 0.3, threshold: 0.7, gate: 'block' },
  },
}

describe('EvaluationRunner 端到端（fake executor）', () => {
  const globalCfg = testGlobalConfig()

  it('完整流水线：执行 -> 指标 -> 聚合 -> 落盘', async () => {
    const registry = loadDatasetRegistry()
    const pp = loadPreprocessing()
    const smoke = buildDataset(registry, 'smoke', pp)

    const { report, caseResults } = await runEvaluation({
      dataset: smoke,
      executor: fakeExecutor({}),
      thresholds: testThresholds,
      globalConfig: globalCfg,
      judgeLlm: null,
      outputDir: tmp,
      withBaseline: false,
    })

    // 全部用例执行成功且回复含 gt 值
    expect(report.caseCount).toBe(smoke.cases.length)
    expect(caseResults).toHaveLength(smoke.cases.length)
    expect(report.metrics['system_task_success'].avg).toBeGreaterThan(0)
    expect(report.overallScore).toBeGreaterThan(0)

    // 报告落盘
    const files = readdirSync(tmp).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(1)
    const saved = JSON.parse(readFileSync(join(tmp, files[files.length - 1]), 'utf-8'))
    expect(saved['runId']).toBe(report.runId)
    expect(saved['datasetName']).toBe('smoke')
  }, 20000)

  it('超时用例记为 failure 且不阻塞其他用例', async () => {
    const dataset = {
      name: 'timeout-test',
      cases: [
        { id: 'fast-1', category: 'core' as const, input: 'a', groundTruth: '4053', expectedTools: [], tags: [], source: 'human' as const },
        { id: 'slow-1', category: 'core' as const, input: 'b', groundTruth: '4053', expectedTools: [], tags: [], source: 'human' as const },
      ],
    }
    const { report } = await runEvaluation({
      dataset,
      executor: fakeExecutor({ 'slow-1': 'timeout' }),
      thresholds: testThresholds,
      globalConfig: { ...globalCfg, runner: { concurrency: 2, timeout_ms: 300, retries: 0 } },
      judgeLlm: null,
      outputDir: null,   // 不落盘
      withBaseline: false,
    })

    const slow = report.failures.find((f) => f.caseId === 'slow-1')
    expect(slow).toBeDefined()   // 超时 -> fail
    // fast-1 正常完成
    expect(report.caseCount).toBe(2)
  }, 15000)

  it('engine 异常兜底：executor 抛错 -> 用例 fail 而非中断', async () => {
    const dataset = {
      name: 'error-test',
      cases: [
        { id: 'boom', category: 'core' as const, input: 'x', groundTruth: null, expectedTools: [], tags: [], source: 'human' as const },
      ],
    }
    const { report } = await runEvaluation({
      dataset,
      executor: async () => { throw new Error('agent crashed') },
      thresholds: testThresholds,
      globalConfig: globalCfg,
      judgeLlm: null,
      outputDir: null,
      withBaseline: false,
    })
    expect(report.failures[0].caseId).toBe('boom')
  })

  it('baseline：第二次 run 产出 delta', async () => {
    const registry = loadDatasetRegistry()
    const pp = loadPreprocessing()
    const ds = buildDataset(registry, 'smoke', pp)
    const outDir = mkdtempSync(join(tmpdir(), 'evals-bl-'))

    await runEvaluation({
      dataset: ds, executor: fakeExecutor({}), thresholds: testThresholds,
      globalConfig: { ...globalCfg, report: { ...globalCfg.report, baseline: 'latest' } },
      judgeLlm: null, outputDir: outDir, withBaseline: true,
    })
    const second = await runEvaluation({
      dataset: ds, executor: fakeExecutor({}), thresholds: testThresholds,
      globalConfig: { ...globalCfg, report: { ...globalCfg.report, baseline: 'latest' } },
      judgeLlm: null, outputDir: outDir, withBaseline: true,
    })
    expect(second.report.delta).not.toBeNull()
    expect(second.report.delta!['overall_score']).toBeCloseTo(0)  // 同 executor 无变化
    expect(second.report.baselineRunId).not.toBe(second.report.runId)
    rmSync(outDir, { recursive: true, force: true })
  }, 30000)
})

describe('evolution-bridge（评测失败 -> EvolutionSignal）', () => {
  it('低质量失败用例生成信号，高质量失败不生成', () => {
    const report = {
      runId: 'run-evo',
      datasetName: 'smoke',
      failures: [
        { caseId: 'low-quality', category: 'regression', failedMetrics: ['system_task_success'] },
        { caseId: 'high-quality', category: 'core', failedMetrics: ['system_task_success'] },
      ],
    } as any

    const caseResults = [
      {
        caseId: 'low-quality', category: 'regression', tags: ['regression'],
        metrics: { system_task_success: 0 },   // block 指标 0 -> 质量分 0（低）
        pass: false, failedBlockMetrics: ['system_task_success'],
        agentRun: { response: 'x', toolCalls: [] },
      },
      {
        caseId: 'high-quality', category: 'core', tags: [],
        metrics: { system_task_success: 0.95 }, // block 指标 0.95（仍 <0.8? 不，0.95>0.8 但假设 fail）
        pass: false, failedBlockMetrics: ['system_task_success'],
        agentRun: { response: 'y', toolCalls: [] },
      },
    ] as any

    const signals = buildEvolutionSignals(report, caseResults, { minQualityScore: 0.6 })
    // high-quality 的质量分 0.95 > 0.6 -> 不生成
    expect(signals).toHaveLength(1)
    expect(signals[0].signalType).toBe('evaluation_failure')
    expect(signals[0].context['case_id']).toBe('low-quality')
    expect(signals[0].source).toBe('evals.dataset.smoke')
  })
})
