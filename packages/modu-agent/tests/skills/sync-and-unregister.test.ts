// L3（1.1 / 1.2）：技能反注册回收工具 + 白名单对齐（syncFromConfig）+ 版本号
//
// 背景缺陷：`unregisterSkill` 修复前只删 `_skills` 条目，工具残留在 `_tools`
//   → 管理面「停用」后工具仍可被 LLM 调用（假动作）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { ComponentRegistry } from '@/core/registry.js'
import { BaseTool } from '@/core/interfaces/action.js'
import { BaseSkill } from '@/core/interfaces/skill.js'
import { SkillLoader } from '@/skills/loader.js'
import { RuntimeConfig, resetConfig } from '@/config/runtime-config.js'
import { getSkillsRevision, resetSkillsRevision } from '@/skills/revision.js'

class ToolX extends BaseTool {
  constructor(private readonly _name = 'x_tool') {
    super()
  }
  name(): string {
    return this._name
  }
  description(): string {
    return 'x'
  }
  parametersSchema(): Record<string, any> {
    return {}
  }
  async invoke(): Promise<Record<string, any>> {
    return { status: 'success' }
  }
}

class SkillA extends BaseSkill {
  teardownCalls = 0
  name(): string {
    return 'alpha'
  }
  description(): string {
    return 'alpha skill'
  }
  version(): string {
    return '1.0.0'
  }
  tools() {
    return [new ToolX()]
  }
  teardown(): void {
    this.teardownCalls += 1
  }
}

const TMP_DIRS: string[] = []

function makeSkillDir(name: string): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'modu-skills-'))
  TMP_DIRS.push(base)
  const dir = path.join(base, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'skill.js'),
    [
      'export const skill = {',
      `  name: () => ${JSON.stringify(name)},`,
      `  description: () => ${JSON.stringify(`${name} skill`)},`,
      "  version: () => '1.0.0',",
      "  tags: () => ['t'],",
      '  examples: () => [],',
      '  tools: () => [{',
      `    name: () => ${JSON.stringify(`${name}_tool`)},`,
      "    description: () => 'tool',",
      '    parametersSchema: () => ({}),',
      '    requiresApproval: () => false,',
      '    onApprovalRejected: () => ({}),',
      "    invoke: async () => ({ status: 'success' }),",
      '  }],',
      '  isAvailable: () => true,',
      '  healthCheck: () => globalThis.__skillHealthy !== false,',
      '  setup() { globalThis.__skillSetup = (globalThis.__skillSetup || 0) + 1 },',
      '  teardown() { globalThis.__skillTeardown = (globalThis.__skillTeardown || 0) + 1 },',
      '}',
    ].join('\n'),
    'utf8',
  )
  // discover() 的入参是「包含多个技能子目录的根目录」，故返回 base
  return base
}

beforeEach(() => {
  resetConfig()
  resetSkillsRevision()
  delete (globalThis as any).__skillSetup
  delete (globalThis as any).__skillTeardown
  delete (globalThis as any).__skillHealthy
})

afterEach(() => {
  for (const d of TMP_DIRS.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

describe('unregisterSkill（L3-1.1：连带回收工具）', () => {
  it('移除技能条目与其注册的工具', () => {
    const reg = new ComponentRegistry()
    reg.registerSkill(new SkillA())

    expect(reg.getSkill('alpha')).toBeDefined()
    expect(reg.getTool('x_tool')).toBeDefined()
    expect(reg.skillToolNames('alpha')).toEqual(['x_tool'])

    expect(reg.unregisterSkill('alpha')).toBe(true)
    expect(reg.getSkill('alpha')).toBeUndefined()
    expect(reg.getTool('x_tool')).toBeUndefined()
    expect(reg.skillToolNames('alpha')).toEqual([])
  })

  it('工具已被同名组件覆盖时不误删', () => {
    const reg = new ComponentRegistry()
    reg.registerSkill(new SkillA())
    const override = new ToolX()
    reg.registerTool(override)

    reg.unregisterSkill('alpha')
    expect(reg.getTool('x_tool')).toBe(override)
  })

  it('重复卸载返回 false（幂等）', () => {
    const reg = new ComponentRegistry()
    reg.registerSkill(new SkillA())
    expect(reg.unregisterSkill('alpha')).toBe(true)
    expect(reg.unregisterSkill('alpha')).toBe(false)
  })
})

describe('SkillLoader.syncFromConfig（L3-1.2：白名单对齐）', () => {
  function cfg(active: string[], dirs: string[]): RuntimeConfig {
    return new RuntimeConfig({
      skills: { enabled: true, active, auto_discover_dirs: dirs },
    })
  }

  it('新增：白名单命中且可发现 → 注册并 bump 版本号', async () => {
    const reg = new ComponentRegistry()
    const dir = makeSkillDir('alpha')
    const before = getSkillsRevision()

    const diff = await new SkillLoader(reg, cfg(['alpha'], [dir])).syncFromConfig()

    expect(diff.added).toEqual(['alpha'])
    expect(diff.removed).toEqual([])
    expect(reg.getSkill('alpha')).toBeDefined()
    expect(reg.getTool('alpha_tool')).toBeDefined()
    expect((globalThis as any).__skillSetup).toBe(1)
    expect(getSkillsRevision()).toBe(before + 1)
  })

  it('移除：白名单为空 → 反注册 + 回收工具 + teardown', async () => {
    const reg = new ComponentRegistry()
    const dir = makeSkillDir('alpha')
    const loader = new SkillLoader(reg, cfg(['alpha'], [dir]))
    await loader.syncFromConfig()

    const loader2 = new SkillLoader(reg, cfg([], [dir]))
    const diff = await loader2.syncFromConfig()

    expect(diff.removed).toEqual(['alpha'])
    expect(reg.getSkill('alpha')).toBeUndefined()
    expect(reg.getTool('alpha_tool')).toBeUndefined()
    expect((globalThis as any).__skillTeardown).toBe(1)
  })

  it('幂等：连续两次 sync 不产生增删、不重复 setup', async () => {
    const reg = new ComponentRegistry()
    const dir = makeSkillDir('alpha')
    await new SkillLoader(reg, cfg(['alpha'], [dir])).syncFromConfig()
    const rev = getSkillsRevision()

    const diff = await new SkillLoader(reg, cfg(['alpha'], [dir])).syncFromConfig()

    expect(diff).toEqual({ added: [], removed: [], missing: [] })
    expect((globalThis as any).__skillSetup).toBe(1)
    expect(getSkillsRevision()).toBe(rev)
  })

  it('白名单里不可发现的技能 → missing（不抛异常）', async () => {
    const reg = new ComponentRegistry()
    const dir = makeSkillDir('alpha')
    const diff = await new SkillLoader(reg, cfg(['ghost'], [dir])).syncFromConfig()

    expect(diff.missing).toEqual(['ghost'])
    expect(reg.getSkill('ghost')).toBeUndefined()
  })

  it('healthCheck 失败 → 不注册（L4-5.1）', async () => {
    const reg = new ComponentRegistry()
    const dir = makeSkillDir('alpha')
    ;(globalThis as any).__skillHealthy = false

    const diff = await new SkillLoader(reg, cfg(['alpha'], [dir])).syncFromConfig()

    expect(diff.missing).toEqual(['alpha'])
    expect(reg.getSkill('alpha')).toBeUndefined()
    expect(reg.getTool('alpha_tool')).toBeUndefined()
  })

  it('已注册后 healthCheck 失败 → 下次 sync 被移除', async () => {
    const reg = new ComponentRegistry()
    const dir = makeSkillDir('alpha')
    await new SkillLoader(reg, cfg(['alpha'], [dir])).syncFromConfig()
    expect(reg.getSkill('alpha')).toBeDefined()

    ;(globalThis as any).__skillHealthy = false
    const diff = await new SkillLoader(reg, cfg(['alpha'], [dir])).syncFromConfig()

    expect(diff.removed).toEqual(['alpha'])
    expect(reg.getSkill('alpha')).toBeUndefined()
    expect(reg.getTool('alpha_tool')).toBeUndefined()
  })

  it('skills.enabled=false → 不做任何变更（默认路径零行为变化）', async () => {
    const reg = new ComponentRegistry()
    const dir = makeSkillDir('alpha')
    const disabled = new RuntimeConfig({
      skills: { enabled: false, active: ['alpha'], auto_discover_dirs: [dir] },
    })
    const diff = await new SkillLoader(reg, disabled).syncFromConfig()

    expect(diff).toEqual({ added: [], removed: [], missing: [] })
    expect(Object.keys(reg.listSkills())).toEqual([])
  })
})
