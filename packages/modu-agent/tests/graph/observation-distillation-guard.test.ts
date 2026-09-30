// P0-6：Observation 蒸馏去重守卫回归。
//
// 原缺陷：蒸馏块位于 `if (!processedIds.has(toolCallId))` 守卫之外，
// toolResultProcessor 每轮 ReAct 遍历全部历史 ToolMessage 时都会对旧消息重新蒸馏，
// observation_history 经 append reducer 按轮次二次增长。
import { describe, it, expect } from 'vitest'
import { ToolMessage } from '@langchain/core/messages'

import { makeToolResultProcessor } from '@/graph/nodes.js'
import type { ObservationDistiller } from '@/graph/adapters/observation-distiller.js'

/** 计数蒸馏器：记录每次 distill 收到的内容，验证调用次数与对象。 */
function makeCountingDistiller(): ObservationDistiller & { calls: number } {
  return {
    calls: 0,
    distill(content: any) {
      this.calls += 1
      return {
        status: 'success',
        summary: `summary-${typeof content === 'object' && content ? content['id'] ?? 'x' : 'x'}`,
        records_count: 1,
        key_metrics: {},
      }
    },
  } as unknown as ObservationDistiller & { calls: number }
}

function toolMessage(id: string): ToolMessage {
  return new ToolMessage({
    content: JSON.stringify({ id, status: 'success', tool: 'search_engine', data: { rows: 1 } }),
    tool_call_id: id,
    name: 'search_engine',
  })
}

describe('P0-6 · Observation 蒸馏仅对新 ToolMessage 执行一次', () => {
  it('首轮：两条新 ToolMessage → 两条蒸馏记录', () => {
    const distiller = makeCountingDistiller()
    const processor = makeToolResultProcessor(distiller)

    const out = processor({
      messages: [toolMessage('call-1'), toolMessage('call-2')],
      tool_results: [],
      observation_history: [],
    } as any)

    expect(out.observation_history).toHaveLength(2)
    expect(distiller.calls).toBe(2)
    expect(out.tool_results).toHaveLength(2)
  })

  it('第二轮：同一批历史消息 + 已处理 tool_results → 零新增蒸馏（回归原二次膨胀缺陷）', () => {
    const distiller = makeCountingDistiller()
    const processor = makeToolResultProcessor(distiller)

    // 首轮
    const round1 = processor({
      messages: [toolMessage('call-1'), toolMessage('call-2')],
      tool_results: [],
      observation_history: [],
    } as any)
    expect(round1.observation_history).toHaveLength(2)

    // 第二轮：ReAct 每轮都会把全量 messages 重交给本节点；
    // tool_results 已含两条 execution_id（append reducer 累积态）
    const round2 = processor({
      messages: [toolMessage('call-1'), toolMessage('call-2')],
      tool_results: round1.tool_results,
      observation_history: round1.observation_history,
    } as any)

    expect(round2.observation_history ?? []).toHaveLength(0)
    expect(distiller.calls).toBe(2) // 总数仍是首轮的 2 次，未对历史消息重蒸馏
    // tool_results 同样不重复产出
    expect(round2.tool_results ?? []).toHaveLength(0)
  })

  it('第二轮新增一条 ToolMessage：仅新消息蒸馏一次，历史消息不重复', () => {
    const distiller = makeCountingDistiller()
    const processor = makeToolResultProcessor(distiller)

    const round1 = processor({
      messages: [toolMessage('call-1')],
      tool_results: [],
      observation_history: [],
    } as any)

    const round2 = processor({
      messages: [toolMessage('call-1'), toolMessage('call-2')],
      tool_results: round1.tool_results,
      observation_history: round1.observation_history,
    } as any)

    expect(round2.observation_history).toHaveLength(1)
    expect(round2.observation_history?.[0]['execution_id']).toBe('call-2')
    expect(distiller.calls).toBe(2)
  })

  it('resume 重执行：新 processor 实例面对已累积 state 同样幂等', () => {
    const distiller = makeCountingDistiller()

    const first = makeToolResultProcessor(distiller)({
      messages: [toolMessage('call-9')],
      tool_results: [],
      observation_history: [],
    } as any)

    // 模拟 resume：换一个全新 processor 实例，但 state 已含累积结果
    const replayed = makeToolResultProcessor(distiller)({
      messages: [toolMessage('call-9')],
      tool_results: first.tool_results,
      observation_history: first.observation_history,
    } as any)

    expect(replayed.observation_history ?? []).toHaveLength(0)
    expect(distiller.calls).toBe(1)
  })
})
