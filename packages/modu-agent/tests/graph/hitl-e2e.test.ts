// HITL（Human-in-the-Loop）端到端测试：敏感工具审批流程
//
// 验证目标：
//   1. 敏感工具（code_executor）调用触发 human_review interrupt 暂停
//   2. get_interrupt_state 能查询到暂停状态（next_nodes 含 human_review）
//   3. resume_sync(approved=true) 批准后继续执行工具并产出终答
//   4. resume_sync(approved=false) 拒绝后走降级路径（TOOL_APPROVAL_REJECTED），工具不执行
//
// 测试策略（对齐 react-news-e2e.test.ts）：
//   - Mock LLM：脚本化 2 轮（第 1 轮 code_executor 调用 → 第 2 轮终答）
//   - 真实 CodeExecutorTool：带 invoke 计数，验证审批通过后才真正执行
//   - RuntimeConfig 启用 tools.human_in_loop（sensitive_tools 含 code_executor）
//   - MemorySaver checkpointer：中断/恢复依赖 LangGraph checkpoint
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'

import { buildModuGraph } from '@/graph/graph.js'
import { getConfig, overrideConfig, RuntimeConfig, resetConfig } from '@/config/runtime-config.js'
import { CodeExecutorTool } from '@/tools/index.js'
import { wrap_modu_tool } from '@/graph/adapters/tool-adapter.js'
import { resume_sync, get_interrupt_state } from '@/graph/runner.js'
import type { ModuAgentState } from '@/graph/state.js'

// ============================================================
// Mock LLM：脚本化 HITL 推理轮次
// ============================================================

/**
 * 第 1 轮：返回 code_executor 工具调用（敏感工具，应触发 HITL 审批）
 * 第 2 轮：返回最终自然语言回复（无 tool_calls，结束流程）
 */
class HitlMockLlm {
  public callCount = 0

  private scripts: Array<{
    content: string
    tool_calls?: Array<{ id: string; name: string; args: Record<string, any> }>
  }> = [
    {
      content: '我需要执行一段代码来完成用户请求。',
      tool_calls: [
        { id: 'call_code_1', name: 'code_executor', args: { code: 'print("hello hitl")' } },
      ],
    },
    {
      content: '代码执行完成，用户请求已处理完毕。',
      // 无 tool_calls —— 触发 routeAfterAgent 返回 __end__
    },
  ]

  async invoke(messages: any[]): Promise<any> {
    this.callCount += 1
    const idx = Math.min(this.callCount - 1, this.scripts.length - 1)
    const script = this.scripts[idx]

    return new AIMessage({
      content: script.content,
      tool_calls: script.tool_calls as any,
    })
  }

  bindTools(_tools: any[]): any {
    return this
  }

  bind(_opts: any): any {
    return this
  }
}

// ============================================================
// 计数 CodeExecutorTool：验证审批通过后才真正执行
// ============================================================

class CountingCodeExecutorTool extends CodeExecutorTool {
  public invokeCount = 0

  async invoke(
    params: Record<string, any>,
    context: Record<string, any>,
  ): Promise<Record<string, any>> {
    this.invokeCount += 1
    return super.invoke(params, context)
  }
}

// ============================================================
// 测试辅助：构建图并触发 HITL interrupt
// ============================================================

async function buildHitlGraph(): Promise<{
  compiled: any
  mockLlm: HitlMockLlm
  codeTool: CountingCodeExecutorTool
}> {
  const mockLlm = new HitlMockLlm()
  const codeTool = new CountingCodeExecutorTool()

  const config = getConfig()
  const structured = wrap_modu_tool(codeTool, config)
  const tools = [structured]
  const boundLlm = mockLlm.bindTools(tools)

  // HITL 开启（hitlEnabled=true），其余开关关闭，纯单 Agent ReAct + human_review
  const compiled = buildModuGraph(
    tools,
    boundLlm,
    new MemorySaver(), // 使用内存 checkpointer（中断/恢复必需）
    null,              // 无 store
    'You are a helpful AI assistant.',
    null,              // 默认 recursionLimit
    null,              // 无 orchestrator
    true,              // HITL 开启
    false,             // multi_agent 关闭
    null,              // 无 judgeLlm
    false,             // plan_execute 关闭
    null,              // 无 rawLlm
    null,              // 无 complexityAssessor
    null,              // 无 observationDistiller
  )

  return { compiled, mockLlm, codeTool }
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

// ============================================================
// 测试用例
// ============================================================

describe('HITL 端到端：敏感工具审批流程', () => {
  let restoreHandle: { restore: () => void } | null = null

  beforeEach(() => {
    resetConfig()
    // 启用 HITL：sensitive_tools 含 code_executor
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

  it('敏感工具调用触发 interrupt 暂停，resume 批准后工具执行并产出终答', async () => {
    const { compiled, mockLlm, codeTool } = await buildHitlGraph()
    const threadId = 'hitl-approve-thread'

    // 1. 首次 invoke 命中 human_review interrupt。
    // 注：LangGraph JS 0.2.74 中非嵌套顶层图的 interrupt 被抑制（不抛异常），
    //     invoke 返回暂停态，需通过 get_interrupt_state 检测暂停。
    await compiled.invoke(makeInitialState(threadId), { configurable: { thread_id: threadId } })

    // 2. interrupt 前工具未执行
    expect(codeTool.invokeCount).toBe(0)

    // 3. get_interrupt_state 能查询到暂停状态
    const pendingState = await get_interrupt_state(compiled, threadId)
    expect(pendingState).not.toBeNull()
    expect(pendingState!.next_nodes).toContain('human_review')
    expect(pendingState!.session_id).toBe(threadId)

    // 4. resume 批准（approved=true）→ 工具执行 → 终答
    const result = await resume_sync(compiled, threadId, true, 'test approved')
    expect(result.status).toBe('success')
    expect(result.error_code).toBe('')
    expect(result.data.approval_status).toBe('approved')

    // 5. 批准后 code_executor 真正执行 1 次
    expect(codeTool.invokeCount).toBe(1)

    // 6. LLM 第 2 轮产出终答
    expect(mockLlm.callCount).toBeGreaterThanOrEqual(2)
    expect(String(result.data.response ?? '')).toContain('处理完毕')
  }, 30000)

  it('resume 拒绝走降级路径（TOOL_APPROVAL_REJECTED），工具不执行', async () => {
    const { compiled, codeTool } = await buildHitlGraph()
    const threadId = 'hitl-reject-thread'

    // 1. 首次 invoke 命中 interrupt（非嵌套图 interrupt 被抑制，invoke 返回暂停态）
    await compiled.invoke(makeInitialState(threadId), { configurable: { thread_id: threadId } })

    // 2. 确认处于暂停态
    const pendingState = await get_interrupt_state(compiled, threadId)
    expect(pendingState).not.toBeNull()

    // 3. resume 拒绝（approved=false）→ 走降级路径，工具不执行
    const result = await resume_sync(compiled, threadId, false, 'test rejected')
    expect(result.status).toBe('success')
    expect(result.data.approval_status).toBe('rejected')
    expect(codeTool.invokeCount).toBe(0)

    // 3. 拒绝路径仍产出终答（从状态消息中可读到 TOOL_APPROVAL_REJECTED）
    const graphState = await compiled.getState({ configurable: { thread_id: threadId } })
    const messages = graphState?.values?.messages ?? []
    const lastMsg = messages[messages.length - 1]
    expect(String(lastMsg?.content ?? '')).toContain('TOOL_APPROVAL_REJECTED')
  }, 30000)
})
