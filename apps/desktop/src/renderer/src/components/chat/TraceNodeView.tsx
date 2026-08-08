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
  Search,
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
  if (n.includes('search') || n.includes('web_search') || n === 'news') return Search
  if (n.includes('fetch') || n.includes('url') || n.includes('browser')) return Globe
  if (n.includes('datetime') || n.includes('time') || n.includes('clock')) return Clock
  if (n.includes('python') || n.includes('code') || n.includes('execute')) return Code2
  return TerminalSquare
}

// ---- 从工具参数中提取简短摘要 ----
function extractArgSummary(args: Record<string, unknown> | undefined): string | null {
  if (!args) return null
  const keys = ['query', 'q', 'keyword', 'keywords', 'search_query', 'question', 'prompt', 'url', 'pattern']
  for (const k of keys) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) {
      const t = v.trim()
      return t.length > 40 ? t.slice(0, 40) + '…' : t
    }
  }
  return null
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
        'trace-node my-2 overflow-hidden rounded-lg border text-sm',
        isError
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-border/60 bg-muted/30'
      )}
      data-node-kind={node.kind}
      data-node-status={node.status}
    >
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/40',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60'
        )}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
            expanded && 'rotate-90'
          )}
        />
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            isRunning && 'animate-spin text-foreground/40',
            isError && 'text-destructive',
            !isRunning && !isError && 'text-muted-foreground'
          )}
        />
        <span className={cn(
          'truncate text-xs font-medium',
          isError ? 'text-destructive' : 'text-foreground/70'
        )}>
          {title}
        </span>
        {node.fromHistory && (
          <span className="ml-1 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            历史
          </span>
        )}
        <NodeDuration node={node} />
        {isRunning && (
          <span className="ml-auto shrink-0 text-[10px] text-foreground/50">执行中</span>
        )}
        {isError && node.errorMessage && (
          <span className="ml-auto shrink-0 truncate text-[10px] text-destructive/80">
            {node.errorMessage}
          </span>
        )}
      </button>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-300 ease-out',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-0">
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
      <div className="relative pl-3.5">
        <div className="absolute left-0 top-1 bottom-1 w-[2.5px] rounded-full bg-border/70" />
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
      <div className="space-y-2 text-xs">
        {showArgs && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-foreground/25">参数</div>
            <pre className="max-h-60 overflow-auto rounded bg-background/60 p-2 font-mono text-[11px] text-foreground/55 whitespace-pre-wrap break-all">
{JSON.stringify(node.arguments, null, 2)}
            </pre>
          </div>
        )}
        {!hasArgs && node.argumentsRaw && !hasObservationChildren && (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px] text-foreground/40">
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
