// ============================================================
// HitlToolConfirmDialog — HITL 工具审批弹窗（一期主链路）
// 展示待批准的工具调用（工具名 + 参数），approve / reject，可带 modified_args
// 视觉对齐现有 ConfirmDialog：圆角卡片、无阴影、底栏按钮右对齐
// ============================================================

import { useState } from 'react'
import { ChevronDown, ShieldCheck } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { useHitlStore, type HitlItem } from '@/stores/hitlStore'
import { cn } from '@/lib/utils'

export function HitlToolConfirmDialog({ item }: { item: HitlItem }) {
  const resolve = useHitlStore((s) => s.resolve)
  const dismiss = useHitlStore((s) => s.dismiss)
  const [showEdit, setShowEdit] = useState(false)
  const [resolving, setResolving] = useState(false)

  const toolCalls = item.toolCalls ?? []

  // 每个工具的「修改后参数」JSON 文本（初始为原参数格式化）
  const [argEdits, setArgEdits] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const tc of toolCalls) init[tc.id] = JSON.stringify(tc.args ?? {}, null, 2)
    return init
  })

  const close = () => {
    if (!resolving) dismiss()
  }

  const handleApprove = async () => {
    if (resolving) return
    setResolving(true)
    // 改参批准：按 tool_call_id 覆盖原参数；JSON 解析失败的项忽略（保持原参）
    let modifiedArgs: Record<string, Record<string, unknown>> | null = null
    if (showEdit) {
      for (const tc of toolCalls) {
        try {
          const parsed = JSON.parse(argEdits[tc.id] ?? '')
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            modifiedArgs ??= {}
            modifiedArgs[tc.id] = parsed as Record<string, unknown>
          }
        } catch {
          // 保持原参
        }
      }
    }
    await resolve(true, null, modifiedArgs)
  }

  const handleReject = async () => {
    if (resolving) return
    setResolving(true)
    await resolve(false, '用户拒绝了该工具调用')
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent
        hideClose
        className="w-[460px] max-w-[90vw] !rounded-[12px] !p-6 !gap-0 shadow-xl border"
      >
        <DialogHeader className="!space-y-0 !text-left">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="h-5 w-5 shrink-0 text-amber-500" />
            <h2 className="text-base font-semibold leading-none text-foreground">需要你的确认</h2>
          </div>
        </DialogHeader>

        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          {item.message || 'Agent 请求执行以下操作，请确认是否批准。'}
        </p>

        {/* 待审批工具列表 */}
        <div className="space-y-2 max-h-[260px] overflow-y-auto mb-4">
          {toolCalls.map((tc, i) => (
            <div key={tc.id} className="rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-[11px] font-semibold text-amber-600">
                  {i + 1}
                </span>
                <span className="font-mono text-sm font-medium text-foreground">{tc.name}</span>
              </div>
              <pre className="mt-2 overflow-x-auto rounded-md bg-background p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {JSON.stringify(tc.args ?? {}, null, 2)}
              </pre>
            </div>
          ))}
        </div>

        {/* 修改参数折叠区 */}
        {toolCalls.length > 0 && (
          <div className="mb-4">
            <button
              type="button"
              onClick={() => setShowEdit((v) => !v)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <ChevronDown className={cn('size-3.5 transition-transform', showEdit && 'rotate-180')} />
              修改参数
            </button>
            {showEdit && (
              <div className="mt-2 space-y-3">
                {toolCalls.map((tc) => (
                  <div key={tc.id}>
                    <Label className="mb-1 block font-mono text-[11px] text-muted-foreground">
                      {tc.name}
                    </Label>
                    <textarea
                      value={argEdits[tc.id] ?? ''}
                      onChange={(e) => setArgEdits((prev) => ({ ...prev, [tc.id]: e.target.value }))}
                      spellCheck={false}
                      className="h-28 w-full resize-y rounded-md border border-input bg-background p-2 font-mono text-[11px] leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="!flex-row !justify-end !gap-2 sm:space-x-0">
          <Button variant="outline" size="sm" onClick={handleReject} disabled={resolving} className="h-8 px-4">
            拒绝
          </Button>
          <Button variant="default" size="sm" onClick={handleApprove} disabled={resolving} className="h-8 px-4">
            {resolving ? '处理中…' : '批准并继续'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
