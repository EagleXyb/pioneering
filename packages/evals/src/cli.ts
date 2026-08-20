// ============================================================
// evals CLI 入口
//
// 命令：
//   node dist/cli.js datasets                    列出已注册数据集
//   node dist/cli.js run --dataset smoke         跑指定数据集评测
//   node dist/cli.js gate --gate ci              跑门禁（先评测后评估，按退出码对接 CI）
//
// CI 契约：gate 退出码 0=pass/warn，1=block；
//         报告 JSON 路径输出到 stdout（CI 上传 artifact 用）。
// ============================================================

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  EVALS_ROOT,
  loadGates,
  loadGlobalConfig,
  loadThresholds,
} from './config-loader.js'
import {
  buildDataset,
  loadDatasetRegistry,
  loadPreprocessing,
} from './dataset-loader.js'
import { buildEvolutionSignals } from './evolution-bridge.js'
import { evaluateGate } from './gate.js'
import { runEvaluation } from './runner.js'
import { createDefaultExecutor, buildJudgeLlm } from './agent-executor.js'
import type { EvalReport } from './types.js'

/** 简易参数解析：--key value / --flag（flag=true）。 */
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      args[key] = next
      i++
    } else {
      args[key] = true
    }
  }
  return args
}

function usage(): void {
  console.info(`evals CLI（Agent 评测工程）

用法:
  node dist/cli.js datasets                    列出已注册数据集
  node dist/cli.js run --dataset <name>        跑数据集评测（如 smoke/full/dev）
  node dist/cli.js gate --gate <name>          跑门禁（如 ci/release），按退出码对接 CI

选项:
  --config <path>     global.yaml 路径（默认 config/global.yaml）
  --no-save           不落盘报告
  --quiet             精简输出`)
}

/** 执行单个数据集评测（组装真实 Agent 执行器 + judge）。 */
async function runDataset(
  datasetName: string,
  globalPath?: string,
  save = true,
): Promise<EvalReport> {
  const globalCfg = loadGlobalConfig(globalPath)
  const thresholds = loadThresholds()
  const registry = loadDatasetRegistry()
  const preprocessing = loadPreprocessing()
  const dataset = buildDataset(registry, datasetName, preprocessing)

  const runTag = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)
  const bundle = await createDefaultExecutor(globalCfg, runTag)
  try {
    const judgeLlm = buildJudgeLlm(globalCfg, bundle.runtimeConfig)
    const { report, caseResults } = await runEvaluation({
      dataset,
      executor: bundle.executor,
      thresholds,
      globalConfig: globalCfg,
      judgeLlm,
      outputDir: save ? resolve(EVALS_ROOT, globalCfg.report?.output_dir ?? 'reports') : null,
      withBaseline: save,
    })

    // 评测 -> 进化闭环（失败用例转译 EvolutionSignal，stdout 输出供宿主消费）
    if (globalCfg.evolution_bridge?.enabled) {
      const signals = buildEvolutionSignals(report, caseResults, globalCfg.evolution_bridge)
      if (signals.length > 0) {
        console.info(`\n[evolution-bridge] 生成 ${signals.length} 条进化信号（示例）:`)
        console.info(JSON.stringify(signals[0], null, 2))
      }
    }
    return report
  } finally {
    bundle.restore()
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv
  const args = parseArgs(rest)

  if (!command || command === 'help' || args['help'] === true) {
    usage()
    return 0
  }

  const globalPath = typeof args['config'] === 'string' ? args['config'] : undefined
  const save = args['no-save'] !== true

  if (command === 'datasets') {
    const registry = loadDatasetRegistry()
    console.info('已注册数据集:')
    for (const [name, def] of Object.entries(registry.datasets)) {
      console.info(`  - ${name}: ${def.description ?? ''}（sources: ${def.sources.map((s) => s.file).join(', ')}）`)
    }
    return 0
  }

  if (command === 'run') {
    const datasetName = typeof args['dataset'] === 'string' ? args['dataset'] : 'smoke'
    const report = await runDataset(datasetName, globalPath, save)
    console.info(`\n===== 评测摘要 [${datasetName}] =====`)
    console.info(`runId:        ${report.runId}`)
    console.info(`通过率:       ${report.passCount}/${report.caseCount} (${(report.casePassRate * 100).toFixed(1)}%)`)
    console.info(`总分:         ${report.overallScore.toFixed(4)}`)
    console.info(`层级分:       output=${report.layerScores.output.toFixed(4)} process=${report.layerScores.process.toFixed(4)} system=${report.layerScores.system.toFixed(4)}`)
    if (report.delta) {
      console.info(`对比 baseline: overall Δ=${(report.delta['overall_score'] ?? 0).toFixed(4)} (${report.baselineRunId})`)
    }
    if (report.failures.length > 0) {
      console.info('失败用例:')
      for (const f of report.failures) {
        console.info(`  - ${f.caseId} [${f.category}] 未达标: ${f.failedMetrics.join(', ')}`)
      }
    }
    return 0
  }

  if (command === 'gate') {
    const gateName = typeof args['gate'] === 'string' ? args['gate'] : 'ci'
    const gates = loadGates()
    const gateDef = gates.gates[gateName]
    if (!gateDef) {
      console.error(`门禁 '${gateName}' 未定义（可用: ${Object.keys(gates.gates).join(', ')}）`)
      return 2
    }

    // 依次跑门禁声明的数据集，再统一评估
    const reports: Record<string, EvalReport> = {}
    for (const dsName of gateDef.datasets) {
      reports[dsName] = await runDataset(dsName, globalPath, save)
    }

    const result = evaluateGate(gateName, gateDef, reports)
    console.info(`\n${result.summary}`)

    // 报告路径输出（CI artifact 上传依据）
    if (save) {
      const globalCfg = loadGlobalConfig(globalPath)
      console.info(`\n报告目录: ${resolve(EVALS_ROOT, globalCfg.report?.output_dir ?? 'reports')}`)
    }
    return result.exitCode
  }

  console.error(`未知命令: ${command}`)
  usage()
  return 2
}

// ESM CLI 入口（仅直接执行 cli.js 时自动运行；被 import 时不执行）
const isDirectRun = (() => {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return import.meta.url === pathToFileURL(resolve(entry)).href
  } catch {
    return false
  }
})()

if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`[evals.cli] 致命错误: ${e instanceof Error ? e.stack : String(e)}`)
      process.exit(2)
    })
}

export { main as runCli }
