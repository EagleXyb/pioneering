import { describe, it, expect } from 'vitest'
import { BaseSkill } from '@/core/interfaces/skill.js'
import { BaseTool } from '@/core/interfaces/action.js'
import {
  collectSkillToolNames,
  pruneSkillTools,
  resolveSkillSelection,
  shouldEnableProgressiveDisclosure,
  summarizeSkillDescription,
} from '@/skills/selection.js'

class StubTool extends BaseTool {
  constructor(private readonly _name: string) {
    super()
  }
  name(): string {
    return this._name
  }
  description(): string {
    return this._name
  }
  parametersSchema(): Record<string, any> {
    return {}
  }
  async invoke(): Promise<Record<string, any>> {
    return { status: 'success' }
  }
}

class StubSkill extends BaseSkill {
  constructor(
    private readonly _name: string,
    private readonly _desc = '一句话描述。第二句不应进入目录。',
    private readonly _tools: string[] = [`${_name}_tool`],
    private readonly _available = true,
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
  isAvailable(): boolean {
    return this._available
  }
  tools() {
    return this._tools.map((n) => new StubTool(n))
  }
}

function registryOf(...skills: BaseSkill[]) {
  const map = new Map(skills.map((s) => [s.name(), s]))
  return {
    getSkill: (name: string) => map.get(name),
    listSkills: () => Object.fromEntries([...map.keys()].map((n) => [n, {}])),
  } as any
}

describe('resolveSkillSelection', () => {
  it('未传选择（undefined）→ 全部 undefined，表示不裁剪（改造前行为）', () => {
    const r = resolveSkillSelection(registryOf(new StubSkill('math')), undefined)
    expect(r.promptSkills).toBeUndefined()
    expect(r.toolNames).toBeUndefined()
    expect(r.ignored).toEqual([])
    expect(r.catalog).toEqual([])
  })

  it('null 与 undefined 等价', () => {
    const r = resolveSkillSelection(registryOf(), null)
    expect(r.toolNames).toBeUndefined()
  })

  it('空数组 → 明确不使用技能（空集，不是 undefined）', () => {
    const r = resolveSkillSelection(registryOf(new StubSkill('math')), [])
    expect(r.promptSkills).toEqual([])
    expect(r.toolNames).toEqual([])
  })

  it('命中技能：返回提示范围、工具名与目录条目', () => {
    const r = resolveSkillSelection(
      registryOf(new StubSkill('math'), new StubSkill('writer')),
      ['math'],
    )
    expect(r.promptSkills).toEqual(['math'])
    expect(r.toolNames).toEqual(['math_tool'])
    expect(r.catalog).toHaveLength(1)
    expect(r.catalog[0].name).toBe('math')
    // 目录只取首句
    expect(r.catalog[0].summary).toBe('一句话描述')
    expect(r.ignored).toEqual([])
  })

  it('未注册 / 不可用技能进入 ignored，其余照常', () => {
    const r = resolveSkillSelection(
      registryOf(new StubSkill('math'), new StubSkill('off', 'd', ['off_tool'], false)),
      ['math', 'missing', 'off'],
    )
    expect(r.promptSkills).toEqual(['math'])
    expect(r.toolNames).toEqual(['math_tool'])
    expect(r.ignored).toEqual(['missing', 'off'])
  })

  it('重复 / 空白 / 非字符串项被归一化', () => {
    const r = resolveSkillSelection(
      registryOf(new StubSkill('math')),
      ['math', ' math ', '', '  '],
    )
    expect(r.promptSkills).toEqual(['math'])
    expect(r.catalog).toHaveLength(1)
  })

  it('工具名去重（两个技能共享同一工具名）', () => {
    const a = new StubSkill('a', 'd', ['shared', 'a_only'])
    const b = new StubSkill('b', 'd', ['shared', 'b_only'])
    const r = resolveSkillSelection(registryOf(a, b), ['a', 'b'])
    expect(r.toolNames).toEqual(['shared', 'a_only', 'b_only'])
  })

  it('registry 缺失 / getSkill 抛错时全部进入 ignored（不抛异常）', () => {
    expect(resolveSkillSelection(undefined, ['math']).ignored).toEqual(['math'])
    const broken = {
      getSkill: () => {
        throw new Error('boom')
      },
    } as any
    expect(resolveSkillSelection(broken, ['math']).ignored).toEqual(['math'])
  })
})

class ScopedSkill extends StubSkill {
  constructor(
    name: string,
    private readonly _scopes: string[],
  ) {
    super(name)
  }
  requiredScopes(): string[] {
    return this._scopes
  }
}

describe('resolveSkillSelection · scopes（L4-4.1）', () => {
  it('未提供 scopes → 不校验（向后兼容）', () => {
    const r = resolveSkillSelection(
      registryOf(new ScopedSkill('pay', ['pay:write'])),
      ['pay'],
    )
    expect(r.promptSkills).toEqual(['pay'])
  })

  it('提供 scopes 且全部命中 → 放行', () => {
    const r = resolveSkillSelection(
      registryOf(new ScopedSkill('pay', ['pay:write', 'net:http'])),
      ['pay'],
      { scopes: ['pay:write', 'net:http', 'other'] },
    )
    expect(r.promptSkills).toEqual(['pay'])
    expect(r.ignored).toEqual([])
  })

  it('缺少任一 scope → 忽略该技能（fail-closed）', () => {
    const r = resolveSkillSelection(
      registryOf(new ScopedSkill('pay', ['pay:write', 'net:http'])),
      ['pay'],
      { scopes: ['pay:write'] },
    )
    expect(r.promptSkills).toEqual([])
    expect(r.ignored).toEqual(['pay'])
    expect(r.toolNames).toEqual([])
  })

  it('空 scopes → 所有声明了 scope 的技能都被忽略', () => {
    const r = resolveSkillSelection(
      registryOf(new ScopedSkill('pay', ['pay:write']), new StubSkill('free')),
      ['pay', 'free'],
      { scopes: [] },
    )
    expect(r.promptSkills).toEqual(['free'])
    expect(r.ignored).toEqual(['pay'])
  })

  it('requiredScopes 抛错 → 视为无要求（保守放行）', () => {
    const broken = new StubSkill('x')
    broken.requiredScopes = () => {
      throw new Error('boom')
    }
    const r = resolveSkillSelection(registryOf(broken), ['x'], { scopes: [] })
    expect(r.promptSkills).toEqual(['x'])
  })
})

describe('summarizeSkillDescription', () => {
  it('取首句并去除句末标点', () => {
    expect(summarizeSkillDescription('数学计算。支持括号')).toBe('数学计算')
    expect(summarizeSkillDescription('Do math. Then more.')).toBe('Do math')
  })

  it('超长截断并追加省略号', () => {
    const out = summarizeSkillDescription('a'.repeat(50), 10)
    expect(out).toBe(`${'a'.repeat(10)}…`)
  })

  it('空描述返回空串', () => {
    expect(summarizeSkillDescription(undefined)).toBe('')
    expect(summarizeSkillDescription('   ')).toBe('')
  })
})

describe('pruneSkillTools', () => {
  it('保留非技能工具，剔除未选中的技能工具', () => {
    const tools = [
      { name: 'datetime' },
      { name: 'calculator' },
      { name: 'doc_writer' },
    ]
    const allSkillTools = new Set(['calculator'])
    const kept = pruneSkillTools(tools, allSkillTools, new Set())
    expect(kept.map((t) => t.name)).toEqual(['datetime', 'doc_writer'])
  })

  it('选中的技能工具保留', () => {
    const tools = [{ name: 'calculator' }, { name: 'datetime' }]
    const kept = pruneSkillTools(tools, new Set(['calculator']), new Set(['calculator']))
    expect(kept.map((t) => t.name)).toEqual(['calculator', 'datetime'])
  })

  it('空技能工具集合时原样返回', () => {
    const tools = [{ name: 'a' }, { name: 'b' }]
    expect(pruneSkillTools(tools, new Set(), new Set())).toEqual(tools)
  })
})

describe('shouldEnableProgressiveDisclosure（门控矩阵）', () => {
  it('三个条件全满足才启用', () => {
    expect(shouldEnableProgressiveDisclosure(true, true, ['math'])).toBe(true)
  })

  it('技能总开关关闭 → 不启用', () => {
    expect(shouldEnableProgressiveDisclosure(false, true, ['math'])).toBe(false)
  })

  it('渐进式披露关闭（默认）→ 不启用', () => {
    expect(shouldEnableProgressiveDisclosure(true, false, ['math'])).toBe(false)
  })

  it('未选择技能 / 选择为空 / undefined → 不启用', () => {
    expect(shouldEnableProgressiveDisclosure(true, true, [])).toBe(false)
    expect(shouldEnableProgressiveDisclosure(true, true, undefined)).toBe(false)
  })
})

describe('collectSkillToolNames', () => {
  it('汇总所有已注册技能的工具名', () => {
    const reg = registryOf(
      new StubSkill('math', 'd', ['calculator']),
      new StubSkill('writer', 'd', ['doc_writer']),
    )
    const names = collectSkillToolNames(reg)
    expect([...names].sort()).toEqual(['calculator', 'doc_writer'])
  })

  it('listSkills 抛错时返回空集合（不阻断装配）', () => {
    const broken = {
      listSkills: () => {
        throw new Error('boom')
      },
      getSkill: () => undefined,
    } as any
    expect(collectSkillToolNames(broken).size).toBe(0)
  })
})
