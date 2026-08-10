// ============================================================
// ToolCallCard — 扁平（非 trace 树）路径下的工具调用展示
// 样式对齐 AgentTimeline：工具图标 + 名称/摘要，右侧箭头可折叠，
// 内容缩进显示，整体与 WorkBuddy 截图视觉一致。
// ============================================================

import { useState, useMemo } from 'react'
import { ChevronRight, TerminalSquare, Search, Globe, Clock, Code2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getToolDisplayName } from '@/lib/constants'
import type { ToolCall } from '@shared/types'
import { formatDuration } from '@/lib/trace-utils'

interface ToolCallCardProps {
  toolCall: ToolCall
}

// 工具图标映射（与 AgentTimeline 保持一致）
function ToolIcon({ toolName, isRunning, isError }: {
  toolName?: string
  isRunning: boolean
  isError: boolean
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
      'size-4 shrink-0',
      isRunning && 'animate-spin text-foreground/40',
      isError && 'text-destructive/70',
      !isRunning && !isError && 'text-foreground/40'
    )} />
  )
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

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const isRunning = toolCall.status === 'running' || toolCall.status === 'pending'
  const isError = toolCall.status === 'error'
  const [expanded, setExpanded] = useState(isRunning)

  const hasArgs = toolCall.arguments && Object.keys(toolCall.arguments).length > 0
  const hasResult = !!toolCall.result
  const hasError = isError && !!toolCall.errorMessage
  const hasContent = hasArgs || hasResult || hasError || isRunning

  const displayName = getToolDisplayName(toolCall.name || '工具调用')
  const argSummary = extractArgSummary(toolCall.arguments)
  const title = argSummary ? `${displayName} ${argSummary}` : displayName

  // 耗时显示（如果有 startTime/endTime）
  const durationMs = toolCall.startTime && toolCall.endTime
    ? toolCall.endTime - toolCall.startTime
    : undefined

  return (
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => hasContent && setExpanded((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 py-0.5 min-h-[22px] text-left rounded',
          hasContent && 'cursor-pointer hover:opacity-70 transition-opacity',
          !hasContent && 'cursor-default'
        )}
      >
        <ToolIcon toolName={toolCall.name} isRunning={isRunning} isError={isError} />
        <span
          className={cn(
            'text-[15px] flex-1 truncate',
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
          <div className="py-0.5 pl-3 space-y-0.5">
            {hasArgs && (
              <pre className="max-h-40 overflow-auto font-mono text-[11px] text-foreground/50 whitespace-pre-wrap break-all">
                {JSON.stringify(toolCall.arguments, null, 2)}
              </pre>
            )}
            {hasResult && (
              <p className="text-[12px] text-foreground/55 break-words whitespace-pre-wrap leading-relaxed">
                {toolCall.result}
              </p>
            )}
            {hasError && (
              <p className="text-[12px] text-destructive/80 break-words whitespace-pre-wrap">
                {toolCall.errorMessage}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
