/**
 * AGUIStateMachine — ReAct 中间轮叙述分段（TAO 闭环）
 *
 * 历史缺陷：多轮中间叙述被合并进同一个 THINKING 段（首尾用 \n\n 粘连），
 * 前端与落库侧因此无法把「思考段」与「工具调用」按轮次对齐，
 * “推理-行动-观察”的交错链路退化为“一大段思考 + 一串工具”。
 *
 * 本测试锁定修复后的契约：每个中间轮叙述独立成一个 THINKING 段
 * （先关闭上一段再开新段），round 随 THINKING_START 递增下发，
 * 使前端可逐轮还原任务链路（阅读资料 → 判断类型 → 导出内容 → 数据清洗）。
 */
import { describe, it, expect } from 'vitest'
import { AGUIStateMachine } from '@/orchestration/communication/agui-adapter.js'

/** 事件 dict（{ data: JSON 串 }）→ 解析后的负载 */
function parse(ev: unknown): Record<string, unknown> {
  const e = ev as { data?: string }
  return JSON.parse(String(e?.data ?? '{}')) as Record<string, unknown>
}

const typesOf = (events: unknown[]): string[] =>
  events.map((e) => String(parse(e).type ?? ''))

describe('AGUIStateMachine — 中间轮叙述分段', () => {
  it('每轮叙述独立成 THINKING 段（段间 END），与工具调用精确交错', () => {
    const sm = new AGUIStateMachine('trace-1', 'msg-1')

    // 第 1 轮：叙述（带 tool_calls → 走 thinking 通道）
    sm.process_message_chunk({ id: 'm1' }, '我先读取资料。')
    const round1 = sm.flush_message_buffer(true)
    expect(typesOf(round1)).toEqual([
      'THINKING_START',
      'THINKING_TEXT_MESSAGE_CONTENT',
    ])
    expect(parse(round1[0]!).round).toBe(1)

    // 第 1 轮的工具调用：与 thinking 段相邻交错
    const toolStart = sm.emit_tool_call_start('tc1', 'library', '{"skill":"library"}')
    expect(typesOf(toolStart)).toEqual(['TOOL_CALL_START', 'TOOL_CALL_ARGS'])
    const toolResult = sm.emit_tool_result('tc1', 'library', '{"ok":true}')
    expect(typesOf(toolResult)).toEqual(['TOOL_CALL_RESULT'])

    // 第 2 轮：先关闭上一段（END），再开新段（round 递增）——不粘连
    sm.process_message_chunk({ id: 'm2' }, '再核对节点。')
    const round2 = sm.flush_message_buffer(true)
    expect(typesOf(round2)).toEqual([
      'THINKING_END',
      'THINKING_START',
      'THINKING_TEXT_MESSAGE_CONTENT',
    ])
    expect(parse(round2[1]!).round).toBe(2)

    // 最终回答：关闭最后一段并以 text 通道输出
    sm.process_message_chunk({ id: 'm3' }, '最终回答')
    const finalRound = sm.flush_message_buffer(false)
    expect(typesOf(finalRound)).toEqual([
      'THINKING_END',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
    ])
  })

  it('无 tool_calls 的轮次不产生 thinking 段（直接走 text）', () => {
    const sm = new AGUIStateMachine('trace-2', 'msg-2')
    sm.process_message_chunk({ id: 'm1' }, '直接回答')
    const events = sm.flush_message_buffer(false)
    expect(typesOf(events)).toEqual(['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT'])
  })
})
