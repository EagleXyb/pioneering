/**
 * AGUIStateMachine — 思考段 / 叙述段 / 正文路由（TAO 闭环）
 *
 * 历史缺陷与演进：
 *   1. 多轮中间叙述被合并进同一个 THINKING 段（首尾粘连），前端与落库侧无法把
 *      「思考段」与「工具调用」按轮次对齐，TAO 闭环退化为「一大段思考 + 一串工具」；
 *   2. EventBridge 的 thinking 状态标记（started/ended，本身无内容）被当作"新思考段"
 *      开场，每次 run 前后各多出一个空思考段（幽灵段）；
 *   3. 最终回答被整段积压到流结束才一次性下发（长回答"卡住后整段蹦出"）；
 *   4. 中间轮叙述原先被并入思考段（半推理半话术），与 WorkBuddy 形态不一致。
 *
 * 当前契约（对齐 WorkBuddy）：
 *   - 思维链（reasoning delta）→ 思考段：每次 LLM 调用另开一段，round 递增；
 *   - 中间轮叙述（带 tool_calls 的 AIMessage 正文）→ **正文通道**，与工具动作行交错，
 *     段落带 narration 标记（复制/分享与历史回放据此排除过程话术），每段独立收尾；
 *   - 最终回答 → 正文通道，无 narration 标记；
 *   - 空状态标记不产生事件；超过阈值的最终回答边流边发。
 */
import { describe, it, expect } from 'vitest'
import {
  AGUIStateMachine,
  AGUIStreamAdapter,
} from '@/orchestration/communication/agui-adapter.js'

/** 事件 dict（{ data: JSON 串 }）→ 解析后的负载 */
function parse(ev: unknown): Record<string, unknown> {
  const e = ev as { data?: string }
  return JSON.parse(String(e?.data ?? '{}')) as Record<string, unknown>
}

const typesOf = (events: unknown[]): string[] =>
  events.map((e) => String(parse(e).type ?? ''))

/** 模拟 EventBridge 下发的 thinking 事件（status: delta 携带真实思维链） */
function thinkingDelta(sm: AGUIStateMachine, content: string): unknown[] {
  return AGUIStreamAdapter._process_langgraph_event(
    sm,
    { type: 'thinking', data: { status: 'delta', content } },
    'thinking',
  )
}

describe('AGUIStateMachine — 思考段与正文路由', () => {
  it('思维链进思考段、叙述进正文：每轮一段，与工具调用交错且叙述带标记', () => {
    const sm = new AGUIStateMachine('trace-1', 'msg-1')

    // 第 1 轮：模型真实思维链（reasoning_content 旁路）开思考段
    const cot1 = thinkingDelta(sm, '先想清楚要读什么。')
    expect(typesOf(cot1)).toEqual(['THINKING_START', 'THINKING_TEXT_MESSAGE_CONTENT'])
    expect(parse(cot1[0]!).round).toBe(1)

    // 第 1 轮叙述（带 tool_calls）→ 正文通道：先收尾思考段，再下发带标记的独立文本段
    sm.process_message_chunk({ id: 'm1' }, '我先加载资料。')
    const round1 = sm.flush_message_buffer(true)
    expect(typesOf(round1)).toEqual([
      'THINKING_END',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
    ])
    expect(parse(round1[1]!).narration).toBe(true)
    expect(parse(round1[2]!).delta).toBe('我先加载资料。')
    expect(sm.thinking_started).toBe(false)

    // 工具调用：与叙述/思考相邻交错
    const toolStart = sm.emit_tool_call_start('tc1', 'library', '{"skill":"library"}')
    expect(typesOf(toolStart)).toEqual(['TOOL_CALL_START', 'TOOL_CALL_ARGS'])
    const toolResult = sm.emit_tool_result('tc1', 'library', '{"ok":true}')
    expect(typesOf(toolResult)).toEqual(['TOOL_CALL_RESULT'])

    // 第 2 轮：新 CoT 另开新思考段（round 递增），与上一段不粘连
    const cot2 = thinkingDelta(sm, '再核对节点。')
    expect(typesOf(cot2)).toEqual(['THINKING_START', 'THINKING_TEXT_MESSAGE_CONTENT'])
    expect(parse(cot2[0]!).round).toBe(2)

    // 最终回答：收尾最后一段思考，正文段不带 narration 标记
    sm.process_message_chunk({ id: 'm3' }, '最终回答')
    const finalRound = sm.flush_message_buffer(false)
    expect(typesOf(finalRound)).toEqual([
      'THINKING_END',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
    ])
    expect(parse(finalRound[1]!).narration).toBeUndefined()
    expect(parse(finalRound[2]!).delta).toBe('最终回答')
  })

  it('无 tool_calls 的轮次不产生叙述标记（直接走 text）', () => {
    const sm = new AGUIStateMachine('trace-2', 'msg-2')
    sm.process_message_chunk({ id: 'm1' }, '直接回答')
    const events = sm.flush_message_buffer(false)
    expect(typesOf(events)).toEqual(['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT'])
    expect(parse(events[0]!).narration).toBeUndefined()
  })

  it('thinking 状态标记（started/ended）不产生幽灵空段', () => {
    const sm = new AGUIStateMachine('trace-3', 'msg-3')

    const started = AGUIStreamAdapter._process_langgraph_event(
      sm,
      { type: 'thinking', data: { status: 'started' } },
      'thinking',
    )
    expect(started).toEqual([])

    const ended = AGUIStreamAdapter._process_langgraph_event(
      sm,
      { type: 'thinking', data: { status: 'ended' } },
      'thinking',
    )
    // 未开段时 ended 也不下发（无空段可关）
    expect(ended).toEqual([])
    expect(sm.thinking_started).toBe(false)
  })

  it('纯知识类提问（无工具调用）：CoT 正常成段，超阈值后回答边流边发', () => {
    const sm = new AGUIStateMachine('trace-4', 'msg-4')

    // 真实思维链先落段（这正是此前完全缺失的"思考"内容）
    expect(typesOf(thinkingDelta(sm, '这个问题不需要检索，直接回答。'))).toEqual([
      'THINKING_START',
      'THINKING_TEXT_MESSAGE_CONTENT',
    ])

    // 最终回答：首段不足阈值 → 先缓冲
    expect(sm.process_message_chunk({ id: 'm1' }, 'x'.repeat(120))).toEqual([])
    // 累计超过阈值 → 关闭思考段并开始直发
    const first = sm.process_message_chunk({ id: 'm1' }, 'y'.repeat(60))
    expect(typesOf(first)).toEqual([
      'THINKING_END',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
    ])
    // 后续增量逐段直发，不再积压
    expect(typesOf(sm.process_message_chunk({ id: 'm1' }, '尾部增量'))).toEqual([
      'TEXT_MESSAGE_CONTENT',
    ])
    // 冲刷时不重复投递
    expect(sm.flush_message_buffer()).toEqual([])
  })

  it('已出现 tool_calls 的轮次：长叙述按「正文段」下发且不打早期直发', () => {
    const sm = new AGUIStateMachine('trace-5', 'msg-5')
    const longNarration = 'n'.repeat(200)

    // 同 chunk 带 tool_call_chunks → 立即判定为中间轮，不做早期直发（缓冲到轮次结束）
    expect(
      sm.process_message_chunk({ id: 'm1', tool_call_chunks: [{ index: 0 }] }, longNarration),
    ).toEqual([])

    const events = sm.flush_message_buffer(true)
    expect(typesOf(events)).toEqual([
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
    ])
    expect(parse(events[0]!).narration).toBe(true)
    expect(parse(events[1]!).delta).toBe(longNarration)
  })
})
