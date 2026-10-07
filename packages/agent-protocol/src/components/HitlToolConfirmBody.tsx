/**
 * HitlToolConfirmBody —— 工具审批卡正文（tool_confirm）
 *
 * 逻辑移植自 desktop InputArea.tsx 的 HitlToolConfirmPanel，按 T1.2 要求增强：
 *   · 工具列表可折叠，参数格式化展示
 *   · 每工具独立「修改参数」textarea（预填原 args JSON）
 *   · JSON 非法时红字提示且禁用批准
 *   · 批准：无改参传 null；有改参按 tool_call_id 索引
 *   · 拒绝并说明：携带可选 feedback
 *   · 敏感工具视觉警示
 */
import { useMemo, useState } from 'react'
import { ChevronDown, AlertTriangle } from 'lucide-react'
import './HitlToolConfirmBody.css'

export interface HitlToolCall {
  id: string
  name: string
  args?: Record<string, unknown>
}

export interface HitlToolConfirmBodyProps {
  toolCalls: HitlToolCall[]
  /** 外部 busy（store resolving） */
  busy?: boolean
  /** 敏感/高危操作：显示警示徽标 */
  sensitive?: boolean
  /** 批准：modifiedArgs=null 表示未改参 */
  onApprove: (
    modifiedArgs: Record<string, Record<string, unknown>> | null,
  ) => void | Promise<boolean>
  /** 拒绝并说明 */
  onReject: (feedback: string) => void | Promise<boolean>
}

export function HitlToolConfirmBody({
  toolCalls,
  busy: externalBusy = false,
  sensitive = false,
  onApprove,
  onReject,
}: HitlToolConfirmBodyProps) {
  const [internalBusy, setInternalBusy] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [editMode, setEditMode] = useState<Record<string, boolean>>({})
  const [argEdits, setArgEdits] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const tc of toolCalls) init[tc.id] = JSON.stringify(tc.args ?? {}, null, 2)
    return init
  })
  const [rejectFeedback, setRejectFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)

  const busy = externalBusy || internalBusy

  /** 逐工具解析改参；收集非法 JSON 的工具 id */
  const { invalidIds, hasEdits } = useMemo(() => {
    const invalid: string[] = []
    let edits = false
    for (const tc of toolCalls) {
      if (!editMode[tc.id]) continue
      const text = argEdits[tc.id] ?? ''
      try {
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          invalid.push(tc.id)
          continue
        }
        edits = true
      } catch {
        invalid.push(tc.id)
      }
    }
    return { invalidIds: invalid, hasEdits: edits }
  }, [toolCalls, editMode, argEdits])

  const collectModifiedArgs = (): Record<string, Record<string, unknown>> | null => {
    if (!hasEdits || invalidIds.length) return null
    let modifiedArgs: Record<string, Record<string, unknown>> | null = null
    for (const tc of toolCalls) {
      if (!editMode[tc.id]) continue
      const parsed = JSON.parse(argEdits[tc.id] ?? '') as Record<string, unknown>
      modifiedArgs ??= {}
      modifiedArgs[tc.id] = parsed
    }
    return modifiedArgs
  }

  const runAction = async (action: () => boolean | void | Promise<boolean>) => {
    if (busy) return
    setInternalBusy(true)
    const ok = await action()
    if (ok === false) setInternalBusy(false)
  }

  return (
    <div className="ap-hitl-tool-body-wrap">
      {sensitive && (
        <span className="ap-hitl-sensitive">
          <AlertTriangle className="ap-hitl-sensitive-icon" aria-hidden />
          高危操作
        </span>
      )}

      <div className="ap-hitl-tools">
        {toolCalls.map((tc, i) => {
          const isOpen = !!expanded[tc.id]
          const isEdit = !!editMode[tc.id]
          const invalid = invalidIds.includes(tc.id)
          return (
            <div key={tc.id} className="ap-hitl-tool">
              <button
                type="button"
                className="ap-hitl-tool-head"
                onClick={() => setExpanded((p) => ({ ...p, [tc.id]: !p[tc.id] }))}
                aria-expanded={isOpen}
                disabled={busy}
              >
                <span className="ap-hitl-tool-no" aria-hidden>
                  {i + 1}
                </span>
                <span className="ap-hitl-tool-name">{tc.name}</span>
                <span className="ap-hitl-tool-args-summary">
                  {JSON.stringify(tc.args ?? {})}
                </span>
                <ChevronDown
                  className={`ap-hitl-tool-chevron${isOpen ? ' is-open' : ''}`}
                  aria-hidden
                />
              </button>
              {isOpen && (
                <div className="ap-hitl-tool-detail">
                  <pre className="ap-hitl-tool-args">{JSON.stringify(tc.args ?? {}, null, 2)}</pre>
                  <button
                    type="button"
                    className="ap-hitl-tool-edit-toggle"
                    onClick={() => setEditMode((p) => ({ ...p, [tc.id]: !p[tc.id] }))}
                    disabled={busy}
                  >
                    <ChevronDown
                      className={`ap-hitl-tool-edit-chevron${isEdit ? ' is-open' : ''}`}
                      aria-hidden
                    />
                    修改参数
                  </button>
                  {isEdit && (
                    <>
                      <textarea
                        spellCheck={false}
                        className={`ap-hitl-tool-edit${invalid ? ' is-invalid' : ''}`}
                        value={argEdits[tc.id] ?? ''}
                        onChange={(e) =>
                          setArgEdits((p) => ({ ...p, [tc.id]: e.target.value }))
                        }
                        aria-label={`${tc.name} 修改后参数（JSON）`}
                        disabled={busy}
                      />
                      {invalid && (
                        <p className="ap-hitl-tool-edit-error">JSON 格式非法，请修正后再批准</p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showFeedback && (
        <textarea
          className="ap-hitl-reject-input"
          value={rejectFeedback}
          onChange={(e) => setRejectFeedback(e.target.value)}
          placeholder="说明拒绝原因（可选）"
          rows={2}
          aria-label="拒绝原因说明"
          disabled={busy}
        />
      )}

      <div className="ap-hitl-actions">
        <button
          type="button"
          className="ap-hitl-btn is-reject"
          onClick={() =>
            void runAction(() => {
              if (!showFeedback) {
                setShowFeedback(true)
                return false // 首次点击展开说明输入，不真正发起
              }
              return onReject(rejectFeedback.trim())
            })
          }
          disabled={busy}
        >
          拒绝并说明
        </button>
        <button
          type="button"
          className="ap-hitl-btn is-approve"
          onClick={() => void runAction(() => onApprove(collectModifiedArgs()))}
          disabled={busy || invalidIds.length > 0}
        >
          {busy ? '处理中…' : '批准并继续'}
        </button>
      </div>
    </div>
  )
}
