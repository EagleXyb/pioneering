// scenario-loader.test.ts
//
// P3-B：场景包加载器/宿主测试 —— manifest 驱动装配 + 作用域回滚。
// P1-2/P1-3/P1-4：激活失败回滚、extends 环检测、entry/target 路径沙箱。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  ScenarioLoader,
  resetScenarioLoader,
} from '@/kernel/scenario-loader.js'
import {
  resetRegistry,
  getRegistry,
} from '@/core/registry.js'
import {
  getDomainAdapter,
} from '@/reasoning/domain-adapters.js'
import {
  peekGuardrailRule,
} from '@/tools/tool-guardrails.js'
import {
  isRegisteredPlanTaskType,
  isRegisteredSopRole,
  resetSopRegistry,
} from '@/orchestration/sop-registry.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACKS_DIR = path.resolve(HERE, '..', '..', 'packs')

beforeEach(() => {
  resetRegistry()
  resetSopRegistry()
  resetScenarioLoader()
})

afterEach(async () => {
  resetRegistry()
  resetSopRegistry()
  resetScenarioLoader()
})

/** 在临时 packs 根下创建一个包目录（返回 packsRoot 与 packDir）。 */
function makeTempPack(
  packLeaf: string,
  manifestLines: string[],
  extraFiles: Record<string, string> = {},
): { packsRoot: string; packDir: string } {
  const packsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-packs-'))
  const packDir = path.join(packsRoot, packLeaf)
  fs.mkdirSync(packDir, { recursive: true })
  fs.writeFileSync(path.join(packDir, 'pack.yaml'), manifestLines.join('\n'))
  for (const [rel, content] of Object.entries(extraFiles)) {
    const abs = path.join(packDir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  return { packsRoot, packDir }
}

describe('P3-B ScenarioLoader', () => {
  it('激活内置示例场景包：全部能力装配到注册表', async () => {
    const loader = new ScenarioLoader({ packsDir: PACKS_DIR })

    const host = await loader.activate('example-pack')
    expect(host.active).toBe(true)
    expect(loader.isActive('example-pack')).toBe(true)

    // 领域知识
    expect(getDomainAdapter('research_writer')).not.toBeNull()
    expect(getDomainAdapter('research_writer')?.domain_context).toContain('研究写作')

    // Prompt
    expect(getRegistry().getPrompt('example_pack.writing_style')).toBeDefined()

    // 护栏
    expect(peekGuardrailRule('example_doc_writer_approval')).not.toBeNull()

    // SOP 字典
    expect(isRegisteredSopRole('fact_checker')).toBe(true)
    expect(isRegisteredPlanTaskType('research')).toBe(true)

    // 画像扩展
    expect(loader.config.get('graph.spec.extra', {})['example_pack_enabled']).toBe(true)

    // 卸载：作用域回滚
    await loader.deactivate('example-pack')
    expect(host.active).toBe(false)
    expect(getDomainAdapter('research_writer')).toBeNull()
    expect(getRegistry().getPrompt('example_pack.writing_style')).toBeUndefined()
    expect(peekGuardrailRule('example_doc_writer_approval')).toBeNull()
    expect(isRegisteredSopRole('fact_checker')).toBe(false)
    expect(isRegisteredPlanTaskType('research')).toBe(false)
    expect(loader.config.get('graph.spec.extra', {})['example_pack_enabled']).toBeUndefined()
  })

  it('重复激活返回同一 host；未激活包 deactivate 安全', async () => {
    const loader = new ScenarioLoader({ packsDir: PACKS_DIR })
    const h1 = await loader.activate('example-pack')
    const h2 = await loader.activate('example-pack')
    expect(h1).toBe(h2)

    await loader.deactivate('not-exists-pack') // 不抛错
    await loader.deactivate('example-pack')
  })

  it('代码型 entry：activate(host) 注册自定义节点，卸载时摘除', async () => {
    const { packsRoot } = makeTempPack('code_pack', [
      'name: tmp-code-pack',
      'version: 0.1.0',
      'capabilities:',
      '  - prompt',
      '  - domain',
      'entry: entry.js',
    ], {
      'prompts/greet.json': JSON.stringify({
        id: 'tmp_pack.greet',
        version: '1',
        messages: [{ role: 'system', content: 'hi' }],
      }),
      'domains/tmp_domain.md': '---\ndomain_context: 临时领域\n---\n临时领域正文',
      'entry.js': [
        "export function activate(host) {",
        "  host.registerNode({",
        "    name: 'tmp_pack_node',",
        "    factory: () => () => ({ tmp: true }),",
        "  })",
        "}",
      ].join('\n'),
    })

    try {
      const loader = new ScenarioLoader({ packsDir: packsRoot })
      const host = await loader.activate('code_pack')

      expect(getRegistry().listNodeSpecs().map((s) => s.name)).toContain('tmp_pack_node')
      expect(getRegistry().getPrompt('tmp_pack.greet')).toBeDefined()
      expect(getDomainAdapter('tmp_domain')).not.toBeNull()

      await loader.deactivate('tmp-code-pack')
      expect(host.active).toBe(false)
      expect(getRegistry().listNodeSpecs().map((s) => s.name)).not.toContain('tmp_pack_node')
      expect(getRegistry().getPrompt('tmp_pack.greet')).toBeUndefined()
      expect(getDomainAdapter('tmp_domain')).toBeNull()
    } finally {
      fs.rmSync(packsRoot, { recursive: true, force: true })
    }
  })

  it('非法 manifest / 缺失包抛出错误', async () => {
    const { packsRoot } = makeTempPack('bad_pack', ['version: 0.1.0'])
    try {
      const loader = new ScenarioLoader({ packsDir: packsRoot })
      await expect(loader.activate('bad_pack')).rejects.toThrow(/name 必须是非空字符串/)

      await expect(loader.activate('definitely-not-a-pack')).rejects.toThrow(/scenario pack not found/)
    } finally {
      fs.rmSync(packsRoot, { recursive: true, force: true })
    }
  })

  it('extends 依赖先行激活；被依赖时拒绝卸载', async () => {
    const packsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-packs-'))
    try {
      fs.mkdirSync(path.join(packsRoot, 'base_pack'))
      fs.mkdirSync(path.join(packsRoot, 'child_pack'))
      fs.writeFileSync(path.join(packsRoot, 'base_pack', 'pack.yaml'), [
        'name: base_pack',
        'version: 0.1.0',
      ].join('\n'))
      fs.writeFileSync(path.join(packsRoot, 'child_pack', 'pack.yaml'), [
        'name: child_pack',
        'version: 0.1.0',
        'extends:',
        '  - base_pack',
      ].join('\n'))

      const loader = new ScenarioLoader({ packsDir: packsRoot })
      await loader.activate('child_pack')
      expect(loader.listActive().sort()).toEqual(['base_pack', 'child_pack'])

      await expect(loader.deactivate('base_pack')).rejects.toThrow(/still required by active pack/)

      await loader.deactivate('child_pack')
      await loader.deactivate('base_pack')
      expect(loader.listActive()).toEqual([])
    } finally {
      fs.rmSync(packsRoot, { recursive: true, force: true })
    }
  })
})

// ============================================================
// P1-2：激活失败回滚（已注册资产零残留 + 可同名重新激活）
// ============================================================
describe('P1-2 · ScenarioLoader 激活失败回滚', () => {
  it('entry activate 抛错：已注册 prompt/节点零残留，包不进入 active', async () => {
    const { packsRoot } = makeTempPack('fail_pack', [
      'name: fail-pack',
      'version: 0.1.0',
      'capabilities:',
      '  - prompt',
      'entry: entry.js',
    ], {
      'prompts/boom.json': JSON.stringify({
        id: 'fail_pack.p1',
        version: '1',
        messages: [{ role: 'system', content: 'x' }],
      }),
      'entry.js': [
        "export function activate(host) {",
        "  host.registerNode({ name: 'fail_pack_node', factory: () => () => ({}) })",
        "  throw new Error('boom from entry')",
        "}",
      ].join('\n'),
    })

    try {
      const loader = new ScenarioLoader({ packsDir: packsRoot })
      await expect(loader.activate('fail_pack')).rejects.toThrow(/boom from entry/)

      // 包未激活
      expect(loader.isActive('fail-pack')).toBe(false)
      expect(loader.listActive()).toEqual([])
      // 装配期资产已回滚
      expect(getRegistry().getPrompt('fail_pack.p1')).toBeUndefined()
      expect(getRegistry().listNodeSpecs().map((s) => s.name)).not.toContain('fail_pack_node')

      // 修复后同名包可再次激活：用"不同目录、同 manifest 名"的包验证
      // （ESM 按文件 URL 缓存模块，直接覆盖原 entry.js 不会重新加载，
      //   真实流程也是修复文件后换新版本目录/重启进程）。
      const fixedDir = path.join(packsRoot, 'fail_pack_fixed')
      fs.mkdirSync(fixedDir)
      fs.writeFileSync(path.join(fixedDir, 'pack.yaml'), 'name: fail-pack\nversion: 0.2.0\nentry: entry.js\n')
      fs.writeFileSync(path.join(fixedDir, 'entry.js'), [
        "export function activate(host) {",
        "  host.registerNode({ name: 'fail_pack_node', factory: () => () => ({ ok: 1 }) })",
        "}",
      ].join('\n'))
      const host = await loader.activate('fail_pack_fixed')
      expect(host.active).toBe(true)
      expect(getRegistry().listNodeSpecs().map((s) => s.name)).toContain('fail_pack_node')
      await loader.deactivate('fail-pack')
    } finally {
      fs.rmSync(packsRoot, { recursive: true, force: true })
    }
  })

  it('配置覆盖随激活失败回滚：未存在的键恢复默认值（不留 undefined 残留）', async () => {
    const { packsRoot } = makeTempPack('cfg_fail_pack', [
      'name: cfg-fail-pack',
      'version: 0.1.0',
      'config_profile:',
      '  agent_overrides:',
      '    custom.rollback.key: injected',
      'entry: entry.js',
    ], {
      'entry.js': "export function activate() { throw new Error('cfg boom') }\n",
    })

    try {
      const loader = new ScenarioLoader({ packsDir: packsRoot })
      await expect(loader.activate('cfg_fail_pack')).rejects.toThrow(/cfg boom/)

      // 覆盖键已随回滚删除，get 回落到默认值而非 undefined
      expect(loader.config.get('custom.rollback.key', 'DEFAULT')).toBe('DEFAULT')
      expect(loader.isActive('cfg-fail-pack')).toBe(false)
    } finally {
      fs.rmSync(packsRoot, { recursive: true, force: true })
    }
  })
})

// ============================================================
// P1-3：extends 循环依赖显式报错（不再递归到栈溢出）
// ============================================================
describe('P1-3 · extends 环检测', () => {
  it('A extends B、B extends A：抛 circular 错误且无激活残留', async () => {
    const packsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-cycle-'))
    try {
      fs.mkdirSync(path.join(packsRoot, 'pack_a'))
      fs.mkdirSync(path.join(packsRoot, 'pack_b'))
      fs.writeFileSync(path.join(packsRoot, 'pack_a', 'pack.yaml'),
        'name: pack_a\nversion: 0.1.0\nextends:\n  - pack_b\n')
      fs.writeFileSync(path.join(packsRoot, 'pack_b', 'pack.yaml'),
        'name: pack_b\nversion: 0.1.0\nextends:\n  - pack_a\n')

      const loader = new ScenarioLoader({ packsDir: packsRoot })
      await expect(loader.activate('pack_a')).rejects.toThrow(/circular scenario pack dependency/)
      expect(loader.listActive()).toEqual([])

      // 激活标记已清理：后续激活一个独立包正常
      fs.mkdirSync(path.join(packsRoot, 'pack_c'))
      fs.writeFileSync(path.join(packsRoot, 'pack_c', 'pack.yaml'),
        'name: pack_c\nversion: 0.1.0\n')
      const host = await loader.activate('pack_c')
      expect(host.active).toBe(true)
      await loader.deactivate('pack_c')
    } finally {
      fs.rmSync(packsRoot, { recursive: true, force: true })
    }
  })

  it('自依赖（A extends A）同样报环错误', async () => {
    const packsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-self-'))
    try {
      fs.mkdirSync(path.join(packsRoot, 'self_pack'))
      fs.writeFileSync(path.join(packsRoot, 'self_pack', 'pack.yaml'),
        'name: self_pack\nversion: 0.1.0\nextends:\n  - self_pack\n')
      const loader = new ScenarioLoader({ packsDir: packsRoot })
      await expect(loader.activate('self_pack')).rejects.toThrow(/circular scenario pack dependency/)
      expect(loader.listActive()).toEqual([])
    } finally {
      fs.rmSync(packsRoot, { recursive: true, force: true })
    }
  })
})

// ============================================================
// P1-4：entry / target 路径沙箱（拒绝 packsDir / packDir 之外）
// ============================================================
describe('P1-4 · 场景包路径沙箱', () => {
  it('entry 指向包目录外（../../evil.js）：拒绝且不执行外部文件', async () => {
    const evilDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-evil-'))
    const packsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-p4-packs-'))
    try {
      // 外部恶意模块：一旦被 import 就写全局标记
      fs.writeFileSync(path.join(evilDir, 'evil.js'),
        'globalThis.__MODU_EVIL_LOADED__ = true\n')
      fs.mkdirSync(path.join(packsRoot, 'escape_pack'))
      const rel = path.relative(
        path.join(packsRoot, 'escape_pack'),
        path.join(evilDir, 'evil.js'),
      ).split(path.sep).join('/')
      fs.writeFileSync(path.join(packsRoot, 'escape_pack', 'pack.yaml'),
        `name: escape_pack\nversion: 0.1.0\nentry: ${rel}\n`)

      const loader = new ScenarioLoader({ packsDir: packsRoot })
      await expect(loader.activate('escape_pack')).rejects.toThrow(/越界|outside|不在允许目录/)
      // 外部文件未被加载执行
      expect((globalThis as any).__MODU_EVIL_LOADED__).toBeUndefined()
      expect(loader.isActive('escape_pack')).toBe(false)
    } finally {
      fs.rmSync(evilDir, { recursive: true, force: true })
      fs.rmSync(packsRoot, { recursive: true, force: true })
    }
  })

  it('target 为 packsDir 之外的绝对目录：拒绝激活', async () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-outside-'))
    const packsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-p4-root-'))
    try {
      fs.writeFileSync(path.join(outside, 'pack.yaml'), 'name: outside_pack\nversion: 0.1.0\n')
      const loader = new ScenarioLoader({ packsDir: packsRoot })
      await expect(loader.activate(outside)).rejects.toThrow(/越界|outside|不在允许目录/)
      expect(loader.isActive('outside_pack')).toBe(false)
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
      fs.rmSync(packsRoot, { recursive: true, force: true })
    }
  })

  it('合法包内 entry 正常加载（沙箱不误伤）', async () => {
    const { packsRoot } = makeTempPack('nested_pack', [
      'name: nested_pack',
      'version: 0.1.0',
      'entry: sub/entry.js',
    ], {
      'sub/entry.js': "export function activate() { /* ok */ }\n",
    })
    try {
      const loader = new ScenarioLoader({ packsDir: packsRoot })
      const host = await loader.activate('nested_pack')
      expect(host.active).toBe(true)
      await loader.deactivate('nested_pack')
    } finally {
      fs.rmSync(packsRoot, { recursive: true, force: true })
    }
  })
})
