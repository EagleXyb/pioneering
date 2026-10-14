// Plan-and-Execute 端到端：HITL 暂停 → resume 后计划必须完整收敛
//
// 缺陷背景（实测会话 sess_2e7c1e18… / sess_d7185e5c…）：
// 任务在最后一步调用敏感工具触发人工审批 → 暂停 → resume 批准后，
// 图跑完 agent 却**没有回到 step_finalize**，导致：
//   - 该步永远停在 `running`（DB plan_steps / 前端面板均是）
//   - `plan_delta` 缺失 → 前端拿不到步骤终态
//   - 落库 metadata.plan_phase 只能标 `incomplete`
//
// 本测试用真实图（buildModuGraph + MemorySaver）复现该链路并锁定契约：
//   1. 计划 2 步，第 1 步调用敏感工具触发 interrupt；
//   2. resume(approved) 后工具执行、agent 产出正文；
//   3. **必须**经过 step_finalize：两步均进入终态、step_results 齐全；
//   4. 逐步骤轮次计数器 step_round_count 在每步结束后归零（P0-2）。
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
// Mock LLM
// ============================================================

/** planner 专用（未绑定工具）：返回固定的两步计划（英文便于断言，避免编码干扰） */
class PlannerMockLlm {
  public readonly planJson = JSON.stringify({
    goal: 'produce a research report',
    steps: [
      {
        step_id: 'step_1',
        title: 'run-validation',
        description: 'Call code_executor to run a validation snippet and record the output.',
        requires_tool: true,
      },
      {
        step_id: 'step_2',
        title: 'summarize',
        description: 'Based on the previous step output, state the conclusion in one paragraph.',
      },
    ],
  })

  async invoke(messages: any[]): Promise<any> {
    // 同一个"未绑定工具的 LLM"同时服务 planner 与 plan_summarize（P1-2 节点复用
    // rawLlm），靠系统提示区分职责——此处模拟真实模型的按指令分流。
    const sys = String(messages?.[0]?.content ?? '')
    if (sys.includes('你是任务汇总模块')) {
      return new AIMessage({
        content: 'FINAL_SUMMARY merged: STEP1_OUTPUT + STEP2_OUTPUT',
      })
    }
    return new AIMessage({ content: this.planJson })
  }

  bind(_opts: any): any {
    return this
  }

  bindTools(_tools: any[]): any {
    return this
  }
}

/** agent 专用：脚本化推理轮次（内容用英文，便于断言） */
class AgentMockLlm {
  public callCount = 0
  private scripts: Array<{ content: string; toolCalls?: any[] }> = [
    {
      content: 'Running a validation snippet first.',
      toolCalls: [{ id: 'call_code_1', name: 'code_executor', args: { code: 'print("ok")' } }],
    },
    { content: 'STEP1_OUTPUT sample_size=3 validation=passed' },
    { content: 'STEP2_OUTPUT conclusion=holds' },
  ]

  async invoke(_messages: any[]): Promise<any> {
    const script = this.scripts[Math.min(this.callCount, this.scripts.length - 1)]
    this.callCount += 1
    return new AIMessage({
      content: script.content,
      tool_calls: script.toolCalls as any,
    })
  }

  bind(_opts: any): any {
    return this
  }

  bindTools(_tools: any[]): any {
    return this
  }
}

class CountingCodeExecutorTool extends CodeExecutorTool {
  public invokeCount = 0

  async invoke(params: Record<string, any>, context: Record<string, any>): Promise<Record<string, any>> {
    this.invokeCount += 1
    return super.invoke(params, context)
  }
}

async function buildPlanExecuteGraph() {
  const plannerLlm = new PlannerMockLlm()
  const agentLlm = new AgentMockLlm()
  const codeTool = new CountingCodeExecutorTool()

  const config = getConfig()
  const tools = [wrap_modu_tool(codeTool, config)]
  const boundLlm = agentLlm.bindTools(tools)

  const compiled = buildModuGraph(
    tools,
    boundLlm,
    new MemorySaver(),
    null, // store
    'You are a helpful AI assistant.',
    null, // recursionLimit
    null, // orchestrator
    true, // hitlEnabled
    false, // multiAgentEnabled
    null, // judgeLlm
    true, // planExecuteEnabled
    plannerLlm, // rawLlm（planner 专用）
    null,
    null,
    null,
  )

  return { compiled, agentLlm, codeTool }
}

function makeInitialState(threadId: string): Partial<ModuAgentState> {
  return {
    input_data: { prompt: '请产出调研报告', input_type: 'text' },
    cleaned_text: '请产出调研报告',
    session_id: threadId,
    user_id: 'test-user',
    trace_id: `trace-${threadId}`,
  }
}

// ============================================================
// 测试
// ============================================================

describe('Plan-and-Execute 端到端：HITL resume 后计划收敛', () => {
  let restoreHandle: { restore: () => void } | null = null

  beforeEach(() => {
    resetConfig()
    restoreHandle = overrideConfig(
      new RuntimeConfig({
        tools: {
          human_in_loop: {
            enabled: true,
            approval_timeout_seconds: 300,
            auto_reject_on_timeout: true,
            sensitive_tools: ['code_executor'],
          },
        },
      }),
    )
  })

  afterEach(() => {
    restoreHandle?.restore()
    restoreHandle = null
    resetConfig()
  })

  it('resume 后两步全部进入终态，且逐步骤轮次计数器归零', async () => {
    const { compiled, agentLlm, codeTool } = await buildPlanExecuteGraph()
    const threadId = 'plan-hitl-resume-thread'

    // 1. 首次执行：planner 出计划 → step_1 调敏感工具 → human_review 暂停
    // 注意：必须透传 plan_execute_enabled=true —— routeAfterMemoryQuery 优先读
    // per-request configurable，仅在构建期打开 planExecuteEnabled 不足以进入 planner
    await compiled.invoke(makeInitialState(threadId), {
      configurable: { thread_id: threadId, plan_execute_enabled: true },
    })

    const paused = await get_interrupt_state(compiled, threadId)
    expect(paused).not.toBeNull()
    expect(paused!.next_nodes).toContain('human_review')
    expect(codeTool.invokeCount).toBe(0)

    // 2. 批准并恢复（同样透传 plan_execute_enabled，保持与中断时同一 profile）
    const result = await resume_sync(compiled, threadId, true, 'approved', 'trace-resume', {
      extraConfigurable: { plan_execute_enabled: true },
    })
    expect(result.status).toBe('success')
    expect(codeTool.invokeCount).toBe(1)

    // 3. 关键契约：resume 之后图必须真正走到 step_finalize，
    //    否则该步永远停在 running（实测缺陷的表现）。
    //    注意：从 checkpoint 读终态，而不是从 resume_sync 的返回值
    //    （后者只带 approval_status 等摘要字段）。
    const snapshot = await compiled.getState({ configurable: { thread_id: threadId } })
    const finalState: any = snapshot.values
    expect(finalState).toBeTruthy()

    const plan = finalState.plan ?? []
    expect(plan).toHaveLength(2)
    for (const step of plan) {
      expect(['done', 'skipped']).toContain(step.status)
    }
    // 不允许有步骤停留在 running / pending
    expect(plan.some((s: any) => s.status === 'running' || s.status === 'pending')).toBe(false)

    // 4. 每一步的产物都要进 step_results（且长度 > 0）
    const stepResults = finalState.step_results ?? []
    expect(stepResults).toHaveLength(2)
    for (const r of stepResults) {
      expect(String(r.output ?? '').length).toBeGreaterThan(0)
    }
    expect(String(stepResults[0].output)).toContain('STEP1_OUTPUT')
    expect(String(stepResults[1].output)).toContain('STEP2_OUTPUT')

    // 5. P0-2：逐步骤轮次计数器在每步结束后归零（而不是全 run 累加到触顶）
    expect(finalState.step_round_count ?? 0).toBe(0)

    // 6. agent 至少被调用 3 轮（step_1 工具轮 + step_1 产出 + step_2 产出）
    expect(agentLlm.callCount).toBeGreaterThanOrEqual(3)

    // 7. 最终答复来自 plan_summarize 的整合结果（覆盖各步骤产物，而非只有末步一句话）
    expect(String(finalState.response ?? '')).toContain('FINAL_SUMMARY')
  }, 30000)
})