// P0（T-06）自动派生能力的"隔离性"回归测试。
//
// 缺陷背景（P1 复查发现）：
//   `ensureToolCapability` 为所有未登记工具（MCP / Skill / 宿主自定义）派生
//   `requires_confirmation: true` 的**保守标注**。该标注随后被两处**判定逻辑**采信：
//     ① `tool-guardrails.checkGuardrail` 的第二层回退 → 需审批
//     ② `tool-orchestrator.hasDependency`            → 视为写操作、强制串行
//   结果：相对 T-06 之前（能力未知 → 不命中任何判定）产生**行为漂移**：
//     · `action_guardrails.enabled=true` 时所有第三方工具被强制审批
//       （且与 MCP 工具自身 `requiresApproval()=false` 的契约冲突）；
//     · `parallel_tools.enabled=true` 时任意两个第三方工具被判为有依赖而串行。
//
// 修复：派生条目标记 `derived: true`，并通过 `isExplicitlyConfirmRequired`
// 让两处判定**仅采信显式声明**（内置 7 项 + `registerToolCapability`）。
//
// 本测试锁定该隔离语义：派生 = 仅供"能力已知"与 task_type 过滤，不参与判定。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  TOOL_CAPABILITY_MATRIX,
  ensureToolCapability,
  registerToolCapability,
  getToolCapability,
  isExplicitlyConfirmRequired,
  type ToolCapability,
} from '@/tools/tool-registry.js'
import { checkGuardrail } from '@/tools/tool-guardrails.js'
import { hasDependency, type ToolCallItem } from '@/graph/adapters/tool-orchestrator.js'

/** 由 ensureToolCapability 派生的工具名（模拟 MCP / Skill 工具）。 */
const DERIVED_TOOL = 'mcp_derived_tool'
/** 宿主显式注册、声明需要审批的工具名。 */
const EXPLICIT_TOOL = 'explicit_confirm_tool'

function cleanup(): void {
  delete TOOL_CAPABILITY_MATRIX[DERIVED_TOOL]
  delete TOOL_CAPABILITY_MATRIX[EXPLICIT_TOOL]
}

function makeCall(id: string, name: string): ToolCallItem {
  return { id, name, args: {} }
}

beforeEach(cleanup)
afterEach(cleanup)

describe('T-06 派生条目：不参与审批判定（checkGuardrail 第二层）', () => {
  it('派生条目标记 derived=true，但保守标注仍为 true', () => {
    expect(ensureToolCapability(DERIVED_TOOL)).toBe(true)
    const cap = getToolCapability(DERIVED_TOOL)
    expect(cap?.derived).toBe(true)
    expect(cap?.requires_confirmation).toBe(true)
    expect(cap?.task_types).toEqual(['default'])
  })

  it('派生条目不触发 guardrail 第二层回退（等价 T-06 之前的"能力未知"）', () => {
    ensureToolCapability(DERIVED_TOOL)
    const r = checkGuardrail(DERIVED_TOOL, {})
    expect(r.hit).toBe(false)
  })

  it('宿主显式声明 requires_confirmation=true 的工具仍触发第二层回退', () => {
    registerToolCapability({
      name: EXPLICIT_TOOL,
      task_types: ['default'],
      requires_confirmation: true,
    })
    const r = checkGuardrail(EXPLICIT_TOOL, {})
    expect(r.hit).toBe(true)
    expect(r.rule?.rule_id).toBe(`matrix_${EXPLICIT_TOOL}`)
  })

  it('内置 7 项的既有判定不受影响（file_ops 仍命中矩阵层）', () => {
    const r = checkGuardrail('file_ops', { op: 'read', path: '/tmp' })
    expect(r.hit).toBe(true)
    expect(r.rule?.rule_id).toBe('matrix_file_ops')
  })

  it('decideToolApprovals：派生工具不被判为需审批（source=none）', async () => {
    const { decideToolApprovals } = await import('@/tools/tool-guardrails.js')
    ensureToolCapability(DERIVED_TOOL)

    const decisions = decideToolApprovals(
      [{ id: 'c1', name: DERIVED_TOOL, args: {} }],
      {
        guardrailsEnabled: true,
        guardrailDryRun: true,
        sensitiveTools: [],
        registry: null,
        approvalContext: { user_id: 'u1', session_id: 's1', trace_id: 't1' },
      },
    )

    expect(decisions).toEqual([
      {
        toolCallId: 'c1',
        toolName: DERIVED_TOOL,
        requiresApproval: false,
        source: 'none',
      },
    ])
  })
})

describe('T-06 派生条目：不参与依赖判定（hasDependency）', () => {
  it('两个派生工具不因"保守标注"被判为有依赖（等价 T-06 之前）', () => {
    ensureToolCapability(DERIVED_TOOL)
    ensureToolCapability('mcp_derived_tool_2')
    try {
      expect(hasDependency(makeCall('1', DERIVED_TOOL), makeCall('2', 'mcp_derived_tool_2'))).toBe(false)
    } finally {
      delete TOOL_CAPABILITY_MATRIX['mcp_derived_tool_2']
    }
  })

  it('两个显式声明 requires_confirmation=true 的工具仍被判为有依赖', () => {
    expect(hasDependency(makeCall('1', 'file_ops'), makeCall('2', 'sql_query'))).toBe(true)
  })

  it('同名工具仍视为有依赖（既有规则不回退）', () => {
    expect(hasDependency(makeCall('1', DERIVED_TOOL), makeCall('2', DERIVED_TOOL))).toBe(true)
  })
})

describe('isExplicitlyConfirmRequired 语义', () => {
  it('派生条目 / 未声明 / null 均返回 false', () => {
    ensureToolCapability(DERIVED_TOOL)
    expect(isExplicitlyConfirmRequired(getToolCapability(DERIVED_TOOL))).toBe(false)
    expect(isExplicitlyConfirmRequired(null)).toBe(false)
    expect(isExplicitlyConfirmRequired({ name: 'x', task_types: [] } as ToolCapability)).toBe(false)
  })

  it('显式声明 requires_confirmation=true 返回 true', () => {
    expect(isExplicitlyConfirmRequired({
      name: 'x',
      task_types: [],
      requires_confirmation: true,
    })).toBe(true)
  })

  it('显式覆盖派生条目后（derived=false）可参与判定', () => {
    ensureToolCapability(DERIVED_TOOL)
    // 宿主显式注册同名词条 → 覆盖派生条目，derived 标记随之消失
    registerToolCapability({
      name: DERIVED_TOOL,
      task_types: ['default'],
      requires_confirmation: true,
    })
    expect(getToolCapability(DERIVED_TOOL)?.derived).toBeUndefined()
    expect(isExplicitlyConfirmRequired(getToolCapability(DERIVED_TOOL))).toBe(true)
    expect(checkGuardrail(DERIVED_TOOL, {}).hit).toBe(true)
  })
})
