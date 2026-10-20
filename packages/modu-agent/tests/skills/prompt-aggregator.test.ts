import { describe, it, expect } from 'vitest'
import { SkillPromptAggregator } from '@/skills/prompt-aggregator.js'
import { SkillAdapter } from '@/skills/adapter.js'
import { BaseSkill } from '@/core/interfaces/skill.js'

class StubSkill extends BaseSkill {
  name(): string {
    return 'stub'
  }
  description(): string {
    return 'a stub skill'
  }
  version(): string {
    return '1.0.0'
  }
  systemPromptFragment(): string | null {
    return 'USE THE STUB TOOL'
  }
}

function fakeRegistry(skill: BaseSkill | null) {
  return {
    listSkills(): Record<string, any> {
      return skill ? { stub: {} } : {}
    },
    getSkill(): BaseSkill | undefined {
      return skill ?? undefined
    },
  } as any
}

describe('SkillPromptAggregator', () => {
  it('returns base unchanged when there are no skills', () => {
    const out = SkillPromptAggregator.aggregate('base prompt', fakeRegistry(null))
    expect(out).toBe('base prompt')
  })

  it('appends skill prompt fragments to the base prompt', () => {
    const out = SkillPromptAggregator.aggregate('base prompt', fakeRegistry(new StubSkill()))
    expect(out).toContain('base prompt')
    expect(out).toContain('[Skill: stub v1.0.0]')
    expect(out).toContain('USE THE STUB TOOL')
  })

  it('returns null when base is null and there are no fragments', () => {
    expect(SkillPromptAggregator.aggregate(null, fakeRegistry(null))).toBeNull()
  })
})

describe('SkillAdapter', () => {
  it('builds a prompt fragment string', () => {
    const frag = SkillAdapter.promptFragment(new StubSkill())
    expect(frag).toContain('[Skill: stub v1.0.0]')
    expect(frag).toContain('USE THE STUB TOOL')
  })
})

// ============================================================
// P0（选择→执行）：only 过滤 / P1-c：catalogOnly 目录注入
// ============================================================

class NamedSkill extends BaseSkill {
  constructor(
    private readonly _name: string,
    private readonly _desc: string,
    private readonly _frag: string,
  ) {
    super()
  }
  name(): string {
    return this._name
  }
  description(): string {
    return this._desc
  }
  version(): string {
    return '1.0.0'
  }
  systemPromptFragment(): string | null {
    return this._frag
  }
}

function multiRegistry(...skills: BaseSkill[]) {
  const map = new Map(skills.map((s) => [s.name(), s]))
  return {
    listSkills: () => Object.fromEntries([...map.keys()].map((n) => [n, {}])),
    getSkill: (n: string) => map.get(n),
  } as any
}

describe('SkillPromptAggregator · only（P0 选择）', () => {
  const math = new NamedSkill('math', '数学计算能力。支持括号。', 'USE MATH TOOL')
  const writer = new NamedSkill('writer', '长文写作能力', 'USE WRITER TOOL')

  it('未传 only 时聚合全部（与改造前一致）', () => {
    const out = SkillPromptAggregator.aggregate('base', multiRegistry(math, writer))
    expect(out).toContain('USE MATH TOOL')
    expect(out).toContain('USE WRITER TOOL')
  })

  it('only 命中的技能才注入', () => {
    const out = SkillPromptAggregator.aggregate('base', multiRegistry(math, writer), {
      only: ['math'],
    })
    expect(out).toContain('USE MATH TOOL')
    expect(out).not.toContain('USE WRITER TOOL')
  })

  it('only=[] 时不注入任何片段（返回 base 原样）', () => {
    const out = SkillPromptAggregator.aggregate('base', multiRegistry(math, writer), {
      only: [],
    })
    expect(out).toBe('base')
  })

  it('only 中包含未注册技能时忽略该名字', () => {
    const out = SkillPromptAggregator.aggregate('base', multiRegistry(math), {
      only: ['missing'],
    })
    expect(out).toBe('base')
  })
})

describe('SkillPromptAggregator · catalogOnly（P1-c 目录）', () => {
  const math = new NamedSkill('math', '数学计算能力。支持括号。', 'USE MATH TOOL')
  const writer = new NamedSkill('writer', '长文写作能力', 'USE WRITER TOOL')

  it('只注入目录（名称 + 首句摘要），不含正文与 examples', () => {
    const out = SkillPromptAggregator.aggregate('base', multiRegistry(math, writer), {
      catalogOnly: true,
    })
    expect(out).toContain('[Skills]')
    expect(out).toContain('- math: 数学计算能力')
    expect(out).toContain('- writer: 长文写作能力')
    expect(out).toContain('load_skill(name)')
    expect(out).not.toContain('USE MATH TOOL')
  })

  it('catalogOnly 时 only 同样生效', () => {
    const out = SkillPromptAggregator.aggregate(null, multiRegistry(math, writer), {
      catalogOnly: true,
      only: ['writer'],
    })
    expect(out).toContain('- writer')
    expect(out).not.toContain('- math')
  })

  it('无技能时返回 base 原样', () => {
    expect(
      SkillPromptAggregator.aggregate('base', multiRegistry(), { catalogOnly: true }),
    ).toBe('base')
  })

  it('预算不足时截断并标记 [truncated]', () => {
    const out = SkillPromptAggregator.aggregate('', multiRegistry(math, writer), {
      catalogOnly: true,
      catalogMaxChars: 20,
    })
    expect(out).toContain('- math')
    expect(out).toContain('[truncated]')
    expect(out).not.toContain('- writer')
  })

  it('预算为 0 时不注入（避免半行内容）', () => {
    const out = SkillPromptAggregator.aggregate('base', multiRegistry(math), {
      catalogOnly: true,
      catalogMaxChars: 0,
    })
    expect(out).toBe('base')
  })
})
