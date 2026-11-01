// ============================================================
// AgentTimeline — WorkBuddy 风格的 Agent 运行过程展示
// 对齐截图视觉：
//   - 顶部状态行：图标 + "已完成/正在执行" + 耗时 + 下拉箭头（最右侧）
//   - 深度思考：灰色小标题，默认展开，内容左侧灰色竖线引用
//   - 工具步骤：工具图标 + 中文名/参数摘要，右侧耗时 + 下拉箭头
//   - 搜索结果：浅灰圆角卡片（由 ToolResultRenderer 渲染）
//   - 所有可折叠项使用统一的 grid 平滑动画
//   - 无左侧圆点时间线轨道，整体为缩进对齐的列表
// ============================================================

import { useState, useEffect, useMemo, useRef } from 'react'
import {
  ChevronRight,
  Loader2,
  TerminalSquare,
  Globe,
  Clock,
  Code2,
  Brain
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getToolDisplayName } from '@/lib/constants'
import type { TraceNode } from '@shared/types'
import { ObservationResult } from './ObservationResult'
import { MarkdownRenderer } from './MarkdownRenderer'

interface AgentTimelineProps {
  nodes: Record<string, TraceNode>
  rootOrder: string[]
  isStreaming?: boolean
}

/** 毫秒 → 「1 分 37 秒」/「8 秒」（对齐 web ProcessContainer 的摘要口径） */
function formatProcessTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}

export function AgentTimeline({ nodes, rootOrder, isStreaming = false }: AgentTimelineProps) {
  // 运行中展开；流式 → 终态自动收起为一行摘要（对齐 web ProcessContainer）
  const [expanded, setExpanded] = useState(isStreaming)
  const prevStreamingRef = useRef(isStreaming)
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) setExpanded(false)
    prevStreamingRef.current = isStreaming
  }, [isStreaming])

  // 运行中每秒刷新耗时（终态后停止，避免无意义重渲染）
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!isStreaming) return
    const timer = window.setInterval(() => setTick((v) => v + 1), 1000)
    return () => window.clearInterval(timer)
  }, [isStreaming])

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
  }, [nodes, rootOrder, isStreaming, tick])

  // 摘要措辞对齐 web：终态「已完成 · 耗时 X」；运行中「运行中 · 已用 X」
  const timePart =
    totalDurationMs > 0
      ? `${overallStatus === 'running' ? '已用' : '耗时'} ${formatProcessTime(totalDurationMs)}`
      : ''
  const statusText = {
    running: '运行中',
    completed: '已完成',
    error: '执行出错'
  }[overallStatus]
  const summary = `${statusText}${timePart ? ` · ${timePart}` : ''}`

  return (
    <div className="agent-timeline mb-2.5">
      {/* 顶部摘要行：状态 + 耗时 + 折叠箭头（内容宽度、行内排列，对齐 web 过程容器） */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`执行过程，${summary}`}
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 rounded-lg py-1 pl-0.5 pr-2 -ml-0.5',
          'text-[1rem] leading-6 text-muted-foreground select-none',
          'transition-colors hover:text-foreground hover:bg-accent'
        )}
      >
        {overallStatus === 'running' && (
          <span className="size-1.5 shrink-0 rounded-full bg-blue-500 animate-pulse" aria-hidden />
        )}
        <span className={cn('truncate', overallStatus === 'error' && 'text-destructive')}>
          {summary}
        </span>
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-200',
            expanded && 'rotate-90'
          )}
        />
      </button>

      {/* 内容区：平滑折叠动画 */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out',
          expanded
            ? 'grid-rows-[1fr] opacity-100 translate-y-0'
            : 'grid-rows-[0fr] opacity-0 -translate-y-[3px]'
        )}
        aria-hidden={!expanded}
        inert={!expanded ? true : undefined}
      >
        <div className="overflow-hidden min-h-0">
          <div className="flex flex-col gap-1.5 pt-0.5">
            {rootOrder.map((nodeId) => {
              const node = nodes[nodeId]
              if (!node || node.kind === 'text') return null
              return <TimelineItem key={nodeId} node={node} nodes={nodes} depth={0} />
            })}
          </div>
        </div>
      </div>
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
    if (n.includes('search') || n.includes('web_search') || n === 'news') return Globe
    if (n.includes('fetch') || n.includes('url') || n.includes('browser')) return Globe
    if (n.includes('datetime') || n.includes('time') || n.includes('clock')) return Clock
    if (n.includes('python') || n.includes('code') || n.includes('execute')) return Code2
    return TerminalSquare
  }, [toolName])

  return (
    <Icon className={cn(
      'size-3.5 shrink-0',
      isRunning && 'animate-pulse text-blue-500 dark:text-blue-400',
      isError && 'text-destructive/80',
      !isRunning && !isError && 'text-muted-foreground',
      className
    )} />
  )
}

// ---- 从工具参数中提取简短摘要（用于折叠标题） ----
// 支持：嵌套对象递归、数组拼接、更多关键词 key、兜底第一个字符串参数
function extractArgSummary(_toolName: string | undefined, args: Record<string, unknown> | undefined): string | null {
  if (!args) return null
  const preferredKeys = [
    'query', 'q', 'keyword', 'keywords', 'search_query', 'searchQuery', 'search_term', 'searchTerm',
    'question', 'prompt', 'input', 'text', 'content', 'title', 'topic', 'subject',
    'url', 'urls', 'pattern', 'path', 'file', 'filepath', 'name', 'target', 'operation',
    'action', 'request', 'command'
  ]

  // 1. 优先在顶层按偏好 key 顺序查找（匹配到字符串/字符串数组即用）
  for (const k of preferredKeys) {
    if (!(k in args)) continue
    const v = args[k]
    const s = stringifyValue(v)
    if (s) return s
  }

  // 2. 递归搜索嵌套对象中的偏好 key（最多两层）
  for (const k of Object.keys(args)) {
    const v = args[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nested = v as Record<string, unknown>
      for (const pk of preferredKeys) {
        if (pk in nested) {
          const s = stringifyValue(nested[pk])
          if (s) return s
        }
      }
    }
  }

  // 3. 兜底：找到第一个非空字符串参数（排除明显技术字段）
  const skipKeys = new Set(['id', 'type', 'format', 'mode', 'version', 'token', 'api_key', 'apikey', 'session', 'callback'])
  for (const k of Object.keys(args)) {
    if (skipKeys.has(k)) continue
    const v = args[k]
    if (typeof v === 'string' && v.trim() && !/^(true|false|null)$/.test(v.trim())) {
      const t = v.trim()
      return t.length > 50 ? t.slice(0, 50) + '…' : t
    }
  }
  return null

  function stringifyValue(v: unknown): string | null {
    if (typeof v === 'string') {
      const t = v.trim()
      if (!t) return null
      return t.length > 50 ? t.slice(0, 50) + '…' : t
    }
    if (Array.isArray(v)) {
      const parts = v
        .map((x) => typeof x === 'string' ? x.trim() : (x != null ? String(x) : ''))
        .filter(Boolean)
      if (parts.length === 0) return null
      const joined = parts.join(' ')
      return joined.length > 50 ? joined.slice(0, 50) + '…' : joined
    }
    if (v && typeof v === 'object') return null // 嵌套对象不直接用，在上层递归处理
    return null
  }
}

// ---- 单个时间线项目 ----
interface TimelineItemProps {
  node: TraceNode
  nodes: Record<string, TraceNode>
  depth: number
}

function TimelineItem({ node, nodes, depth }: TimelineItemProps) {
  const isThinking = node.kind === 'thinking'
  const isObservation = node.kind === 'observation'
  const isToolCall = node.kind === 'tool-call'
  const isRunning = node.status === 'running'
  const isError = node.status === 'error'

  const directVisible = isToolCall && isDirectlyVisibleResult(node, nodes) && node.status === 'completed'
  const [expanded, setExpanded] = useState(() => defaultExpanded(node, directVisible))

  useEffect(() => {
    if (isRunning) setExpanded(true)
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
    (isToolCall && node.status === 'running') ||
    (isThinking && node.content)
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

  const indent = depth * 14

  // 深度思考：可折叠行（对齐 web tao-reasoning：行内标题 + 左竖线引用内容）
  if (isThinking) {
    return (
      <div className="py-0.5" style={{ paddingLeft: indent }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className={cn(
            'inline-flex max-w-full items-center gap-1.5 rounded-lg py-1 pl-0.5 pr-2 -ml-0.5',
            'text-[1rem] leading-6 text-muted-foreground select-none',
            'transition-colors hover:text-foreground hover:bg-accent'
          )}
        >
          <Brain className={cn('size-3.5 shrink-0', isRunning && 'animate-pulse')} aria-hidden />
          <span className={cn('truncate', isRunning && 'animate-pulse')}>
            {isRunning ? '开始思考' : '深度思考'}
          </span>
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-200',
              expanded && 'rotate-90'
            )}
          />
        </button>

        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out',
            expanded
              ? 'grid-rows-[1fr] opacity-100 translate-y-0'
              : 'grid-rows-[0fr] opacity-0 -translate-y-[3px]'
          )}
          aria-hidden={!expanded}
          inert={!expanded ? true : undefined}
        >
          <div className="overflow-hidden min-h-0">
            {/* 引用式思考正文：左 4px 竖线、限高内部滚动（对齐 web tao-reasoning-body） */}
            <div className="ml-0.5 max-h-[188px] overflow-y-auto overscroll-contain border-l-4 border-border py-0.5 pl-4 pr-2 text-[1rem] leading-[1.75] text-muted-foreground">
              <MarkdownRenderer content={node.content ?? ''} />
              {isRunning && (
                <span className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse bg-muted-foreground/50" aria-hidden>
                  ▊
                </span>
              )}
            </div>
            {hasChildren && (
              <div className="mt-0.5">
                {node.children.map((childId) => {
                  const child = nodes[childId]
                  if (!child) return null
                  return <TimelineItem key={childId} node={child} nodes={nodes} depth={depth} />
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // observation 节点不单独渲染标题行，直接渲染内容（作为 tool-call 的子内容）
  if (isObservation && !hasContent) {
    return null
  }

  // 工具调用/其他节点：可折叠行（对齐 web tao-tool：行内图标 + 摘要 + 箭头）
  return (
    <div className="py-0.5" style={{ paddingLeft: indent }}>
      <button
        type="button"
        onClick={() => hasContent && setExpanded((v) => !v)}
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 rounded-lg py-1 pl-0.5 pr-2 -ml-0.5 text-left',
          'text-[1rem] leading-6 text-muted-foreground select-none transition-colors',
          hasContent && 'cursor-pointer hover:text-foreground hover:bg-accent',
          !hasContent && 'cursor-default'
        )}
      >
        <ToolIcon toolName={node.toolName} isRunning={isRunning} isError={isError} />
        <span className={cn('truncate', isError && 'text-destructive/80')}>
          {title}
        </span>
        {hasContent && (
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 transition-transform duration-200',
              expanded && 'rotate-90'
            )}
          />
        )}
      </button>

      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out',
          expanded && hasContent
            ? 'grid-rows-[1fr] opacity-100 translate-y-0'
            : 'grid-rows-[0fr] opacity-0 -translate-y-[3px]'
        )}
        aria-hidden={!expanded || !hasContent}
        inert={!expanded || !hasContent ? true : undefined}
      >
        <div className="overflow-hidden min-h-0">
          <div className="pt-0.5">
            <NodeContent node={node} />
            {hasChildren && (
              <div className="mt-0.5">
                {node.children.map((childId) => {
                  const child = nodes[childId]
                  if (!child) return null
                  // observation 子节点直接渲染内容（无标题行），深度+1缩进
                  if (child.kind === 'observation') {
                    return (
                      <div key={childId} className="pl-3">
                        <ObservationResult raw={child.content ?? ''} />
                      </div>
                    )
                  }
                  return <TimelineItem key={childId} node={child} nodes={nodes} depth={depth + 1} />
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- 节点正文内容 ----
function NodeContent({ node }: { node: TraceNode }) {
  if (node.kind === 'tool-call') {
    const hasObservationWithResult = node.children.length > 0
    const hasArgs = node.arguments && Object.keys(node.arguments).length > 0
    const showArgs = hasArgs && !hasObservationWithResult

    return (
      <div className="ml-6 space-y-2 border-l-2 border-border pl-3">
        {showArgs && (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2 font-mono text-xs leading-relaxed text-muted-foreground">
{JSON.stringify(node.arguments, null, 2)}
          </pre>
        )}
        {!hasArgs && node.argumentsRaw && !hasObservationWithResult && (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-2 font-mono text-xs leading-relaxed text-muted-foreground">
{node.argumentsRaw}
          </pre>
        )}
        {node.status === 'running' && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            <span>正在执行...</span>
          </div>
        )}
        {node.status === 'error' && node.errorMessage && (
          <div className="text-xs text-destructive/80">{node.errorMessage}</div>
        )}
      </div>
    )
  }

  if (node.kind === 'error' && node.errorMessage) {
    return <div className="pl-3 text-xs text-destructive/80">{node.errorMessage}</div>
  }

  return null
}

// ---- 判断工具结果是否可以直接展示（搜索/时间等） ----
function isDirectlyVisibleResult(node: TraceNode, nodes: Record<string, TraceNode>): boolean {
  if (node.kind !== 'tool-call') return false
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

// ---- 默认展开策略 ----
function defaultExpanded(node: TraceNode, directVisible: boolean): boolean {
  if (node.kind === 'text') return true
  if (node.kind === 'thinking') return true // 思考默认展开
  if (node.status === 'error') return true
  if (node.status === 'running') return true
  if (node.kind === 'observation') return true
  if (node.kind === 'tool-call' && node.status === 'completed') {
    return directVisible // 有可视化结果的工具默认展开
  }
  return false
}
