import { describe, it, expect } from 'vitest'
import { CalculatorTool } from '@/tools/calculator.js'

describe('CalculatorTool', () => {
  const tool = new CalculatorTool()

  it('returns its name', () => {
    expect(tool.name()).toBe('calculator')
  })

  it('evaluates arithmetic correctly', () => {
    const r = tool.invoke({ expression: '1 + 2 * 3' }, {}) as any
    expect(r.status).toBe('success')
    expect(r.data.result).toBe(7)
  })

  it('respects parentheses', () => {
    const r = tool.invoke({ expression: '(1 + 2) * 3' }, {}) as any
    expect(r.data.result).toBe(9)
  })

  it('evaluates division to a float', () => {
    const r = tool.invoke({ expression: '10 / 4' }, {}) as any
    expect(r.data.result).toBe(2.5)
  })

  it('rejects empty expression', () => {
    const r = tool.invoke({ expression: '' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('TOOL_001')
  })

  it('rejects disallowed characters', () => {
    const r = tool.invoke({ expression: '1 + 2; import os' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('TOOL_001')
  })

  it('reports division by zero', () => {
    const r = tool.invoke({ expression: '1 / 0' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('TOOL_002')
  })
})
