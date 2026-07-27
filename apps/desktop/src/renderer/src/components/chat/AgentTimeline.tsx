// ============================================================
// AgentTimeline — 时间线样式的 Agent 运行过程展示
// 替代 TraceTreeRenderer 的卡片堆叠样式，采用左侧竖线的
// 简洁时间线布局，更贴合深度思考产品的视觉语言。
//
// 结构：
//   ┌─ 顶部状态行：状态 + 总耗时 + 下拉箭头（可折叠整体）
//   ├─ 思考块：左侧竖线 + "深度思考" 折叠标题 + 思考内容
//   ├─ 工具块：左侧竖线 + 工具名 + 折叠内容（参数/结果）
//   └─ 观察节点：工具节点的子节点，展示返回结果
// ============================================================

import { useState, useEffect, useMemo } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  CircleAlert,
  Brain,
  TerminalSquare,
  Eye
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TraceNode } from '@shared/types'
import { formatDuration } from '@/lib/trace-utils'

interface AgentTimelineProps {
  nodes: Record<string, TraceNode>
  rootOrder: string[]
  isStreaming?: boolean
}

export function AgentTimeline({ nodes, rootOrder, isStreaming = false }: AgentTimelineProps) {
  const [expanded, setExpanded] = useState(true)

  const { overallStatus, totalDurationMs, stepCount } = useMemo(() => {
    const visibleNodes = rootOrder
      .map((id) => nodes[id])
      .filter((n): n is TraceNode => !!n && n.kind !== 'text')

    let totalMs = 0
    let runningCount = 0
    let errorCount = 0

    for (const n of visibleNodes) {
      const start = n.startTime ?? 0
      const end = n.endTime ?? (n.status === 'running' ? Date.now() : start)
      const dur = n.durationMs ?? (start && end ? end - start : 0)
      totalMs += dur ?? 0
      if (n.status === 'running') runningCount++
      if (n.status === 'error') errorCount++
    }

    const status: 'running' | 'completed' | 'error' =
      errorCount > 0 ? 'error' : runningCount > 0 ? 'running' : 'completed'

    return {
      overallStatus: status,
      totalDurationMs: totalMs,
      stepCount: visibleNodes.length
    }
  }, [nodes, rootOrder, isStreaming])

  const statusText = {
    running: '正在执行',
    completed: '已完成',
    error: '执行出错'
  }[overallStatus]

  return (
    <div className="agent-timeline mb-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-1 py-1 text-left text-sm transition-colors hover:bg-accent/20 rounded -mx-1 px-1"
      >
        {overallStatus === 'running' ? (
          <Loader2 className="size-3.5 animate-spin text-foreground/70 shrink-0" />
        ) : overallStatus === 'error' ? (
          <CircleAlert className="size-3.5 text-destructive shrink-0" />
        ) : (
          <CheckCircle2 className="size-3.5 text-foreground/60 shrink-0" />
        )}
        <span className="font-medium text-foreground/70">{statusText}</span>
        {totalDurationMs > 0 && (
          <span className="text-sm text-foreground/50 font-mono tabular-nums">
            {formatDuration(totalDurationMs)}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="size-3.5 ml-0.5 text-foreground/40 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 ml-0.5 text-foreground/40 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-1 pl-0.5">
          {rootOrder.map((nodeId) => {
            const node = nodes[nodeId]
            if (!node || node.kind === 'text') return null
            return <TimelineItem key={nodeId} node={node} nodes={nodes} />
          })}
        </div>
      )}
    </div>
  )
}

// ---- 单个时间线项目 ----
interface TimelineItemProps {
  node: TraceNode
  nodes: Record<string, TraceNode>
}

function TimelineItem({ node, nodes }: TimelineItemProps) {
  const [expanded, setExpanded] = useState(() => defaultExpanded(node))

  useEffect(() => {
    if (node.status === 'running') setExpanded(true)
  }, [node.status])

  const hasChildren = node.children.length > 0
  const isRunning = node.status === 'running'
  const isError = node.status === 'error'
  const hasContent = Boolean(
    node.content ||
    hasChildren ||
    (node.kind === 'tool-call' && node.arguments && Object.keys(node.arguments).length > 0) ||
    (node.kind === 'tool-call' && node.status === 'running')
  )

  const isThinking = node.kind === 'thinking'

  const title = useMemo(() => {
    if (node.kind === 'thinking') return '深度思考'
    if (node.kind === 'tool-call') return node.toolName || node.label || '工具调用'
    if (node.kind === 'observation') return node.toolName ? `${node.toolName} · 结果` : '观察结果'
    return node.label || node.kind
  }, [node.kind, node.label, node.toolName])

  const durationMs =
    node.durationMs ??
    (node.startTime && node.endTime ? node.endTime - node.startTime : undefined)

  return (
    <div className="flex gap-2">
      <div className="flex flex-col items-center w-4 shrink-0">
        <div
          className={cn(
            'size-2.5 rounded-full border-2 bg-background shrink-0 mt-[6px]',
            isRunning && 'border-foreground/50',
            isError && 'border-destructive',
            !isRunning && !isError && 'border-foreground/20'
          )}
        />
        {(hasContent || hasChildren) && (
          <div className="w-px flex-1 bg-border/60 mt-1" />
        )}
      </div>

      <div className="flex-1 min-w-0 pb-2.5">
        <button
          type="button"
          onClick={() => hasContent && setExpanded((v) => !v)}
          className={cn(
            'flex w-full items-center gap-1.5 text-left py-0.5 transition-colors rounded -mx-1 px-1 min-h-[22px]',
            hasContent && 'hover:bg-accent/20 cursor-pointer',
            !hasContent && 'cursor-default'
          )}
        >
          {isThinking ? (
            <Brain className={cn(
              'size-3 shrink-0',
              isRunning && 'animate-spin text-foreground/60',
              isError && 'text-destructive',
              !isRunning && !isError && 'text-foreground/40'
            )} />
          ) : node.kind === 'tool-call' ? (
            <TerminalSquare className={cn(
              'size-3 shrink-0',
              isRunning && 'animate-spin text-foreground/60',
              isError && 'text-destructive',
              !isRunning && !isError && 'text-foreground/40'
            )} />
          ) : node.kind === 'observation' ? (
            <Eye className="size-3 shrink-0 text-foreground/40" />
          ) : null}
          <span
            className={cn(
              'text-sm font-medium flex-1',
              isError ? 'text-destructive' : 'text-foreground/75'
            )}
          >
            {title}
          </span>
          {durationMs !== undefined && durationMs > 0 && (
            <span className="text-xs text-foreground/40 font-mono tabular-nums shrink-0">
              {formatDuration(durationMs)}
            </span>
          )}
          {hasContent && (
            expanded ? (
              <ChevronDown className="size-3 text-foreground/40 shrink-0" />
            ) : (
              <ChevronRight className="size-3 text-foreground/40 shrink-0" />
            )
          )}
        </button>

        {expanded && hasContent && (
          <div className="mt-1.5">
            <NodeContent node={node} />
            {hasChildren && (
              <div className="mt-2 space-y-0">
                {node.children.map((childId) => {
                  const child = nodes[childId]
                  if (!child) return null
                  return <TimelineItem key={childId} node={child} nodes={nodes} />
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- 节点正文内容 ----
function NodeContent({ node }: { node: TraceNode }) {
  if (node.kind === 'thinking') {
    return (
      <div className="text-sm text-foreground/60 leading-relaxed whitespace-pre-wrap break-words">
        {node.content}
        {node.status === 'running' && (
          <span className="ml-0.5 inline-block h-4 w-1 animate-pulse bg-foreground/50 align-0.5" aria-hidden>
            ▊
          </span>
        )}
      </div>
    )
  }

  if (node.kind === 'tool-call') {
    const hasArgs = node.arguments && Object.keys(node.arguments).length > 0
    return (
      <div className="space-y-2">
        {hasArgs && (
          <div>
            <div className="text-[11px] uppercase tracking-wide text-foreground/30 mb-1">参数</div>
            <pre className="max-h-60 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[12px] text-foreground/70 whitespace-pre-wrap break-all">
{JSON.stringify(node.arguments, null, 2)}
            </pre>
          </div>
        )}
        {!hasArgs && node.argumentsRaw && (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-2 font-mono text-[12px] text-foreground/50">
{node.argumentsRaw}
          </pre>
        )}
        {node.status === 'running' && (
          <div className="flex items-center gap-1.5 text-sm text-foreground/50">
            <Loader2 className="size-3 animate-spin" />
            <span>正在执行...</span>
          </div>
        )}
        {node.status === 'error' && node.errorMessage && (
          <div className="text-sm text-destructive">{node.errorMessage}</div>
        )}
      </div>
    )
  }

  if (node.kind === 'observation') {
    const text = node.content ?? ''
    return (
      <div>
        <div className="text-[11px] uppercase tracking-wide text-foreground/30 mb-1">返回</div>
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 font-mono text-[12px] text-foreground/70">
{text || '(空结果)'}
        </pre>
      </div>
    )
  }

  if (node.kind === 'error' && node.errorMessage) {
    return <div className="text-sm text-destructive">{node.errorMessage}</div>
  }

  return null
}

// ---- 默认展开策略 ----
function defaultExpanded(node: TraceNode): boolean {
  if (node.kind === 'text') return true
  if (node.status === 'error') return true
  if (node.status === 'running') return true
  if (node.kind === 'observation') return false
  if (node.kind === 'thinking' && node.status === 'completed') return false
  if (node.kind === 'tool-call' && node.status === 'completed') return false
  return true
}
