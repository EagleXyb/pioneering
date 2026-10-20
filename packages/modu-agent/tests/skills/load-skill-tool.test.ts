import { describe, it, expect } from 'vitest'
import { BaseSkill } from '@/core/interfaces/skill.js'
import { LoadSkillTool } from '@/skills/load-skill-tool.js'

class StubSkill extends BaseSkill {
  constructor(
    private readonly _name: string,
    private readonly _frag: string | null = 'USE IT',
    private readonly _available = true,
    private readonly _examples: Array<Record<string, string>> = [
      { input: 'a', output: 'b' },
      { input: '', output: '' },
    ],
  ) {
    super()
  }
  name(): string {
    return this._name
  }
  description(): string {
    return `${this._name}-desc`
  }
  version(): string {
    return '2.3.4'
  }
  isAvailable(): boolean {
    return this._available
  }
  systemPromptFragment(): string | null {
    return this._frag
  }
  examples(): Array<Record<string, string>> {
    return this._examples
  }
}

function registryOf(...skills: BaseSkill[]) {
  const map = new Map(skills.map((s) => [s.name(), s]))
  return { getSkill: (n: string) => map.get(n) } as any
}

describe('LoadSkillTool（P1-c L2 按需加载）', () => {
  it('工具名与参数 schema 固定', () => {
    const tool = new LoadSkillTool({ registry: registryOf(), allowed: [] })
    expect(tool.name()).toBe('load_skill')
    const schema = tool.parametersSchema()
    expect(schema.required).toEqual(['name'])
    expect(schema.properties.name.type).toBe('string')
  })

  it('加载允许的技能：返回正文 + examples + 版本', async () => {
    const tool = new LoadSkillTool({
      registry: registryOf(new StubSkill('math')),
      allowed: ['math'],
    })
    const r = await tool.invoke({ name: 'math' })
    expect(r.status).toBe('success')
    expect(r.data.skill).toBe('math')
    expect(r.data.version).toBe('2.3.4')
    expect(r.data.instructions).toBe('USE IT')
    // 空 example 被过滤
    expect(r.data.examples).toEqual([{ input: 'a', output: 'b' }])
    expect(r.data.truncated).toBe(false)
  })

  it('未选中的技能 → SKILL_NOT_AVAILABLE（不暴露未启用能力）', async () => {
    const tool = new LoadSkillTool({
      registry: registryOf(new StubSkill('math'), new StubSkill('writer')),
      allowed: ['math'],
    })
    const r = await tool.invoke({ name: 'writer' })
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SKILL_NOT_AVAILABLE')
  })

  it('缺少技能名 → 错误（不抛异常）', async () => {
    const tool = new LoadSkillTool({ registry: registryOf(), allowed: ['math'] })
    const r = await tool.invoke({})
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SKILL_NOT_AVAILABLE')
  })

  it('已允许但未注册 / 不可用 → 错误', async () => {
    const missing = new LoadSkillTool({ registry: registryOf(), allowed: ['math'] })
    expect((await missing.invoke({ name: 'math' })).status).toBe('error')

    const off = new LoadSkillTool({
      registry: registryOf(new StubSkill('math', 'X', false)),
      allowed: ['math'],
    })
    const r = await off.invoke({ name: 'math' })
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SKILL_NOT_AVAILABLE')
  })

  it('正文超预算时截断并标记 [truncated]', async () => {
    const long = 'x'.repeat(1000)
    const tool = new LoadSkillTool({
      registry: registryOf(new StubSkill('math', long)),
      allowed: ['math'],
      maxChars: 200,
    })
    const r = await tool.invoke({ name: 'math' })
    expect(r.data.truncated).toBe(true)
    expect(r.data.instructions.endsWith('[truncated]')).toBe(true)
    expect(String(r.data.instructions).length).toBeLessThan(long.length)
  })

  it('无 systemPromptFragment 时回退 description', async () => {
    const tool = new LoadSkillTool({
      registry: registryOf(new StubSkill('math', null)),
      allowed: ['math'],
    })
    const r = await tool.invoke({ name: 'math' })
    expect(r.data.instructions).toBe('math-desc')
  })

  it('registry 抛错时返回标准错误（不外泄异常）', async () => {
    const broken = {
      getSkill: () => {
        throw new Error('boom')
      },
    } as any
    const tool = new LoadSkillTool({ registry: broken, allowed: ['math'] })
    const r = await tool.invoke({ name: 'math' })
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SKILL_NOT_AVAILABLE')
  })

  it('技能内部抛错时返回 SKILL_LOAD_FAILED', async () => {
    const bad = new StubSkill('math')
    bad.systemPromptFragment = () => {
      throw new Error('frag boom')
    }
    const tool = new LoadSkillTool({ registry: registryOf(bad), allowed: ['math'] })
    const r = await tool.invoke({ name: 'math' })
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SKILL_LOAD_FAILED')
  })
})
