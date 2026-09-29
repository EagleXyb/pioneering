// layer-boundaries.test.ts
//
// P3（T-24）：层边界与无环校验 —— 验证层 L6 的**自动化载体**。
//
// 规则（对应实施计划 §4.4 B-1~B-5；B-6 / B-0 为本测试补充的加固项）：
//   B-0 无 ESM **值依赖**环。
//   B-1 底座层（core/interfaces, tools, memory, observability,
//       perception/security, reasoning/llm, graph/spec.ts）**不得** import
//       `kernel/`（装配层）或场景包（`packs/`）。
//   B-2 底座层**不得** import 具体业务模块（graph/nodes、graph/factory、
//       plan-execute、subgraph、runner 等）。
//   B-3 `src/kernel/` 是唯一允许 import 全部底座的模块；反向地，除装配入口
//       （`graph/factory.ts`、`src/index.ts`）与 kernel 自身外，其余 `src/` 文件
//       不得 import `src/kernel/`。
//   B-4 场景包（`packs/`）只能经 `ScenarioHost` 访问内核 → 不得 import `src/` 内部路径。
//   B-5 运行时层（`graph/runner.ts`）不得依赖场景包 / 装配层。
//   B-6 `core/interfaces/**` 为**零 src 内值依赖**的契约层（纯类型 + 契约）。
//
// 统计口径：仅计**值依赖**（`import x from`）。`import type` / `export type` 在编译期
// 擦除、不构成运行时环，故不计入 —— `graph/spec.ts ↔ core/registry.ts` 正是此类
// （见 `graph/spec.ts` 顶部"循环依赖说明"）。
//
// 注（P3-B 起更新）：`src/kernel/` 装配层与 `packs/` 目录约定**已落地**：
//   - kernel 位于 src/kernel（scenario-host / scenario-loader）；
//   - 首个示例场景包位于 packs/example-pack（纯声明资产，无代码文件）。
// B-1/B-3/B-4 已由"真空成立"转为真实检查。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TESTS_ARCH_DIR = path.dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = path.resolve(TESTS_ARCH_DIR, '../..')
const SRC_DIR = path.join(PKG_ROOT, 'src')
/** `packs/` 位置待 D-03 决策，故同时探测"包内"与"仓库根"。 */
const PACK_DIR_CANDIDATES = [
  path.join(PKG_ROOT, 'packs'),
  path.resolve(PKG_ROOT, '../..', 'packs'),
]

// ---------------------------------------------------------------------------
// import 图构建
// ---------------------------------------------------------------------------

// ⚠️ 三条正则均**允许换行**（`[^'";]` 包含 `\n`）且**不跨越分号/引号**：
// 初版使用 `[^'\n]`（禁换行），实测漏掉全部 393 条跨行 import 语句、37 个文件的
// 依赖被整体漏判 → B-0「无环」是**漏检下的假阴性**（`core/registry.ts ↔ graph/spec.ts`
// 这一真实存在的类型环都未被计出）。限定符改为 `[^'";]` 后既覆盖跨行，又不会
// 从 `import` 一路吞到文件末尾的无关 `from`。
const IMPORT_FROM_RE = /(?:^|\n)\s*(?:import|export)\s+[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
const TYPE_ONLY_RE = /(?:^|\n)\s*(?:import|export)\s+type\s+[^'";]*?\bfrom\s*['"]([^'"]+)['"]/g

/**
 * 剥离块注释与行注释（**扫描前必须执行**）。
 *
 * 反例（实测）：`orchestration/communication/event-bus-adapter.ts` 的 JSDoc 示例中含
 * `import { EventBusBackend } from './event-bus-adapter.js'`（自引用），不剥离会产生
 * **自环误报**。`[^:'"`\\]` 前缀用于跳过 URL（`https://` 中的 `//`）。
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectTsFiles(p, acc)
    else if (e.name.endsWith('.ts')) acc.push(p)
  }
  return acc
}

function collectJsFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectJsFiles(p, acc)
    else if (e.name.endsWith('.js')) acc.push(p)
  }
  return acc
}

/** 归一为仓库相对 POSIX 路径（如 `src/core/registry.ts`）。 */
function toRel(abs: string): string {
  return path.relative(PKG_ROOT, abs).split(path.sep).join('/')
}

function resolveSpecifier(fromFile: string, spec: string): string | null {
  let abs: string
  if (spec.startsWith('@/')) abs = path.join(SRC_DIR, spec.slice(2))
  else if (spec.startsWith('.')) abs = path.resolve(path.dirname(fromFile), spec)
  else return null // 外部依赖（node:/npm 包）
  const tsPath = abs.replace(/\.js$/, '.ts')
  return fs.existsSync(tsPath) ? tsPath : null
}

function matches(text: string, re: RegExp): string[] {
  const out: string[] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1])
  return out
}

function buildImportGraph(files: string[]): Map<string, string[]> {
  const graph = new Map<string, string[]>()
  for (const f of files) {
    const text = stripComments(fs.readFileSync(f, 'utf8'))
    const typeOnly = new Set(matches(text, TYPE_ONLY_RE))
    const deps = new Set<string>()
    for (const spec of [...matches(text, IMPORT_FROM_RE), ...matches(text, BARE_IMPORT_RE)]) {
      if (typeOnly.has(spec)) continue
      const resolved = resolveSpecifier(f, spec)
      if (resolved) deps.add(toRel(resolved))
    }
    graph.set(toRel(f), [...deps])
  }
  return graph
}

const SRC_FILES = collectTsFiles(SRC_DIR)
const GRAPH = buildImportGraph(SRC_FILES)
const ALL_FILES = [...GRAPH.keys()]

// ---------------------------------------------------------------------------
// 层定义
// ---------------------------------------------------------------------------

/** ③ 底座层（对上层零业务假设）。 */
const BASE_LAYER_PREFIXES = [
  'src/core/interfaces/',
  'src/tools/',
  'src/memory/',
  'src/observability/',
  'src/perception/security/',
  'src/reasoning/llm/',
]
const BASE_LAYER_FILES = ['src/graph/spec.ts']

/**
 * 具体业务 / 上层逻辑（底座不得依赖）。
 *
 * 措辞刻意收窄：**共享基础设施不算业务** —— `orchestration/communication/`（事件总线 /
 * 协议）、`graph/adapters/`（通用中间件）、`perception/*`（感知底座）均为 ③ 底座的
 * 组成部分，底座层依赖它们**不**违反 B-2（实测基线中确有此类依赖：
 * `perception/security/audit.ts → orchestration/communication/*`、
 * `reasoning/llm/cost-tracker.ts → orchestration/communication/*`）。
 */
const BUSINESS_PREFIXES = [
  'src/graph/nodes.ts',
  'src/graph/factory.ts',
  'src/graph/graph.ts',
  'src/graph/runner.ts',
  'src/graph/plan-execute/',
  'src/graph/subgraph/',
  'src/graph/prompt-templates.ts',
  'src/graph/context-strategies.ts',
  'src/reasoning/domain-adapters.ts',
  'src/reasoning/prompt-composer.ts',
  'src/feedback/',
  'src/orchestration/patterns/',
]

const isBaseLayer = (rel: string): boolean =>
  BASE_LAYER_PREFIXES.some((p) => rel.startsWith(p)) || BASE_LAYER_FILES.includes(rel)

const isBusiness = (rel: string): boolean => BUSINESS_PREFIXES.some((p) => rel.startsWith(p))

const isKernel = (rel: string): boolean => rel.startsWith('src/kernel/')
const isPack = (rel: string): boolean => rel.startsWith('packs/')

/** B-3：允许 import `src/kernel/` 的装配入口。 */
const ASSEMBLY_ENTRY_ALLOWLIST = ['src/index.ts', 'src/graph/factory.ts']

/** 返回 `from -> to` 形式的越界边。 */
function edgesWhere(pred: (from: string, to: string) => boolean): string[] {
  const out: string[] = []
  for (const [from, deps] of GRAPH) {
    for (const to of deps) if (pred(from, to)) out.push(`${from} -> ${to}`)
  }
  return out.sort()
}

// ---------------------------------------------------------------------------

describe('P3-T24 层边界（L6 载体）', () => {
  it('图构建自检：应扫描到全部 src 文件（含注释中引用的相对导入）', () => {
    expect(ALL_FILES.length).toBeGreaterThan(120)
    expect(ALL_FILES.every((f) => f.endsWith('.ts'))).toBe(true)
  })

  it('扫描器自检①：能识别**跨行** import（防漏检 → B-0 假阴性）', () => {
    // 初版正则禁换行时，以下两条边**均**未被发现（依赖位于跨行 import 块内）。
    expect(GRAPH.get('src/graph/graph.ts') ?? []).toContain('src/graph/spec.ts')
    expect(GRAPH.get('src/graph/nodes.ts') ?? []).toContain('src/perception/pipeline.ts')
    // 边数量级自检（修正后实测 339 条；漏检时仅约 2xx 条）
    const totalEdges = [...GRAPH.values()].reduce((n, d) => n + d.length, 0)
    expect(totalEdges).toBeGreaterThan(300)
  })

  it('扫描器自检②：注释中的 import 不产生依赖边（防误报 → 自环）', () => {
    // event-bus-adapter.ts 的 JSDoc 示例含自引用 import；不剥离注释会产生自环。
    expect(edgesWhere((from, to) => from === to)).toEqual([])
    expect(GRAPH.get('src/orchestration/communication/event-bus-adapter.ts') ?? []).not.toContain(
      'src/orchestration/communication/event-bus-adapter.ts',
    )
  })

  it('B-1 底座层不得 import 装配层（kernel/）或场景包（packs/）', () => {
    const violations = edgesWhere((from, to) => isBaseLayer(from) && (isKernel(to) || isPack(to)))
    expect(violations).toEqual([])
  })

  it('B-2 底座层不得 import 具体业务模块', () => {
    const violations = edgesWhere((from, to) => isBaseLayer(from) && isBusiness(to))
    expect(violations).toEqual([])
  })

  it('B-3 仅装配入口可 import 装配层（kernel/）', () => {
    const violations = edgesWhere(
      (from, to) =>
        isKernel(to) &&
        !isKernel(from) &&
        !ASSEMBLY_ENTRY_ALLOWLIST.includes(from),
    )
    expect(violations).toEqual([])
  })

  it('B-4 场景包不得 import 内核源码（只能经 ScenarioHost）', () => {
    // 场景包位于 `packs/`（**不**在 `src/` 内），故须独立扫描其导入说明符。
    // P3-B 起 packs/ 已存在（示例包为纯声明资产）；代码型入口（entry.js）一旦
    // 加入即受本检查约束。
    const packFiles: string[] = []
    for (const dir of PACK_DIR_CANDIDATES) {
      for (const f of collectTsFiles(dir)) packFiles.push(f)
      for (const f of collectJsFiles(dir)) packFiles.push(f)
    }
    const violations: string[] = []
    for (const f of packFiles) {
      const text = fs.readFileSync(f, 'utf8')
      for (const spec of [...matches(text, IMPORT_FROM_RE), ...matches(text, BARE_IMPORT_RE)]) {
        const srcIdx = f.split(path.sep).findIndex((seg) => seg === 'packs')
        const packRel = f.split(path.sep).slice(srcIdx + 1).join('/')
        if (spec.startsWith('@/') || resolveSpecifier(f, spec)?.startsWith(SRC_DIR)) {
          violations.push(`packs/${packRel} -> ${spec}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('B-5 运行时层（runner.ts）不得依赖场景包 / 装配层', () => {
    const violations = edgesWhere(
      (from, to) => from === 'src/graph/runner.ts' && (isKernel(to) || isPack(to)),
    )
    expect(violations).toEqual([])
  })

  it('B-6 契约层（core/interfaces）零 src 内值依赖', () => {
    const violations = edgesWhere(
      (from, to) => from.startsWith('src/core/interfaces/') && to.startsWith('src/'),
    )
    expect(violations).toEqual([])
  })

  it('B-0 无 ESM 值依赖环（类型专用导入不计入）', () => {
    const WHITE = 0
    const GRAY = 1
    const BLACK = 2
    const color = new Map<string, number>(ALL_FILES.map((f) => [f, WHITE]))
    const cycles: string[] = []
    const stack: string[] = []

    const visit = (node: string): void => {
      color.set(node, GRAY)
      stack.push(node)
      for (const dep of GRAPH.get(node) ?? []) {
        const c = color.get(dep)
        if (c === GRAY) {
          const idx = stack.indexOf(dep)
          cycles.push([...stack.slice(idx), dep].join(' -> '))
        } else if (c === WHITE) {
          visit(dep)
        }
      }
      stack.pop()
      color.set(node, BLACK)
    }

    for (const f of ALL_FILES) if (color.get(f) === WHITE) visit(f)
    expect(cycles).toEqual([])
  })

  it('B-4 补充：packs/ 目录探测（P3-B 起包内 packs/ 已存在）', () => {
    const existing = PACK_DIR_CANDIDATES.filter((d) => fs.existsSync(d))
    // 包内 packs/（含示例场景包）必须存在
    expect(existing).toContain(path.join(PKG_ROOT, 'packs'))
    expect(fs.existsSync(path.join(PKG_ROOT, 'packs', 'example-pack', 'pack.yaml'))).toBe(true)
  })
})
