// P0-4 回归测试：resume / HITL 场景下的孤儿 tool_calls 净化
//
// 缺陷（实测两次，会话 sess_1b006374… / sess_c2d19a42…）：任务模式某步调用
// doc_writer 触发人工审批 → 暂停 → resume 后整轮以 RUN_ERROR 告终：
//   "400 An assistant message with 'tool_calls' must be followed by tool messages
//    responding to each 'tool_call_id'. (insufficient tool messages following...)"
//
// 根因：暂停时写入的 AIMessage 带 tool_calls，但审批未完成 / 恢复后又重跑 agent，
// 这些 tool_calls 没有对应的 ToolMessage 就被发给了 provider。
import { describe, it, expect } from 'vitest'
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'

import { _sanitizeOrphanToolCalls } from '@/graph/nodes.js'

function aiWithCalls(id: string, content = '正文') {
  return new AIMessage({
    content,
    tool_calls: [{ id, name: 'doc_writer', args: { op: 'create' } } as any],
  })
}

describe('_sanitizeOrphanToolCalls', () => {
  it('末尾孤儿 tool_calls 被移除（保留正文）', () => {
    const msgs = [new HumanMessage({ content: '写文档' }), aiWithCalls('call_1', '我去写文档')]
    const { messages, fixed } = _sanitizeOrphanToolCalls(msgs)

    expect(fixed).toBe(1)
    const last = messages[messages.length - 1] as any
    expect(last.tool_calls ?? []).toHaveLength(0)
    expect(last.content).toBe('我去写文档')
  })

  it('序列中间的孤儿同样被移除（仅清末尾不够）', () => {
    // resume 后 human_review / doc_final_answer 可能又追加了消息，
    // 孤儿 tool_calls 会落在中间
    const msgs = [
      aiWithCalls('call_1', '准备写文档'),
      new HumanMessage({ content: '请直接输出最终答复，不要再用工具。' }),
      new SystemMessage({ content: '系统提醒' }),
    ]
    const { messages, fixed } = _sanitizeOrphanToolCalls(msgs)

    expect(fixed).toBe(1)
    expect((messages[0] as any).tool_calls ?? []).toHaveLength(0)
    expect((messages[0] as any).content).toBe('准备写文档')
    // 后续消息保持原样
    expect((messages[1] as any).content).toContain('不要再用工具')
  })

  it('已有工具响应的 tool_calls 保留（行为不回归）', () => {
    const msgs = [
      aiWithCalls('call_1', '调用工具'),
      new ToolMessage({ content: '{"status":"success"}', tool_call_id: 'call_1' }),
    ]
    const { messages, fixed } = _sanitizeOrphanToolCalls(msgs)

    expect(fixed).toBe(0)
    expect(messages).toBe(msgs)
    expect((messages[0] as any).tool_calls).toHaveLength(1)
  })

  it('部分响应时只保留有响应的那一项', () => {
    const msg = new AIMessage({
      content: '并行调用',
      tool_calls: [
        { id: 'call_1', name: 'search_engine', args: {} } as any,
        { id: 'call_2', name: 'doc_writer', args: {} } as any,
      ],
    })
    const msgs = [msg, new ToolMessage({ content: 'ok', tool_call_id: 'call_1' })]
    const { messages, fixed } = _sanitizeOrphanToolCalls(msgs)

    expect(fixed).toBe(1)
    const first = messages[0] as any
    expect(first.tool_calls).toHaveLength(1)
    expect(first.tool_calls[0].id).toBe('call_1')
  })

  it('无 tool_calls 的消息序列原样返回', () => {
    const msgs = [new HumanMessage({ content: 'hi' }), new AIMessage({ content: 'hello' })]
    const { messages, fixed } = _sanitizeOrphanToolCalls(msgs)

    expect(fixed).toBe(0)
    expect(messages).toBe(msgs)
  })
})
