import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  ComponentRegistry,
  getRegistry,
  resetRegistry,
  overrideRegistry,
} from '@/core/registry.js'
import { BaseTool } from '@/core/interfaces/action.js'
import { BaseSkill } from '@/core/interfaces/skill.js'

class FakeTool extends BaseTool {
  constructor(private _name = 'fake') {
    super()
  }
  name(): string {
    return this._name
  }
  description(): string {
    return 'fake tool'
  }
  parametersSchema(): Record<string, any> {
    return { type: 'object', properties: {} }
  }
  invoke(): Record<string, any> {
    return { status: 'success' }
  }
}

class FakeSkill extends BaseSkill {
  constructor(private _name = 'fake') {
    super()
  }
  name(): string {
    return this._name
  }
  description(): string {
    return 'fake skill'
  }
  version(): string {
    return '1.0.0'
  }
  tools(): BaseTool[] {
    return [new FakeTool(`tool_of_${this._name}`)]
  }
}

describe('ComponentRegistry', () => {
  let reg: ComponentRegistry

  beforeEach(() => {
    reg = new ComponentRegistry()
  })

  it('registers and retrieves reasoning engines, first becomes active', () => {
    const e1 = { x: 1 }
    const e2 = { x: 2 }
    reg.registerReasoningEngine('gpt', e1 as any)
    reg.registerReasoningEngine('glm', e2 as any)
    expect(reg.getReasoningEngine('gpt')).toBe(e1)
    expect(reg.getActiveReasoningEngine()).toBe(e1)
  })

  it('setActiveReasoningEngine switches the active engine', () => {
    reg.registerReasoningEngine('a', { a: 1 } as any)
    reg.registerReasoningEngine('b', { b: 2 } as any)
    reg.setActiveReasoningEngine('b')
    expect(reg.getActiveReasoningEngine()).not.toBeNull()
    expect((reg.getActiveReasoningEngine() as any).b).toBe(2)
  })

  it('throws when setting active engine that is not registered', () => {
    expect(() => reg.setActiveReasoningEngine('nope')).toThrow()
  })

  it('registers reasoning strategies', () => {
    reg.registerReasoningStrategy('cot', { s: 1 } as any)
    expect(reg.getReasoningStrategy('cot')).toEqual({ s: 1 })
  })

  it('registers action executors', () => {
    reg.registerActionExecutor('sync', { e: 1 } as any)
    expect(reg.getActionExecutor('sync')).toEqual({ e: 1 })
  })

  it('registers tools by their name()', () => {
    const t = new FakeTool('my_tool')
    reg.registerTool(t)
    expect(reg.getTool('my_tool')).toBe(t)
    expect(reg.listTools()['my_tool'].name).toBe('my_tool')
  })

  it('registers memories, storage adapters, perceptions, sensors', () => {
    reg.registerMemory('m', { m: 1 } as any)
    reg.registerStorageAdapter('sa', { sa: 1 } as any)
    reg.registerPerception('p', { p: 1 } as any)
    reg.registerSensor('s', { s: 1 } as any)
    expect(reg.getMemory('m')).toEqual({ m: 1 })
    expect(reg.getStorageAdapter('sa')).toEqual({ sa: 1 })
    expect(reg.getPerception('p')).toEqual({ p: 1 })
    expect(reg.getSensor('s')).toEqual({ s: 1 })
  })

  it('registers feedback loops and evolution signals', () => {
    reg.registerFeedbackLoop('fl', { fl: 1 } as any)
    reg.registerEvolutionSignal('es', { es: 1 } as any)
    expect(reg.getFeedbackLoop('fl')).toEqual({ fl: 1 })
    expect(reg.getEvolutionSignal('es')).toEqual({ es: 1 })
  })

  it('registers a skill and auto-registers its tools', () => {
    const skill = new FakeSkill('demo')
    reg.registerSkill(skill)
    expect(reg.getSkill('demo')).toBe(skill)
    expect(reg.getTool('tool_of_demo')).not.toBeUndefined()
    expect(reg.listSkills()['demo'].tool_count).toBe(1)
  })

  it('skips unavailable skills', () => {
    class UnavailableSkill extends FakeSkill {
      isAvailable(): boolean {
        return false
      }
    }
    reg.registerSkill(new UnavailableSkill('off'))
    expect(reg.getSkill('off')).toBeUndefined()
  })

  it('unregisters a skill', () => {
    reg.registerSkill(new FakeSkill('tmp'))
    expect(reg.unregisterSkill('tmp')).toBe(true)
    expect(reg.getSkill('tmp')).toBeUndefined()
  })

  it('swaps a component at runtime', () => {
    reg.registerTool(new FakeTool('t'))
    const ok = reg.swapComponent('tool', 't', new FakeTool('t2'))
    expect(ok).toBe(true)
    expect((reg.getTool('t') as FakeTool).name()).toBe('t2')
  })

  it('returns false for unknown swap category', () => {
    expect(reg.swapComponent('unknown_cat', 'x', {})).toBe(false)
  })

  it('listAll returns all 11 categories', () => {
    const all = reg.listAll()
    expect(Object.keys(all).sort()).toEqual(
      [
        'action_executors',
        'evolution_signals',
        'feedback_loops',
        'memories',
        'perceptions',
        'reasoning_engines',
        'reasoning_strategies',
        'sensors',
        'skills',
        'storage_adapters',
        'tools',
      ].sort(),
    )
  })
})

describe('registry singletons', () => {
  afterEach(() => {
    resetRegistry()
  })

  it('getRegistry returns a singleton', () => {
    const a = getRegistry()
    const b = getRegistry()
    expect(a).toBe(b)
  })

  it('overrideRegistry replaces and restores', () => {
    const original = getRegistry()
    const custom = new ComponentRegistry()
    const scope = overrideRegistry(custom)
    expect(getRegistry()).toBe(custom)
    scope.restore()
    expect(getRegistry()).toBe(original)
  })
})
