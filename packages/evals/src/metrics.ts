// ============================================================
// 分层指标实现（MetricGroup）
//
// 三层指标树（key 与 metrics/thresholds.yaml 一一对应）：
//   OutputMetricGroup  —— 复用 modu-agent QualityMonitor
//                         （rule/llm/hybrid 三模 LLM-as-Judge）
//   ProcessMetricGroup —— 轨迹行为分析（工具成功率/覆盖/冗余/恢复/迭代）
//   SystemMetricGroup  —— 端到端任务达成（task_success/ground_truth_match）
//
// 输出约定：每组返回 Record<metricKey, number>，key 由
// thresholds.yaml 引用；不适用的指标（如无 ground_truth 的用例）
// 直接不产出该 key，聚合层自动排除。
// ============================================================

import { QualityMonitor } from '@pioneering/modu-agent'
import type { AgentRunResult, EvalCase, MetricContext, ToolCallRecord } from './types.js'

// ============================================================
// 工具调用辅助
// ============================================================

/** 工具调用指纹（tool + 规范化 args），用于冗余调用检测。 */
function callFingerprint(call: ToolCallRecord): string {
  const argsKey = JSON.stringify(call.args ?? {})
  return `${call.toolName}::${argsKey}`
}

// ============================================================
// 输出层指标组（复用 QualityMonitor）
// ============================================================

/**
 * 输出层：最终回答质量。
 *
 * 产出 key：output_relevance / output_completeness /
 *          output_accuracy / output_confidence
 * （QualityMonitor.evaluateAsync 的四维结果映射；
 *  overall 不在此层产出——由报告层加权聚合）
 */
export class OutputMetricGroup {
  private readonly judge: QualityMonitor

  constructor(judge?: QualityMonitor) {
    // 默认 rule 模式（零 LLM 成本）；llm/hybrid 由 runner 注入
    this.judge = judge ?? new QualityMonitor(null, 'rule')
  }

  async compute(ctx: MetricContext): Promise<Record<string, number>> {
    const { agentRun } = ctx
    if (!agentRun.ok || !agentRun.response.trim()) {
      // 执行失败/空响应：四维全 0（不短路后续层，保留失败可见性）
      return {
        output_relevance: 0,
        output_completeness: 0,
        output_accuracy: 0,
        output_confidence: 0,
      }
    }
    const result = await this.judge.evaluateAsync(
      ctx.evalCase.input,
      agentRun.response,
      // tool_result 上下文：任一失败调用触发 tool_success 扣分逻辑
      { tool_result: agentRun.toolCalls.find((c) => !c.success) ?? null },
    )
    const clamp01 = (v: any, dflt = 0): number => {
      const n = Number(v)
      return Number.isNaN(n) ? dflt : Math.max(0, Math.min(1, n))
    }
    return {
      output_relevance: clamp01(result['relevance']),
      output_completeness: clamp01(result['completeness']),
      output_accuracy: clamp01(result['accuracy']),
      output_confidence: clamp01(result['confidence']),
    }
  }
}

// ============================================================
// 过程层指标组（轨迹行为分析）
// ============================================================

/**
 * 过程层：轨迹行为质量。
 *
 * 产出 key：
 *   process_tool_success_rate     成功调用 / 总调用（无期望工具且无调用=1）
 *   process_tool_coverage         期望工具覆盖比率（expectedTools 空时=1）
 *   process_redundant_calls       重复（tool+args）调用占比（越低越好）
 *   process_recovery_rate         失败后参数调整重试的比率（无失败=1）
 *   process_iteration_efficiency  调用数是否在预算内（maxToolCalls）
 */
export class ProcessMetricGroup {
  compute(ctx: MetricContext): Record<string, number> {
    const { agentRun, evalCase } = ctx
    const calls = agentRun.toolCalls
    const expected = evalCase.expectedTools ?? []

    // ---- tool_success_rate ----
    let toolSuccessRate: number
    if (calls.length === 0) {
      toolSuccessRate = expected.length > 0 ? 0 : 1
    } else {
      const okCount = calls.filter((c) => c.success).length
      toolSuccessRate = okCount / calls.length
    }

    // ---- tool_coverage ----
    let coverage: number
    if (expected.length === 0) {
      coverage = 1
    } else {
      const called = new Set(calls.map((c) => c.toolName))
      const hit = expected.filter((t) => called.has(t)).length
      coverage = hit / expected.length
    }

    // ---- redundant_calls ----
    let redundantRatio = 0
    if (calls.length > 1) {
      const seen = new Set<string>()
      let duplicates = 0
      for (const c of calls) {
        const fp = callFingerprint(c)
        if (seen.has(fp)) duplicates++
        else seen.add(fp)
      }
      redundantRatio = duplicates / calls.length
    }

    // ---- recovery_rate ----
    // 失败调用之后：若存在下一次调用且指纹不同（换参数/换工具）记为成功恢复。
    // 末尾失败调用无后续行为可评，不计入分母（其失败已由
    // tool_success_rate / task_success 指标惩罚，此处只衡量纠错质量）。
    let recoveryRate = 1
    {
      const failureIdx = calls
        .map((c, i) => (c.success ? -1 : i))
        .filter((i) => i >= 0 && i < calls.length - 1)   // 排除末尾失败
      if (failureIdx.length > 0) {
        let recovered = 0
        for (const i of failureIdx) {
          const next = calls[i + 1]
          if (next && callFingerprint(next) !== callFingerprint(calls[i])) recovered++
        }
        recoveryRate = recovered / failureIdx.length
      }
    }

    // ---- iteration_efficiency ----
    let iterationEfficiency = 1
    {
      const budget = evalCase.maxToolCalls
      if (budget !== undefined && calls.length > budget) {
        iterationEfficiency = Math.max(0, 1 - (calls.length - budget) / budget)
      }
    }

    return {
      process_tool_success_rate: toolSuccessRate,
      process_tool_coverage: coverage,
      process_redundant_calls: redundantRatio,
      process_recovery_rate: recoveryRate,
      process_iteration_efficiency: iterationEfficiency,
    }
  }
}

// ============================================================
// 系统层指标组（端到端任务达成）
// ============================================================

/** 中文字符 bigram Jaccard 相似度（ground_truth_match 的召回实现）。 */
function bigramJaccard(a: string, b: string): number {
  const norm = (s: string): string => s.replace(/[\s，。、；：""''！？,.!?;:'"()（）]/g, '').toLowerCase()
  const grams = (s: string): Set<string> => {
    const t = norm(s)
    const set = new Set<string>()
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2))
    if (t.length === 1) set.add(t)
    return set
  }
  const ga = grams(a)
  const gb = grams(b)
  if (ga.size === 0 || gb.size === 0) return 0
  let inter = 0
  for (const g of ga) if (gb.has(g)) inter++
  return inter / (ga.size + gb.size - inter)
}

/**
 * 系统层：端到端任务达成。
 *
 * 产出 key：
 *   system_task_success        执行成功 && 非空回复 && （有 gt 时 gt 匹配）
 *                              （无 gt 时以 output_relevance 达标为替代判据）
 *   system_ground_truth_match  参考答案匹配分（子串包含 -> 1.0，
 *                              否则 bigram Jaccard；无 gt 用例不产出）
 */
export class SystemMetricGroup {
  compute(ctx: MetricContext): Record<string, number> {
    const { agentRun, evalCase, outputMetrics } = ctx
    const result: Record<string, number> = {}

    // ---- ground_truth_match（无 gt 不产出） ----
    let gtScore: number | null = null
    const gt = evalCase.groundTruth
    if (gt && gt.trim()) {
      const normResp = agentRun.response.replace(/\s+/g, '')
      const normGt = gt.replace(/\s+/g, '')
      gtScore = normResp.includes(normGt) ? 1 : bigramJaccard(normResp, normGt)
      result['system_ground_truth_match'] = gtScore
    }

    // ---- task_success ----
    let taskSuccess = 0
    if (agentRun.ok && !agentRun.timedOut && agentRun.response.trim().length > 0 && !agentRun.errorCode) {
      if (gtScore !== null) {
        taskSuccess = gtScore >= 0.5 ? 1 : 0
      } else if (outputMetrics && outputMetrics['output_relevance'] !== undefined) {
        // 无标注用例：以输出层相关性达标作为端到端达成代理
        taskSuccess = outputMetrics['output_relevance'] >= 0.6 ? 1 : 0
      } else {
        taskSuccess = 1
      }
    }
    result['system_task_success'] = taskSuccess

    return result
  }
}

// ============================================================
// 指标组编排（runner 按此顺序计算：output -> process -> system）
// ============================================================

export interface MetricGroups {
  output: OutputMetricGroup
  process: ProcessMetricGroup
  system: SystemMetricGroup
}

/** 组装三层指标组（judge 由 runner 按 global.yaml judge.mode 注入）。 */
export function createMetricGroups(judge?: QualityMonitor): MetricGroups {
  return {
    output: new OutputMetricGroup(judge),
    process: new ProcessMetricGroup(),
    system: new SystemMetricGroup(),
  }
}

/** 工具调用记录构造辅助（agent-executor 映射 tool_results 用）。 */
export function toToolCallRecord(raw: Record<string, any>): ToolCallRecord {
  return {
    toolName: String(raw.tool_name ?? raw.toolName ?? raw.tool ?? 'unknown'),
    args: (raw.args ?? raw.arguments ?? raw.input ?? {}) as Record<string, any>,
    success: raw.success === true,
    executionTimeMs: typeof raw.execution_time === 'number' ? raw.execution_time : undefined,
    error: raw.error ?? raw.error_message ?? null,
  }
}
