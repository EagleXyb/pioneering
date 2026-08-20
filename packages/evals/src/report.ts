// ============================================================
// 评测报告：聚合、持久化与 baseline 回归对比
//
// 职责：
//   1. aggregate()：把单用例结果聚合为 EvalReport
//      —— 指标级 avg/min/max/p50/passRate + 层级分 + 加权总分
//   2. saveReport()/loadBaseline()：JSON 持久化与最近一次
//      同数据集报告读取（baseline='latest' 策略）
//   3. computeDelta()：current vs baseline 的逐指标差值
//      （回归检测的数据来源，gate 的 delta 规则消费）
// ============================================================

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  EvalCaseResult,
  EvalReport,
  MetricCategory,
  MetricSummary,
  MetricThresholdDef,
  ThresholdsConfig,
} from './types.js'

/** 单用例指标值是否达标（higher_is_better=false 时越低越好）。 */
export function metricMeetsThreshold(
  value: number,
  def: MetricThresholdDef,
): boolean {
  if (def.higherIsBetter === false) return value <= def.threshold
  return value >= def.threshold
}

/** 分位数（线性插值；p50=中位数）。 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

/**
 * 聚合单用例结果为报告。
 *
 * 规则：
 *   - 指标聚合仅纳入"产出该指标"的用例（gt 类指标自动排除不适用用例）
 *   - 层级分 = 层内指标 avg 按 weight 归一化加权
 *   - 总分 = 全部启用（gate != off 且有数据）指标 avg 按 weight 归一化加权
 *   - 单用例 pass = 无任何 block 指标低于阈值
 */
export function aggregate(
  datasetName: string,
  results: EvalCaseResult[],
  thresholds: ThresholdsConfig,
  startedAt: string,
  finishedAt: string,
): EvalReport {
  const metrics: Record<string, MetricSummary> = {}

  for (const [key, def] of Object.entries(thresholds.metrics)) {
    const values = results
      .map((r) => r.metrics[key])
      .filter((v): v is number => typeof v === 'number')
    if (values.length === 0) continue

    const sorted = [...values].sort((a, b) => a - b)
    const sum = values.reduce((a, b) => a + b, 0)
    const passCount = values.filter((v) => metricMeetsThreshold(v, def)).length
    metrics[key] = {
      key,
      category: def.category,
      avg: sum / values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: percentile(sorted, 0.5),
      passRate: passCount / values.length,
      count: values.length,
    }
  }

  // 层级分（层内 weight 归一化）
  const layerScores: Record<MetricCategory, number> = { output: 0, process: 0, system: 0 }
  for (const layer of ['output', 'process', 'system'] as MetricCategory[]) {
    let wSum = 0
    let wTotal = 0
    for (const m of Object.values(metrics)) {
      if (m.category !== layer) continue
      const def = thresholds.metrics[m.key]
      wSum += m.avg * def.weight
      wTotal += def.weight
    }
    layerScores[layer] = wTotal > 0 ? wSum / wTotal : 0
  }

  // 加权总分（全部有数据指标，weight 归一化）
  let scoreSum = 0
  let scoreWeight = 0
  for (const m of Object.values(metrics)) {
    const def = thresholds.metrics[m.key]
    scoreSum += m.avg * def.weight
    scoreWeight += def.weight
  }
  const overallScore = scoreWeight > 0 ? scoreSum / scoreWeight : 0

  // 按 category 分组通过率
  const perCategory: Record<string, { count: number; passCount: number; passRate: number }> = {}
  for (const r of results) {
    const g = (perCategory[r.category] ??= { count: 0, passCount: 0, passRate: 0 })
    g.count++
    if (r.pass) g.passCount++
  }
  for (const g of Object.values(perCategory)) g.passRate = g.count > 0 ? g.passCount / g.count : 0

  const passCount = results.filter((r) => r.pass).length
  const failures = results
    .filter((r) => !r.pass)
    .map((r) => ({ caseId: r.caseId, category: r.category, failedMetrics: r.failedBlockMetrics }))

  return {
    runId: `run-${finishedAt.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`,
    datasetName,
    startedAt,
    finishedAt,
    caseCount: results.length,
    passCount,
    casePassRate: results.length > 0 ? passCount / results.length : 0,
    overallScore,
    layerScores,
    metrics,
    perCategory,
    failures,
    delta: null,
    baselineRunId: null,
  }
}

// ============================================================
// 持久化与 baseline
// ============================================================

/** 报告 JSON 文件名（runId 前缀，字典序即时间序）。 */
function reportFileName(report: EvalReport): string {
  return `${report.runId}.${report.datasetName}.json`
}

/** 写入报告 JSON（目录自动创建）。返回写入路径。 */
export function saveReport(report: EvalReport, outputDir: string): string {
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })
  const path = resolve(outputDir, reportFileName(report))
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf-8')
  return path
}

/**
 * 读取 baseline：指定数据集最近一次（字典序最大文件名）的历史报告。
 * 不含本次 runId 的文件（saveReport 之后调用时排除自身）。
 */
export function loadBaseline(
  outputDir: string,
  datasetName: string,
  excludeRunId?: string,
): EvalReport | null {
  if (!existsSync(outputDir)) return null
  const files = readdirSync(outputDir)
    .filter((f) => f.endsWith(`.${datasetName}.json`))
    .sort()
  for (let i = files.length - 1; i >= 0; i--) {
    try {
      const raw = JSON.parse(readFileSync(resolve(outputDir, files[i]), 'utf-8')) as EvalReport
      if (excludeRunId && raw.runId === excludeRunId) continue
      return raw
    } catch {
      // 损坏文件跳过
    }
  }
  return null
}

/** 清理历史报告，仅保留最近 keepRuns 份。 */
export function pruneReports(outputDir: string, keepRuns: number): void {
  if (!existsSync(outputDir) || keepRuns <= 0) return
  const files = readdirSync(outputDir).filter((f) => f.endsWith('.json')).sort()
  const excess = files.length - keepRuns
  for (let i = 0; i < excess; i++) {
    try {
      unlinkSync(resolve(outputDir, files[i]))
    } catch {
      // 清理失败忽略
    }
  }
}

/** 计算逐指标差值（current - baseline）与总分差值。 */
export function computeDelta(current: EvalReport, baseline: EvalReport | null): Record<string, number> {
  if (!baseline) return {}
  const delta: Record<string, number> = {}
  for (const [key, summary] of Object.entries(current.metrics)) {
    const b = baseline.metrics[key]
    if (b) delta[key] = summary.avg - b.avg
  }
  delta['overall_score'] = current.overallScore - baseline.overallScore
  delta['case_pass_rate'] = current.casePassRate - baseline.casePassRate
  return delta
}
