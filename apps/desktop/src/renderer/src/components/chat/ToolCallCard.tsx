// ============================================================
// ToolCallCard / ToolBatchRow — 扁平（非 trace 树）路径下的工具调用展示
// 对齐 apps/web/src/components/message/ToolCallRow.tsx：
//   - 单行摘要：工具图标 + 名称/参数摘要 + 右侧箭头，默认收起，
//     点击展开查看「参数 / 观察」分节详情（左侧竖线缩进 + 灰底
//     圆角 pre，限高内部滚动，不撑长消息流）
//   - 连续同类调用聚合为 ToolBatchRow 一行（对齐 web ToolBatchRow：
//     一轮并列的多次检索收成「联网搜索 5 条查询 ⌄」，展开看明细），
//     减少消息区噪声
//   - 执行中图标呼吸高亮（对齐 web tao-pulse），终态自动收起
// 图标映射与 AgentTimeline 保持一致（trace 路径与扁平路径视觉统一）。
// ============================================================

import { memo, useState } from 'react'
import {
  ChevronRight,
  TerminalSquare,
  Search,
  Globe,
  Clock,
  Code2,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getToolDisplayName } from '@/lib/constants'
import type { ToolCall } from '@shared/types'
import { formatDuration } from '@/lib/trace-utils'

// ---- 工具图标类别（与 AgentTimeline 的映射口径一致）----
export type ToolIconKind = 'search' | 'web' | 'time' | 'code' | 'tool'

export function getToolIconKind(toolName?: string): ToolIconKind {
  if (!toolName) return 'tool'
  const n = toolName.toLowerCase()
  if (n.includes('search') || n.includes('web_search') || n === 'news') return 'search'
  if (n.includes('fetch') || n.includes('url') || n.includes('browser')) return 'web'
  if (n.includes('datetime') || n.includes('time') || n.includes('clock')) return 'time'
  if (n.includes('python') || n.includes('code') || n.includes('execute')) return 'code'
  return 'tool'
}

const ICONS: Record<ToolIconKind, LucideIcon> = {
  search: Search,
  web: Globe,
  time: Clock,
  code: Code2,
  tool: TerminalSquare
}

// 从参数中提取标题摘要
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

/** 工具行摘要（单行）：图标 + 「名称 参数摘要」+ 耗时/执行中 + 箭头 */
function ToolRowTitle({ toolCall }: { toolCall: ToolCall }) {
  const displayName = getToolDisplayName(toolCall.name || '工具调用')
  const argSummary = extractArgSummary(toolCall.arguments)
  return <>{argSummary ? `${displayName} ${argSummary}` : displayName}</>
}

interface ToolCallCardProps {
  toolCall: ToolCall
}

export const ToolCallCard = memo(function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending'
  const isError = toolCall.status === 'error'
  // 对齐 web ToolCallRow：默认收起，点击展开看参数与观测（可追溯性不丢）
  const [expanded, setExpanded] = useState(false)

  const hasArgs = toolCall.arguments && Object.keys(toolCall.arguments).length > 0
  const hasResult = !!toolCall.result
  const hasError = isError && !!toolCall.errorMessage
  const hasContent = hasArgs || hasResult || hasError

  const Icon = ICONS[getToolIconKind(toolCall.name)]

  // 耗时显示（如果有 startTime/endTime）
  const durationMs = toolCall.startTime && toolCall.endTime
    ? toolCall.endTime - toolCall.startTime
    : undefined

  return (
    <div>
      <button
        type="button"
        onClick={() => hasContent && setExpanded((v) => !v)}
        aria-expanded={expanded}
        disabled={!hasContent}
        className={cn(
          'flex w-full items-center gap-1.5 py-1 pl-0.5 pr-2 -ml-0.5 min-h-[24px] text-left rounded-lg select-none',
          'text-[1rem] leading-6 transition-colors',
          hasContent && 'cursor-pointer hover:bg-accent',
          !hasContent && 'cursor-default'
        )}
      >
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            isRunning && 'animate-pulse text-primary',
            isError && 'text-destructive/70',
            !isRunning && !isError && 'text-muted-foreground'
          )}
        />
        <span
          className={cn(
            'flex-1 truncate',
            isError ? 'text-destructive/80' : 'text-muted-foreground'
          )}
        >
          <ToolRowTitle toolCall={toolCall} />
        </span>
        {durationMs !== undefined && durationMs > 0 && !isRunning && (
          <span className="text-[13px] text-muted-foreground/70 font-mono tabular-nums shrink-0">
            {formatDuration(durationMs)}
          </span>
        )}
        {isRunning && (
          <span className="text-[13px] text-muted-foreground shrink-0">执行中</span>
        )}
        {hasContent && (
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200',
              expanded && 'rotate-90'
            )}
          />
        )}
      </button>

      {/* 展开详情：左侧竖线缩进 + 「参数/观察」分节（对齐 web tao-tool-detail） */}
      {expanded && hasContent && (
        <div className="ml-[9px] mt-0.5 mb-1 flex flex-col gap-2 border-l-2 border-border pl-3">
          {hasArgs && (
            <div>
              <div className="mb-1 text-xs leading-5 text-muted-foreground/70">参数</div>
              <pre className="max-h-60 overflow-auto overscroll-contain rounded-lg bg-muted/60 px-2.5 py-2 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
                {JSON.stringify(toolCall.arguments, null, 2)}
              </pre>
            </div>
          )}
          {hasResult && (
            <div>
              <div className="mb-1 text-xs leading-5 text-muted-foreground/70">观察</div>
              <pre className="max-h-60 overflow-auto overscroll-contain rounded-lg bg-muted/60 px-2.5 py-2 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
                {toolCall.result}
              </pre>
            </div>
          )}
          {hasError && (
            <div>
              <div className="mb-1 text-xs leading-5 text-destructive/70">错误</div>
              <p className="text-xs text-destructive/80 break-words whitespace-pre-wrap">
                {toolCall.errorMessage}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
})

/** 工具列表渲染项：单条或同类批次 */
export type ToolRow =
  | { type: 'single'; toolCall: ToolCall }
  | { type: 'batch'; kind: ToolIconKind; items: ToolCall[] }

/**
 * 连续同类（图标类别一致）调用聚合（对齐 web renderBlocks 的分组规则）：
 * 一轮并列的 5 条检索天然相邻，收成一行批次摘要，展开看完整明细。
 */
export function groupToolCalls(toolCalls: ToolCall[]): ToolRow[] {
  const rows: ToolRow[] = []
  let idx = 0
  while (idx < toolCalls.length) {
    const first = toolCalls[idx]!
    const kind = getToolIconKind(first.name)
    let end = idx + 1
    while (end < toolCalls.length && getToolIconKind(toolCalls[end]!.name) === kind) {
      end += 1
    }
    const group = toolCalls.slice(idx, end)
    if (group.length >= 2) {
      rows.push({ type: 'batch', kind, items: group })
    } else {
      rows.push({ type: 'single', toolCall: first })
    }
    idx = end
  }
  return rows
}

/** 批次聚合行摘要的主题截断长度（对齐 web BATCH_TOPIC_MAX_LEN） */
const BATCH_TOPIC_MAX_LEN = 30

interface ToolBatchRowProps {
  kind: ToolIconKind
  items: ToolCall[]
}

/**
 * 动作批次聚合行（对齐 web ToolBatchRow）：
 * 「联网搜索 5 条查询 ⌄」一行收拢并列调用，展开后逐条显示明细。
 */
export const ToolBatchRow = memo(function ToolBatchRow({ kind, items }: ToolBatchRowProps) {
  const [open, setOpen] = useState(false)
  const Icon = ICONS[kind]
  const anyRunning = items.some((it) => it.status === 'running' || it.status === 'pending')
  const failedCount = items.filter((it) => it.status === 'error').length

  // 人话摘要：搜索类带首条 query 主题，其余「名称 N 次」
  const firstSummary = items[0] ? extractArgSummary(items[0].arguments) : null
  const topic = firstSummary
    ? firstSummary.length > BATCH_TOPIC_MAX_LEN
      ? firstSummary.slice(0, BATCH_TOPIC_MAX_LEN) + '…'
      : firstSummary
    : ''
  const displayName = getToolDisplayName(items[0]?.name || '工具调用')
  const summary =
    kind === 'search' || kind === 'web'
      ? topic
        ? `${displayName}「${topic}」等 ${items.length} 条`
        : `${displayName} ${items.length} 条查询`
      : `${displayName} ${items.length} 次`
  const failedSuffix = failedCount > 0 ? ` · ${failedCount} 条失败` : ''

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${summary}，展开查看明细`}
        className={cn(
          'flex w-full items-center gap-1.5 py-1 pl-0.5 pr-2 -ml-0.5 min-h-[24px] text-left rounded-lg select-none',
          'text-[1rem] leading-6 text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-foreground'
        )}
      >
        <Icon
          className={cn(
            'size-3.5 shrink-0',
            anyRunning ? 'animate-pulse text-primary' : 'text-muted-foreground'
          )}
        />
        <span className="flex-1 truncate">
          {summary}
          {failedSuffix}
        </span>
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200',
            open && 'rotate-90'
          )}
        />
      </button>

      {/* 展开/折叠容器：grid 0fr→1fr 高度过渡（双向平滑）；
          明细与聚合行同左缘对齐（图标列一条线到底） */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <div className="overflow-hidden min-h-0">
          <div className="flex flex-col gap-1.5 pt-1.5">
            {items.map((item) => (
              <ToolCallCard key={item.id} toolCall={item} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})
