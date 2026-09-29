// scenario-loader.test.ts
//
// P3-B：场景包加载器/宿主测试 —— manifest 驱动装配 + 作用域回滚。
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
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-pack-'))
    try {
      fs.mkdirSync(path.join(tmp, 'prompts'), { recursive: true })
      fs.mkdirSync(path.join(tmp, 'domains'), { recursive: true })

      fs.writeFileSync(path.join(tmp, 'pack.yaml'), [
        'name: tmp-code-pack',
        'version: 0.1.0',
        'capabilities:',
        '  - prompt',
        '  - domain',
        'entry: entry.js',
      ].join('\n'))

      fs.writeFileSync(path.join(tmp, 'prompts', 'greet.json'), JSON.stringify({
        id: 'tmp_pack.greet',
        version: '1',
        messages: [{ role: 'system', content: 'hi' }],
      }))

      fs.writeFileSync(path.join(tmp, 'domains', 'tmp_domain.md'), [
        '---',
        'domain_context: 临时领域',
        '---',
        '临时领域正文',
      ].join('\n'))

      fs.writeFileSync(path.join(tmp, 'entry.js'), [
        "export function activate(host) {",
        "  host.registerNode({",
        "    name: 'tmp_pack_node',",
        "    factory: () => () => ({ tmp: true }),",
        "  })",
        "}",
      ].join('\n'))

      const loader = new ScenarioLoader({ packsDir: PACKS_DIR })
      const host = await loader.activate(tmp)

      expect(getRegistry().listNodeSpecs().map((s) => s.name)).toContain('tmp_pack_node')
      expect(getRegistry().getPrompt('tmp_pack.greet')).toBeDefined()
      expect(getDomainAdapter('tmp_domain')).not.toBeNull()

      await loader.deactivate('tmp-code-pack')
      expect(getRegistry().listNodeSpecs().map((s) => s.name)).not.toContain('tmp_pack_node')
      expect(getRegistry().getPrompt('tmp_pack.greet')).toBeUndefined()
      expect(getDomainAdapter('tmp_domain')).toBeNull()
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('非法 manifest / 缺失包抛出错误', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-pack-bad-'))
    try {
      fs.writeFileSync(path.join(tmp, 'pack.yaml'), 'version: 0.1.0\n')
      const loader = new ScenarioLoader({ packsDir: PACKS_DIR })
      await expect(loader.activate(tmp)).rejects.toThrow(/name 必须是非空字符串/)

      await expect(loader.activate('definitely-not-a-pack')).rejects.toThrow(/scenario pack not found/)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
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
