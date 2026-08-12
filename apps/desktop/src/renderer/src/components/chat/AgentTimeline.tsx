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

import { useState, useEffect, useMemo } from 'react'
import {
  ChevronRight,
  Loader2,
  CheckCircle2,
  CircleAlert,
  TerminalSquare,
  Globe,
  Clock,
  Code2,
  Brain
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
    <div className="agent-timeline mb-1">
      {/* 顶部状态行：图标 + 状态文字 + 耗时 + 折叠箭头（最右） */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 py-0.5 text-left transition-opacity hover:opacity-70 rounded"
      >
        {overallStatus === 'running' ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-foreground/40" />
        ) : overallStatus === 'error' ? (
          <CircleAlert className="size-4 shrink-0 text-destructive/80" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-foreground/40" />
        )}
        <span className="text-[15px] text-foreground/50">{statusText}</span>
        {totalDurationMs > 0 && (
          <span className="text-[15px] text-foreground/40 font-mono tabular-nums">
            {formatDuration(totalDurationMs)}
          </span>
        )}
        <ChevronRight
          className={cn(
            'ml-auto size-4 shrink-0 text-foreground/30 transition-transform duration-200',
            expanded && 'rotate-90'
          )}
        />
      </button>

      {/* 内容区：平滑折叠动画 */}
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-0.5">
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
      'size-4 shrink-0',
      isRunning && 'animate-spin text-foreground/40',
      isError && 'text-destructive/70',
      !isRunning && !isError && 'text-foreground/40',
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

  const durationMs =
    node.durationMs ??
    (node.startTime && node.endTime ? node.endTime - node.startTime : undefined)

  const indent = depth * 14

  // 深度思考：可折叠行（与其他时间线行对齐：标题行 + 右侧折叠箭头），
  // 内容左侧竖线引用，段落间空行分隔
  if (isThinking) {
    // 按空行拆分段落，过滤末尾因流式/分隔符产生的空段落，避免抖动
    const paragraphs = (node.content ?? '')
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p, idx, arr) => p || idx !== arr.length - 1)

    return (
      <div className="py-0.5" style={{ paddingLeft: indent }}>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-2 text-left py-0.5 min-h-[22px] rounded cursor-pointer hover:opacity-70 transition-opacity"
        >
          <Brain className="size-4 shrink-0 text-foreground/40" />
          <span className="text-[14px] text-foreground/55 flex-1">深度思考</span>
          {durationMs !== undefined && durationMs > 0 && !isRunning && (
            <span className="text-[13px] text-foreground/35 font-mono tabular-nums shrink-0">
              {formatDuration(durationMs)}
            </span>
          )}
          {isRunning && (
            <span className="text-[13px] text-foreground/40 shrink-0">思考中</span>
          )}
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-foreground/30 transition-transform duration-200',
              expanded && 'rotate-90'
            )}
          />
        </button>

        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-200 ease-out',
            expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
        >
          <div className="overflow-hidden">
            <div className="relative pl-3 py-0.5">
              <div className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-border/70" />
              <div className="text-[12px] text-foreground/50 leading-relaxed break-words space-y-2">
                {paragraphs.map((para, idx) => (
                  <p key={idx} className="whitespace-pre-wrap">{para}</p>
                ))}
                {node.status === 'running' && (
                  <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-foreground/30 align-middle" aria-hidden>
                    ▊
                  </span>
                )}
              </div>
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

  // 工具调用/其他节点：可折叠行
  return (
    <div className="py-0.5" style={{ paddingLeft: indent }}>
      <button
        type="button"
        onClick={() => hasContent && setExpanded((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 text-left py-0.5 min-h-[22px] rounded',
          hasContent && 'cursor-pointer hover:opacity-70 transition-opacity',
          !hasContent && 'cursor-default'
        )}
      >
        <ToolIcon toolName={node.toolName} isRunning={isRunning} isError={isError} />
        <span
          className={cn(
            'text-[14px] flex-1 truncate',
            isError ? 'text-destructive/80' : 'text-foreground/55'
          )}
        >
          {title}
        </span>
        {durationMs !== undefined && durationMs > 0 && !isRunning && (
          <span className="text-[13px] text-foreground/35 font-mono tabular-nums shrink-0">
            {formatDuration(durationMs)}
          </span>
        )}
        {isRunning && (
          <span className="text-[13px] text-foreground/40 shrink-0">执行中</span>
        )}
        {hasContent && (
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-foreground/30 transition-transform duration-200',
              expanded && 'rotate-90'
            )}
          />
        )}
      </button>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded && hasContent ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="py-0.5">
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
      <div className="space-y-0.5 pl-3">
        {showArgs && (
          <pre className="max-h-40 overflow-auto font-mono text-[11px] text-foreground/50 whitespace-pre-wrap break-all">
{JSON.stringify(node.arguments, null, 2)}
          </pre>
        )}
        {!hasArgs && node.argumentsRaw && !hasObservationWithResult && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/40">
{node.argumentsRaw}
          </pre>
        )}
        {node.status === 'running' && (
          <div className="flex items-center gap-1 text-[12px] text-foreground/40">
            <Loader2 className="size-3 animate-spin" />
            <span>正在执行...</span>
          </div>
        )}
        {node.status === 'error' && node.errorMessage && (
          <div className="text-[12px] text-destructive/80">{node.errorMessage}</div>
        )}
      </div>
    )
  }

  if (node.kind === 'error' && node.errorMessage) {
    return <div className="pl-3 text-[12px] text-destructive/80">{node.errorMessage}</div>
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
