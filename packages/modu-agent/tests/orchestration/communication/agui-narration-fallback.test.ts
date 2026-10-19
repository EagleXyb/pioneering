/**
 * AGUIStateMachine — 叙述标记兜底与正文累积口径
 *
 * 缺陷背景（真实事故）：agent 在工具轮次上限处被强制终止，消息里只有过程叙述
 * （"我先确认当前时间…"），而这段文本没带 narration 标记 → 前端把它当最终回答
 * 渲染，用户看到的"回答"只有一句话。
 *
 * 根因：叙述判定依赖"本轮是否带 tool_calls"，但流式 chunk 的 tool_calls 与 content
 * 常不在同一 chunk / 同一 id 上，权威 tool_calls 又经 updates 到达 —— 收尾 flush
 * 时判据落空。修复：以「本轮是否真的下发过工具调用」兜底，并在 tools 节点执行后复位。
 *
 * 同时锁定正文累积口径：叙述（过程话术）不进 collected_text —— 它是落库正文与
 * 复制/分享的来源，混入叙述会让"回答"变成一串过程话术。
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

describe('AGUIStateMachine — 叙述标记兜底', () => {
  it('本轮下发过工具调用时，收尾 flush 的文本判为叙述（带 narration 标记）', () => {
    const sm = new AGUIStateMachine('t1', 'm1')
    // 工具调用先经 updates 通道下发（chunk 里看不到 tool_calls）
    sm.emit_tool_call_start('c1', 'web_search', '{"query":"x"}')
    // 随后该轮的过渡话术到达缓冲
    sm.process_message_chunk({ id: 'm-round' }, '我先确认当前时间，并检索业界实践。')

    // 流收尾时的 flush（无权威判定入参）——修复前这里判成"最终回答"
    const events = sm.flush_message_buffer()

    expect(typesOf(events)).toEqual([
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
    ])
    expect(parse(events[0]!).narration).toBe(true)
  })

  it('工具执行完成后复位：下一轮文本仍按最终回答处理（不带标记）', () => {
    const sm = new AGUIStateMachine('t2', 'm2')
    sm.emit_tool_call_start('c1', 'web_search', '{}')
    // tools 节点执行完毕 = 轮次边界
    sm.note_tools_executed()
    sm.process_message_chunk({ id: 'm-final' }, '这是最终回答。')

    const events = sm.flush_message_buffer()

    expect(parse(events[0]!).narration).toBeUndefined()
    expect(sm.has_final_answer_text).toBe(true)
  })

  it('只下发过过程叙述时不生成正文累积（终态据此补发兜底正文）', () => {
    const sm = new AGUIStateMachine('t3', 'm3')
    sm.emit_tool_call_start('c1', 'web_search', '{}')
    sm.process_message_chunk({ id: 'm-narr' }, '我先检索一轮。')
    sm.flush_message_buffer()

    // 叙述不进正文累积：复制/落库的"回答"不应是过程话术
    expect(sm.collected_text).toBe('')
    expect(sm.has_final_answer_text).toBe(false)
  })

  it('最终回答进入正文累积（collected_text 只含回答）', () => {
    const sm = new AGUIStateMachine('t4', 'm4')
    sm.emit_tool_call_start('c1', 'web_search', '{}')
    sm.process_message_chunk({ id: 'm-narr' }, '我先检索一轮。')
    sm.flush_message_buffer()
    sm.note_tools_executed()
    sm.process_message_chunk({ id: 'm-answer' }, '这是最终回答。')
    sm.flush_message_buffer(false)

    expect(sm.collected_text).toBe('这是最终回答。')
  })
})
