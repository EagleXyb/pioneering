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
