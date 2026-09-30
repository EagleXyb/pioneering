// P1-17：子图 recursionLimit 经 invoke config 真正生效（旧实现挂实例属性无效）。
import { describe, it, expect } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'

import { build_subagent_subgraph } from '@/graph/subgraph/builder.js'

function loopLlm(): any {
  // 始终请求工具调用 → agent⇄tools 无限循环，只有 recursionLimit 能终止
  return {
    invoke: async () =>
      new AIMessage({
        content: '',
        tool_calls: [{ name: 'loop_tool', args: {}, id: 'call_loop_1' }],
      }),
  }
}

function finalizeLlm(): any {
  return {
    invoke: async () => new AIMessage({ content: 'done-no-tools' }),
  }
}

function makeLoopTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: 'loop_tool',
    description: 'always succeeds; used to force the agent-tools loop',
    schema: z.object({}),
    func: async () => 'ok',
  })
}

const input = {
  task_id: 't-1',
  task_type: 'default',
  task_input: { prompt: 'loop test' },
  messages: [],
}

describe('P1-17 · 子图 recursionLimit 经 invoke config 生效', () => {
  it('不再把 recursionLimit 挂在编译产物实例上（LangGraph 不读取该属性）', () => {
    const sg = build_subagent_subgraph(loopLlm(), [makeLoopTool()], null, 'default', 10)
    expect((sg as any).recursionLimit).toBeUndefined()
  })

  it('低 recursionLimit(3) 使无限工具循环快速失败（GraphRecursionError）', async () => {
    const sg = build_subagent_subgraph(loopLlm(), [makeLoopTool()], null, 'default', 10)
    await expect(sg.invoke(input, { recursionLimit: 3 })).rejects.toThrow(/recursion|limit/i)
  })

  it('无工具调用的正常子图在小 recursionLimit 下正常完成（不受影响）', async () => {
    const sg = build_subagent_subgraph(finalizeLlm(), [], null, 'default', 10)
    const result = await sg.invoke(input, { recursionLimit: 3 })
    expect(result.task_output?.status).not.toBe('error')
    expect(String(result.task_output?.content ?? result.task_output?.output ?? '')).toContain('done')
  })
})
