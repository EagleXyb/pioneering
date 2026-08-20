// ============================================================
// 评测 -> 进化闭环桥接
//
// 职责：将评测失败用例转译为 modu-agent 的 EvolutionSignal，
// 喂给 EvolutionSignalCollector，供 ParameterTuneStrategy /
// EvolutionOrchestrator 消费——实现"评测驱动持续优化"：
//
//   评测失败 → EvolutionSignal(quality_score/context.case_id)
//            → EvolutionSignalCollector.getSignals()
//            → ParameterTuneStrategy.analyzeAndAdjust()
//            → config_overrides（下一轮 run 生效）→ 再评测验证
//
// 这条链路与 modu-agent 运行时的 feedback/evolution 闭环
// （QualityMonitor → FeedbackLoop → ParameterTune）同构，
// 区别是评测侧信号基于离线数据集，样本充足、可复现。
// ============================================================

import { EvolutionSignal } from '@pioneering/modu-agent'
import type { EvalCaseResult, EvalReport } from './types.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[evals.evolution] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[evals.evolution] ${msg}`, ...args),
}

export interface EvolutionBridgeConfig {
  enabled?: boolean
  minQualityScore?: number
  severity?: string
}

/**
 * 从评测结果构建进化信号。
 *
 * 信号设计（对齐 EvolutionSignalCollector 的消费语义）：
 *   signalType: 'evaluation_failure'（评测失败）/ 'evaluation_low_quality'（低分）
 *   source:     'evals.dataset.<name>'
 *   metrics:    { quality_score, task_success, tool_success_rate }
 *   context:    { case_id, category, tags, failed_metrics, response_snippet }
 *   severity:   按配置（low/medium/high）
 */
export function buildEvolutionSignals(
  report: EvalReport,
  caseResults: EvalCaseResult[],
  cfg: EvolutionBridgeConfig = {},
): EvolutionSignal[] {
  const minQuality = cfg.minQualityScore ?? 0.6
  const severity = cfg.severity ?? 'medium'
  const byId = new Map(caseResults.map((r) => [r.caseId, r]))

  const signals: EvolutionSignal[] = []
  for (const failure of report.failures) {
    const cr = byId.get(failure.caseId)
    if (!cr) continue

    // 用例综合质量分（其产出的 block 级指标均值）
    const blockScores = failure.failedMetrics
      .map((k) => cr.metrics[k])
      .filter((v): v is number => typeof v === 'number')
    const qualityScore =
      blockScores.length > 0
        ? blockScores.reduce((a, b) => a + b, 0) / blockScores.length
        : 0

    // 仅低质量失败才触发进化（高整体分但个别维度失守的用例噪音大）
    if (qualityScore > minQuality) continue

    signals.push(
      new EvolutionSignal(
        'evaluation_failure',
        `evals.dataset.${report.datasetName}`,
        Date.now() / 1000,
        {
          quality_score: qualityScore,
          task_success: cr.metrics['system_task_success'] ?? 0,
          tool_success_rate: cr.metrics['process_tool_success_rate'] ?? 1,
        },
        {
          case_id: cr.caseId,
          category: cr.category,
          tags: cr.tags,
          failed_metrics: failure.failedMetrics,
          response_snippet: cr.agentRun.response.slice(0, 300),
          run_id: report.runId,
        },
        severity,
      ),
    )
  }

  logger.info(
    `进化信号构建完成: ${signals.length} 条（失败 ${report.failures.length} 条，` +
    `质量分 <= ${minQuality} 的进入闭环）`,
  )
  return signals
}

/**
 * 将信号注入 modu-agent 的 EvolutionSignalCollector。
 *
 * 返回注入后的信号全量快照（测试与 CI 日志用）。
 */
export function feedEvolutionCollector(
  collector: { getSignals(): any[] },
  signals: EvolutionSignal[],
): any[] {
  // EvolutionSignalCollector 的公开写入口是 onAgentEvent（事件驱动）；
  // 评测侧没有 AgentEvent，直接复用其 getSignals 快照语义：
  // 由调用方（宿主/脚本）把 signals 传入 ParameterTuneStrategy.analyzeAndAdjust。
  // 这里做存在性校验 + 透传，保持桥接层的松耦合。
  if (typeof collector.getSignals !== 'function') {
    logger.warning('EvolutionSignalCollector 接口不符（缺少 getSignals），跳过注入')
    return []
  }
  return [...collector.getSignals(), ...signals]
}
