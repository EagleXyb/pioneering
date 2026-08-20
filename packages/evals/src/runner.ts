// ============================================================
// EvaluationRunner：评测编排核心
//
// 流水线（对应"评测流程自动化"）：
//   execute（并发池 + 超时 + 重试）
//     -> judge（output 层，LLM-as-Judge / rule）
//     -> process / system 层指标
//     -> 单用例 pass 判定（block 指标门控）
//     -> aggregate（聚合报告）
//     -> baseline delta（回归检测）
//     -> save（JSON 持久化）
//
// 依赖注入：executor 抽象（CaseExecutor）使测试可用 fake Agent，
// 生产用 agent-executor 的真实实现。
// ============================================================

import { QualityMonitor } from '@pioneering/modu-agent'
import { computeDelta, aggregate, loadBaseline, pruneReports, saveReport } from './report.js'
import { createMetricGroups } from './metrics.js'
import type { CaseExecutor } from './agent-executor.js'
import type {
  AgentRunResult,
  EvalCaseResult,
  EvalDataset,
  EvalReport,
  ThresholdsConfig,
} from './types.js'
import type { GlobalConfig } from './config-loader.js'
import { resolve } from 'node:path'
import { EVALS_ROOT } from './config-loader.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[evals.runner] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[evals.runner] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[evals.runner] ${msg}`, ...args),
}

export interface RunnerOptions {
  /** 数据集（必传）。 */
  dataset: EvalDataset
  /** 用例执行器（必传；测试注入 fake）。 */
  executor: CaseExecutor
  /** 指标阈值定义（thresholds.yaml）。 */
  thresholds: ThresholdsConfig
  /** 全局配置（runner 并发/超时/重试 + judge 参数）。 */
  globalConfig: GlobalConfig
  /** LLM-as-Judge 的 ModuLLM（null=rule 模式）。 */
  judgeLlm?: any | null
  /** 报告输出目录（空=不落盘）。 */
  outputDir?: string | null
  /** 是否计算 baseline delta（默认按 global.report.baseline）。 */
  withBaseline?: boolean
}

/** runDataset 的返回：报告 + 单用例明细（evolution-bridge 消费）。 */
export interface RunnerOutput {
  report: EvalReport
  caseResults: EvalCaseResult[]
}

/** 带超时的 Promise 包装。 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve_, reject) => {
    const timer = setTimeout(() => reject(new Error('EVAL_CASE_TIMEOUT')), timeoutMs)
    promise.then(
      (v) => { clearTimeout(timer); resolve_(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

/** 超时/异常的兜底 AgentRunResult（保留 caseId 关联，指标记 0）。 */
function timeoutResult(evalCaseId: string, latencyMs: number, error: unknown): AgentRunResult {
  return {
    caseId: evalCaseId,
    ok: false,
    response: '',
    toolCalls: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    iteration: 0,
    reasoningRoundCount: 0,
    latencyMs,
    errorCode: 'EVAL_CASE_TIMEOUT',
    errorMessage: String(error),
    timedOut: true,
  }
}

/**
 * 评测运行器。
 */
export class EvaluationRunner {
  private readonly cfg: GlobalConfig
  private readonly thresholds: ThresholdsConfig

  constructor(thresholds: ThresholdsConfig, globalConfig: GlobalConfig) {
    this.thresholds = thresholds
    this.cfg = globalConfig
  }

  /**
   * 执行单用例评测（执行 -> 三层指标 -> pass 判定）。
   */
  async evalCase(
    evalCase: EvalDataset['cases'][number],
    executor: CaseExecutor,
    judge: QualityMonitor,
  ): Promise<EvalCaseResult> {
    const timeoutMs = this.cfg.runner?.timeout_ms ?? 120_000
    const retries = this.cfg.runner?.retries ?? 1

    // ---- 执行（超时 + 重试） ----
    let agentRun: AgentRunResult | null = null
    let lastError: unknown = null
    for (let attempt = 0; attempt <= retries; attempt++) {
      const startedAt = Date.now()
      try {
        agentRun = await withTimeout(executor(evalCase), timeoutMs)
        break
      } catch (e) {
        lastError = e
        logger.warning(
          `用例 ${evalCase.id} 第 ${attempt + 1} 次执行失败: ${String(e)}`,
        )
        if (attempt === retries) {
          agentRun = timeoutResult(evalCase.id, Date.now() - startedAt, e)
        }
      }
    }
    if (agentRun === null) {
      agentRun = timeoutResult(evalCase.id, 0, lastError ?? 'unknown')
    }

    // ---- 三层指标（output -> process -> system 顺序，system 复用 output） ----
    const groups = createMetricGroups(judge)
    const ctx = { evalCase, agentRun }
    const outputMetrics = await groups.output.compute(ctx)
    const processMetrics = groups.process.compute({ ...ctx, outputMetrics })
    const systemMetrics = groups.system.compute({ ...ctx, outputMetrics })

    const metrics: Record<string, number> = {
      ...outputMetrics,
      ...processMetrics,
      ...systemMetrics,
    }

    // ---- 单用例 pass 判定：block 指标低于阈值即 fail ----
    const failedBlockMetrics: string[] = []
    for (const [key, value] of Object.entries(metrics)) {
      const def = this.thresholds.metrics[key]
      if (!def || def.gate !== 'block') continue
      const higherBetter = def.higherIsBetter !== false
      const failed = higherBetter ? value < def.threshold : value > def.threshold
      if (failed) failedBlockMetrics.push(key)
    }

    return {
      caseId: evalCase.id,
      category: evalCase.category,
      tags: evalCase.tags,
      metrics,
      pass: failedBlockMetrics.length === 0,
      failedBlockMetrics,
      agentRun,
    }
  }

  /**
   * 跑整个数据集：并发池执行 -> 聚合 -> baseline 对比 -> 落盘。
   */
  async runDataset(options: RunnerOptions): Promise<RunnerOutput> {
    const { dataset, executor, outputDir } = options
    const concurrency = Math.max(1, this.cfg.runner?.concurrency ?? 4)
    const startedAt = new Date().toISOString()

    logger.info(
      `开始评测数据集 '${dataset.name}': ${dataset.cases.length} 用例, 并发=${concurrency}`,
    )

    // ---- judge（rule 模式零成本；llm/hybrid 由注入的 judgeLlm 驱动） ----
    const judgeMode = this.cfg.judge?.mode ?? 'rule'
    const judge = new QualityMonitor(
      options.judgeLlm ?? null,
      judgeMode,
      this.cfg.judge?.timeout_seconds ?? 15,
      this.cfg.judge?.temperature ?? 0,
      this.cfg.judge?.max_tokens ?? 256,
      this.cfg.judge?.hybrid_rule_weight ?? 0.4,
      this.cfg.judge?.hybrid_llm_weight ?? 0.6,
    )

    // ---- 并发池 ----
    const results: EvalCaseResult[] = new Array(dataset.cases.length)
    let cursor = 0
    let completed = 0
    const workers = Array.from({ length: Math.min(concurrency, dataset.cases.length) }, async () => {
      for (;;) {
        const idx = cursor++
        if (idx >= dataset.cases.length) break
        const evalCase = dataset.cases[idx]
        try {
          results[idx] = await this.evalCase(evalCase, executor, judge)
        } catch (e) {
          // 引擎级兜底：任何意外异常都转成失败用例（评测永不中断）
          logger.error(`用例 ${evalCase.id} 评测异常: ${String(e)}`)
          results[idx] = {
            caseId: evalCase.id,
            category: evalCase.category,
            tags: evalCase.tags,
            metrics: {},
            pass: false,
            failedBlockMetrics: ['internal_error'],
            agentRun: timeoutResult(evalCase.id, 0, e),
          }
        }
        completed++
        logger.info(`进度: ${completed}/${dataset.cases.length}（${evalCase.id} 完成）`)
      }
    })
    await Promise.all(workers)

    // ---- 聚合 ----
    const finishedAt = new Date().toISOString()
    const report = aggregate(dataset.name, results, this.thresholds, startedAt, finishedAt)

    // ---- baseline delta（回归检测） ----
    const wantBaseline = options.withBaseline ?? (this.cfg.report?.baseline !== 'none')
    if (wantBaseline && outputDir) {
      const baseline = loadBaseline(outputDir, dataset.name, report.runId)
      if (baseline) {
        report.delta = computeDelta(report, baseline)
        report.baselineRunId = baseline.runId
        logger.info(
          `baseline 对比: ${baseline.runId} -> ${report.runId}, overall delta=${(report.delta['overall_score'] ?? 0).toFixed(4)}`,
        )
      }
    }

    // ---- 落盘 + 清理 ----
    if (outputDir) {
      const path = saveReport(report, outputDir)
      logger.info(`报告已写入: ${path}`)
      const keep = this.cfg.report?.keep_runs ?? 30
      if (keep > 0) pruneReports(outputDir, keep)
    }

    logger.info(
      `数据集 '${dataset.name}' 评测完成: pass=${report.passCount}/${report.caseCount} ` +
      `(${(report.casePassRate * 100).toFixed(1)}%), overall=${report.overallScore.toFixed(4)}`,
    )
    return { report, caseResults: results }
  }
}

/** 便捷工厂：按配置组装 runner 并跑数据集。 */
export async function runEvaluation(options: RunnerOptions): Promise<RunnerOutput> {
  const runner = new EvaluationRunner(options.thresholds, options.globalConfig)
  const outputDir = options.outputDir ?? resolve(EVALS_ROOT, options.globalConfig.report?.output_dir ?? 'reports')
  return runner.runDataset({ ...options, outputDir })
}
