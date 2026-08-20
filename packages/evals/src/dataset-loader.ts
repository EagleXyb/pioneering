// ============================================================
// 评测数据集加载器
//
// 职责：
//   1. 解析 data/datasets.yaml 的数据集注册表（sources + sample + filter）
//   2. 合并多个用例文件（id 去重，后写覆盖——支持"引用继承"：
//      数据集复用其他数据集的用例文件）
//   3. 应用预处理规则（preprocessing.yaml）：exclude_tags 过滤、
//      占位符替换 {{key}}、trim、超长截断
//   4. 采样：all / random(n, seed)——seed 保证可复现
// ============================================================

import { resolve } from 'node:path'
import { loadYaml, EVALS_ROOT } from './config-loader.js'
import type { EvalCase, EvalDataset, EvalCaseCategory, EvalCaseSource } from './types.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[evals.dataset] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[evals.dataset] ${msg}`, ...args),
}

// ============================================================
// YAML schema 类型
// ============================================================

/** datasets.yaml 中单个数据集定义。 */
export interface DatasetDef {
  description?: string
  sources: Array<{ file: string }>
  sample?: {
    strategy: 'all' | 'random'
    n?: number
    seed?: number
  }
  filter?: {
    tags?: string[]
    exclude_tags?: string[]
  }
}

/** datasets.yaml 顶层结构。 */
export interface DatasetRegistry {
  version: number
  datasets: Record<string, DatasetDef>
}

/** preprocessing.yaml 顶层结构。 */
export interface PreprocessingConfig {
  version: number
  preprocessing: {
    trim_whitespace?: boolean
    max_prompt_chars?: number
    placeholders?: Record<string, string>
    exclude_tags?: string[]
  }
}

/** cases/*.yaml 顶层结构。 */
interface CasesFile {
  version: number
  cases: Array<Record<string, any>>
}

const VALID_CATEGORIES = ['core', 'edge', 'adversarial', 'regression']
const VALID_SOURCES = ['human', 'synthetic', 'production', 'failure']

// ============================================================
// 加载入口
// ============================================================

/** 加载数据集注册表（data/datasets.yaml）。 */
export function loadDatasetRegistry(filePath?: string): DatasetRegistry {
  const path = filePath ?? resolve(EVALS_ROOT, 'data/datasets.yaml')
  const raw = loadYaml<DatasetRegistry>(path)
  if (!raw.datasets || typeof raw.datasets !== 'object') {
    throw new Error(`datasets.yaml 缺少 datasets 定义: ${path}`)
  }
  return raw
}

/** 加载预处理规则（data/preprocessing.yaml）。 */
export function loadPreprocessing(filePath?: string): PreprocessingConfig {
  const path = filePath ?? resolve(EVALS_ROOT, 'data/preprocessing.yaml')
  return loadYaml<PreprocessingConfig>(path)
}

/** 规范化单条用例（字段校验 + 默认值）。 */
function normalizeCase(raw: Record<string, any>): EvalCase {
  if (!raw.id || typeof raw.id !== 'string') {
    throw new Error(`用例缺少 id: ${JSON.stringify(raw).slice(0, 200)}`)
  }
  if (typeof raw.input !== 'string') {
    throw new Error(`用例 ${raw.id} 缺少 input`)
  }
  const category = VALID_CATEGORIES.includes(raw.category) ? raw.category : 'core'
  const source = VALID_SOURCES.includes(raw.source) ? raw.source : 'human'
  return {
    id: raw.id,
    category: category as EvalCaseCategory,
    input: raw.input,
    groundTruth: raw.ground_truth ?? null,
    expectedTools: Array.isArray(raw.expected_tools) ? raw.expected_tools : [],
    maxToolCalls: typeof raw.max_tool_calls === 'number' ? raw.max_tool_calls : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    source: source as EvalCaseSource,
  }
}

/** 应用预处理规则到单条用例（占位符/trim/截断/标签过滤）。 */
export function applyPreprocessing(
  c: EvalCase,
  pp: PreprocessingConfig['preprocessing'],
): EvalCase | null {
  // exclude_tags 过滤（数据集 filter 与全局 preprocessing 合并生效）
  const excludeTags = new Set([...(pp.exclude_tags ?? []), ...([] as string[])])
  if (c.tags.some((t) => excludeTags.has(t))) {
    logger.info(`用例 ${c.id} 命中 exclude_tags，跳过`)
    return null
  }

  let input = c.input
  // 占位符替换：{{key}} -> 固定值（时间敏感用例的可复现性）
  for (const [key, value] of Object.entries(pp.placeholders ?? {})) {
    input = input.replaceAll(`{{${key}}}`, value)
  }
  if (pp.trim_whitespace !== false) {
    input = input.trim()
  }
  const maxChars = pp.max_prompt_chars ?? 2000
  if (input.length > maxChars) {
    input = `${input.slice(0, maxChars)}...[truncated by evals]`
  }
  return { ...c, input }
}

/** 确定性伪随机数（mulberry32，seed 可复现采样）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 构建命名数据集：合并 sources 用例文件 -> 预处理 -> 标签过滤 -> 采样。
 *
 * @param registry datasets.yaml 注册表
 * @param name 数据集名（smoke / full / regression / dev ...）
 * @param pp 预处理规则
 * @param baseDir sources.file 的相对基准目录（默认 evals 包的 data/ 目录，
 *                即 datasets.yaml 所在目录——用例文件相对其自身声明）
 */
export function buildDataset(
  registry: DatasetRegistry,
  name: string,
  pp: PreprocessingConfig,
  baseDir?: string,
): EvalDataset {
  const def = registry.datasets[name]
  if (!def) {
    throw new Error(
      `数据集 '${name}' 未在 datasets.yaml 中注册（可用: ${Object.keys(registry.datasets).join(', ')}）`,
    )
  }
  const base = baseDir ?? resolve(EVALS_ROOT, 'data')

  // 1. 合并 sources 用例文件（id 去重：后写覆盖，实现"引用继承"）
  const merged = new Map<string, EvalCase>()
  for (const src of def.sources ?? []) {
    const filePath = resolve(base, src.file)
    const casesFile = loadYaml<CasesFile>(filePath)
    for (const raw of casesFile.cases ?? []) {
      merged.set(raw.id, normalizeCase(raw))
    }
  }

  // 2. 预处理 + 全局 exclude_tags 过滤
  const preprocessed: EvalCase[] = []
  for (const c of merged.values()) {
    const processed = applyPreprocessing(c, pp.preprocessing)
    if (processed !== null) preprocessed.push(processed)
  }

  // 3. 数据集级 filter：include tags（非空时白名单）+ exclude_tags
  const includeTags = def.filter?.tags ?? []
  const dsExclude = new Set(def.filter?.exclude_tags ?? [])
  let filtered = preprocessed.filter((c) => {
    if (c.tags.some((t) => dsExclude.has(t))) return false
    if (includeTags.length > 0 && !c.tags.some((t) => includeTags.includes(t))) return false
    return true
  })

  // 4. 采样
  const sample = def.sample ?? { strategy: 'all' as const }
  if (sample.strategy === 'random' && typeof sample.n === 'number') {
    const rng = mulberry32(sample.seed ?? 42)
    // 洗牌后取前 n（Fisher-Yates，确定性）
    const arr = [...filtered]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    filtered = arr.slice(0, sample.n)
  }

  logger.info(
    `数据集 '%s' 构建完成: %d 用例（原始 %d）采样策略=%s`,
    name, filtered.length, merged.size, sample.strategy,
  )
  return { name, description: def.description, cases: filtered }
}
