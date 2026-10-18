/**
 * P6 回归：responseNode 必须识别 AIMessageChunk
 *
 * 缺陷：流式/函数调用下 LangGraph 返回的是 AIMessageChunk（不是 AIMessage 子类），
 * 只判 instanceof AIMessage 会跳过最终答案，落到「本次任务共执行 N 次工具调用」兜底，
 * 表现为工具执行成功但用户只看到过程叙述（评测 smoke 0/6 的根因）。
 */
import { describe, it, expect } from 'vitest'
import { AIMessageChunk, ToolMessage } from '@langchain/core/messages'
import { responseNode } from '../../src/graph/nodes.js'

function stateWith(messages: any[]): any {
  return {
    messages,
    tool_results: [{ tool: 'calculator', status: 'success' }],
    artifacts: [],
  }
}

describe('responseNode —— AIMessageChunk', () => {
  it('从 AIMessageChunk 提取最终回答，而不是工具摘要兜底', () => {
    const result = responseNode(
      stateWith([new AIMessageChunk({ content: '(123 + 456) × 7 = **4053**' })]),
    )
    expect(result.response).toBe('(123 + 456) × 7 = **4053**')
  })

  it('跳过带 tool_calls 的中间 chunk，取后续最终回答', () => {
    const intermediate = new AIMessageChunk({
      content: '',
      tool_calls: [{ id: 't1', name: 'calculator', args: { expression: '1+1' } }],
    })
    const tool = new ToolMessage({ content: '{"result":2}', tool_call_id: 't1' })
    const final = new AIMessageChunk({ content: '结果是 2' })

    const result = responseNode(stateWith([intermediate, tool, final]))
    expect(result.response).toBe('结果是 2')
  })

  it('全程无正文时仍回退到工具摘要（保持原兜底行为）', () => {
    const result = responseNode(stateWith([new AIMessageChunk({ content: '' })]))
    expect(String(result.response)).toContain('本次任务共执行 1 次工具调用')
  })
})
