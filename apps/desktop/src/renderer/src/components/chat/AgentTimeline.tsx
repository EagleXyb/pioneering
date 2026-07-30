// ============================================================
// AgentTimeline — 时间线样式的 Agent 运行过程展示
// P0/P1/P2 优化：对齐 WorkBuddy 视觉风格
//   - 工具名中文化（getToolDisplayName）
//   - observation 节点使用 ObservationResult 智能展示
//   - 已完成步骤默认折叠，仅 running 自动展开
//   - 更扁平、更轻盈的视觉风格
//
// 结构：
//   ┌─ 顶部状态行：状态 + 总耗时 + 下拉箭头（可折叠整体）
//   ├─ 思考块：左侧竖线 + "深度思考" 折叠标题 + 思考内容
//   ├─ 工具块：左侧竖线 + 工具中文名 + 折叠内容（参数/结果）
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
import { getToolDisplayName } from '@/lib/constants'
import type { TraceNode } from '@shared/types'
import { formatDuration } from '@/lib/trace-utils'
import { ObservationResult } from './ObservationResult'

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
      {/* 顶部状态行：WorkBuddy 风格 — 简洁灰文字 + 下拉箭头 */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 py-1 text-left text-[13px] transition-opacity hover:opacity-70"
      >
        {overallStatus === 'running' ? (
          <Loader2 className="size-3.5 animate-spin text-foreground/50 shrink-0" />
        ) : overallStatus === 'error' ? (
          <CircleAlert className="size-3.5 text-destructive/80 shrink-0" />
        ) : (
          <CheckCircle2 className="size-3.5 text-foreground/40 shrink-0" />
        )}
        <span className="text-foreground/50">{statusText}</span>
        {totalDurationMs > 0 && (
          <span className="text-foreground/40 font-mono tabular-nums">
            {formatDuration(totalDurationMs)}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="size-3.5 ml-0.5 text-foreground/30 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 ml-0.5 text-foreground/30 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-0.5">
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
    // P2：running 状态自动展开；完成后自动折叠
    if (node.status === 'running') {
      setExpanded(true)
    }
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

  // P1：工具名中文化
  const title = useMemo(() => {
    if (node.kind === 'thinking') return '深度思考'
    if (node.kind === 'tool-call') return getToolDisplayName(node.toolName || node.label || '工具调用')
    if (node.kind === 'observation') return node.toolName ? `${getToolDisplayName(node.toolName)} · 结果` : '观察结果'
    return node.label || node.kind
  }, [node.kind, node.label, node.toolName])

  const durationMs =
    node.durationMs ??
    (node.startTime && node.endTime ? node.endTime - node.startTime : undefined)

  return (
    <div className="flex gap-2">
      {/* 左侧时间线轨道 */}
      <div className="flex flex-col items-center w-4 shrink-0">
        <div
          className={cn(
            'size-2 rounded-full border shrink-0 mt-[7px]',
            isRunning && 'border-foreground/40 bg-foreground/10',
            isError && 'border-destructive/60 bg-destructive/10',
            !isRunning && !isError && 'border-foreground/20'
          )}
        />
        {(hasContent || hasChildren) && (
          <div className="w-px flex-1 bg-border/50 mt-1" />
        )}
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 min-w-0 pb-2">
        <button
          type="button"
          onClick={() => hasContent && setExpanded((v) => !v)}
          className={cn(
            'flex w-full items-center gap-1.5 text-left py-0.5 min-h-[22px]',
            hasContent && 'cursor-pointer hover:opacity-70 transition-opacity',
            !hasContent && 'cursor-default'
          )}
        >
          {isThinking ? (
            <Brain className={cn(
              'size-3 shrink-0',
              isRunning && 'animate-spin text-foreground/40',
              isError && 'text-destructive/70',
              !isRunning && !isError && 'text-foreground/30'
            )} />
          ) : node.kind === 'tool-call' ? (
            <TerminalSquare className={cn(
              'size-3 shrink-0',
              isRunning && 'animate-spin text-foreground/40',
              isError && 'text-destructive/70',
              !isRunning && !isError && 'text-foreground/30'
            )} />
          ) : node.kind === 'observation' ? (
            <Eye className="size-3 shrink-0 text-foreground/30" />
          ) : null}
          <span
            className={cn(
              'text-[13px] flex-1 truncate',
              isError ? 'text-destructive/80' : 'text-foreground/55'
            )}
          >
            {title}
          </span>
          {durationMs !== undefined && durationMs > 0 && (
            <span className="text-[11px] text-foreground/35 font-mono tabular-nums shrink-0">
              {formatDuration(durationMs)}
            </span>
          )}
          {hasContent && (
            expanded ? (
              <ChevronDown className="size-3 text-foreground/30 shrink-0" />
            ) : (
              <ChevronRight className="size-3 text-foreground/30 shrink-0" />
            )
          )}
        </button>

        {expanded && hasContent && (
          <div className="mt-1.5">
            <NodeContent node={node} />
            {hasChildren && (
              <div className="mt-1.5 space-y-0">
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
      <div className="text-[13px] text-foreground/50 leading-relaxed whitespace-pre-wrap break-words">
        {node.content}
        {node.status === 'running' && (
          <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-foreground/40 align-middle" aria-hidden>
            ▊
          </span>
        )}
      </div>
    )
  }

  if (node.kind === 'tool-call') {
    const hasArgs = node.arguments && Object.keys(node.arguments).length > 0
    return (
      <div className="space-y-1.5">
        {hasArgs && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-foreground/25 mb-0.5">参数</div>
            <pre className="max-h-40 overflow-auto rounded-md bg-muted/30 p-2 font-mono text-[11px] text-foreground/60 whitespace-pre-wrap break-all">
{JSON.stringify(node.arguments, null, 2)}
            </pre>
          </div>
        )}
        {!hasArgs && node.argumentsRaw && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/30 p-2 font-mono text-[11px] text-foreground/40">
{node.argumentsRaw}
          </pre>
        )}
        {node.status === 'running' && (
          <div className="flex items-center gap-1.5 text-[13px] text-foreground/40">
            <Loader2 className="size-3 animate-spin" />
            <span>正在执行...</span>
          </div>
        )}
        {node.status === 'error' && node.errorMessage && (
          <div className="text-[13px] text-destructive/80">{node.errorMessage}</div>
        )}
      </div>
    )
  }

  // P0：observation 节点使用 ObservationResult 智能展示，不再裸露原始 JSON
  if (node.kind === 'observation') {
    return <ObservationResult raw={node.content ?? ''} />
  }

  if (node.kind === 'error' && node.errorMessage) {
    return <div className="text-[13px] text-destructive/80">{node.errorMessage}</div>
  }

  return null
}

// ---- 默认展开策略（P2：已完成步骤默认折叠）----
function defaultExpanded(node: TraceNode): boolean {
  if (node.kind === 'text') return true
  if (node.status === 'error') return true
  if (node.status === 'running') return true
  // P2：已完成/待处理步骤默认折叠
  if (node.kind === 'observation') return false
  if (node.kind === 'thinking' && node.status === 'completed') return false
  if (node.kind === 'tool-call' && node.status === 'completed') return false
  return false
}
