/**
 * agent-tool-registry 单元测试（T4.1）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerAgentTool,
  getAgentTool,
  listAgentTools,
  unregisterAgentTool,
} from '../../src/core/agent-tool-registry.js'
import { resetRegistry } from '../../src/core/registry.js'
import type { BaseTool } from '../../src/core/interfaces/action.js'

function makeTool(name: string): BaseTool {
  return {
    name: () => name,
    description: () => 'desc',
    parametersSchema: () => ({}),
    invoke: async () => ({ status: 'ok' }),
  } as unknown as BaseTool
}

describe('agent-tool-registry（T4.1）', () => {
  beforeEach(() => {
    resetRegistry()
  })

  it('注册后可按名获取并出现在列表', () => {
    expect(registerAgentTool(makeTool('tool_a'))).toBe('tool_a')
    expect(getAgentTool('tool_a')?.name()).toBe('tool_a')
    expect(listAgentTools()).toContain('tool_a')
  })

  it('同名重复注册不抛错并覆盖', () => {
    const t1 = makeTool('dup')
    const t2 = {
      ...t1,
      description: () => 'new desc',
    }
    registerAgentTool(t1)
    expect(() => registerAgentTool(t2)).not.toThrow()
    expect(getAgentTool('dup')?.description()).toBe('new desc')
    expect(listAgentTools()).toEqual(['dup'])
  })

  it('非法工具抛 TypeError', () => {
    expect(() => registerAgentTool({} as BaseTool)).toThrow(TypeError)
  })

  it('unregister 幂等：不存在返回 false，移除后再取为 undefined', () => {
    registerAgentTool(makeTool('tmp'))
    expect(unregisterAgentTool('tmp')).toBe(true)
    expect(unregisterAgentTool('tmp')).toBe(false)
    expect(getAgentTool('tmp')).toBeUndefined()
  })
})
