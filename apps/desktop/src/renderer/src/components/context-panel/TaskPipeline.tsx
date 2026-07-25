// ============================================================
// TaskPipeline — 任务流水线时间轴主体（右栏 ContextPanel body）
//
// 设计参考：apps/web/src/modes/task/components/PlanPipelineTree.tsx
//   - 时间轴样式：左侧圆点 + 竖线连线 + 右侧折叠面板
//   - 状态色映射：pending(灰) / running(蓝+脉冲) / done(绿+对勾) /
//     failed(红+叉)
//   - 折叠策略：用户手动 > 阶段自动（执行中仅 running/failed 展开，
//     全部完成仅首步展开）
//
// 与 web 端的关键差异：
//   - 数据源为 chatStore 的 ToolCall[]（非 PlanItem[]）：
//       * title ← toolCall.name
//       * description ← JSON.stringify(toolCall.arguments)
//       * result ← toolCall.result
//       * error ← toolCall.errorMessage
//       * status 映射：pending→pending / running→running /
//         completed→done / error→failed
//   - 无独立 planExecuteStore：折叠态用组件内 useState 管理
//     （UI-only state，无持久化需求）
//   - 历史模式：非流式时由 ContextPanel 注入最后一条 assistant
//     消息的 toolCalls，禁用 running 脉冲动画（与 web 的
//     data-source="history" 一致）
//
// 无障碍：
//   - 标题行 role="button" + tabIndex=0 + aria-expanded + aria-controls
//   - 支持 Enter / Space 切换折叠
//   - 折叠内容区 aria-labelledby 关联标题
// ============================================================

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@shared/types'

/** 时间轴步骤状态（与 web 端 PlanItem.status 对齐） */
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
    dotClass: 'border-blue-500 bg-blue-500 text-white',
    titleClass: 'text-blue-600'
  },
  done: {
    label: '已完成',
    dotClass: 'border-green-500 bg-green-500 text-white',
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
  /** 当前阶段（由 ContextPanel 统一推导后传入） */
  phase: 'idle' | 'thinking' | 'executing' | 'done' | 'error'
}

/**
 * 判断步骤是否应展开。
 *
 * 优先级：用户手动折叠/展开 > 阶段自动策略
 *
 * 自动策略分两种模式：
 *   - 执行中（存在 running 步骤）：仅 running / failed 步骤展开，已完成步骤自动折叠
 *   - 全部完成（无 running 步骤）：仅第一步展开，其余折叠
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
 *
 * - 空参数：返回空串（不展示描述区）
 * - 单行短参数：直接 JSON.stringify
 * - 多行/长参数：pretty-print（2 空格缩进）
 */
function formatArguments(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return ''
  const oneLine = JSON.stringify(args)
  if (oneLine.length <= 60) return oneLine
  return JSON.stringify(args, null, 2)
}

function StatusDot({ status }: { status: TimelineStatus }) {
  if (status === 'done') {
    return (
      <svg width="8" height="8" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 7l3 3 5-5" />
      </svg>
    )
  }
  if (status === 'failed') {
    return (
      <svg width="8" height="8" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4l6 6M10 4l-6 6" />
      </svg>
    )
  }
  if (status === 'running') {
    return (
      <span className="block w-2 h-2 rounded-full border-2 border-white/30 border-t-white animate-spin" />
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
  /** 历史模式：禁用 running 脉冲动画（与 web data-source="history" 一致） */
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
        'flex gap-2.5 rounded transition-colors',
        expanded && 'is-expanded',
        historical && 'is-historical'
      )}
      data-status={status}
    >
      {/* 左侧时间轴指示器列：圆点 + 上下连线 */}
      <div className="relative shrink-0 w-6 min-h-[50px]">
        {showTopLine && (
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-[18px] bg-border" />
        )}
        <div
          className={cn(
            'absolute top-[18px] left-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center z-10 transition-all',
            config.dotClass,
            status === 'running' && !historical && 'animate-pulse'
          )}
        >
          <StatusDot status={status} />
        </div>
        {showBottomLine && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 w-px bottom-0 bg-border" />
        )}
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div
          className="flex items-center justify-between gap-2 min-h-[50px] py-0 pr-1 cursor-pointer select-none shrink-0 focus:outline-none focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-1 rounded"
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-controls={bodyId}
          id={headerId}
          onClick={onToggle}
          onKeyDown={handleKeyDown}
        >
          <span className="flex items-center gap-1 min-w-0 flex-1 text-sm font-semibold whitespace-nowrap">
            <span className="text-muted-foreground font-medium shrink-0">{index + 1}.</span>
            <span className={cn('truncate', config.titleClass)}>{toolCall.name}</span>
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              ({index + 1}/{total})
            </span>
            <span className="text-muted-foreground inline-flex items-center justify-center">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </div>
        </div>

        <div
          id={bodyId}
          aria-labelledby={headerId}
          className={cn(
            'overflow-hidden transition-all duration-200 pr-1',
            expanded ? 'max-h-[600px] opacity-100 mb-3' : 'max-h-0 opacity-0'
          )}
        >
          {description && (
            <pre className="mt-1 mb-1 p-2 text-[11px] text-muted-foreground bg-muted/40 rounded font-mono whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
              {description}
            </pre>
          )}
          {status === 'done' && toolCall.result && (
            <div className="mt-1.5 p-2 text-xs text-muted-foreground bg-green-500/5 border-l-2 border-green-500 rounded whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
              <span className="block text-[10px] font-semibold text-green-600 mb-1">执行结果</span>
              {toolCall.result}
            </div>
          )}
          {status === 'failed' && toolCall.errorMessage && (
            <div className="mt-1.5 p-2 text-xs text-red-600 bg-red-500/5 border-l-2 border-red-500 rounded whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto">
              <span className="block text-[10px] font-semibold text-red-600 mb-1">错误信息</span>
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
  // 折叠态：UI-only，无需持久化（与 web 端 planExecuteStore.collapsedSteps 等价但更轻量）
  const [collapsedSteps, setCollapsedSteps] = useState<Record<string, boolean>>({})

  const toggleStep = (id: string) => {
    setCollapsedSteps((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const list = toolCalls ?? []
  const total = list.length
  const done = list.filter((t) => t.status === 'completed').length
  const failed = list.filter((t) => t.status === 'error').length
  const historical = !isStreaming // 非流式视为历史回放，禁用 running 脉冲

  const allCompleted = useMemo(
    () =>
      total > 0 &&
      list.every((t) => t.status === 'completed' || t.status === 'error'),
    [list, total]
  )

  // 空态：phase 优先级 error > 有工具
  if (total === 0) {
    if (phase === 'error' && error) {
      return (
        <div className="flex flex-col items-center justify-start gap-2 pt-4 px-3 text-center">
          <div className="w-7 h-7 rounded-full bg-red-500 text-white flex items-center justify-center text-sm font-bold shrink-0">
            ✕
          </div>
          <div className="text-xs font-semibold text-red-600">任务失败</div>
          {error && (
            <div className="text-[11px] text-muted-foreground leading-relaxed max-w-[260px] break-words whitespace-pre-wrap">
              {error}
            </div>
          )}
        </div>
      )
    }
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        {phase === 'thinking'
          ? '正在思考...'
          : phase === 'executing'
            ? '正在执行...'
            : '等待任务开始'}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0" data-source={historical ? 'history' : 'live'}>
      {/* 思考过程提示行（流式思考中且无工具时仍可看到，与工具列表共存） */}
      {isStreaming && thinking && (
        <div className="px-3 py-2 mb-1 text-[11px] text-muted-foreground bg-muted/30 border-l-2 border-blue-500/40 rounded-r whitespace-pre-wrap break-words max-h-[120px] overflow-y-auto shrink-0">
          <span className="block text-[10px] font-semibold text-blue-600 mb-0.5">思考过程</span>
          {thinking}
        </div>
      )}

      {/* 摘要行 */}
      <div className="flex items-center gap-2.5 px-1 pt-2.5 pb-3 border-b border-border mb-1 shrink-0">
        <span className="text-xs text-muted-foreground">
          已完成 <strong className="text-foreground font-semibold">{done}</strong> / {total} 步
        </span>
        {failed > 0 && <span className="text-[11px] text-red-600">{failed} 失败</span>}
      </div>

      {/* 全局错误条（已有工具但后续执行失败） */}
      {phase === 'error' && error && (
        <div className="flex items-start gap-1.5 px-2.5 py-2 mb-2 bg-red-500/8 rounded border-l-2 border-red-500 shrink-0">
          <span className="text-red-600 font-bold text-xs shrink-0 leading-relaxed">✕</span>
          <span className="text-xs text-red-600 leading-relaxed break-words whitespace-pre-wrap">
            {error}
          </span>
        </div>
      )}

      {/* 时间轴列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto py-1 px-1">
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
