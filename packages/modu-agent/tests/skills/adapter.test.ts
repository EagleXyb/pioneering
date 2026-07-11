import { describe, it, expect } from 'vitest'
import { SkillToolWrapper } from '@/skills/adapter.js'
import { BaseTool } from '@/core/interfaces/action.js'

class InnerTool extends BaseTool {
  fail = false
  name(): string {
    return 'inner'
  }
  description(): string {
    return 'inner'
  }
  parametersSchema(): Record<string, any> {
    return {}
  }
  async invoke(): Promise<Record<string, any>> {
    if (this.fail) throw new Error('inner boom')
    return { status: 'success', data: { ok: true } }
  }
}

describe('SkillToolWrapper', () => {
  it('delegates name/description/parameters to the inner tool', () => {
    const w = new SkillToolWrapper(new InnerTool(), 'math')
    expect(w.name()).toBe('inner')
    expect(w.description()).toBe('inner')
  })

  it('returns the inner tool result on success', async () => {
    const w = new SkillToolWrapper(new InnerTool(), 'math')
    const r = await w.invoke({}, {})
    expect(r.status).toBe('success')
  })

  it('isolates inner tool exceptions as a standardized error', async () => {
    const inner = new InnerTool()
    inner.fail = true
    const w = new SkillToolWrapper(inner, 'math')
    const r = await w.invoke({}, {})
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SKILL_EXECUTION_FAILED')
    expect((r.data as any).skill).toBe('math')
  })
})
