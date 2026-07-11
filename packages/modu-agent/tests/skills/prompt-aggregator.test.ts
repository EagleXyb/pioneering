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
