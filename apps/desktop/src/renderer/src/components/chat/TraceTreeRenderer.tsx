// ============================================================
// TraceTreeRenderer — 递归渲染 TraceNode 树（支持任意深度嵌套）
// M6：替代 MessageBubble 中手写的平铺渲染，未来后端在 TOOL_CALL_START
// 中携带 parentCallId 时只需修改 stream-handler 的 parentId 赋值，
// UI 无需改动即可展示多层嵌套 Agent 调用（如工具调用子 Agent）。
// ============================================================

import { memo } from 'react'
import type { TraceNode } from '@shared/types'
import { TraceNodeView } from './TraceNodeView'

interface TraceTreeRendererProps {
  /** 节点 id 到节点的映射 */
  nodes: Record<string, TraceNode>
  /** 要渲染的根节点 id 有序列表 */
  rootIds: string[]
  /** 缩进层级（根为 0） */
  depth?: number
}

export const TraceTreeRenderer = memo(function TraceTreeRenderer({
  nodes,
  rootIds,
  depth = 0
}: TraceTreeRendererProps) {
  return (
    <div className={depth > 0 ? 'ml-4' : ''}>
      {rootIds.map((id) => {
        const node = nodes[id]
        if (!node) return null
        // text 节点不渲染外壳（最终回答由外层 Bubble 承载），但其子节点仍需递归
        if (node.kind === 'text') {
          return node.children.length > 0 ? (
            <TraceTreeRenderer
              key={id}
              nodes={nodes}
              rootIds={node.children}
              depth={depth}
            />
          ) : null
        }
        return (
          <TraceNodeView key={id} node={node}>
            <NodeChildrenOrContent node={node} nodes={nodes} depth={depth} />
          </TraceNodeView>
        )
      })}
    </div>
  )
})

/** 节点内部：如果有 children → 递归；否则按 kind 渲染默认内容 */
function NodeChildrenOrContent({
  node,
  nodes,
  depth
}: {
  node: TraceNode
  nodes: Record<string, TraceNode>
  depth: number
}) {
  // 若节点有显式子节点（嵌套 tool/obs），递归渲染子树
  if (node.children.length > 0) {
    return (
      <div className="space-y-0.5">
        {node.kind === 'tool-call' && node.arguments && Object.keys(node.arguments).length > 0 && (
          <div>
            <pre className="max-h-60 overflow-auto font-mono text-[11px] text-foreground/50">
{JSON.stringify(node.arguments, null, 2)}
            </pre>
          </div>
        )}
        <TraceTreeRenderer nodes={nodes} rootIds={node.children} depth={depth + 1} />
        {node.kind === 'tool-call' && node.status === 'running' && (
          <div className="flex items-center gap-1.5 pt-1 text-[13px] text-foreground/40">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground/30" />
            <span>正在执行...</span>
          </div>
        )}
        {node.kind === 'tool-call' && node.status === 'error' && node.errorMessage && (
          <div className="pt-1 text-[13px] text-destructive/80">{node.errorMessage}</div>
        )}
      </div>
    )
  }
  // 无子节点：让 TraceNodeView 使用默认 TraceNodeContent 渲染（传入 undefined children 即可）
  return undefined
}

/** 独立渲染 text 节点（最终回答），用于 MessageBubble BubbleContent 中 */
export const TraceTextNode = memo(function TraceTextNode({
  nodes,
  rootIds
}: {
  nodes: Record<string, TraceNode>
  rootIds: string[]
}) {
  for (const id of rootIds) {
    const n = nodes[id]
    if (n?.kind === 'text') {
      return <TraceNodeView node={n} />
    }
  }
  return null
})
