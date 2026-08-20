// ============================================================
// CI/CD 门禁评估
//
// 契约（CI 无关）：
//   - evaluateGate() 输入门禁定义 + 各数据集报告，输出 GateResult
//   - CLI 依据 GateResult.exitCode 退出（0=pass/warn，1=block），
//     可对接任意 CI 系统（GitHub Actions / GitLab CI / Jenkins）
//
// 规则取值语义：
//   scope=dataset（默认）：metric 为 thresholds.yaml 指标的聚合 avg
//     或内置伪指标（case_pass_rate / regression_failure_count / overall_score）
//   scope=delta：metric 的相对 baseline 差值（负数=退化）
// ============================================================

import type {
  EvalReport,
  GateDef,
  GateResult,
  GateRule,
} from './types.js'

/** 比较运算。 */
function compare(actual: number, op: GateRule['op'], expected: number): boolean {
  switch (op) {
    case '>=': return actual >= expected
    case '<=': return actual <= expected
    case '>': return actual > expected
    case '<': return actual < expected
    case '==': return actual === expected
    default: return false
  }
}

/**
 * 从报告中解析规则左侧取值。
 *
 * 内置伪指标（无需在 thresholds.yaml 定义）：
 *   overall_score           加权总分（scope=delta 时为其差值）
 *   case_pass_rate          用例通过率
 *   regression_failure_count regression 类失败用例数（回归集全绿判据）
 */
function resolveMetricValue(report: EvalReport, rule: GateRule): number | null {
  if (rule.scope === 'delta') {
    if (!report.delta) return null
    return report.delta[rule.metric] ?? null
  }

  switch (rule.metric) {
    case 'overall_score':
      return report.overallScore
    case 'case_pass_rate':
      return report.casePassRate
    case 'regression_failure_count': {
      const regressionFailures = report.failures.filter((f) => f.category === 'regression')
      return regressionFailures.length
    }
    default: {
      const summary = report.metrics[rule.metric]
      return summary ? summary.avg : null
    }
  }
}

/**
 * 评估门禁。
 *
 * 多数据集（如 release 门禁的 [full, regression]）语义：
 *   - block 规则：任一数据集违反即 block
 *   - warn 规则：任一数据集触发即 warn（不阻断）
 *   - 指标无数据（如数据集无 gt 用例而规则引用 gt 指标）→ 记 warning 不记 failure
 *
 * @param gateName 门禁名（ci / release ...）
 * @param gateDef ci_gates.yaml 中的门禁定义
 * @param reports 各数据集的评测报告（key=datasetName）
 */
export function evaluateGate(
  gateName: string,
  gateDef: GateDef,
  reports: Record<string, EvalReport>,
): GateResult {
  const failures: GateResult['failures'] = []
  const warnings: GateResult['warnings'] = []

  for (const [datasetName, report] of Object.entries(reports)) {
    for (const rule of gateDef.rules ?? []) {
      const actual = resolveMetricValue(report, rule)
      if (actual === null) {
        // 数据缺失：降级为告警（避免无 gt 数据集误杀 CI）
        warnings.push({
          rule,
          actual: Number.NaN,
          reportRunId: report.runId,
          datasetName,
        })
        continue
      }
      if (!compare(actual, rule.op, rule.value)) {
        if (rule.action === 'block') {
          failures.push({ rule, actual, reportRunId: report.runId, datasetName })
        } else {
          warnings.push({ rule, actual, reportRunId: report.runId, datasetName })
        }
      }
    }
  }

  const decision = failures.length > 0 ? 'block' : warnings.length > 0 ? 'warn' : 'pass'
  const exitCode = decision === 'block' ? (gateDef.on_failure?.exit_code ?? 1) : 0

  // 摘要（stdout 供 CI 日志直接消费）
  const lines: string[] = []
  lines.push(`门禁 '${gateName}' 评估结果: ${decision.toUpperCase()}`)
  for (const f of failures) {
    lines.push(
      `  [BLOCK] ${f.datasetName}#${f.rule.metric}${f.rule.scope === 'delta' ? '(delta)' : ''}: ` +
      `实际=${f.actual.toFixed(4)} 期望 ${f.rule.op} ${f.rule.value}`,
    )
  }
  for (const w of warnings) {
    const actualStr = Number.isNaN(w.actual) ? 'N/A(无数据)' : w.actual.toFixed(4)
    lines.push(
      `  [WARN] ${w.datasetName}#${w.rule.metric}${w.rule.scope === 'delta' ? '(delta)' : ''}: ` +
      `实际=${actualStr} 期望 ${w.rule.op} ${w.rule.value}`,
    )
  }
  lines.push(`  退出码: ${exitCode}`)

  return {
    gateName,
    decision,
    failures,
    warnings,
    exitCode,
    summary: lines.join('\n'),
  }
}
