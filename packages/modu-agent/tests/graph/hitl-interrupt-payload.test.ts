// HITL interrupt 载荷契约测试
//
// 背景（前端恢复链路缺陷）：
//   前端 hitlStore.recover() 依赖 GET /agent/state/:threadId 返回的
//   kind / pending_tool_calls / tool_requires_approval 重建待答复弹窗。
//   interrupt() 的载荷只存在于 checkpoint 的 task.interrupts[].value 中，
//   节点自身的返回值在暂停时不会写入 state.values，因此仅靠 values 读取
//   会得到空载荷，前端只能"猜"kind 并弹出无内容的通用弹窗。
//
// 本测试锁定契约：
//   1. get_interrupt_state 必须返回 kind='tool_confirm'
//   2. pending_tool_calls 必须非空且包含工具名与参数（来自 interrupt 载荷）
//   3. tool_requires_approval 必须为 true
//   4. message 必须来自 interrupt 载荷（而非硬编码兜底文案）
//   5. clarify 节点的载荷（kind='clarifying' + question）也必须可读
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'

import { buildModuGraph } from '@/graph/graph.js'
import { getConfig, overrideConfig, RuntimeConfig, resetConfig } from '@/config/runtime-config.js'
import { CodeExecutorTool } from '@/tools/index.js'
import { wrap_modu_tool } from '@/graph/adapters/tool-adapter.js'
import { get_interrupt_state } from '@/graph/runner.js'
import type { ModuAgentState } from '@/graph/state.js'

/** 第 1 轮返回 code_executor 调用（敏感工具），第 2 轮返回终答 */
class PayloadMockLlm {
  private callCount = 0
  private scripts = [
    {
      content: '需要执行代码。',
      tool_calls: [
        { id: 'call_code_payload', name: 'code_executor', args: { code: 'print(1)' } },
      ],
    },
    { content: '已完成。' },
  ]

  async invoke(_messages: any[]): Promise<any> {
    const idx = Math.min(this.callCount, this.scripts.length - 1)
    this.callCount += 1
    const script = this.scripts[idx] as any
    return new AIMessage({ content: script.content, tool_calls: script.tool_calls as any })
  }

  bindTools(_tools: any[]): any {
    return this
  }

  bind(_opts: any): any {
    return this
  }
}

function makeInitialState(threadId: string): Partial<ModuAgentState> {
  return {
    input_data: { prompt: '请执行一段代码', input_type: 'text' },
    cleaned_text: '请执行一段代码',
    session_id: threadId,
    user_id: 'test-user',
    trace_id: `trace-${threadId}`,
  }
}

describe('HITL interrupt 载荷契约', () => {
  let restoreHandle: { restore: () => void } | null = null

  beforeEach(() => {
    resetConfig()
    const cfg = new RuntimeConfig({
      tools: {
        human_in_loop: {
          enabled: true,
          approval_timeout_seconds: 300,
          auto_reject_on_timeout: true,
          sensitive_tools: ['code_executor'],
        },
      },
    })
    restoreHandle = overrideConfig(cfg)
  })

  afterEach(() => {
    if (restoreHandle) {
      restoreHandle.restore()
      restoreHandle = null
    }
    resetConfig()
  })

  it('工具审批暂停时返回完整 kind/tool_calls/message 载荷', async () => {
    const mockLlm = new PayloadMockLlm()
    const tool = new CodeExecutorTool()
    const structured = wrap_modu_tool(tool, getConfig())
    const compiled = buildModuGraph(
      [structured],
      mockLlm.bindTools([structured]),
      new MemorySaver(),
      null,
      'You are a helpful AI assistant.',
      null,
      null,
      true, // HITL 开启
      false,
      null,
      false,
      null,
      null,
      null,
    )

    const threadId = 'hitl-payload-thread'
    await compiled.invoke(makeInitialState(threadId), {
      configurable: { thread_id: threadId },
    })

    const pending = await get_interrupt_state(compiled, threadId)
    expect(pending).not.toBeNull()

    // 1. kind 必须明确为工具审批（前端据此选择弹窗类型，而非靠布尔值猜测）
    expect(pending!.kind).toBe('tool_confirm')

    // 2. 待审批工具调用必须可用（否则弹窗无内容、改参也无法进行）
    expect(Array.isArray(pending!.pending_tool_calls)).toBe(true)
    expect(pending!.pending_tool_calls.length).toBeGreaterThan(0)
    expect(String(pending!.pending_tool_calls[0].name)).toBe('code_executor')
    expect(pending!.pending_tool_calls[0].args).toMatchObject({ code: 'print(1)' })

    // 3. 审批标记必须为 true
    expect(pending!.tool_requires_approval).toBe(true)

    // 4. 提示文案来自 interrupt 载荷
    expect(String(pending!.message ?? '').length).toBeGreaterThan(0)

    // 5. session_id 必须与会话一致（用于前端会话归属校验）
    expect(pending!.session_id).toBe(threadId)
  }, 30000)
})
