// config-consumption-audit.test.ts
//
// P3（T-22）：配置「声明 ↔ 消费」一致性审计 —— 目标 G-2 / 验证层 L7 的**自动化载体**。
//
// 背景：`UNDECLARED_CONSUMED_KEYS` 只覆盖「已消费未声明」一个方向；
// 「已声明未消费」（悬挂键）此前**无任何自动化检查**，导致 G-2 的 blocking
// 断言长期无载体。本测试补齐该方向：扫描 `src/**/*.ts` 中出现的配置键字面量，
// 与「DEFAULT_CONFIG 叶子键 ∪ 能力注册表声明键」求差，并断言：
//   ① 注册表声明的键均已落地 DEFAULT_CONFIG；
//   ② 注册表声明的键不得为**未登记基线**的悬挂键背书；
//   ③ 悬挂键集合 == 已登记基线（快照锁定，收敛进度可追踪）；
//   ④ 无**新增**悬挂键（增量不得累积 → 新增必须走「接线或删除」，§9 D-06）；
//   ⑤ 基线清单无腐化（已接线的键必须同步移出清单）。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DECLARED_UNCONSUMED_KEYS,
  auditConfigConsumption,
  flattenConfigKeys,
} from '@/config/capability-registry.js'
import { DEFAULT_CONFIG } from '@/config/runtime-config.js'

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

/**
 * 「声明面」文件自身：`capability-registry.ts` 的 `configKeys` 数组与基线常量是
 * **声明**而非消费点，必须从扫描中排除（否则悬挂键会被自身声明"消费"掉 → 假阴性）。
 * 该文件同时含 `enabledKey`，故注册表方向也会因此变严（正是 ② 的用意）。
 */
const DECLARATION_SITE = path.join(SRC_DIR, 'config', 'capability-registry.ts')

function collectTsFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectTsFiles(p, acc)
    else if (e.name.endsWith('.ts')) acc.push(p)
  }
  return acc
}

const SCANNED_FILES = collectTsFiles(SRC_DIR).filter((f) => f !== DECLARATION_SITE)

/** 收集 src/ 中出现的全部字符串字面量（单引号 / 双引号 / 反引号）。 */
function collectConsumedKeyLiterals(files: string[]): string[] {
  const literals = new Set<string>()
  const patterns = [/'([^'\r\n]*)'/g, /"([^"\r\n]*)"/g, /`([^`\r\n]*)`/g]
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    for (const re of patterns) {
      for (const m of text.matchAll(re)) literals.add(m[1])
    }
  }
  return [...literals]
}

const AUDIT = auditConfigConsumption({
  defaultConfig: DEFAULT_CONFIG,
  consumedKeys: collectConsumedKeyLiterals(SCANNED_FILES),
})

const BASELINE_SORTED = [...DECLARED_UNCONSUMED_KEYS].sort()

describe('P3-T22 配置「声明 ↔ 消费」一致性（L7 载体）', () => {
  it('扫描面不含声明面文件自身（防自引用假阴性）', () => {
    expect(SCANNED_FILES.length).toBeGreaterThan(50)
    expect(SCANNED_FILES).not.toContain(DECLARATION_SITE)
  })

  it('① 注册表声明的键均已落地 DEFAULT_CONFIG', () => {
    expect(AUDIT.registryKeysNotDeclared).toEqual([])
  })

  it('② 注册表声明的悬挂键必须已在基线登记（不得为未登记键背书）', () => {
    for (const k of AUDIT.registryKeysUnconsumed) {
      expect(BASELINE_SORTED).toContain(k)
    }
  })

  it('③ 悬挂键集合 == 已登记基线（快照锁定）', () => {
    expect(AUDIT.unconsumedKeys).toEqual(BASELINE_SORTED)
    expect(AUDIT.baselineKeys).toEqual(BASELINE_SORTED)
  })

  it('④ 无新增悬挂键（新增必须走「接线或删除」）', () => {
    expect(AUDIT.newDanglingKeys).toEqual([])
  })

  it('⑤ 基线清单无腐化（已接线的键必须同步移出清单）', () => {
    expect(AUDIT.staleBaselineKeys).toEqual([])
  })

  it('已处置的 3 个键不得重新出现（回归哨兵）', () => {
    for (const k of [
      'llm.max_format_retries',
      'event_bus.max_log_size',
      'perception.default_processor',
    ]) {
      expect(BASELINE_SORTED).not.toContain(k)
      expect(AUDIT.unconsumedKeys).not.toContain(k)
    }
  })
})

describe('P3-T22 auditConfigConsumption / flattenConfigKeys 语义', () => {
  const defaultConfig = {
    a: { b: 'x', nested: { c: 1 } },
    arr: ['p', 'q'],
    nil: null,
  }

  it('flattenConfigKeys 展开叶子键（数组与 null 视为叶子）', () => {
    expect(flattenConfigKeys(defaultConfig).sort()).toEqual(
      ['a.b', 'a.nested.c', 'arr', 'nil'].sort(),
    )
  })

  it('精确命中视为已消费', () => {
    const r = auditConfigConsumption({
      defaultConfig,
      consumedKeys: ['a.b', 'a.nested.c', 'arr', 'nil'],
      registry: [],
    })
    expect(r.unconsumedKeys).toEqual([])
    expect(r.newDanglingKeys).toEqual([])
  })

  it('含点前缀覆盖视为已消费（对象整体读取）', () => {
    const r = auditConfigConsumption({
      defaultConfig,
      consumedKeys: ['a.nested', 'a.b', 'arr', 'nil'],
      registry: [],
    })
    expect(r.unconsumedKeys).toEqual([])
  })

  it('裸前缀**不**覆盖整棵子树（防止门禁被掩盖）', () => {
    const r = auditConfigConsumption({ defaultConfig, consumedKeys: ['a'], registry: [] })
    expect(r.unconsumedKeys).toEqual(['a.b', 'a.nested.c', 'arr', 'nil'])
  })

  it('已登记的悬挂键进入 baselineKeys，未登记进入 newDanglingKeys', () => {
    const r = auditConfigConsumption({
      defaultConfig,
      consumedKeys: [],
      registry: [],
      exemptKeys: ['a.b'],
    })
    expect(r.baselineKeys).toEqual(['a.b'])
    expect(r.newDanglingKeys).toEqual(['a.nested.c', 'arr', 'nil'])
  })

  it('staleBaselineKeys 检出清单腐化（基线中的键已被消费）', () => {
    const r = auditConfigConsumption({
      defaultConfig,
      consumedKeys: ['a.b'],
      registry: [],
      exemptKeys: ['a.b', 'arr'],
    })
    expect(r.staleBaselineKeys).toEqual(['a.b'])
  })

  it('注册表声明键并入悬挂全集，并单独暴露 registryKeysUnconsumed', () => {
    const r = auditConfigConsumption({
      defaultConfig,
      consumedKeys: [],
      registry: [
        {
          id: 'x',
          name: 'x',
          configPrefix: '',
          enabledKey: 'a.b',
          configKeys: ['missing.key'],
          implementation: [],
          defaultEnabled: false,
          status: 'implemented',
        },
      ],
      exemptKeys: [],
    })
    expect(r.registryKeysNotDeclared).toEqual(['missing.key'])
    expect(r.registryKeysUnconsumed).toEqual(['a.b', 'missing.key'])
    // 「声明但未落地配置面」的键同样计入悬挂全集（missing.key 不在 defaultConfig 中）
    expect(r.unconsumedKeys).toEqual(['a.b', 'a.nested.c', 'arr', 'missing.key', 'nil'])
  })
})
