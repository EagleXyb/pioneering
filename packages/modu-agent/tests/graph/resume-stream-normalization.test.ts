// 回归测试：resume_stream 事件归一化（pro / task 的 HITL 恢复链路）
//
// 缺陷：`resume_stream` 直接把LangGraph 产出的 `[mode, chunk]` 元组包成
// `{ type: mode, data: chunk }`，而 `AGUIStreamAdapter` 的 messages 分支读的是
// `event.event ?? event.data`：
//   - stream_response 经 `_normalizeLangGraphStream` 归一为
//     `{ type:'messages', event: msgObj, data: msgObj, metadata }` → 可取到正文；
//   - resume_stream 未归一，data 是原始 `[msgChunk, metadata]` 数组，
//     `event.event` 为空 → msg 退化为数组 → msgType 解析为空 → content 取不到。
// 结果：整轮 resume 只产出 RUN_STARTED / RUN_FINISHED，零个 TEXT_MESSAGE_CONTENT，
// 前端表现为「Agent 没有任何回复」。
//
// 验证目标：resume_stream 产出的 messages 事件必须带event 字段（单条消息对象），
// 且经 AGUIStreamAdapter 转换后能产出 TEXT_MESSAGE_CONTENT。
import { describe, it, expect, beforeEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'

import { buildModuGraph } from '@/graph/graph.js'
import { getConfig, resetConfig } from '@/config/runtime-config.js'
import { resume_stream, stream_response } from '@/graph/runner.js'
import { AGUIStreamAdapter } from '@/orchestration/communication/agui-adapter.js'

// ============================================================
// Mock LLM：第 1 轮返回敏感工具调用（触发 HITL），第 2 轮返回终答
// ============================================================

class ScriptedLlm {
  public callCount = 0

  async invoke(_messages: any[]): Promise<any> {
    this.callCount += 1
    if (this.callCount === 1) {
      return new AIMessage({
        content: '我需要执行一段代码。',
        tool_calls: [
          { id: 'call_1', name: 'code_executor', args: { code: 'print("ok")' } },
        ] as any,
      })
    }
    return new AIMessage({ content: '代码已执行完成，结果如下。' })
  }

  bindTools(_tools: any[]): any {
    return this
  }

  bind(_opts: any): any {
    return this
  }
}

async function buildGraph(): Promise<any> {
  const mockLlm = new ScriptedLlm()
  return buildModuGraph(
    [],
    mockLlm,
    new MemorySaver(),
    null,
    'You are a helpful AI assistant.',
    null,
    null,
    true, // hitlEnabled
    false, // multiAgent
    null, // judgeLlm
    false, // planExecute
    null, // rawLlm
    null,
    null,
  )
}

function inputData(prompt: string): Record<string, any> {
  return { input_type: 'text', prompt }
}

/** 收集 AG-UI 事件类型与正文 */
async function drainAgui(
  it: AsyncGenerator<Record<string, any>>,
): Promise<{ types: string[]; text: string }> {
  const types: string[] = []
  let text = ''
  const adapter = new AGUIStreamAdapter('trace-test')
  for await (const d of adapter.transform_langgraph_events(it as any)) {
    const e = JSON.parse(d.data as string)
    types.push(e.type)
    if (e.type === 'TEXT_MESSAGE_CONTENT') text += e.delta ?? ''
  }
  return { types, text }
}

describe('resume_stream 事件归一化（HITL 恢复链路）', () => {
  beforeEach(() => resetConfig())

  it('resume 后的 messages 事件必须带 event 字段（单条消息对象）', async () => {
    const graph = await buildGraph()
    const threadId = 'resume-norm-thread'

    for await (const _ of stream_response(
      graph as any,
      'test-user',
      threadId,
      inputData('请执行一段代码'),
      'trace-1',
      null,
      {},
      null,
    )) {
      // 触发 human_review interrupt
    }

    const messageEvents: any[] = []
    for await (const e of resume_stream(
      graph as any,
      threadId,
      true,
      '',
      'trace-2',
      {},
      null,
    )) {
      if (e?.type === 'messages') messageEvents.push(e)
    }

    expect(messageEvents.length).toBeGreaterThan(0)
    for (const e of messageEvents) {
      // event 必须是单个消息对象（不是数组），AG-UI 适配器依赖它取值
      expect(Array.isArray(e.event)).toBe(false)
      expect(e.event).toBeTruthy()
      expect(typeof e.event?._getType === 'function' || e.event?.type !== undefined).toBe(true)
    }
  })

  it('resume 后的 AG-UI 流必须产出 TEXT_MESSAGE_CONTENT（正文可见）', async () => {
    const graph = await buildGraph()
    const threadId = 'resume-agui-thread'

    for await (const _ of stream_response(
      graph as any,
      'test-user',
      threadId,
      inputData('请执行一段代码'),
      'trace-1',
      null,
      {},
      null,
    )) {
      // 触发 interrupt
    }

    const { types, text } = await drainAgui(
      resume_stream(graph as any, threadId, true, '', 'trace-2', {}, null) as any,
    )

    expect(types).toContain('TEXT_MESSAGE_CONTENT')
    expect(types).toContain('RUN_FINISHED')
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain('代码已执行完成')
  })
})