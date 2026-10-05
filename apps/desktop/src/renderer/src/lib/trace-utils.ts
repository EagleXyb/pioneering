// ============================================================
// Trace 工具函数
// ============================================================

import type { TraceNode } from '@shared/types'

/** 任务监控「待办」项（由 plan-step TraceNode 映射而来） */
export interface PlanTodoItem {
  id: string
  text: string
  completed: boolean
}

/**
 * T3 修复（修复任务清单 T3 / 报告 §2.6）：
 * 把 Plan-and-Execute 的 plan-step TraceNode 映射为任务监控待办项——
 * 标题取节点 description（label/content），完成态取 status==='completed'
 * （running/pending/error 均为未完成）。按入参顺序输出并按 id 去重。
 */
export function planStepNodesToTodos(
  nodes: Array<TraceNode | undefined>
): PlanTodoItem[] {
  const todos: PlanTodoItem[] = []
  const seen = new Set<string>()
  for (const n of nodes) {
    if (!n || n.kind !== 'plan-step' || seen.has(n.id)) continue
    seen.add(n.id)
    todos.push({
      id: n.id,
      text: n.label || n.content || '计划步骤',
      completed: n.status === 'completed'
    })
  }
  return todos
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}
