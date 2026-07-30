// ============================================================
// AgentTimeline — 时间线样式的 Agent 运行过程展示
// 对齐 WorkBuddy 视觉风格：
//   - 顶部状态行：图标 + "已完成/正在执行" + 耗时 + 下拉箭头
//   - 深度思考：左侧灰色竖线 + 浅灰文字（blockquote 风格）
//   - 工具步骤：工具中文名 + 参数摘要（如查询词）
//   - 搜索结果：直接展示为浅灰圆角卡片 + 彩色来源图标 + 标题列表
//   - 其他工具结果：智能判别（时间芯片 / 折叠JSON）
//   - 已完成步骤默认折叠，仅 running 自动展开
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
  Search,
  Globe,
  Clock,
  Code2
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

  const { overallStatus, totalDurationMs } = useMemo(() => {
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

    return { overallStatus: status, totalDurationMs: totalMs }
  }, [nodes, rootOrder, isStreaming])

  const statusText = {
    running: '正在执行',
    completed: '已完成',
    error: '执行出错'
  }[overallStatus]

  return (
    <div className="agent-timeline mb-3">
      {/* 顶部状态行 */}
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

// ---- 工具图标映射 ----
function ToolIcon({ toolName, isRunning, isError, className }: {
  toolName?: string
  isRunning: boolean
  isError: boolean
  className?: string
}) {
  const Icon = useMemo(() => {
    if (!toolName) return TerminalSquare
    const n = toolName.toLowerCase()
    if (n.includes('search') || n.includes('web_search') || n === 'news') return Search
    if (n.includes('fetch') || n.includes('url') || n.includes('browser')) return Globe
    if (n.includes('datetime') || n.includes('time') || n.includes('clock')) return Clock
    if (n.includes('python') || n.includes('code') || n.includes('execute')) return Code2
    return TerminalSquare
  }, [toolName])

  return (
    <Icon className={cn(
      'size-3 shrink-0',
      isRunning && 'animate-spin text-foreground/40',
      isError && 'text-destructive/70',
      !isRunning && !isError && 'text-foreground/30',
      className
    )} />
  )
}

// ---- 从工具参数中提取简短摘要（用于折叠标题） ----
function extractArgSummary(toolName: string | undefined, args: Record<string, unknown> | undefined): string | null {
  if (!args) return null
  const keys = ['query', 'q', 'keyword', 'keywords', 'search_query', 'question', 'prompt', 'url', 'pattern']
  for (const k of keys) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) {
      const t = v.trim()
      // 截断过长的摘要
      return t.length > 40 ? t.slice(0, 40) + '…' : t
    }
  }
  return null
}

// ---- 判断工具的observation结果是否可以"直接展示"（无需折叠整个步骤） ----
function isDirectlyVisibleResult(node: TraceNode, nodes: Record<string, TraceNode>): boolean {
  if (node.kind !== 'tool-call') return false
  // 如果子节点只有一个 observation 且内容是搜索结果/时间，则直接展示
  if (node.children.length === 0) return false
  for (const cid of node.children) {
    const child = nodes[cid]
    if (!child) continue
    if (child.kind === 'observation') {
      const raw = child.content ?? ''
      if (raw.includes('"results"') && raw.includes('"title"')) return true
      if (raw.includes('"datetime"')) return true
    }
  }
  return false
}

// ---- 单个时间线项目 ----
interface TimelineItemProps {
  node: TraceNode
  nodes: Record<string, TraceNode>
}

function TimelineItem({ node, nodes }: TimelineItemProps) {
  const isThinking = node.kind === 'thinking'
  const isObservation = node.kind === 'observation'
  const isToolCall = node.kind === 'tool-call'
  const isRunning = node.status === 'running'
  const isError = node.status === 'error'

  // 搜索/时间类工具：有结果后默认展开（因为结果直接可见，不冗长）
  const directVisible = isToolCall && isDirectlyVisibleResult(node, nodes) && node.status === 'completed'
  const [expanded, setExpanded] = useState(() => defaultExpanded(node, directVisible))

  useEffect(() => {
    if (isRunning) setExpanded(true)
    // 搜索/时间工具刚完成时也展开一下显示结果，后续可手动折叠
    if (node.status === 'completed' && directVisible) setExpanded(true)
  }, [node.status, directVisible])

  const hasChildren = node.children.length > 0

  const argSummary = isToolCall
    ? extractArgSummary(node.toolName, node.arguments)
    : null

  const hasContent = Boolean(
    node.content ||
    hasChildren ||
    (isToolCall && node.arguments && Object.keys(node.arguments).length > 0) ||
    (isToolCall && node.status === 'running')
  )

  // 标题
  const title = useMemo(() => {
    if (isThinking) return '深度思考'
    if (isObservation) return node.toolName ? `${getToolDisplayName(node.toolName)} · 结果` : '观察结果'
    if (isToolCall) {
      const name = getToolDisplayName(node.toolName || node.label || '工具调用')
      return argSummary ? `${name} ${argSummary}` : name
    }
    return node.label || node.kind
  }, [isThinking, isObservation, isToolCall, node.toolName, node.label, argSummary])

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
              isRunning && 'animate-pulse text-foreground/40',
              isError && 'text-destructive/70',
              !isRunning && !isError && 'text-foreground/30'
            )} />
          ) : isToolCall ? (
            <ToolIcon toolName={node.toolName} isRunning={isRunning} isError={isError} />
          ) : isObservation ? (
            <ChevronRight className="size-3 shrink-0 text-foreground/30" />
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
          <div className="mt-1">
            <NodeContent node={node} />
            {hasChildren && (
              <div className="mt-1 space-y-0">
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
  // 深度思考：WorkBuddy 风格 — 左侧灰色竖线 + 浅灰文字
  if (node.kind === 'thinking') {
    return (
      <div className="relative pl-3.5">
        <div className="absolute left-0 top-1 bottom-1 w-[2.5px] rounded-full bg-border/70" />
        <div className="text-[13px] text-foreground/45 leading-relaxed whitespace-pre-wrap break-words">
          {node.content}
          {node.status === 'running' && (
            <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-foreground/30 align-middle" aria-hidden>
              ▊
            </span>
          )}
        </div>
      </div>
    )
  }

  if (node.kind === 'tool-call') {
    // 搜索/时间等有直接可视化结果的工具，不显示参数区（结果会直接在子observation节点展示）
    const hasObservationWithResult = node.children.length > 0
    const hasArgs = node.arguments && Object.keys(node.arguments).length > 0
    const showArgs = hasArgs && !hasObservationWithResult

    return (
      <div className="space-y-1">
        {showArgs && (
          <div className="rounded-md bg-muted/20 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-foreground/25 mb-0.5">参数</div>
            <pre className="max-h-40 overflow-auto font-mono text-[11px] text-foreground/55 whitespace-pre-wrap break-all">
{JSON.stringify(node.arguments, null, 2)}
            </pre>
          </div>
        )}
        {!hasArgs && node.argumentsRaw && !hasObservationWithResult && (
          <div className="rounded-md bg-muted/20 px-2.5 py-1.5">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/40">
{node.argumentsRaw}
            </pre>
          </div>
        )}
        {node.status === 'running' && (
          <div className="flex items-center gap-1.5 text-[13px] text-foreground/40 pl-0.5">
            <Loader2 className="size-3 animate-spin" />
            <span>正在执行...</span>
          </div>
        )}
        {node.status === 'error' && node.errorMessage && (
          <div className="text-[13px] text-destructive/80 pl-0.5">{node.errorMessage}</div>
        )}
      </div>
    )
  }

  // observation：智能展示（搜索卡片/时间芯片/折叠JSON）
  if (node.kind === 'observation') {
    return <ObservationResult raw={node.content ?? ''} />
  }

  if (node.kind === 'error' && node.errorMessage) {
    return <div className="text-[13px] text-destructive/80 pl-0.5">{node.errorMessage}</div>
  }

  return null
}

// ---- 默认展开策略 ----
function defaultExpanded(node: TraceNode, directVisible: boolean): boolean {
  if (node.kind === 'text') return true
  if (node.status === 'error') return true
  if (node.status === 'running') return true
  if (node.kind === 'observation') return false
  if (node.kind === 'thinking' && node.status === 'completed') return false
  if (node.kind === 'tool-call' && node.status === 'completed') {
    return directVisible // 有可视化结果的工具默认展开
  }
  return false
}
