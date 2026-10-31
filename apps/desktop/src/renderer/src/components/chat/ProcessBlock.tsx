// ============================================================
// ProcessBlock — Agent 执行过程折叠容器（扁平路径）
// 对齐 apps/web/src/components/message/ProcessContainer.tsx：
//   - 运行中：展开并逐块流出，标题显示状态与实时「已用时」（有进度感）
//   - 终态：自动收起为一行摘要（已完成 · 耗时 X），正文区只留最终回答，
//     多轮过程不再把消息撑长
//   - 展开后仍是思考块 / 工具动作行交错的过程序列
//
// 耗时取值：优先用调用方推导的 durationMs（历史消息由 toolCalls 时间戳
// 汇总）；实时流缺省时本地计时（容器挂载即开始，终态冻结）。
// 样式令牌映射：web 的 --text-secondary → text-muted-foreground、
// --bg-hover → bg-accent、--accent-blue → text-primary，字号走 rem
// 跟随 desktop 全局字体档位。
// ============================================================

import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProcessBlockProps {
  /** 是否仍在流式输出 */
  streaming?: boolean
  /** 推导耗时（毫秒）；历史消息由 toolCalls 起止时间提供，缺省时本地计时 */
  durationMs?: number | null
  children: ReactNode
}

/** 毫秒 → 「1 分 37 秒」/「8 秒」 */
function formatProcessDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}

export const ProcessBlock = memo(function ProcessBlock({
  streaming = false,
  durationMs = null,
  children
}: ProcessBlockProps) {
  // 运行中展开；流式 → 终态的跃迁自动收起（用户手动展开后不再被打断）
  const [open, setOpen] = useState(streaming)
  const prevStreamingRef = useRef(streaming)
  const mountedAtRef = useRef(Date.now())
  const frozenMsRef = useRef<number | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)

  useEffect(() => {
    const prev = prevStreamingRef.current
    prevStreamingRef.current = streaming
    if (prev && !streaming) {
      frozenMsRef.current = Date.now() - mountedAtRef.current
      setOpen(false)
    }
  }, [streaming])

  // 运行中的秒级计时（终态后停止，避免无意义重渲染）
  useEffect(() => {
    if (!streaming) return
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - mountedAtRef.current)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [streaming])

  const shownMs = durationMs ?? (streaming ? elapsedMs : frozenMsRef.current)

  // 摘要措辞：终态「已完成 · 耗时 X」；运行中「运行中 · 已用 X」
  const timePart =
    shownMs === null || shownMs === undefined
      ? ''
      : streaming
        ? ` · 已用 ${formatProcessDuration(shownMs)}`
        : ` · 耗时 ${formatProcessDuration(shownMs)}`
  const text = `${streaming ? '运行中' : '已完成'}${timePart}`

  return (
    <div className="my-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`执行过程，${text}`}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg py-1 pl-0.5 pr-2 -ml-0.5',
          'text-[1rem] leading-6 text-muted-foreground select-none',
          'transition-colors hover:text-foreground hover:bg-accent'
        )}
      >
        {streaming && (
          <span className="size-1.5 shrink-0 rounded-full bg-primary animate-pulse" aria-hidden />
        )}
        <span className="whitespace-nowrap">{text}</span>
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-200',
            open && 'rotate-90'
          )}
        />
      </button>

      {/* 展开/折叠容器：grid 0fr→1fr 高度过渡 + 淡入下滑（双向平滑） */}
      <div
        className={cn(
          'grid transition-[grid-template-rows,opacity,transform] duration-200 ease-out',
          open ? 'grid-rows-[1fr] opacity-100 translate-y-0' : 'grid-rows-[0fr] opacity-0 -translate-y-[3px]'
        )}
        aria-hidden={!open}
        inert={!open ? true : undefined}
      >
        <div className="overflow-hidden min-h-0">
          {/* 过程行统一垂直节奏 6px（对齐 web .tao-process-body 的 gap 规范） */}
          <div className="flex flex-col gap-1.5 pt-0.5">{children}</div>
        </div>
      </div>
    </div>
  )
})
