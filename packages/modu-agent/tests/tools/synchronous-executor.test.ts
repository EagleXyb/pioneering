import { describe, it, expect, beforeEach } from 'vitest'
import { SyncActionExecutor } from '@/tools/synchronous-executor.js'
import { ComponentRegistry } from '@/core/registry.js'
import { BaseTool } from '@/core/interfaces/action.js'

class OkTool extends BaseTool {
  name(): string {
    return 'ok'
  }
  description(): string {
    return 'ok'
  }
  parametersSchema(): Record<string, any> {
    return {}
  }
  invoke(): Record<string, any> {
    return { status: 'success', data: { value: 42 } }
  }
}

class BoomTool extends BaseTool {
  name(): string {
    return 'boom'
  }
  description(): string {
    return 'boom'
  }
  parametersSchema(): Record<string, any> {
    return {}
  }
  invoke(): Record<string, any> {
    throw new Error('kaboom')
  }
}

describe('SyncActionExecutor', () => {
  let reg: ComponentRegistry
  let exec: SyncActionExecutor

  beforeEach(() => {
    reg = new ComponentRegistry()
    reg.registerTool(new OkTool())
    reg.registerTool(new BoomTool())
    exec = new SyncActionExecutor(reg)
  })

  it('executes a registered tool and returns its result', async () => {
    const r = await exec.execute('ok', {}, {})
    expect(r.status).toBe('success')
    expect((r as any).data.value).toBe(42)
  })

  it('returns TOOL_001 when the tool is missing', async () => {
    const r = await exec.execute('missing', {}, {})
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('TOOL_001')
  })

  it('captures tool exceptions as TOOL_002', async () => {
    const r = await exec.execute('boom', {}, {})
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('TOOL_002')
  })

  it('lists actions from the registry', () => {
    expect(exec.listActions().sort()).toEqual(['boom', 'ok'])
  })
})
