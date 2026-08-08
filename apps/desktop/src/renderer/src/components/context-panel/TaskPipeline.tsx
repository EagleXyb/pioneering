// ============================================================
// TaskPipeline — 任务流水线时间轴主体（右栏 ContextPanel body）
//
// 字体标准：所有主要文字统一 14px
//   - 工具名称：14px semibold
//   - 进度摘要：14px
//   - 步骤序号/进度指示：14px
//   - 代码/参数：12px font-mono
//   - 标签文字：11px
// ============================================================

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@shared/types'

/** 时间轴步骤状态 */
type TimelineStatus = 'pending' | 'running' | 'done' | 'failed'

/** ToolCall.status → TimelineStatus 映射 */
function toTimelineStatus(s: ToolCall['status']): TimelineStatus {
  if (s === 'completed') return 'done'
  if (s === 'error') return 'failed'
  return s
}

const STATUS_CONFIG: Record<TimelineStatus, { label: string; dotClass: string; titleClass: string }> = {
  pending: {
    label: '等待中',
    dotClass: 'border-border bg-background',
    titleClass: 'text-muted-foreground'
  },
  running: {
    label: '执行中',
    dotClass: 'border-[#3b82f6] bg-[#3b82f6] text-white',
    titleClass: 'text-[#2563eb]'
  },
  done: {
    label: '已完成',
    dotClass: 'border-[#22c55e] bg-[#22c55e] text-white',
    titleClass: 'text-foreground'
  },
  failed: {
    label: '失败',
    dotClass: 'border-red-500 bg-red-500 text-white',
    titleClass: 'text-red-600'
  }
}

interface TaskPipelineProps {
  isStreaming: boolean
  thinking: string
  toolCalls: ToolCall[] | undefined
  error: string | null
  phase: 'idle' | 'thinking' | 'executing' | 'done' | 'error'
}

/**
 * 判断步骤是否应展开。
 */
function isStepExpanded(
  stepId: string,
  status: TimelineStatus,
  userCollapsed: Record<string, boolean>,
  index: number,
  allCompleted: boolean
): boolean {
  if (userCollapsed[stepId] !== undefined) {
    return !userCollapsed[stepId]
  }
  if (allCompleted) {
    return index === 0
  }
  return status === 'running' || status === 'failed'
}

/**
 * 把工具参数对象格式化为可读字符串。
 */
function formatArguments(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return ''
  const oneLine = JSON.stringify(args)
  if (oneLine.length <= 60) return oneLine
  return JSON.stringify(args, null, 2)
}

function StatusDot({ status }: { status: TimelineStatus }) {
  if (status === 'done') {
    return <Check size={9} strokeWidth={3} />
  }
  if (status === 'failed') {
    return <X size={9} strokeWidth={3} />
  }
  if (status === 'running') {
    return (
      <span className="relative flex items-center justify-center">
        <span className="absolute w-3 h-3 rounded-full border-[1.5px] border-[#3b82f6]/30 animate-ping" />
        <span className="block w-1.5 h-1.5 rounded-full bg-white" />
      </span>
    )
  }
  return null
}

interface TimelineItemProps {
  toolCall: ToolCall
  index: number
  total: number
  isLast: boolean
  expanded: boolean
  onToggle: () => void
  historical: boolean
}

function TimelineItem({
  toolCall,
  index,
  total,
  isLast,
  expanded,
  onToggle,
  historical
}: TimelineItemProps) {
  const status = toTimelineStatus(toolCall.status)
  const config = STATUS_CONFIG[status]
  const headerId = `task-pipeline-header-${toolCall.id}`
  const bodyId = `task-pipeline-body-${toolCall.id}`
  const showTopLine = index !== 0
  const showBottomLine = !isLast
  const description = formatArguments(toolCall.arguments)

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onToggle()
    }
  }

  return (
    <div
      className={cn(
        'flex gap-0 transition-colors',
        expanded && 'is-expanded',
        historical && 'is-historical'
      )}
      data-status={status}
    >
      {/* 左侧时间轴指示器列：圆点 + 上下连线 */}
      <div className="relative shrink-0 w-7 flex flex-col items-center">
        {/* 上连线 */}
        {showTopLine && (
          <div className="w-px h-[15px] bg-border" />
        )}
        {/* 圆点 */}
        <div
          className={cn(
            'relative w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center z-10 transition-all shrink-0',
            config.dotClass,
            status === 'running' && !historical && 'shadow-sm shadow-blue-500/20'
          )}
        >
          <StatusDot status={status} />
        </div>
        {/* 下连线 */}
        {showBottomLine && (
          <div className="w-px flex-1 bg-border min-h-[18px]" />
        )}
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div
          className="flex items-center justify-between gap-2 h-11 pr-1 cursor-pointer select-none shrink-0 focus:outline-none focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-1 rounded group"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-controls={bodyId}
          id={headerId}
          onClick={onToggle}
          onKeyDown={handleKeyDown}
        >
          <span className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-[14px] text-muted-foreground font-medium shrink-0 w-6 text-right">
              {index + 1}.
            </span>
            <span className={cn('text-[12px] font-semibold truncate leading-[1.4]', config.titleClass)}>
              {toolCall.name}
            </span>
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[14px] text-muted-foreground tabular-nums leading-[1.4]">
              ({index + 1}/{total})
            </span>
            <span className="text-muted-foreground inline-flex items-center justify-center transition-colors duration-200 group-hover:text-foreground/70">
              {expanded ? <ChevronUp size={16} strokeWidth={2} /> : <ChevronDown size={16} strokeWidth={2} />}
            </span>
          </div>
        </div>

        <div
          id={bodyId}
          aria-labelledby={headerId}
          className={cn(
            'overflow-hidden transition-all duration-200 pr-1',
            expanded ? 'max-h-[600px] opacity-100 mb-2' : 'max-h-0 opacity-0'
          )}
          style={{ marginLeft: '28px' }}
        >
          {description && (
            <pre className="mt-1 mb-1.5 p-2 text-[12px] text-muted-foreground bg-muted/50 rounded-md font-mono whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto leading-relaxed">
              {description}
            </pre>
          )}
          {status === 'done' && toolCall.result && (
            <div className="mt-1.5 p-2.5 text-[13px] text-muted-foreground bg-green-500/5 border-l-2 border-green-500 rounded-r-md whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto leading-relaxed">
              <span className="block text-[11px] font-semibold text-green-600 mb-1">执行结果</span>
              {toolCall.result}
            </div>
          )}
          {status === 'failed' && toolCall.errorMessage && (
            <div className="mt-1.5 p-2.5 text-[13px] text-red-600 bg-red-500/5 border-l-2 border-red-500 rounded-r-md whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto leading-relaxed">
              <span className="block text-[11px] font-semibold text-red-600 mb-1">错误信息</span>
              {toolCall.errorMessage}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function TaskPipeline({
  isStreaming,
  thinking,
  toolCalls,
  error,
  phase
}: TaskPipelineProps) {
  const [collapsedSteps, setCollapsedSteps] = useState<Record<string, boolean>>({})

  const toggleStep = (id: string) => {
    setCollapsedSteps((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const list = toolCalls ?? []
  const total = list.length
  const done = list.filter((t) => t.status === 'completed').length
  const failed = list.filter((t) => t.status === 'error').length
  const historical = !isStreaming

  const allCompleted = useMemo(
    () =>
      total > 0 &&
      list.every((t) => t.status === 'completed' || t.status === 'error'),
    [list, total]
  )

  // 空态
  if (total === 0) {
    if (phase === 'error' && error) {
      return (
        <div className="flex flex-col items-center justify-start gap-2 pt-6 px-4 text-center">
          <div className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center text-sm font-bold shrink-0">
            ✕
          </div>
          <div className="text-[13px] font-semibold text-red-600">任务失败</div>
          {error && (
            <div className="text-[12px] text-muted-foreground leading-relaxed max-w-[260px] break-words whitespace-pre-wrap">
              {error}
            </div>
          )}
        </div>
      )
    }
    return (
      <div className="flex items-center justify-center h-full text-[14px] text-muted-foreground">
        {phase === 'thinking'
          ? '正在思考...'
          : phase === 'executing'
            ? '正在执行...'
            : '等待任务开始'}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background" data-source={historical ? 'history' : 'live'}>
      {/* 思考过程提示行 */}
      {isStreaming && thinking && (
        <div className="mx-3 mt-3 px-3 py-2.5 text-[13px] text-muted-foreground bg-blue-500/5 border-l-2 border-blue-500/50 rounded-r-md whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto leading-relaxed shrink-0">
          <span className="block text-[11px] font-semibold text-blue-600 mb-0.5">思考过程</span>
          {thinking}
        </div>
      )}

      {/* 摘要进度行 */}
      <div className="flex items-center gap-2 px-4 pt-3.5 pb-3 border-b border-border shrink-0">
        <span className="text-[14px] text-muted-foreground">
          已完成 <strong className="text-foreground font-semibold text-[14px]">{done}</strong>
          <span className="mx-0.5">/</span>
          <span className="font-medium">{total}</span> 步
        </span>
        {failed > 0 && <span className="text-[12px] text-red-600 font-medium">{failed} 失败</span>}
      </div>

      {/* 全局错误条 */}
      {phase === 'error' && error && (
        <div className="flex items-start gap-1.5 mx-3 mt-2.5 px-3 py-2.5 bg-red-500/8 rounded-md border-l-2 border-red-500 shrink-0">
          <span className="text-red-600 font-bold text-xs shrink-0 leading-relaxed mt-0.5">✕</span>
          <span className="text-[13px] text-red-600 leading-relaxed break-words whitespace-pre-wrap">
            {error}
          </span>
        </div>
      )}

      {/* 时间轴列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto py-3 px-3">
        {list.map((tc, idx) => {
          const status = toTimelineStatus(tc.status)
          const expanded = isStepExpanded(
            tc.id,
            status,
            collapsedSteps,
            idx,
            allCompleted
          )
          return (
            <TimelineItem
              key={tc.id}
              toolCall={tc}
              index={idx}
              total={total}
              isLast={idx === list.length - 1}
              expanded={expanded}
              onToggle={() => toggleStep(tc.id)}
              historical={historical}
            />
          )
        })}
      </div>
    </div>
  )
}
