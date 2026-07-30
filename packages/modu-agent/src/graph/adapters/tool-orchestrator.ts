// P2-3: 动态工具编排（串行/并行/条件分支）（对应文档 §1.2 优化点 12 + §5.3 P2-3）
//
// 设计要点（对应风险 R-12 规避策略）：
//   1. 仅在 LLM 输出多个独立 tool_calls 时触发并行编排
//   2. 依赖关系不明确时保守串行（conservative_mode=true）
//   3. 复用 plan-execute/dispatcher.ts 的 _identifyReadySteps 依赖分析逻辑
//   4. 任一并行工具需 HITL 时整组阻塞（由 human_review 节点统一处理）
//   5. feature flag enable_parallel_tools 默认 false
//   6. 按 tool_call_id 聚合并保留顺序元数据
//
// 触发位置：
//   routeAfterAgent 中检测多 tool_calls 时，路由到 tool_orchestrator 节点
//   而非直接路由到 tools（ToolNode）
//
// 注意：
//   当前实现为"调度策略计算层"——根据 tool_calls 的依赖关系决定并行/串行分组，
//   实际执行仍委托给 ToolNode（避免重写工具调用逻辑）。
//   LangGraph Send API 的并行分发需在 graph.ts 中接入，
//   本模块仅提供分组策略与执行计划。

import { getToolCapability } from '../../tools/tool-registry.js'

/**
 * 工具调用项（从 AIMessage.tool_calls 解析）。
 */
export interface ToolCallItem {
  id: string
  name: string
  args: Record<string, any>
}

/**
 * 执行分组：同一组内的 tool_calls 可并行执行，不同组间串行。
 */
export interface ExecutionGroup {
  /** 组内工具调用（可并行） */
  tool_calls: ToolCallItem[]
  /** 组类型：parallel（可并行）/ serial（强制串行） */
  type: 'parallel' | 'serial'
  /** 组描述（用于日志） */
  description?: string
}

/**
 * 执行计划：由若干 ExecutionGroup 组成的串行序列。
 */
export interface ExecutionPlan {
  groups: ExecutionGroup[]
  /** 是否触发了并行编排（false 表示全部串行，等价现状） */
  has_parallel: boolean
  /** 总 tool_calls 数 */
  total_calls: number
}

/**
 * 判断两个工具调用是否有潜在依赖关系。
 *
 * 依赖推断规则（保守策略，对应 R-12 策略②）：
 *   1. 同名工具调用视为有依赖（可能修改同一资源）
 *   2. 写操作工具（requires_confirmation=true）之间视为有依赖
 *   3. 一个工具的输出可能作为另一个工具的输入（通过 args 中的占位符检测）
 *   4. 无法确定时默认有依赖（保守串行）
 *
 * @param a 工具调用 A
 * @param b 工具调用 B
 * @returns true 表示有依赖（应串行），false 表示无依赖（可并行）
 */
export function hasDependency(a: ToolCallItem, b: ToolCallItem): boolean {
  // 同名工具：可能操作同一资源，保守串行
  if (a.name === b.name) return true

  // 写操作工具之间：可能存在隐式数据依赖，保守串行
  const capA = getToolCapability(a.name)
  const capB = getToolCapability(b.name)
  if (capA?.requires_confirmation && capB?.requires_confirmation) {
    return true
  }

  // 检测 args 中的占位符引用（如 ${tool_call_id.output}）
  const argsStrA = JSON.stringify(a.args)
  const argsStrB = JSON.stringify(b.args)
  if (argsStrA.includes('${') || argsStrB.includes('${')) {
    return true
  }

  // 检测一个工具的 args 引用了另一个工具的 id（使用 call_ 前缀避免短 id 误匹配）
  // 仅当 id 以 call_ 前缀开头时才检测，避免数字 id 与数值参数混淆
  if (a.id.startsWith('call_') && b.id.startsWith('call_')) {
    if (argsStrA.includes(b.id) || argsStrB.includes(a.id)) {
      return true
    }
  }

  return false
}

/**
 * 构建依赖图并识别可并行的分组。
 *
 * 算法（复用 _identifyReadySteps 的思想）：
 *   1. 初始所有 tool_calls 为 pending
 *   2. 找出无相互依赖的 tool_calls 子集 → 一个并行组
 *   3. 移除已分组项，对剩余项重复步骤 2
 *   4. conservative_mode=true 时，依赖关系不明确则全部串行
 *
 * @param toolCalls 工具调用列表
 * @param conservativeMode 保守模式（依赖不明确时串行，默认 true）
 * @returns 执行计划
 */
export function planExecution(
  toolCalls: ToolCallItem[],
  conservativeMode: boolean = true,
): ExecutionPlan {
  if (toolCalls.length === 0) {
    return { groups: [], has_parallel: false, total_calls: 0 }
  }

  if (toolCalls.length === 1) {
    return {
      groups: [{ tool_calls: [toolCalls[0]], type: 'serial', description: 'single call' }],
      has_parallel: false,
      total_calls: 1,
    }
  }

  // 保守模式：任一对 tool_calls 有依赖则全部串行
  if (conservativeMode) {
    let anyDependency = false
    for (let i = 0; i < toolCalls.length; i++) {
      for (let j = i + 1; j < toolCalls.length; j++) {
        if (hasDependency(toolCalls[i], toolCalls[j])) {
          anyDependency = true
          break
        }
      }
      if (anyDependency) break
    }

    if (anyDependency) {
      return {
        groups: [{
          tool_calls: [...toolCalls],
          type: 'serial',
          description: 'conservative serial (dependency detected)',
        }],
        has_parallel: false,
        total_calls: toolCalls.length,
      }
    }
  }

  // 非保守模式：贪心分组
  // 找出最大的无依赖子集作为并行组，剩余的递归处理
  const groups: ExecutionGroup[] = []
  const remaining = [...toolCalls]

  while (remaining.length > 0) {
    if (remaining.length === 1) {
      groups.push({
        tool_calls: [remaining[0]],
        type: 'serial',
        description: 'tail call',
      })
      break
    }

    // 贪心：从 remaining 中找出最大独立集
    const independent: ToolCallItem[] = [remaining[0]]
    const dependent: ToolCallItem[] = []

    for (let i = 1; i < remaining.length; i++) {
      const tc = remaining[i]
      const hasDep = independent.some((indep) => hasDependency(indep, tc))
      if (hasDep) {
        dependent.push(tc)
      } else {
        independent.push(tc)
      }
    }

    if (independent.length > 1) {
      groups.push({
        tool_calls: independent,
        type: 'parallel',
        description: `parallel group (${independent.length} calls)`,
      })
    } else {
      groups.push({
        tool_calls: independent,
        type: 'serial',
        description: 'single call in group',
      })
    }

    remaining.length = 0
    remaining.push(...dependent)
  }

  const hasParallel = groups.some((g) => g.type === 'parallel')
  return {
    groups,
    has_parallel: hasParallel,
    total_calls: toolCalls.length,
  }
}

/**
 * 从 AIMessage 的 tool_calls 字段解析 ToolCallItem 列表。
 *
 * @param rawToolCalls AIMessage.tool_calls 原始字段
 * @returns 解析后的工具调用列表
 */
export function parseToolCalls(rawToolCalls: any[]): ToolCallItem[] {
  if (!Array.isArray(rawToolCalls)) return []
  return rawToolCalls.map((tc: any) => ({
    id: String(tc?.id ?? tc?.['id'] ?? ''),
    name: String(tc?.name ?? tc?.['name'] ?? ''),
    args: (tc?.args ?? tc?.['args'] ?? {}) as Record<string, any>,
  }))
}

/**
 * 判断是否应触发并行编排。
 *
 * 触发条件：
 *   1. tool_calls 数量 >= 2
 *   2. feature flag enable_parallel_tools 已启用
 *   3. 执行计划中存在并行组
 *
 * @param toolCalls 工具调用列表
 * @param enabled feature flag 状态
 * @param conservativeMode 保守模式
 * @returns 是否应触发并行编排
 */
export function shouldOrchestrate(
  toolCalls: ToolCallItem[],
  enabled: boolean,
  conservativeMode: boolean = true,
): boolean {
  if (!enabled || toolCalls.length < 2) return false
  const plan = planExecution(toolCalls, conservativeMode)
  return plan.has_parallel
}

/**
 * 格式化执行计划为日志字符串。
 */
export function formatExecutionPlan(plan: ExecutionPlan): string {
  const parts: string[] = []
  parts.push(`ExecutionPlan: ${plan.total_calls} calls, ${plan.groups.length} groups, parallel=${plan.has_parallel}`)
  for (let i = 0; i < plan.groups.length; i++) {
    const g = plan.groups[i]
    const names = g.tool_calls.map((tc) => tc.name).join(', ')
    parts.push(`  [${i}] ${g.type}: ${names} (${g.description ?? ''})`)
  }
  return parts.join('\n')
}
