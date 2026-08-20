// ============================================================
// YAML 配置加载器
//
// 职责：
//   1. 解析 YAML 文件（依赖 hoisted 的 yaml@2.x）
//   2. 环境变量插值：${VAR:default}（密钥等不落盘，运行时展开）
//   3. 提供四类配置（global / datasets / preprocessing / thresholds / gates）
//      的类型化加载入口
//
// 设计原则：evals 包独立解析 YAML，不侵入 modu-agent 的
// RuntimeConfig（其 fromFile 仅支持 JSON）；global.yaml 中的
// agent_overrides 由 agent-executor 桥接注入 RuntimeConfig。
// ============================================================

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import type { GatesConfig, ThresholdsConfig } from './types.js'

/** evals 包根目录（config/data/gates/metrics 的定位基准）。 */
export const EVALS_ROOT: string = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[evals.config] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[evals.config] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[evals.config] ${msg}`, ...args),
}

// ============================================================
// 环境变量插值
// ============================================================

const ENV_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}/g

/**
 * 字符串插值：`${VAR:default}` -> process.env.VAR ?? default。
 * 未设置且无默认值时替换为空串并告警（避免静默传空密钥）。
 */
export function interpolateEnv(text: string): string {
  return text.replace(ENV_PATTERN, (_match, varName: string, defaultVal?: string) => {
    const v = process.env[varName]
    if (v !== undefined && v !== '') return v
    if (defaultVal !== undefined) return defaultVal
    logger.warning(`环境变量 ${varName} 未设置且无默认值，替换为空串`)
    return ''
  })
}

/** 深度遍历对象，对所有字符串值做环境变量插值（原地修改）。 */
function interpolateDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return interpolateEnv(value) as unknown as T
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = interpolateDeep(value[i])
    return value
  }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value as Record<string, any>)) {
      ;(value as Record<string, any>)[k] = interpolateDeep((value as Record<string, any>)[k])
    }
  }
  return value
}

// ============================================================
// YAML 加载
// ============================================================

/** 加载 YAML 文件并做环境变量插值（文件不存在时抛错）。 */
export function loadYaml<T>(filePath: string): T {
  const abs = resolve(filePath)
  if (!existsSync(abs)) {
    throw new Error(`评测配置文件不存在: ${abs}`)
  }
  const raw = readFileSync(abs, 'utf-8')
  const parsed = parse(raw)
  if (parsed === null || parsed === undefined) {
    throw new Error(`评测配置文件为空: ${abs}`)
  }
  return interpolateDeep(parsed) as T
}

// ============================================================
// global.yaml 类型与加载
// ============================================================

export interface GlobalConfig {
  version: number
  /** 点分键 -> 值；评测执行前注入被测 Agent 的 RuntimeConfig。 */
  agent_overrides?: Record<string, any>
  /** 注入 process.env 的变量（已做 env 插值）。 */
  env?: Record<string, string>
  runner?: {
    concurrency?: number
    timeout_ms?: number
    retries?: number
  }
  judge?: {
    mode?: 'rule' | 'llm' | 'hybrid'
    provider?: string
    temperature?: number
    max_tokens?: number
    timeout_seconds?: number
    hybrid_rule_weight?: number
    hybrid_llm_weight?: number
  }
  report?: {
    output_dir?: string
    baseline?: 'latest' | 'none'
    keep_runs?: number
  }
  evolution_bridge?: {
    enabled?: boolean
    min_quality_score?: number
    severity?: string
  }
}

const DEFAULT_GLOBAL: Required<
  Pick<GlobalConfig, 'agent_overrides' | 'env' | 'runner' | 'judge' | 'report' | 'evolution_bridge'>
> = {
  agent_overrides: {},
  env: {},
  runner: { concurrency: 4, timeout_ms: 120_000, retries: 1 },
  judge: { mode: 'rule' },
  report: { output_dir: 'reports', baseline: 'latest', keep_runs: 30 },
  evolution_bridge: { enabled: false, min_quality_score: 0.6, severity: 'medium' },
}

/** 加载 global.yaml（带默认值合并）。 */
export function loadGlobalConfig(filePath?: string): GlobalConfig {
  const path = filePath ?? resolve(EVALS_ROOT, 'config/global.yaml')
  const raw = loadYaml<Partial<GlobalConfig>>(path)
  const cfg: GlobalConfig = {
    version: raw.version ?? 1,
    agent_overrides: { ...DEFAULT_GLOBAL.agent_overrides, ...(raw.agent_overrides ?? {}) },
    env: { ...(raw.env ?? {}) },
    runner: { ...DEFAULT_GLOBAL.runner, ...(raw.runner ?? {}) },
    judge: { ...DEFAULT_GLOBAL.judge, ...(raw.judge ?? {}) },
    report: { ...DEFAULT_GLOBAL.report, ...(raw.report ?? {}) },
    evolution_bridge: { ...DEFAULT_GLOBAL.evolution_bridge, ...(raw.evolution_bridge ?? {}) },
  }
  logger.info(
    "global.yaml 加载完成: judge.mode=%s concurrency=%s timeout=%sms",
    cfg.judge?.mode, cfg.runner?.concurrency, cfg.runner?.timeout_ms,
  )
  return cfg
}

// ============================================================
// thresholds.yaml / gates.yaml / preprocessing.yaml 加载
// ============================================================

/** 加载 metrics/thresholds.yaml。 */
export function loadThresholds(filePath?: string): ThresholdsConfig {
  const path = filePath ?? resolve(EVALS_ROOT, 'metrics/thresholds.yaml')
  const raw = loadYaml<ThresholdsConfig>(path)
  if (!raw.metrics || typeof raw.metrics !== 'object') {
    throw new Error(`thresholds.yaml 缺少 metrics 定义: ${path}`)
  }
  // 校验：weight/threshold 必填，gate 取值合法；兼容 snake_case 键
  for (const [key, def] of Object.entries(raw.metrics)) {
    if (typeof def.weight !== 'number' || typeof def.threshold !== 'number') {
      throw new Error(`指标 ${key} 缺少 weight/threshold 数值定义`)
    }
    if (!['block', 'warn', 'off'].includes(def.gate)) {
      throw new Error(`指标 ${key} 的 gate 取值非法: ${def.gate}`)
    }
    // YAML snake_case（higher_is_better）-> TS camelCase（higherIsBetter）
    const anyDef = def as any
    if (def.higherIsBetter === undefined && anyDef.higher_is_better !== undefined) {
      def.higherIsBetter = Boolean(anyDef.higher_is_better)
    }
    if (def.higherIsBetter === undefined) def.higherIsBetter = true
  }
  return raw
}

/** 加载 gates/ci_gates.yaml。 */
export function loadGates(filePath?: string): GatesConfig {
  const path = filePath ?? resolve(EVALS_ROOT, 'gates/ci_gates.yaml')
  const raw = loadYaml<GatesConfig>(path)
  if (!raw.gates || typeof raw.gates !== 'object') {
    throw new Error(`ci_gates.yaml 缺少 gates 定义: ${path}`)
  }
  return raw
}

// ============================================================
// 点分键 -> 嵌套对象（agent_overrides 桥接 RuntimeConfig 用）
// ============================================================

/** { 'llm.temperature': 0.3 } -> { llm: { temperature: 0.3 } }。 */
export function dottedToObject(dotted: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(dotted)) {
    const parts = key.split('.')
    let cur = result
    for (const p of parts.slice(0, -1)) {
      if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {}
      cur = cur[p]
    }
    cur[parts[parts.length - 1]] = value
  }
  return result
}
