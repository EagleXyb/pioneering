// P1-2 回归测试：plan_execute 汇总节点（plan_summarize）
//
// 缺陷：最终答复由 responseNode 提取"messages 中最后一条无 tool_calls 的 AIMessage"，
// 完全不读 step_results → 多步任务的最终答复 = 最后一步的自述，
// 中间各步产物（调研结论、分章内容）全部丢失。
//
// 修复：计划收敛后先经 plan_summarize 整合各步骤产物，产出一条 AIMessage，
// 再由 responseNode 提取。
import { describe, it, expect } from 'vitest'
import { AIMessage } from '@langchain/core/messages'

import { makePlanSummarizeNode } from '@/graph/plan-execute/summarize.js'
import type { ModuAgentState } from '@/graph/state.js'

function stateWith(over: Record<string, any> = {}): ModuAgentState {
  return {
    cleaned_text: '请系统解释 Prompt 工程与上下文工程',
    plan: [
      { step_id: 'step_1', title: '梳理框架' },
      { step_id: 'step_2', title: '讲解 Few-shot' },
      { step_id: 'step_3', title: '讲解 CoT' },
    ],
    step_results: [
      { step_id: 'step_1', status: 'done', output: '框架内容…', replan: 0 },
      { step_id: 'step_2', status: 'done', output: 'Few-shot 内容…', replan: 0 },
      { step_id: 'step_3', status: 'done', output: 'CoT 内容…', replan: 0 },
    ],
    ...over,
  } as unknown as ModuAgentState
}

function fakeLlm(text: string) {
  return { invoke: async () => new AIMessage({ content: text }) }
}

describe('P1-2 · plan_summarize 汇总节点', () => {
  it('多步产物 → 调用 LLM 整合，产出一条 AIMessage', async () => {
    const node = makePlanSummarizeNode(fakeLlm('整合后的最终答复'))
    const updates = (await node(stateWith())) as Record<string, any>

    expect(Array.isArray(updates.messages)).toBe(true)
    expect(updates.messages).toHaveLength(1)
    expect(updates.messages[0].content).toBe('整合后的最终答复')
  })

  it('单步（或无可汇总产物）→ 不调用 LLM，零额外开销', async () => {
    let called = 0
    const node = makePlanSummarizeNode({
      invoke: async () => {
        called++
        return new AIMessage({ content: 'x' })
      },
    })

    const one = await node(stateWith({ step_results: [{ step_id: 'step_1', status: 'done', output: 'a' }] }))
    expect(one).toEqual({})
    expect(called).toBe(0)

    const none = await node(stateWith({ step_results: [] }))
    expect(none).toEqual({})
    expect(called).toBe(0)
  })

  it('只汇总 done/degraded 且有输出的步骤（failed / skipped / 空输出被排除）', async () => {
    const node = makePlanSummarizeNode(fakeLlm('整合'))
    const updates = (await node(stateWith({
      step_results: [
        { step_id: 'step_1', status: 'done', output: '有效内容一' },
        { step_id: 'step_2', status: 'failed', output: '失败内容' },
        { step_id: 'step_3', status: 'skipped' },
        { step_id: 'step_4', status: 'done', output: '   ' },
        { step_id: 'step_5', status: 'degraded', output: '降级但有内容' },
      ],
    }))) as Record<string, any>

    // step_1 + step_5 = 2 个可汇总步骤 → 触发汇总
    expect(updates.messages?.[0]?.content).toBe('整合')
  })

  it('LLM 调用失败 → 静默降级（返回 {}，由 responseNode 取最后一步输出）', async () => {
    const node = makePlanSummarizeNode({
      invoke: async () => {
        throw new Error('provider 500')
      },
    })
    const updates = await node(stateWith())
    expect(updates).toEqual({})
  })

  it('LLM 返回空文本 → 同样降级（不写入空 AIMessage）', async () => {
    const node = makePlanSummarizeNode(fakeLlm('   '))
    const updates = await node(stateWith())
    expect(updates).toEqual({})
  })
})
