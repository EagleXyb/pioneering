/**
 * HitlInlineCard —— HITL 内嵌卡（Pro & Task 共用）
 *
 * T1.1：共享外壳（图标/标题/队列序号/X 中止）+ clarifying（文本作答）
 * 与 choice（点击选项即答）两类分支。
 * T1.2：tool_confirm 分支（工具列表 + JSON 改参 + 批准/拒绝）。
 *
 * 组件不 import 任何 web / desktop 私有模块；样式全部走 CSS 变量以适配明暗主题。
 */
import { useState, type FormEvent } from 'react'
import { HelpCircle, ShieldCheck, X, Loader2 } from 'lucide-react'
import type { HitlKind } from '../types.js'
import { HitlToolConfirmBody, type HitlToolCall } from './HitlToolConfirmBody.js'
import './HitlInlineCard.css'

export interface HitlCardOption {
  id: string
  label: string
  description?: string
}

export interface HitlInlineCardProps {
  kind: HitlKind
  question?: string
  message?: string
  options?: HitlCardOption[]
  /** 队列序号（从 1 开始）与总项数：显示「第 N / M 项」 */
  index?: number
  total?: number
  /** 最近一次答复失败原因（卡片内展示） */
  error?: string | null
  /** resolving 中：禁用全部交互并显示 loading */
  busy?: boolean
  /** clarifying：提交自由文本回答 */
  onAnswer?: (text: string) => void
  /** choice：点击选项即答 */
  onSelectOption?: (optionId: string) => void
  /** 跳过本问（仅 clarifying/choice；tool_confirm 不显示） */
  onSkip?: () => void
  /** X：放弃整个 run（通知宿主中止） */
  onDismiss?: () => void
  // —— tool_confirm 专属（T1.2）——
  /** 待审批工具列表 */
  toolCalls?: HitlToolCall[]
  /** 高危/敏感操作视觉标记 */
  sensitive?: boolean
  /** 批准（modifiedArgs=null 表示未改参），返回 false 表示恢复未启动 */
  onApprove?: (
    modifiedArgs: Record<string, Record<string, unknown>> | null,
  ) => void | Promise<boolean>
  /** 拒绝并说明，返回 false 表示恢复未启动 */
  onReject?: (feedback: string) => void | Promise<boolean>
}

export function HitlInlineCard({
  kind,
  question,
  message,
  options,
  index,
  total,
  error,
  busy = false,
  onAnswer,
  onSelectOption,
  onSkip,
  onDismiss,
  toolCalls,
  sensitive,
  onApprove,
  onReject,
}: HitlInlineCardProps) {
  const [text, setText] = useState('')

  // tool_confirm 之外才可跳过（对齐 hitlStore.skip 的约束）
  const answerable = kind !== 'tool_confirm'
  const fallbackTitle = answerable
    ? 'Agent 需要你补充信息后才能继续。'
    : '需要你的确认'
  const title = question || message || fallbackTitle

  const submitAnswer = (e: FormEvent) => {
    e.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    onAnswer?.(value)
  }

  return (
    <div className="ap-hitl-panel" role="region" aria-label="等待用户确认">
      <div className="ap-hitl-header">
        {answerable ? (
          <HelpCircle className="ap-hitl-icon" aria-hidden />
        ) : (
          <ShieldCheck className="ap-hitl-icon ap-hitl-icon--warn" aria-hidden />
        )}
        <span className="ap-hitl-title">{title}</span>
        {!!index && (
          <span className="ap-hitl-index">
            {index}
            {total ? `/${total}` : ''}
          </span>
        )}
        {onDismiss && (
          <button
            type="button"
            className="ap-hitl-x"
            onClick={onDismiss}
            disabled={busy}
            aria-label="取消并中止本次执行"
            title="取消并中止本次执行"
          >
            <X className="ap-hitl-x-icon" aria-hidden />
          </button>
        )}
      </div>

      {kind === 'choice' && (
        <div className="ap-hitl-options" role="listbox" aria-label="候选方向">
          {(options ?? []).map((opt, i) => (
            <button
              key={opt.id}
              type="button"
              role="option"
              className="ap-hitl-option"
              onClick={() => !busy && onSelectOption?.(opt.id)}
              disabled={busy}
              title="选择该方向并发送"
            >
              <span className="ap-hitl-option-no" aria-hidden>
                {i + 1}
              </span>
              <span className="ap-hitl-option-text">
                <span className="ap-hitl-option-label">{opt.label}</span>
                {opt.description && (
                  <span className="ap-hitl-option-desc">{opt.description}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}

      {kind === 'clarifying' && (
        <form className="ap-hitl-form" onSubmit={submitAnswer}>
          <textarea
            className="ap-hitl-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入补充信息，回车提交（Shift+Enter 换行）"
            rows={2}
            disabled={busy}
            aria-label="澄清回答"
          />
          <div className="ap-hitl-form-actions">
            {answerable && onSkip && (
              <button
                type="button"
                className="ap-hitl-skip"
                onClick={onSkip}
                disabled={busy}
              >
                跳过
              </button>
            )}
            <button type="submit" className="ap-hitl-submit" disabled={busy || !text.trim()}>
              {busy && <Loader2 className="ap-hitl-spin" aria-hidden />}
              提交回答
            </button>
          </div>
        </form>
      )}

      {/* tool_confirm 分支（T1.2） */}
      {kind === 'tool_confirm' && (
        <HitlToolConfirmBody
          toolCalls={toolCalls ?? []}
          busy={busy}
          sensitive={sensitive}
          onApprove={async (modifiedArgs) => (await onApprove?.(modifiedArgs)) ?? false}
          onReject={async (feedback) => (await onReject?.(feedback)) ?? false}
        />
      )}

      {error && <p className="ap-hitl-error">{error}</p>}
    </div>
  )
}
