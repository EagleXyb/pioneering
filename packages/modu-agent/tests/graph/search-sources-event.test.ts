/**
 * T4.2：Agent 搜索工具结果收敛为 WEB_SEARCH_SOURCES 事件
 */
import { describe, it, expect } from 'vitest'
import { AGUIStreamAdapter } from '@/orchestration/communication/agui-adapter.js'

/** 构造 SearchTool.invoke 返回值对应的 ToolMessage content */
function searchToolContent(): string {
  return JSON.stringify({
    status: 'success',
    error_code: '',
    data: {
      source: 'bing',
      results: [
        { title: '标题A', url: 'https://a.com', snippet: '摘要A', source: 'Bing' },
        { title: '标题B', url: 'https://b.com', snippet: '摘要B', source: 'Bing' },
      ],
    },
  })
}

async function collect(toolNodeEvents: Array<Record<string, unknown>>) {
  async function* source() {
    // 模拟 LangGraph updates 模式：node='tools'，data.messages 含 ToolMessage
    yield {
      type: 'updates',
      node: 'tools',
      data: { messages: toolNodeEvents },
    }
  }

  const adapter = new AGUIStreamAdapter('trace-1', 'msg-1', 'dict')
  const out: Array<Record<string, unknown>> = []
  for await (const ev of adapter.transform_langgraph_events(source() as never)) {
    // event dict: { type, data: <json string> }
    let type = ''
    try {
      type = JSON.parse((ev.data as string) ?? '{}').type ?? ''
    } catch {
      type = ''
    }
    out.push({ type, raw: ev })
  }
  return out
}

describe('T4.2 搜索收敛', () => {
  it('search_engine 工具结果产出 WEB_SEARCH_SOURCES，字段映射正确', async () => {
    const events = await collect([
      {
        type: 'tool',
        name: 'search_engine',
        tool_call_id: 'call_1',
        content: searchToolContent(),
      },
    ])

    const sourcesEvent = events.find((e) => e.type === 'WEB_SEARCH_SOURCES')
    expect(sourcesEvent).toBeDefined()

    const payload = JSON.parse((sourcesEvent!.raw as { data: string }).data)
    expect(payload.sources).toEqual([
      { title: '标题A', url: 'https://a.com', content: '摘要A', site: 'Bing' },
      { title: '标题B', url: 'https://b.com', content: '摘要B', site: 'Bing' },
    ])

    // TOOL_CALL_RESULT 仍正常发出
    expect(events.some((e) => e.type === 'TOOL_CALL_RESULT')).toBe(true)
  })

  it('非搜索工具不产出 WEB_SEARCH_SOURCES', async () => {
    const events = await collect([
      {
        type: 'tool',
        name: 'calculator',
        tool_call_id: 'call_2',
        content: JSON.stringify({ status: 'success', data: { result: 42 } }),
      },
    ])
    expect(events.some((e) => e.type === 'WEB_SEARCH_SOURCES')).toBe(false)
  })

  it('搜索无结果（results 空）时不产出事件', async () => {
    const events = await collect([
      {
        type: 'tool',
        name: 'search_engine',
        tool_call_id: 'call_3',
        content: JSON.stringify({
          status: 'success',
          data: { source: 'bing', results: [] },
        }),
      },
    ])
    expect(events.some((e) => e.type === 'WEB_SEARCH_SOURCES')).toBe(false)
  })
})
