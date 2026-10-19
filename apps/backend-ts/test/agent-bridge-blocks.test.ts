/**
 * agent-bridge 内容块收集与终态收尾测试
 *
 * 锁定缺陷修复：工具轮次触顶（或 run 异常结束）时，已下发的 TOOL_CALL_START
 * 永远等不到 TOOL_CALL_RESULT，块状态会一直停在 `running` —— 前端过程区把这类行
 * 一直显示成「执行中」。终态必须收尾：
 *   - tool_call：未执行 → failed（前端显示「未执行」）
 *   - thinking / text_stream：已有内容 → success（只是缺 END 事件）
 */
import { describe, it, expect } from 'vitest'

import {
  StreamContext,
  collectMetadataFromEvent,
  extractSearchSources,
  finalizePendingBlocks,
} from '../src/core/agent-bridge.js'

/** AG-UI 事件字典：data 为 JSON 字符串（含 type 字段），与 SSE 解析后的形状一致 */
const agentEvent = (type: string, data: Record<string, any> = {}) => ({
  data: JSON.stringify({ type, ...data }),
})

describe('finalizePendingBlocks', () => {
  it('未执行的 tool_call 收尾为 failed，已完成的块不受影响', () => {
    const ctx = new StreamContext()
    ctx.contentBlocks = [
      { type: 'thinking', status: 'success', summary: '思考' },
      { type: 'tool_call', status: 'success', toolName: 'search_engine', executionId: 't1' },
      { type: 'tool_call', status: 'running', toolName: 'search_engine', executionId: 't2' },
    ]

    finalizePendingBlocks(ctx)

    expect(ctx.contentBlocks[1].status).toBe('success')
    expect(ctx.contentBlocks[2].status).toBe('failed')
  })

  it('残留的 thinking / text_stream 收尾为 success（内容已有，仅缺 END 事件）', () => {
    const ctx = new StreamContext()
    ctx.contentBlocks = [
      { type: 'thinking', status: 'running', summary: '思考中' },
      { type: 'text_stream', status: 'running', text: '半截正文' },
    ]

    finalizePendingBlocks(ctx)

    expect(ctx.contentBlocks[0].status).toBe('success')
    expect(ctx.contentBlocks[1].status).toBe('success')
  })

  it('RUN_FINISHED 事件触发收尾（触顶中止的真实路径）', () => {
    const ctx = new StreamContext()
    collectMetadataFromEvent(agentEvent('RUN_STARTED'), ctx)
    collectMetadataFromEvent(
      agentEvent('TOOL_CALL_START', { toolCallId: 't1', toolCallName: 'search_engine' }),
      ctx,
    )
    collectMetadataFromEvent(
      agentEvent('TOOL_CALL_START', { toolCallId: 't2', toolCallName: 'search_engine' }),
      ctx,
    )
    // 触顶：两个工具调用没有结果，直接 RUN_FINISHED
    collectMetadataFromEvent(agentEvent('RUN_FINISHED'), ctx)

    const statuses = ctx.contentBlocks
      .filter((b) => b.type === 'tool_call')
      .map((b) => b.status)
    expect(statuses).toEqual(['failed', 'failed'])
  })

  it('RUN_ERROR 事件同样收尾，不留"执行中"', () => {
    const ctx = new StreamContext()
    collectMetadataFromEvent(
      agentEvent('TOOL_CALL_START', { toolCallId: 't1', toolCallName: 'read_file' }),
      ctx,
    )
    collectMetadataFromEvent(agentEvent('RUN_ERROR', { code: 'E', message: 'boom' }), ctx)

    expect(ctx.contentBlocks[0].status).toBe('failed')
  })
})

/**
 * 搜索来源块（方案 A）
 *
 * tool_result.summary 只有 800 字，多条搜索结果的回放只剩第一条；搜索类工具的
 * TOOL_CALL_RESULT 需额外产出完整来源块（标题 + URL + 120 字短摘要），
 * 供前端回放渲染「全部条数 + 简要概述」。
 */
describe('搜索来源块（sources）', () => {
  /** 后端 search_engine 工具观测的标准口径 */
  const searchObservation = (count: number, snippetLen = 20) =>
    JSON.stringify({
      tool: 'search_engine',
      status: 'success',
      data: {
        source: 'deepseek',
        results: Array.from({ length: count }, (_, i) => ({
          title: `标题${i + 1}`,
          url: `https://example.com/${i + 1}`,
          snippet: '摘'.repeat(snippetLen),
          source: 'DeepSeek',
        })),
      },
    })

  const runToolResult = (
    ctx: StreamContext,
    toolName: string,
    content: unknown,
    toolCallId = 't1',
  ) =>
    collectMetadataFromEvent(
      agentEvent('TOOL_CALL_RESULT', { toolCallId, toolCallName: toolName, content }),
      ctx,
    )

  it('搜索工具额外落 sources 块：完整条数 + 120 字短摘要', () => {
    const ctx = new StreamContext()
    runToolResult(ctx, 'search_engine', searchObservation(5, 200))

    const sources = ctx.contentBlocks.find((b) => b.type === 'sources')
    expect(sources).toBeDefined()
    expect(sources!.source).toBe('deepseek')
    expect(sources!.items).toHaveLength(5)
    expect(sources!.items[0].snippet).toHaveLength(120)
    expect(sources!.items[0].url).toBe('https://example.com/1')

    // 原有 tool_result 行为不变（仍按 800 字截断）
    const toolResult = ctx.contentBlocks.find((b) => b.type === 'tool_result')
    expect(String(toolResult!.summary).length).toBeLessThanOrEqual(800)
  })

  it('检索条数全部落库（上限 50 = DeepSeek count 上限，不静默截断）', () => {
    const ctx = new StreamContext()
    runToolResult(ctx, 'search_engine', searchObservation(30))

    const sources = ctx.contentBlocks.find((b) => b.type === 'sources')
    expect(sources!.items).toHaveLength(30)
    expect(new Set(sources!.items.map((i: any) => i.title)).size).toBe(30)
  })

  it('带 "...[truncated]" 标记的截断 JSON：挽救已完整闭合的条目', () => {
    const json = searchObservation(3)
    // 在第二条结果中间截断 → 只剩第一条完整
    const secondStart = json.indexOf('{"title"', json.indexOf('{"title"') + 1)
    const ctx = new StreamContext()
    runToolResult(ctx, 'search_engine', `${json.slice(0, secondStart)}...[truncated]`)

    const sources = ctx.contentBlocks.find((b) => b.type === 'sources')
    expect(sources).toBeDefined()
    expect(sources!.items).toHaveLength(1)
    expect(sources!.items[0].title).toBe('标题1')
  })

  it('extractSearchSources：非搜索工具 / 非 JSON / 空结果均返回 null', () => {
    expect(extractSearchSources('read_file', searchObservation(3))).toBeNull()
    expect(extractSearchSources('web_search', 'plain text')).toBeNull()
    expect(
      extractSearchSources('search_engine', JSON.stringify({ data: { results: [] } })),
    ).toBeNull()
    expect(extractSearchSources('search_engine', undefined)).toBeNull()
  })

  it('非搜索工具不落 sources 块（原有行为不变）', () => {
    const ctx = new StreamContext()
    runToolResult(ctx, 'read_file', searchObservation(3))
    expect(ctx.contentBlocks.some((b) => b.type === 'sources')).toBe(false)
  })

  it('裸 {results,[...]} 口径（无 data 包裹）同样可提取', () => {
    const parsed = extractSearchSources(
      'search_engine',
      JSON.stringify({ results: [{ title: 'A', url: 'https://a.com' }], source: 'bing' }),
    )
    expect(parsed?.source).toBe('bing')
    expect(parsed?.items).toEqual([
      { title: 'A', url: 'https://a.com', snippet: '' },
    ])
  })

  it('sources 块紧随对应 tool_result，executionId 一致（前端按 id 回填）', () => {
    const ctx = new StreamContext()
    collectMetadataFromEvent(
      agentEvent('TOOL_CALL_START', { toolCallId: 't1', toolCallName: 'search_engine' }),
      ctx,
    )
    runToolResult(ctx, 'search_engine', searchObservation(4))

    const types = ctx.contentBlocks.map((b) => b.type)
    expect(types).toEqual(['tool_call', 'tool_result', 'sources'])
    const [toolResult, sources] = ctx.contentBlocks.slice(1)
    expect(sources.executionId).toBe(toolResult.executionId)
    expect(sources.executionId).toBe('t1')
  })
})
