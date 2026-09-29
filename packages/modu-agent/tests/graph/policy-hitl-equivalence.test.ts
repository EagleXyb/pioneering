// P1（T-10）审批判定等价矩阵（L10 门禁）。
//
// 核心不变量：`PolicyEngine.decide('tool')`（经 ToolApprovalPolicyRule 委派）
// 与直调 `decideToolApprovals` 的输出**逐工具逐字段一致**，
// 在 `action_guardrails.enabled` × `policy.engine.enabled` 四种组合下均成立。
//
// 同时做图级端到端校验：HITL 场景下 interrupt 载荷（待审批工具集合）不因
// 切换策略引擎而变化。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AIMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'

import { buildModuGraph } from '@/graph/graph.js'
import { getConfig, overrideConfig, RuntimeConfig, resetConfig } from '@/config/runtime-config.js'
import { CodeExecutorTool, DateTimeTool, FileOpsTool } from '@/tools/index.js'
import { wrap_modu_tool } from '@/graph/adapters/tool-adapter.js'
import { get_interrupt_state } from '@/graph/runner.js'
import { getRegistry } from '@/core/registry.js'
import type { ModuAgentState } from '@/graph/state.js'
import {
  decideToolApprovals,
  type DecideToolApprovalsOptions,
} from '@/tools/tool-guardrails.js'
import { ToolApprovalPolicyRule } from '@/perception/security/policy-rules.js'

// ---------------------------------------------------------------------------
// 函数层：等价矩阵
// ---------------------------------------------------------------------------

/** 自定义工具策略 stub：file_ops 的 requiresApprovalFor 恒为 false（用于隔离 guardrail 分支）。 */
function stubRegistry(): any {
  return {
    getTool: (name: string) => {
      if (name === 'file_ops') {
        return { requiresApprovalFor: () => false }
      }
      if (name === 'code_executor') {
        return { requiresApprovalFor: () => true }
      }
      return undefined
    },
  }
}

const TOOL_CALLS: Array<Record<string, any>> = [
  // guardrail 命中（guard_file_ops_delete）+ 工具策略 false → 仅 guardrails 开启时需审批
  { id: 'c1', name: 'file_ops', args: { op: 'delete', path: 'x.txt' } },
  // 敏感工具列表命中
  { id: 'c2', name: 'code_executor', args: { code: 'print(1)' } },
  // 无任何命中
  { id: 'c3', name: 'datetime', args: {} },
  // 敏感工具列表未包含 + 工具策略 true
  { id: 'c4', name: 'file_ops', args: { op: 'read', path: 'x.txt' } },
]

function buildOpts(guardrailsEnabled: boolean): DecideToolApprovalsOptions {
  return {
    guardrailsEnabled,
    guardrailDryRun: true,
    sensitiveTools: ['code_executor'],
    registry: stubRegistry(),
    approvalContext: { user_id: 'u1', session_id: 's1', trace_id: 't1' },
  }
}

async function decideViaPolicy(
  toolCalls: Array<Record<string, any>>,
  opts: DecideToolApprovalsOptions,
): Promise<Array<Record<string, any>>> {
  const engine = getRegistry().getPolicyEngine()
  const decision = await engine.decide(
    'tool',
    { kind: 'tool', toolCalls },
    {
      userId: opts.approvalContext?.['user_id'],
      sessionId: opts.approvalContext?.['session_id'],
      traceId: opts.approvalContext?.['trace_id'],
      registry: opts.registry,
      sensitiveTools: opts.sensitiveTools,
      guardrailsEnabled: opts.guardrailsEnabled,
      guardrailDryRun: opts.guardrailDryRun,
    },
  )
  return (decision.details ?? []) as Array<Record<string, any>>
}

describe('P1-T10 · 审批判定等价矩阵（action_guardrails × policy.engine）', () => {
  beforeEach(() => {
    // 幂等：确保 tool_approval 规则已注册（同 id 覆盖）
    getRegistry().registerPolicyRule(new ToolApprovalPolicyRule())
  })

  for (const guardrailsEnabled of [false, true]) {
    for (const policyEngineEnabled of [false, true]) {
      it(`guardrails=${guardrailsEnabled} / engine=${policyEngineEnabled} → 输出逐字段一致`, async () => {
        const opts = buildOpts(guardrailsEnabled)
        const direct = decideToolApprovals(TOOL_CALLS, opts)
        const viaPolicy = await decideViaPolicy(TOOL_CALLS, opts)

        expect(viaPolicy).toEqual(direct)
        // 结构断言：确保 matrix 真的区分了 guardrails 开关
        expect(viaPolicy).toHaveLength(TOOL_CALLS.length)
        expect(viaPolicy.every((d) => typeof d.requiresApproval === 'boolean')).toBe(true)
      })
    }
  }

  it('guardrails 开关确实影响 c1（file_ops delete）的判定来源', async () => {
    const off = await decideViaPolicy(TOOL_CALLS, buildOpts(false))
    const on = await decideViaPolicy(TOOL_CALLS, buildOpts(true))

    // 关闭：c1 既不命中 guardrail 也不在敏感列表，且 stub 的工具策略为 false → 无需审批
    expect(off[0]).toMatchObject({ toolCallId: 'c1', requiresApproval: false, source: 'none' })
    // 开启：c1 由 guardrail 命中决定（source=guardrail）
    expect(on[0]).toMatchObject({ toolCallId: 'c1', requiresApproval: true, source: 'guardrail' })
  })
})

// ---------------------------------------------------------------------------
// 图级：HITL interrupt 载荷不因策略引擎切换而漂移
// ---------------------------------------------------------------------------

/** 第 1 轮返回 file_ops 写 + datetime 调用，第 2 轮返回终答。 */
class HitlMockLlm {
  private callCount = 0
  private scripts = [
    {
      content: '需要写文件并查询时间。',
      tool_calls: [
        { id: 'call_file_write', name: 'file_ops', args: { op: 'write', path: 'out.txt', content: 'x' } },
        { id: 'call_datetime', name: 'datetime', args: {} },
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
  // 注意：prompt 刻意避开"文档生成"意图词（动作词 ∩ 目标词），
  // 否则 perception 会写入 task_type='document_generation' 并把路由导向 doc_gen_enforce。
  return {
    input_data: { prompt: '请处理 out.txt 并查询当前时间', input_type: 'text' },
    cleaned_text: '请处理 out.txt 并查询当前时间',
    session_id: threadId,
    user_id: 'test-user',
    trace_id: `trace-${threadId}`,
  }
}

describe('P1-T10 · 图级 interrupt 载荷等价', () => {
  let restoreHandle: { restore: () => void } | null = null

  beforeEach(() => {
    getRegistry().registerPolicyRule(new ToolApprovalPolicyRule())
  })

  afterEach(() => {
    if (restoreHandle) {
      restoreHandle.restore()
      restoreHandle = null
    }
    resetConfig()
  })

  async function runHitl(opts: {
    guardrailsEnabled: boolean
    policyEngineEnabled: boolean
    threadId: string
  }): Promise<any[]> {
    const cfg = new RuntimeConfig({
      tools: {
        human_in_loop: {
          enabled: true,
          approval_timeout_seconds: 300,
          auto_reject_on_timeout: true,
          sensitive_tools: ['code_executor'],
        },
      },
      react_optimization: {
        action_guardrails: { enabled: opts.guardrailsEnabled, dry_run_enabled: true },
      },
      policy: { engine: { enabled: opts.policyEngineEnabled } },
    })
    if (restoreHandle) restoreHandle.restore()
    restoreHandle = overrideConfig(cfg)

    // 关键：human_review 通过 `getRegistry().getTool(name).requiresApprovalFor(args)` 判定，
    // 故必须先把工具注册进（全局）注册表，否则 file_ops 与 datetime 一律判为"无需审批"。
    const fileOps = new FileOpsTool()
    const codeExec = new CodeExecutorTool()
    const datetime = new DateTimeTool()
    const reg = getRegistry()
    for (const t of [fileOps, codeExec, datetime]) {
      if (reg.getTool(t.name()) === undefined) reg.registerTool(t)
    }

    const tools = [
      wrap_modu_tool(fileOps, getConfig()),
      wrap_modu_tool(codeExec, getConfig()),
      wrap_modu_tool(datetime, getConfig()),
    ]
    const mockLlm = new HitlMockLlm()
    const compiled = buildModuGraph(
      tools,
      mockLlm.bindTools(tools),
      new MemorySaver(),
      null,
      'You are a helpful AI assistant.',
      null,
      null,
      true,   // HITL 开启
      false,
      null,
      false,
      null,
      null,
      null,
      null,
      null,   // memoryStrategyResolver（P1-T11，null=store 直连）
    )

    await compiled.invoke(makeInitialState(opts.threadId), {
      configurable: { thread_id: opts.threadId },
    })

    const pending = await get_interrupt_state(compiled, opts.threadId)
    return (pending?.pending_tool_calls ?? []) as any[]
  }

  it('四种组合下 interrupt 待审批工具集合一致', async () => {
    const baseline = await runHitl({
      guardrailsEnabled: false,
      policyEngineEnabled: false,
      threadId: 'eq-off-off',
    })
    expect(baseline.map((c) => c.name)).toEqual(['file_ops'])

    const combos = [
      { guardrailsEnabled: false, policyEngineEnabled: true, threadId: 'eq-off-on' },
      { guardrailsEnabled: true, policyEngineEnabled: false, threadId: 'eq-on-off' },
      { guardrailsEnabled: true, policyEngineEnabled: true, threadId: 'eq-on-on' },
    ]

    for (const combo of combos) {
      const pending = await runHitl(combo)
      expect({
        names: pending.map((c) => c.name),
        args: pending.map((c) => c.args),
      }).toEqual({
        names: baseline.map((c) => c.name),
        args: baseline.map((c) => c.args),
      })
    }
  }, 60000)
})
