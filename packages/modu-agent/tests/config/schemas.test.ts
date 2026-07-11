import { describe, it, expect } from 'vitest'
import {
  PerceptionInputSchema,
  MemoryQuerySchema,
  ToolCallSchema,
  LLMCallSchema,
  ToolResultSchema,
  isValidContextWindow,
  ValueError,
} from '@/config/schemas.js'

describe('PerceptionInputSchema', () => {
  it('accepts valid input and round-trips via toDict/fromDict', () => {
    const schema = new PerceptionInputSchema({
      inputType: 'text',
      rawContent: new Uint8Array([1, 2, 3]),
      language: 'zh',
      sensitivityLevel: 2,
    })
    const d = schema.toDict()
    expect(d.input_type).toBe('text')
    const back = PerceptionInputSchema.fromDict(d)
    expect(back.inputType).toBe('text')
    expect(Array.from(back.rawContent)).toEqual([1, 2, 3])
    expect(back.sensitivityLevel).toBe(2)
  })

  it('rejects invalid input_type', () => {
    expect(() => new PerceptionInputSchema({ inputType: 'video' })).toThrow(ValueError)
  })

  it('rejects out-of-range sensitivity_level', () => {
    expect(() => new PerceptionInputSchema({ sensitivityLevel: 9 })).toThrow(ValueError)
    expect(() => new PerceptionInputSchema({ sensitivityLevel: -1 })).toThrow(ValueError)
  })
})

describe('MemoryQuerySchema', () => {
  it('rejects missing user_id', () => {
    expect(() => new MemoryQuerySchema({ contextWindow: 'last_5_turns' })).toThrow(ValueError)
  })

  it('rejects invalid context_window', () => {
    expect(() => new MemoryQuerySchema({ userId: 'u', contextWindow: 'bogus' })).toThrow(ValueError)
  })

  it('accepts a valid query', () => {
    const s = new MemoryQuerySchema({ userId: 'u', contextWindow: 'last_10_turns' })
    expect(s.userId).toBe('u')
    expect(s.contextWindow).toBe('last_10_turns')
  })
})

describe('ToolCallSchema', () => {
  it('rejects empty tool_name', () => {
    expect(() => new ToolCallSchema({ toolName: '' })).toThrow(ValueError)
  })

  it('accepts a valid call', () => {
    const s = new ToolCallSchema({ toolName: 'calc', parameters: { expression: '1+1' } })
    expect(s.toolName).toBe('calc')
  })
})

describe('LLMCallSchema', () => {
  it('rejects empty prompt', () => {
    expect(() => new LLMCallSchema({ prompt: '' })).toThrow(ValueError)
  })

  it('rejects temperature out of range', () => {
    expect(() => new LLMCallSchema({ prompt: 'hi', temperature: 3.0 })).toThrow(ValueError)
  })

  it('rejects non-positive max_tokens', () => {
    expect(() => new LLMCallSchema({ prompt: 'hi', maxTokens: 0 })).toThrow(ValueError)
  })
})

describe('ToolResultSchema', () => {
  it('reports success correctly', () => {
    expect(new ToolResultSchema({ status: 'success' }).isSuccess()).toBe(true)
    expect(new ToolResultSchema({ status: 'error' }).isSuccess()).toBe(false)
  })
})

describe('isValidContextWindow', () => {
  it('accepts known windows and last_<N>_turns', () => {
    expect(isValidContextWindow('last_5_turns')).toBe(true)
    expect(isValidContextWindow('all')).toBe(true)
    expect(isValidContextWindow('last_12_turns')).toBe(true)
  })

  it('rejects bogus values', () => {
    expect(isValidContextWindow('last_x_turns')).toBe(false)
    expect(isValidContextWindow('nope')).toBe(false)
  })
})
