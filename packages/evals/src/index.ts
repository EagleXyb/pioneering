// ============================================================
// @pioneering/evals 统一导出
//
// 模块层次：
//   types.ts            —— 核心类型（EvalCase/AgentRunResult/EvalReport/GateResult）
//   config-loader.ts    —— YAML 配置加载 + env 插值（global/thresholds/gates）
//   dataset-loader.ts   —— 数据集注册表/预处理/采样
//   metrics.ts          —— 三层指标组（output/process/system）
//   agent-executor.ts   —— 被测 Agent 执行器（YAML -> RuntimeConfig 桥接）
//   runner.ts           —— 评测编排（并发/超时/重试/聚合）
//   report.ts           —— 报告聚合 + baseline 回归对比
//   gate.ts             —— CI/CD 门禁评估（退出码契约）
//   evolution-bridge.ts —— 评测失败 -> EvolutionSignal 进化闭环
//   cli.ts              —— CLI 入口（run/gate/datasets）
// ============================================================

export type {
  AgentRunResult,
  EvalCase,
  EvalCaseCategory,
  EvalCaseResult,
  EvalCaseSource,
  EvalDataset,
  EvalReport,
  GateAction,
  GateDecision,
  GateDef,
  GateResult,
  GateRule,
  GatesConfig,
  MetricCategory,
  MetricContext,
  MetricSummary,
  MetricThresholdDef,
  ThresholdsConfig,
  ToolCallRecord,
} from './types.js'

export {
  EVALS_ROOT,
  dottedToObject,
  interpolateEnv,
  loadGates,
  loadGlobalConfig,
  loadThresholds,
  loadYaml,
  type GlobalConfig,
} from './config-loader.js'

export {
  buildDataset,
  loadDatasetRegistry,
  loadPreprocessing,
  type DatasetDef,
  type DatasetRegistry,
  type PreprocessingConfig,
} from './dataset-loader.js'

export {
  createMetricGroups,
  OutputMetricGroup,
  ProcessMetricGroup,
  SystemMetricGroup,
  toToolCallRecord,
} from './metrics.js'

export {
  buildJudgeLlm,
  createDefaultExecutor,
  type CaseExecutor,
  type ExecutorBundle,
} from './agent-executor.js'

export { EvaluationRunner, runEvaluation, type RunnerOptions } from './runner.js'

export {
  aggregate,
  computeDelta,
  loadBaseline,
  metricMeetsThreshold,
  pruneReports,
  saveReport,
} from './report.js'

export { evaluateGate } from './gate.js'

export { buildEvolutionSignals, feedEvolutionCollector } from './evolution-bridge.js'

export { runCli } from './cli.js'
