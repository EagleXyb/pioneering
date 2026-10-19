/**
 * 工具预算耗尽收尾（force_finalize）测试
 *
 * 缺陷背景：`routeAfterAgent` 在轮次触顶时原本直接 `__end__` —— 本轮已下发的
 * tool_calls 被静默丢弃、也没有最终回答，用户只能看到最后一段过程话术
 * （表现为「正文只有一句话」）。
 *
 * 修复契约：
 *   1. 触顶 → 路由到 `force_finalize`（禁用工具收尾作答），不再直接结束；
 *   2. 收尾节点裁掉尾部未被执行的 assistant(tool_calls)（否则 API 会 400），
 *      注入"不要再调用工具、直接作答"的指令，产出的 AIMessage 供 responseNode 提取；
 *   3. 节点拿不到正文时，responseNode 的兜底文案如实说明"因工具次数达上限而中止"。
 */
import { describe, it, expect } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'

import { makeForceFinalizeNode, responseNode, routeAfterAgent } from '@/graph/nodes.js'
import { getConfig } from '@/config/runtime-config.js'
import type { ModuAgentState } from '@/graph/state.js'

/** 最小 state（只放被测逻辑会读到的字段） */
function makeState(over: Partial<ModuAgentState> = {}): ModuAgentState {
  return {
    messages: [],
    tool_results: [],
    ...over,
  } as unknown as ModuAgentState
}

const aiWithToolCalls = () =>
  new AIMessage({
    content: '我先确认当前时间，并检索业界实践作为依据。',
    tool_calls: [
      { id: 't1', name: 'web_search', args: { query: 'HITL 澄清' } },
      { id: 't2', name: 'datetime', args: {} },
    ],
  })

describe('makeForceFinalizeNode — 触顶收尾作答', () => {
  it('裁掉尾部未执行的 assistant(tool_calls)，注入"不要再调用工具"指令后作答', async () => {
    let seen: any[] = []
    const llm = {
      invoke: async (messages: any[]) => {
        seen = messages
        return new AIMessage({ content: '基于已有信息的最终回答。' })
      },
    }

    const node = makeForceFinalizeNode(llm, '你是研究助手。')
    const result = await node(
      makeState({
        messages: [
          new SystemMessage({ content: '你是研究助手。' }),
          new HumanMessage({ content: '请调研 HITL' }),
          new ToolMessage({ content: '检索结果', tool_call_id: 't0' }),
          aiWithToolCalls(),
        ] as any,
        tool_results: [{ status: 'success' }, { status: 'error' }] as any,
      }),
    )

    // 1) 尾部未执行的 tool_calls 消息被裁掉（否则 API 报 "must be followed by tool messages"）
    expect(seen.some((m) => Array.isArray(m?.tool_calls) && m.tool_calls.length > 0)).toBe(false)
    expect(seen[seen.length - 1]).toBeInstanceOf(HumanMessage)
    // 2) 指令明确禁止再调用工具，并带上执行情况
    const directive = String(seen[seen.length - 1]?.content ?? '')
    expect(directive).toContain('不要再调用任何工具')
    expect(directive).toContain('共 2 次工具调用，成功 1 次')
    // 3) 产出可被 responseNode 提取的最终回答 + 中止标记
    expect(result.forced_finalize).toBe(true)
    expect(result.termination_reason).toBe('tool_budget')
    expect(result.messages).toHaveLength(1)
    expect(String((result.messages as any)[0].content)).toContain('最终回答')
  })

  it('模型一个字都没吐出来时也不抛错，仅置中止标记（交给兜底文案）', async () => {
    const node = makeForceFinalizeNode({ invoke: async () => new AIMessage({ content: '' }) })
    const result = await node(makeState({ messages: [aiWithToolCalls()] as any }))

    expect(result.forced_finalize).toBe(true)
    expect(result.messages).toBeUndefined()
  })

  it('LLM 调用失败时同样不抛错，仅置中止标记', async () => {
    const node = makeForceFinalizeNode({
      invoke: async () => {
        throw new Error('provider 500')
      },
    })
    const result = await node(makeState({ messages: [aiWithToolCalls()] as any }))

    expect(result.forced_finalize).toBe(true)
    expect(result.messages).toBeUndefined()
  })
})

describe('routeAfterAgent — 触顶路由到 force_finalize', () => {
  it('轮次达到硬上限时返回 force_finalize（不再直接 __end__）', () => {
    const maxIterations = Number(getConfig().get('llm.max_reasoning_iterations', 3))
    const state = makeState({
      messages: [aiWithToolCalls()] as any,
      reasoning_round_count: maxIterations + 3,
      complexity_assessment: null,
    })

    expect(routeAfterAgent(state)).toBe('force_finalize')
  })

  it('未触顶时仍然照常进入 tools', () => {
    const state = makeState({
      messages: [aiWithToolCalls()] as any,
      reasoning_round_count: 1,
      complexity_assessment: null,
    })

    expect(routeAfterAgent(state)).toBe('tools')
  })
})

describe('responseNode — 触顶中止的兜底文案', () => {
  it('forced_finalize 且无正文时，如实说明"因工具调用次数达上限而中止"', () => {
    const state = makeState({
      messages: [aiWithToolCalls()] as any,
      forced_finalize: true,
      termination_reason: 'tool_budget',
      tool_results: [{ status: 'success' }, { status: 'success' }, { status: 'error' }] as any,
    })

    const result = responseNode(state)
    const text = String(result.response ?? '')

    expect(text).toContain('工具调用次数达到上限')
    expect(text).toContain('3 次工具调用')
    expect(text).toContain('成功 2 次')
  })

  it('正常结束（未触顶）时不出现中止文案', () => {
    const state = makeState({
      messages: [new AIMessage({ content: '正常回答' })] as any,
      tool_results: [{ status: 'success' }] as any,
    })

    expect(String(responseNode(state).response ?? '')).toBe('正常回答')
  })
})
