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
  Eye
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getToolDisplayName } from '@/lib/constants'
import type { TraceNode } from '@shared/types'
import { traceNodeExpandedAtom, defaultExpandedForNode } from '@/stores/traceAtoms'
import { formatDuration } from '@/lib/trace-utils'
// P0：text 节点改由统一 MarkdownRenderer 渲染（替代原裸 ReactMarkdown）
import { MarkdownRenderer } from './MarkdownRenderer'
// P0：observation 节点使用智能结果展示（替代裸露原始 JSON）
import { ObservationResult } from './ObservationResult'

interface TraceNodeViewProps {
  node: TraceNode
  /** 节点内容（正文/参数/结果）；text/thinking 节点为 markdown 源文，tool-call 为 JSON 预览 */
  children?: React.ReactNode
}

const KIND_ICON: Record<TraceNode['kind'], React.ComponentType<{ className?: string }>> = {
  thinking: Brain,
  'tool-call': TerminalSquare,
  observation: Eye,
  text: Wand2,
  error: CircleAlert
}

const KIND_TITLE: Record<TraceNode['kind'], string> = {
  thinking: '思考过程',
  'tool-call': '工具调用',
  observation: '观察结果',
  text: '最终回答',
  error: '错误'
}

export const TraceNodeView = memo(function TraceNodeView({
  node,
  children
}: TraceNodeViewProps) {
  const [expanded, setExpanded] = useAtom(traceNodeExpandedAtom(node.id))

  // 首次挂载根据节点状态决定默认展开（运行中/错误展开，已完成折叠）
  useEffect(() => {
    setExpanded(defaultExpandedForNode(node))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id])

  // running 节点始终保持展开（便于实时看到流式输出）
  useEffect(() => {
    if (node.status === 'running' && !expanded) {
      setExpanded(true)
    }
  }, [node.status, expanded, setExpanded])

  const Icon = KIND_ICON[node.kind]
  const title = useMemo(() => {
    // P1：工具名中文化
    if (node.kind === 'tool-call') return getToolDisplayName(node.toolName || node.label || KIND_TITLE[node.kind])
    if (node.kind === 'observation') return node.toolName ? `${getToolDisplayName(node.toolName)} · 观察结果` : KIND_TITLE[node.kind]
    return node.label || KIND_TITLE[node.kind]
  }, [node.kind, node.label, node.toolName])

  const isRunning = node.status === 'running'
  const isError = node.status === 'error'
  const isText = node.kind === 'text'

  // text 节点（最终回答）不渲染卡片外壳，只渲染内容
  if (isText) {
    // P0 修复：trace 文本节点与非 trace 路径共用 MarkdownRenderer，
    // 补齐此前缺失的 rehype-sanitize（XSS 防护）、rehype-highlight（语法高亮）、
    // SafeLink（危险链接拦截）与 CodeBlock（语言标签/预览按钮）。
    // messageId 从节点 id 推导（`${msgId}::text`，见 stream-handler makeTextNodeId），
    // 供代码块「预览 → 跳转源消息」反向联动。
    const messageId = node.id.endsWith('::text') ? node.id.slice(0, -'::text'.length) : undefined
    return (
      <div className="trace-node-text min-w-0 px-0 py-0">
        {children ?? (
          node.content ? (
            <MarkdownRenderer content={node.content} messageId={messageId} />
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
            isRunning && 'animate-spin text-blue-500',
            isError && 'text-destructive',
            !isRunning && !isError && 'text-muted-foreground'
          )}
        />
        <span className={cn(
          'truncate text-xs font-medium',
          isError ? 'text-destructive' : 'text-foreground/90'
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
          <span className="ml-auto shrink-0 text-[10px] text-blue-500">执行中</span>
        )}
        {isError && node.errorMessage && (
          <span className="ml-auto shrink-0 truncate text-[10px] text-destructive/80">
            {node.errorMessage}
          </span>
        )}
      </button>

      {/* grid-rows 折叠动画：0fr 折叠 / 1fr 展开 */}
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

// ---- 子组件：耗时显示（M3：running 时实时 elapsed 计时 1s/帧）----
function NodeDuration({ node }: { node: TraceNode }) {
  const finalMs =
    node.durationMs ??
    (node.startTime && node.endTime ? node.endTime - node.startTime : undefined)
  const isRunning = node.status === 'running'

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isRunning || !node.startTime) return
    // 每秒刷新一次已用时间（节省 CPU：不使用 rAF）
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
        isRunning ? 'text-blue-500/80' : 'text-muted-foreground/70'
      )}
    >
      {formatDuration(ms)}
    </span>
  )
}

// ---- 子组件：默认节点正文（当未通过 children 注入自定义渲染时使用）----
const TraceNodeContent = memo(function TraceNodeContent({ node }: { node: TraceNode }) {
  if (node.kind === 'thinking') {
    return (
      <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
        {node.content}
        {node.status === 'running' && (
          <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-current" aria-hidden>▊</span>
        )}
      </div>
    )
  }
  if (node.kind === 'tool-call') {
    const hasArgs = node.arguments && Object.keys(node.arguments).length > 0
    return (
      <div className="space-y-2 text-xs">
        {hasArgs && (
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">参数</div>
            <pre className="max-h-60 overflow-auto rounded bg-background/60 p-2 font-mono text-[11px] text-foreground/80">
{JSON.stringify(node.arguments, null, 2)}
            </pre>
          </div>
        )}
        {!hasArgs && node.argumentsRaw && (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px] text-muted-foreground">
{node.argumentsRaw}
          </pre>
        )}
        {node.status === 'running' && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            <span>正在执行...</span>
          </div>
        )}
      </div>
    )
  }
  // P0：observation 节点使用 ObservationResult 智能展示，不再裸露原始 JSON
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
