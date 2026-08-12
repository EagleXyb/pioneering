// ============================================================
// TraceNodeView — 单节点折叠行（memo + grid-rows 动画）
// 渲染 thinking / tool-call / observation / text / error 五类节点，
// 展开/折叠使用 Tailwind v4 任意值 grid-rows-[0fr/1fr] + transition，
// 比 Radix Collapsible 更平滑且无需测量高度。
// 折叠状态通过 Jotai atomFamily(traceNodeExpandedAtom) 独立维护。
// ============================================================

import { memo, useEffect, useMemo, useState } from 'react'
import { useAtom } from 'jotai'
import {
  Brain,
  ChevronRight,
  CircleAlert,
  Loader2,
  TerminalSquare,
  Wand2,
  Eye,
  Globe,
  Clock,
  Code2,
  ListChecks
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getToolDisplayName } from '@/lib/constants'
import type { TraceNode } from '@shared/types'
import { traceNodeExpandedAtom, defaultExpandedForNode } from '@/stores/traceAtoms'
import { formatDuration } from '@/lib/trace-utils'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ObservationResult } from './ObservationResult'

interface TraceNodeViewProps {
  node: TraceNode
  children?: React.ReactNode
}

// ---- 工具图标映射 ----
function getToolIcon(toolName: string | undefined): React.ComponentType<{ className?: string }> {
  if (!toolName) return TerminalSquare
  const n = toolName.toLowerCase()
  if (n.includes('search') || n.includes('web_search') || n === 'news') return Globe
  if (n.includes('fetch') || n.includes('url') || n.includes('browser')) return Globe
  if (n.includes('datetime') || n.includes('time') || n.includes('clock')) return Clock
  if (n.includes('python') || n.includes('code') || n.includes('execute')) return Code2
  return TerminalSquare
}

// ---- 从工具参数中提取简短摘要 ----
// 支持：嵌套对象递归、数组拼接、更多关键词 key、兜底第一个字符串参数
function extractArgSummary(args: Record<string, unknown> | undefined): string | null {
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
    const s = stringifyValue(args[k])
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
    if (v && typeof v === 'object') return null
    return null
  }
}

const KIND_ICON: Record<TraceNode['kind'], React.ComponentType<{ className?: string }>> = {
  thinking: Brain,
  'tool-call': TerminalSquare,
  observation: Eye,
  text: Wand2,
  error: CircleAlert,
  'plan-step': ListChecks
}

const KIND_TITLE: Record<TraceNode['kind'], string> = {
  thinking: '深度思考',
  'tool-call': '工具调用',
  observation: '观察结果',
  text: '最终回答',
  error: '错误',
  'plan-step': '计划步骤'
}

export const TraceNodeView = memo(function TraceNodeView({
  node,
  children
}: TraceNodeViewProps) {
  const [expanded, setExpanded] = useAtom(traceNodeExpandedAtom(node.id))

  useEffect(() => {
    setExpanded(defaultExpandedForNode(node))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  useEffect(() => {
    if (node.status === 'running' && !expanded) {
      setExpanded(true)
    }
  }, [node.status, expanded, setExpanded])

  const isRunning = node.status === 'running'
  const isError = node.status === 'error'
  const isText = node.kind === 'text'
  const isThinking = node.kind === 'thinking'
  const isToolCall = node.kind === 'tool-call'

  // 图标：工具节点用专用图标
  const Icon = useMemo(() => {
    if (isToolCall) return getToolIcon(node.toolName)
    return KIND_ICON[node.kind]
  }, [isToolCall, node.kind, node.toolName])

  // 标题：工具节点显示中文名+参数摘要
  const title = useMemo(() => {
    if (isToolCall) {
      const name = getToolDisplayName(node.toolName || node.label || KIND_TITLE[node.kind])
      const summary = extractArgSummary(node.arguments)
      return summary ? `${name} ${summary}` : name
    }
    if (node.kind === 'observation') {
      return node.toolName ? `${getToolDisplayName(node.toolName)} · 结果` : KIND_TITLE[node.kind]
    }
    return node.label || KIND_TITLE[node.kind]
  }, [isToolCall, node.kind, node.label, node.toolName, node.arguments])

  if (isText) {
    const messageId = node.id.endsWith('::text') ? node.id.slice(0, -'::text'.length) : undefined
    return (
      <div className="trace-node-text min-w-0 px-0 py-0">
        {children ?? (
          node.content ? (
            // trace 模式下上方已有 AgentTimeline 展示工具结果，
            // 正文中嵌入的相同结果直接跳过，避免重复渲染。
            <MarkdownRenderer content={node.content} messageId={messageId} skipEmbeddedResults={true} />
          ) : null
        )}
        {isRunning && (
          <span className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-current align-baseline" aria-hidden>
            ▊
          </span>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'trace-node my-0.5 text-sm',
        isError && 'text-destructive/80'
      )}
      data-node-kind={node.kind}
      data-node-status={node.status}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className={cn(
          'flex w-full items-center gap-1.5 py-1 text-left transition-opacity hover:opacity-70',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40 rounded'
        )}
      >
        <ChevronRight
          className={cn(
            'size-3 shrink-0 text-foreground/30 transition-transform duration-200',
            expanded && 'rotate-90'
          )}
        />
        <Icon
          className={cn(
            'size-3 shrink-0',
            isRunning && 'animate-spin text-foreground/40',
            isError && 'text-destructive/70',
            !isRunning && !isError && 'text-foreground/30'
          )}
        />
        <span className={cn(
          'truncate text-[13px]',
          isError ? 'text-destructive/80' : 'text-foreground/55'
        )}>
          {title}
        </span>
        {node.fromHistory && (
          <span className="ml-1 shrink-0 text-[10px] text-foreground/30">
            历史
          </span>
        )}
        <NodeDuration node={node} />
        {isRunning && (
          <span className="ml-auto shrink-0 text-[11px] text-foreground/40">执行中</span>
        )}
        {isError && node.errorMessage && (
          <span className="ml-auto shrink-0 truncate text-[11px] text-destructive/70">
            {node.errorMessage}
          </span>
        )}
      </button>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="pl-4.5 pb-1.5 pt-0">
            {children ?? <TraceNodeContent node={node} />}
          </div>
        </div>
      </div>
    </div>
  )
})

function NodeDuration({ node }: { node: TraceNode }) {
  const finalMs =
    node.durationMs ??
    (node.startTime && node.endTime ? node.endTime - node.startTime : undefined)
  const isRunning = node.status === 'running'

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isRunning || !node.startTime) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => window.clearInterval(timer)
  }, [isRunning, node.startTime])

  const ms = isRunning && node.startTime
    ? now - node.startTime
    : finalMs

  if (ms === undefined || ms < 0) return null
  return (
    <span
      className={cn(
        'ml-1 shrink-0 font-mono text-[10px] tabular-nums',
        isRunning ? 'text-foreground/40' : 'text-muted-foreground/70'
      )}
    >
      {formatDuration(ms)}
    </span>
  )
}

const TraceNodeContent = memo(function TraceNodeContent({ node }: { node: TraceNode }) {
  // 深度思考：WorkBuddy 风格 — 左侧竖线 + 浅灰文字
  if (node.kind === 'thinking') {
    return (
      <div className="relative pl-3">
        <div className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-border/60" />
        <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground/45">
          {node.content}
          {node.status === 'running' && (
            <span className="ml-0.5 inline-block h-3.5 w-1 animate-pulse bg-foreground/30 align-middle" aria-hidden>▊</span>
          )}
        </div>
      </div>
    )
  }
  if (node.kind === 'tool-call') {
    const hasArgs = node.arguments && Object.keys(node.arguments).length > 0
    const hasObservationChildren = node.children.length > 0
    const showArgs = hasArgs && !hasObservationChildren
    return (
      <div className="space-y-1.5 text-[13px]">
        {showArgs && (
          <div>
            <pre className="max-h-60 overflow-auto font-mono text-[11px] text-foreground/50 whitespace-pre-wrap break-all">
{JSON.stringify(node.arguments, null, 2)}
            </pre>
          </div>
        )}
        {!hasArgs && node.argumentsRaw && !hasObservationChildren && (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/40">
{node.argumentsRaw}
          </pre>
        )}
        {node.status === 'running' && (
          <div className="flex items-center gap-1.5 text-foreground/40">
            <Loader2 className="size-3 animate-spin" />
            <span>正在执行...</span>
          </div>
        )}
      </div>
    )
  }
  // observation → ObservationResult 智能展示（搜索卡片/时间芯片/折叠JSON）
  if (node.kind === 'observation') {
    return <ObservationResult raw={node.content ?? ''} />
  }
  if (node.kind === 'error' && node.errorMessage) {
    return (
      <div className="text-xs text-destructive">{node.errorMessage}</div>
    )
  }
  return null
})
