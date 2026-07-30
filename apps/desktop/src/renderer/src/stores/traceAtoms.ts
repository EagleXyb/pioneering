// ============================================================
// Trace Atoms (Jotai)
// 使用 atomFamily 为每个 TraceNode 维护独立折叠状态，
// 单节点展开/折叠不触发兄弟节点重渲染。
// ============================================================

import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import type { TraceNode } from '@shared/types'

/**
 * 默认展开策略（P2 优化：已完成/待处理步骤默认折叠）：
 * - error 节点：展开（方便看到错误信息）
 * - observation 节点：折叠（通常很长，按需展开）
 * - running 中的 thinking/tool-call：展开（实时看输出）
 * - completed thinking：折叠（节省空间）
 * - text 节点（最终回答）：始终展开
 * - completed/pending tool-call：折叠（默认展示标题即可）
 */
export function defaultExpandedForNode(node: TraceNode | undefined): boolean {
  if (!node) return false
  if (node.kind === 'text') return true
  if (node.status === 'error') return true
  if (node.status === 'running') return true
  // P2：observation / completed / pending 一律默认折叠
  return false
}

/**
 * 每个节点的展开 atom。key = nodeId。
 * 注意：atomFamily 会缓存 atom 实例；消息删除/会话切换时
 * 应调用 traceNodeExpandedAtom.remove(nodeId) 防止内存泄漏。
 */
export const traceNodeExpandedAtom = atomFamily((_nodeId: string) => atom<boolean>(true))

/** 全局折叠/展开触发（写 only）：批量设置多个节点的展开状态 */
export const traceSetExpandedBatchAtom = atom(
  null,
  (_get, set, args: { expanded: boolean; nodeIds: string[] }) => {
    for (const id of args.nodeIds) {
      set(traceNodeExpandedAtom(id), args.expanded)
    }
  }
)
