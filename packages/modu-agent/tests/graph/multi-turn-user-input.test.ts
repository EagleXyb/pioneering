// 回归测试：多轮对话必须注入当前轮用户输入
//
// 缺陷：agentNode 原本只在 `state.messages` 为空时才用 cleaned_text 构造 HumanMessage。
// 第 2 轮起 state.messages 已含上一轮的 Human/AI 消息，于是**本轮用户输入被静默丢弃**，
// 请求变成 `[system, assistant]`（以 assistant 结尾、没有 user 轮）。
// 当请求携带 tools（进入 thinking / 工具调用模式）时，DeepSeek 会要求历史 assistant
// 消息携带 reasoning_content，直接返回 400：
//   "The `reasoning_content` in the thinking mode must be passed back to the API."
//
// 验证目标：第 2 轮及以后，发给 LLM 的消息尾部必须是本轮的用户输入；
// 同时同一轮 ReAct 回环内不得重复注入。
import { describe, it, expect, beforeEach } from 'vitest'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'

import { buildModuGraph } from '@/graph/graph.js'
import { stream_response } from '@/graph/runner.js'
import { resetConfig } from '@/config/runtime-config.js'
import { wrap_modu_tool } from '@/graph/adapters/tool-adapter.js'
import { CalculatorTool } from '@/tools/index.js'

// ============================================================
// Mock LLM：记录每次调用收到的消息，按脚本返回
// ============================================================

class RecordingLlm {
  public calls: any[][] = []

  async invoke(messages: any[]): Promise<any> {
    this.calls.push(messages)
    return new AIMessage({ content: `第${this.calls.length}轮回答` })
  }

  bindTools(_tools: any[]): any {
    return this
  }

  bind(_opts: any): any {
    return this
  }
}

async function buildGraph(llm: any): Promise<any> {
  // 携带工具：与线上 agent 通道一致（tools 是触发 400 的必要条件之一）
  const tools = [wrap_modu_tool(new CalculatorTool(), null)]
  return buildModuGraph(
    tools,
    llm,
    new MemorySaver(), // 跨轮 checkpoint
    null,
    'You are a helpful AI assistant.',
    null,
    null,
    false, // hitl 关闭
    false, // multiAgent
    null,
    false, // planExecute
    null,
    null,
    null,
  )
}

const tailText = (msgs: any[]): string => {
  const last = msgs[msgs.length - 1]
  return last instanceof HumanMessage
    ? String((last as any).content ?? '')
    : `<非 Human: ${last?.constructor?.name}>`
}

describe('agentNode 多轮用户输入注入', () => {
  beforeEach(() => resetConfig())

  it('第 2 轮的请求尾部必须是本轮用户输入（不能丢）', async () => {
    const llm = new RecordingLlm()
    const graph = await buildGraph(llm)
    const thread = 'multi-turn-thread'

    for await (const _ of stream_response(
      graph as any, 'u1', thread, { input_type: 'text', prompt: '第一问' }, 't1', null, {}, null,
    )) { /* 跑完第 1 轮 */ }

    expect(llm.calls.length).toBeGreaterThanOrEqual(1)
    expect(tailText(llm.calls[0]!)).toBe('第一问')

    for await (const _ of stream_response(
      graph as any, 'u1', thread, { input_type: 'text', prompt: '第二问' }, 't2', null, {}, null,
    )) { /* 跑完第 2 轮 */ }

    // 关键断言：第 2 轮 LLM 收到的最后一条必须是「第二问」
    expect(llm.calls.length).toBeGreaterThanOrEqual(2)
    const secondCall = llm.calls[1]!
    expect(tailText(secondCall)).toBe('第二问')
    // 上一轮回答仍在上下文里（未被清空）
    expect(secondCall.some((m: any) => String(m?.content ?? '').includes('第1轮回答'))).toBe(true)
  })

  it('同一轮 ReAct 循环内不得重复注入用户输入', async () => {
    // 让模型首轮就调用工具，触发 agent→tools→agent 的回环
    const calls: any[][] = []
    let n = 0
    const llm: any = {
      async invoke(messages: any[]) {
        calls.push(messages)
        n += 1
        if (n === 1) {
          return new AIMessage({
            content: '',
            tool_calls: [{ id: 'c1', name: 'calculator', args: { expression: '1+1' } }] as any,
          })
        }
        return new AIMessage({ content: '最终回答' })
      },
      bindTools(_t: any[]) { return this },
      bind(_o: any) { return this },
    }
    const graph = await buildGraph(llm)
    const thread = 'react-loop-thread'

    for await (const _ of stream_response(
      graph as any, 'u1', thread, { input_type: 'text', prompt: '算一下 1+1' }, 't1', null, {}, null,
    )) { /* 跑完 */ }

    expect(calls.length).toBeGreaterThanOrEqual(2)
    // 每次调用的尾部都应是本轮 HumanMessage，且全文只出现一次
    for (const c of calls) {
      expect(tailText(c)).toBe('算一下 1+1')
      expect(c.filter((m: any) => m instanceof HumanMessage).length).toBe(1)
    }
  })
})