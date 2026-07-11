import { describe, it, expect } from 'vitest'
import { CodeExecutorTool } from '@/tools/code-executor.js'

describe('CodeExecutorTool', () => {
  const tool = new CodeExecutorTool()

  it('returns its name and requires approval', () => {
    expect(tool.name()).toBe('code_executor')
    expect(tool.requiresApproval()).toBe(true)
  })

  it('rejects empty code (CODE_001)', async () => {
    const r = await tool.invoke({ code: '' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('CODE_001')
  })

  it('rejects import statements (CODE_002)', async () => {
    const r = await tool.invoke({ code: 'import os' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('CODE_002')
  })

  it('rejects forbidden names such as eval (CODE_002)', async () => {
    const r = await tool.invoke({ code: 'eval("1+1")' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('CODE_002')
  })

  it('rejects forbidden attribute access such as __class__ (CODE_002)', async () => {
    const r = await tool.invoke({ code: 'x = (1).__class__' }, {}) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('CODE_002')
  })

  it('passes validation for safe arithmetic (not CODE_002)', async () => {
    const r = await tool.invoke({ code: 'print(1 + 2 * 3)' }, {}) as any
    // Either executed successfully, or environment lacks python3 (CODE_005).
    // The important assertion is that static validation did not reject it.
    expect(r.error_code).not.toBe('CODE_002')
  })

  it('returns a structured rejection when approval is declined', () => {
    const r = tool.onApprovalRejected({ code: 'print(1)' }) as any
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('TOOL_APPROVAL_REJECTED')
  })
})
