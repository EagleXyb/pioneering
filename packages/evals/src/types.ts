// ============================================================
// @pioneering/evals 核心类型定义
//
// 评测分层（对应 metrics/thresholds.yaml 的 category）：
//   output  —— 输出层：最终回答质量（复用 modu-agent QualityMonitor）
//   process —— 过程层：轨迹行为质量（工具调用/冗余/恢复/迭代）
//   system  —— 系统层：端到端任务达成（task_success / ground_truth_match）
// ============================================================

// ---------- 评测用例与数据集 ----------

export type EvalCaseCategory = 'core' | 'edge' | 'adversarial' | 'regression'

export type EvalCaseSource = 'human' | 'synthetic' | 'production' | 'failure'

/** 单条评测用例（data/cases/*.yaml 的 cases[] 元素）。 */
export interface EvalCase {
  id: string
  category: EvalCaseCategory
  /** 预处理（占位符替换/截断/trim）之后的最终输入。 */
  input: string
  groundTruth?: string | null
  expectedTools?: string[]
  maxToolCalls?: number
  tags: string[]
  source: EvalCaseSource
}

/** 命名数据集（由 datasets.yaml 定义 + 预处理 + 采样构建）。 */
export interface EvalDataset {
  name: string
  description?: string
  cases: EvalCase[]
}

// ---------- Agent 执行轨迹 ----------

/** 单次工具调用记录（从 modu-agent tool_results 映射）。 */
export interface ToolCallRecord {
  toolName: string
  args: Record<string, any>
  success: boolean
  executionTimeMs?: number
  error?: string | null
}

/** 单用例的被测 Agent 执行结果（评测引擎的统一输入）。 */
export interface AgentRunResult {
  caseId: string
  /** 执行是否成功（未超时、未崩溃、error_code 为空）。 */
  ok: boolean
  response: string
  toolCalls: ToolCallRecord[]
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
  iteration: number
  reasoningRoundCount: number
  latencyMs: number
  errorCode?: string
  errorMessage?: string
  timedOut?: boolean
}

// ---------- 指标 ----------

export type MetricCategory = 'output' | 'process' | 'system'

/** thresholds.yaml 中单个指标的定义。 */
export interface MetricThresholdDef {
  category: MetricCategory
  weight: number
  threshold: number
  gate: 'block' | 'warn' | 'off'
  /** 默认 true；false 表示越低越好（如 redundant_calls）。 */
  higherIsBetter?: boolean
}

/** thresholds.yaml 顶层结构。 */
export interface ThresholdsConfig {
  version: number
  metrics: Record<string, MetricThresholdDef>
  casePassRule?: string
}

/** 单用例的指标计算上下文。 */
export interface MetricContext {
  evalCase: EvalCase
  agentRun: AgentRunResult
  /** output 组先计算，其结果供 system 组的 task_success 复用。 */
  outputMetrics?: Record<string, number>
}

// ---------- 评测结果与报告 ----------

/** 单用例评测结果。 */
export interface EvalCaseResult {
  caseId: string
  category: EvalCaseCategory
  tags: string[]
  /** metricKey -> value（仅本用例适用的指标）。 */
  metrics: Record<string, number>
  /** 单用例是否通过（任一 block 指标低于阈值即 fail）。 */
  pass: boolean
  failedBlockMetrics: string[]
  agentRun: AgentRunResult
}

/** 指标聚合摘要。 */
export interface MetricSummary {
  key: string
  category: MetricCategory
  avg: number
  min: number
  max: number
  p50: number
  /** 单用例达到阈值的比率（higher_is_better=false 时为 <= 阈值比率）。 */
  passRate: number
  /** 参与聚合的用例数（gt 类指标自动排除不适用用例）。 */
  count: number
}

/** 评测报告（一次 dataset run 的完整产物，JSON 持久化）。 */
export interface EvalReport {
  runId: string
  datasetName: string
  startedAt: string
  finishedAt: string
  caseCount: number
  passCount: number
  casePassRate: number
  /** 全指标加权聚合分（weight 归一化）。 */
  overallScore: number
  layerScores: Record<MetricCategory, number>
  metrics: Record<string, MetricSummary>
  /** 按 category 分组的通过率。 */
  perCategory: Record<string, { count: number; passCount: number; passRate: number }>
  failures: Array<{ caseId: string; category: string; failedMetrics: string[] }>
  /** 与 baseline（最近一次同数据集 run）的差值：metricKey -> current - baseline。 */
  delta: Record<string, number> | null
  baselineRunId: string | null
}

// ---------- 门禁 ----------

export type GateAction = 'block' | 'warn'
export type GateDecision = 'pass' | 'warn' | 'block'

/** ci_gates.yaml 中单条规则。 */
export interface GateRule {
  metric: string
  /** dataset（聚合值）| delta（相对 baseline 的变化量，负值=退化）。 */
  scope?: 'dataset' | 'delta'
  op: '>=' | '<=' | '>' | '<' | '=='
  value: number
  action: GateAction
}

/** ci_gates.yaml 中单个门禁定义。 */
export interface GateDef {
  description?: string
  datasets: string[]
  triggers?: string[]
  rules: GateRule[]
  on_failure?: { exit_code?: number; upload_report?: boolean; fail_fast?: boolean }
  notifications?: string[]
}

/** ci_gates.yaml 顶层结构。 */
export interface GatesConfig {
  version: number
  gates: Record<string, GateDef>
}

/** 门禁评估结果。 */
export interface GateResult {
  gateName: string
  decision: GateDecision
  /** 触发的 block 规则（阻断项）。 */
  failures: Array<{ rule: GateRule; actual: number; reportRunId: string; datasetName: string }>
  /** 触发的 warn 规则（告警项）。 */
  warnings: Array<{ rule: GateRule; actual: number; reportRunId: string; datasetName: string }>
  exitCode: number
  summary: string
}
