// ============================================================
// 需求澄清评测器（阶段3）
//
// 目的：把「误触发率 ≤ 15%（precision ≥ 0.85）」从口头标准变成可执行门禁。
//
// 方法：对 clarification 数据集里标注了期望的用例，调用被测判定函数
// （默认 assessClarificationNeed —— 规则路径，配置缺省读内核真实配置），
// 统计混淆矩阵与 precision / recall / F1 / 误触发率；并按 llm-required
// 标签分组报告规则路径的盲区规模（需 llm_judge 复判才能覆盖）。
//
// 与内核的关系：本评测器只做统计与门禁，判定逻辑仍在内核 clarity-detector。
// 调参（min_input_chars / insufficient_patterns / clarity_threshold）后重跑本评测，
// 即可在数据上对比效果，避免"凭感觉调阈值"。
// ============================================================

import { assessClarificationNeed } from '@pioneering/modu-agent'
import { buildDataset, loadDatasetRegistry, loadPreprocessing } from './dataset-loader.js'

export interface ClarifyEvalCaseResult {
  id: string
  input: string
  /** 标签给出的期望（expect_clarify=true / expect_no_clarify=false） */
  expected: boolean
  /** 规则判定的实际结果 */
  actual: boolean
  /** 判定原因（内核 reason，便于定位误判来源） */
  reason: string
  /** 规则路径的已知盲区样本（语义歧义，需 LLM 复判） */
  llmRequired: boolean
  pass: boolean
}

export interface ClarifyEvalReport {
  /** 数据集用例总数 */
  total: number
  /** 参与评测的用例数（有期望标注的） */
  examined: number
  /** 参与主门禁统计的样本数（排除 llm-required） */
  ruleScope: number
  passed: number
  truePositive: number
  falsePositive: number
  falseNegative: number
  trueNegative: number
  /** 判定准确率 = TP / (TP + FP)；无澄清样本时为 null（仅统计规则范围内样本） */
  precision: number | null
  /** 模糊需求召回率 = TP / (TP + FN)；无模糊样本时为 null（仅统计规则范围内样本） */
  recall: number | null
  /** F1 = 2PR / (P + R) */
  f1: number | null
  /** 误触发率 = FP / (FP + TN)；无明确样本时为 null */
  falsePositiveRate: number | null
  /** llm-required 样本：规则路径覆盖情况（总样本数 / 被规则覆盖数） */
  llmRequired: { total: number; covered: number }
  cases: ClarifyEvalCaseResult[]
}

export interface ClarifyEvalOptions {
  /** 数据集名（默认 'clarification'） */
  datasetName?: string
  /**
   * 判定配置（perception.clarification 块）。
   * 缺省（null/undefined）时由内核读取真实 config.yaml 的灰度配置。
   */
  cfg?: Record<string, any> | null
}

/** 灰度门禁：precision ↔ 误触发率上限 15%；recall 允许漏报换低打扰 */
export const CLARIFY_GATE = {
  minPrecision: 0.85,
  minRecall: 0.6,
} as const

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return numerator / denominator
}

/**
 * 运行需求澄清评测（同步：规则判定为零成本纯函数）。
 */
export function runClarificationEval(opts: ClarifyEvalOptions = {}): ClarifyEvalReport {
  const registry = loadDatasetRegistry()
  const pp = loadPreprocessing()
  const dataset = buildDataset(registry, opts.datasetName ?? 'clarification', pp)

  const cases: ClarifyEvalCaseResult[] = []
  for (const c of dataset.cases) {
    const expectClarify = c.tags.includes('expect_clarify')
    const expectNoClarify = c.tags.includes('expect_no_clarify')
    // 未标注期望的用例不参与门禁统计（数据集允许混入纯演示样本）
    if (!expectClarify && !expectNoClarify) continue

    const decision = assessClarificationNeed(
      { cleaned_text: c.input, input_data: { prompt: c.input }, clarification_round: 0 },
      opts.cfg ?? null,
    )
    const expected = expectClarify
    const actual = decision.needed
    cases.push({
      id: c.id,
      input: c.input,
      expected,
      actual,
      reason: decision.reason,
      llmRequired: c.tags.includes('llm-required'),
      pass: actual === expected,
    })
  }

  // 混淆矩阵只统计「规则声明能力范围内」的样本：
  // llm-required（语义歧义）是 llm_judge 复判的目标，计入 recall 分母会让
  // 规则门禁永远不达标——它们单独在 llmRequired 中报告覆盖率。
  let truePositive = 0
  let falsePositive = 0
  let falseNegative = 0
  let trueNegative = 0
  let ruleScope = 0
  for (const r of cases) {
    if (r.llmRequired) continue
    ruleScope += 1
    if (r.expected && r.actual) truePositive += 1
    else if (!r.expected && r.actual) falsePositive += 1
    else if (r.expected && !r.actual) falseNegative += 1
    else trueNegative += 1
  }

  const precision = ratio(truePositive, truePositive + falsePositive)
  const recall = ratio(truePositive, truePositive + falseNegative)
  const f1 =
    precision !== null && recall !== null && precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : null
  const falsePositiveRate = ratio(falsePositive, falsePositive + trueNegative)

  const llmCases = cases.filter((r) => r.llmRequired)
  return {
    total: dataset.cases.length,
    examined: cases.length,
    ruleScope,
    passed: cases.filter((r) => r.pass).length,
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    precision,
    recall,
    f1,
    falsePositiveRate,
    llmRequired: {
      total: llmCases.length,
      covered: llmCases.filter((r) => r.actual).length,
    },
    cases,
  }
}

/** 门禁判定：返回未达标项（空数组 = 通过） */
export function checkClarifyGate(report: ClarifyEvalReport): string[] {
  const failures: string[] = []
  if (report.precision === null || report.precision < CLARIFY_GATE.minPrecision) {
    failures.push(
      `precision ${report.precision?.toFixed(2) ?? 'n/a'} < ${CLARIFY_GATE.minPrecision}（误触发率过高）`,
    )
  }
  if (report.recall === null || report.recall < CLARIFY_GATE.minRecall) {
    failures.push(
      `recall ${report.recall?.toFixed(2) ?? 'n/a'} < ${CLARIFY_GATE.minRecall}（模糊需求漏检过多）`,
    )
  }
  return failures
}
