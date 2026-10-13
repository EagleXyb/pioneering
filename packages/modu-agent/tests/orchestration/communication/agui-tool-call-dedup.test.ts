/**
 * AGUIStateMachine — 工具调用动作行（唯一事实源 + toolCallId 幂等）
 *
 * 历史缺陷：同一次工具调用会被两条上游路径触发 ——
 *   a. EventBridge 的 tool_call_start SSE 侧路（只有 id/name，无参数）；
 *   b. agent 节点的权威 updates（完整 AIMessage.tool_calls，带 args + END）。
 * 早期实现两条路径各发一遍 TOOL_CALL_START，前端因此渲染出「带目标 + 裸动作」两行；
 * 裸行既无参数也无观测结果，表现为一条永远无法展开的动作行（截图里的裸「搜索」）。
 * 且 SSE 侧路先于原始事件下发，会让同一轮的叙述段排到动作行之后，与 WorkBuddy 形态相悖。
 *
 * 当前契约：
 *   - 动作行只由权威 updates 开行（SSE 侧路在适配器侧不再开行）；
 *   - `emit_tool_call_start` 自身按 toolCallId 幂等兜底：同一 id 只开一行，
 *     参数只在「首次无参数、后到有参数」时补发一次（不重复串接前端 args）。
 */
import { describe, it, expect } from 'vitest'
import {
  AGUIStateMachine,
  AGUIStreamAdapter,
} from '@/orchestration/communication/agui-adapter.js'

function parse(ev: unknown): Record<string, unknown> {
  const e = ev as { data?: string }
  return JSON.parse(String(e?.data ?? '{}')) as Record<string, unknown>
}

const typesOf = (events: unknown[]): string[] =>
  events.map((e) => String(parse(e).type ?? ''))

/** 模拟 EventBridge 下发的 tool_call_start 侧路事件（不带参数） */
function sseToolCallStart(
  sm: AGUIStateMachine,
  toolCallId: string,
  toolCallName: string,
): unknown[] {
  return AGUIStreamAdapter._process_langgraph_event(
    sm,
    { type: 'tool_call_start', data: { tool_call_id: toolCallId, tool_name: toolCallName } },
    'tool_call_start',
  )
}

describe('工具调用动作行去重（toolCallId 幂等）', () => {
  it('SSE 侧路不再开行（唯一事实源是权威 updates，避免裸行与顺序错乱）', () => {
    const sm = new AGUIStateMachine('trace-1', 'msg-1')

    // a. 侧路：EventBridge 的 tool_call_start（无参数）→ 适配器侧不下发任何事件
    expect(sseToolCallStart(sm, 'tc1', 'search_engine')).toEqual([])

    // b. 权威：agent 节点 updates 带来的完整参数 → 由它开行
    const first = sm.emit_tool_call_start('tc1', 'search_engine', '{"query":"harness engineering"}')
    expect(typesOf(first)).toEqual(['TOOL_CALL_START', 'TOOL_CALL_ARGS'])
    expect(parse(first[1]!).delta).toBe('{"query":"harness engineering"}')

    // 观测结果仍按 id 关联，且记录里复用的是权威参数（可追溯）
    const result = sm.emit_tool_result('tc1', 'search_engine', '{"status":"success"}')
    expect(typesOf(result)).toEqual(['TOOL_CALL_RESULT'])
    expect(parse(result[0]!).toolCallId).toBe('tc1')
    expect(sm.tool_call_records).toHaveLength(1)
    expect(sm.tool_call_records[0]!.tool_name).toBe('search_engine')
    expect(sm.tool_call_records[0]!.params).toEqual({ query: 'harness engineering' })
  })

  it('权威 updates 之后侧路重复到达：完全去重（不再下发任何事件）', () => {
    const sm = new AGUIStateMachine('trace-2', 'msg-2')

    const first = sm.emit_tool_call_start('tc2', 'datetime', '{"op":"now"}')
    expect(typesOf(first)).toEqual(['TOOL_CALL_START', 'TOOL_CALL_ARGS'])

    expect(sseToolCallStart(sm, 'tc2', 'datetime')).toEqual([])
    // 幂等兜底：即使上游重复调用带参数开行，也只补发一次参数
    expect(sm.emit_tool_call_start('tc2', 'datetime', '{"op":"now"}')).toEqual([])
  })

  it('参数只补发一次（重复的带参数调用不会串接坏前端 args）', () => {
    const sm = new AGUIStateMachine('trace-3', 'msg-3')

    sm.emit_tool_call_start('tc3', 'search_engine', '{}')
    expect(typesOf(sm.emit_tool_call_start('tc3', 'search_engine', '{"query":"a"}'))).toEqual([
      'TOOL_CALL_ARGS',
    ])
    expect(sm.emit_tool_call_start('tc3', 'search_engine', '{"query":"a"}')).toEqual([])
  })

  it('不同 toolCallId 各自独立开行（不互相吞并）', () => {
    const sm = new AGUIStateMachine('trace-4', 'msg-4')

    const a = sm.emit_tool_call_start('tc_a', 'datetime', '{"op":"now"}')
    const b = sm.emit_tool_call_start('tc_b', 'search_engine', '{"query":"b"}')
    expect(typesOf(a)).toEqual(['TOOL_CALL_START', 'TOOL_CALL_ARGS'])
    expect(typesOf(b)).toEqual(['TOOL_CALL_START', 'TOOL_CALL_ARGS'])
    expect(parse(b[0]!).toolCallId).toBe('tc_b')

    // 结束事件按 id 各自可控
    expect(sm.emit_tool_call_end('tc_a')).not.toBeNull()
    expect(sm.emit_tool_call_end('tc_b')).not.toBeNull()
  })
})
