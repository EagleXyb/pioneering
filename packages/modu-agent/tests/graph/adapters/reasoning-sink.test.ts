/**
 * reasoning-sink —— agent 通道思维链（reasoning_content）采集
 *
 * 背景：@langchain/openai 的 delta 转换会丢弃 reasoning_content，agent 通道
 * （pro / task）因此拿不到模型真实思维链；本模块在 LLM 出口的 fetch 层旁路嗅探
 * provider SSE，把增量送回**当前 run**（AsyncLocalStorage 隔离并发会话）。
 *
 * 本测试锁定三段契约：
 *   1. sink 的上下文隔离（并发 run 不串流）；
 *   2. SSE 旁路：字节等价透传 + 只提取 reasoning_content；
 *   3. EventBridge 把旁路增量映射为 thinking(status=delta) SSE 事件。
 */
import { describe, it, expect } from 'vitest'
import {
  current_reasoning_sink,
  emit_reasoning_delta,
  run_with_reasoning_sink,
} from '../../../src/graph/adapters/reasoning-sink.js'
import { _withReasoningTap } from '../../../src/graph/adapters/llm-adapter.js'
import { LangGraphEventBridge } from '../../../src/graph/adapters/event-bridge.js'

/** 模拟 DeepSeek 流式响应（SSE）：reasoning_content 与 content 混排 */
const SSE_BODY = [
  'data: {"choices":[{"delta":{"reasoning_content":"先想一下"}}]}',
  '',
  'data: {"choices":[{"delta":{"content":"你好"}}]}',
  '',
  'data: {"choices":[{"delta":{"reasoning_content":"再确认"}}]}',
  '',
  'data: [DONE]',
  '',
].join('\n')

function fetchReturning(body: string, contentType: string): typeof fetch {
  return (async () => new Response(body, { headers: { 'content-type': contentType } })) as unknown as typeof fetch
}

describe('reasoning-sink：上下文隔离', () => {
  it('增量只送达当前 run 的 sink（并发不串流）', async () => {
    const roundA: string[] = []
    const roundB: string[] = []

    await Promise.all([
      run_with_reasoning_sink((d) => roundA.push(d), async () => {
        emit_reasoning_delta('A1')
        await new Promise((r) => setTimeout(r, 5))
        emit_reasoning_delta('A2')
      }),
      run_with_reasoning_sink((d) => roundB.push(d), async () => {
        await new Promise((r) => setTimeout(r, 1))
        emit_reasoning_delta('B1')
      }),
    ])

    expect(roundA).toEqual(['A1', 'A2'])
    expect(roundB).toEqual(['B1'])
  })

  it('上下文外无 sink：上报 no-op', () => {
    expect(current_reasoning_sink()).toBeNull()
    expect(() => emit_reasoning_delta('x')).not.toThrow()
  })
})

describe('LLM SSE 旁路：reasoning_content 提取', () => {
  it('字节等价透传，同时把 reasoning_content 上报给当前 run', async () => {
    const seen: string[] = []
    const tapped = _withReasoningTap(fetchReturning(SSE_BODY, 'text/event-stream'))

    await run_with_reasoning_sink((d) => seen.push(d), async () => {
      const res = await tapped('https://api.example.com/v1/chat/completions', {})
      expect(await res.text()).toBe(SSE_BODY)
    })

    expect(seen).toEqual(['先想一下', '再确认'])
  })

  it('无 sink 时零开销透传（响应体不做任何加工）', async () => {
    const tapped = _withReasoningTap(fetchReturning(SSE_BODY, 'text/event-stream'))
    const res = await tapped('https://api.example.com/v1/chat/completions', {})
    expect(await res.text()).toBe(SSE_BODY)
  })

  it('非 SSE 响应不解析', async () => {
    const seen: string[] = []
    const tapped = _withReasoningTap(fetchReturning('{"ok":true}', 'application/json'))

    await run_with_reasoning_sink((d) => seen.push(d), async () => {
      const res = await tapped('https://api.example.com/v1/chat/completions', {})
      await res.text()
    })

    expect(seen).toEqual([])
  })
})

describe('EventBridge：旁路增量 → thinking(delta) SSE 事件', () => {
  it('reasoning_delta 映射为 thinking SSE（status=delta）', () => {
    const bridge = new LangGraphEventBridge(null)

    expect(
      bridge._emitSseEvents({ type: 'reasoning_delta', data: { delta: '思考内容' } }),
    ).toEqual([{ type: 'thinking', data: { status: 'delta', content: '思考内容' } }])

    // 空增量不下发
    expect(bridge._emitSseEvents({ type: 'reasoning_delta', data: { delta: '' } })).toEqual([])
  })
})
