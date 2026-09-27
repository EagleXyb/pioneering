// ============================================================
// HitlChoiceDialog — HITL 多选确认弹窗（图2）
// RadioGroup 单选（一期）或多选，选项来自 item.options，确认 → resolve()。
//
// 阶段三补强：
//   - 回答以 answerId（选项 id）回传，语义与工具审批 feedback 解耦
//   - "跳过"接入 hitlStore.skip()；resume 失败时展示 store.error
// ============================================================

import { useState } from 'react'
import { ListChecks, SkipForward } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { useHitlStore, type HitlItem } from '@/stores/hitlStore'

export function HitlChoiceDialog({ item }: { item: HitlItem }) {
  const resolve = useHitlStore((s) => s.resolve)
  const skip = useHitlStore((s) => s.skip)
  const dismiss = useHitlStore((s) => s.dismiss)
  const error = useHitlStore((s) => s.error)
  const [value, setValue] = useState<string>(item.options?.[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  const options = item.options ?? []

  const close = () => {
    if (!busy) dismiss()
  }

  const handleConfirm = async () => {
    if (busy) return
    setBusy(true)
    // 选项 id 作为 answerId 回传（自由文本补充走 HitlClarifyDialog / 内联澄清条）
    const ok = await resolve({ approved: true, answerId: value || undefined })
    if (!ok) setBusy(false)
  }

  const handleSkip = async () => {
    if (busy) return
    setBusy(true)
    const ok = await skip()
    if (!ok) setBusy(false)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent
        hideClose
        className="w-[460px] max-w-[90vw] !rounded-[12px] !p-6 !gap-0 shadow-xl border"
      >
        <DialogHeader className="!space-y-0 !text-left">
          <div className="flex items-center gap-2 mb-1">
            <ListChecks className="h-5 w-5 shrink-0 text-violet-500" />
            <h2 className="text-base font-semibold leading-none text-foreground">请选择一个选项</h2>
          </div>
        </DialogHeader>

        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          {item.question || item.message || 'Agent 需要你从以下选项中选择一个。'}
        </p>

        <RadioGroup value={value} onValueChange={setValue} className="mb-5 gap-2">
          {options.map((opt) => (
            <div
              key={opt.id}
              className="flex items-center space-x-2 rounded-md border border-input px-3 py-2"
            >
              <RadioGroupItem value={opt.id} id={`hitl-choice-${opt.id}`} />
              <Label htmlFor={`hitl-choice-${opt.id}`} className="flex-1 cursor-pointer py-0">
                {opt.label}
              </Label>
            </div>
          ))}
          {options.length === 0 && (
            <p className="rounded-md border border-dashed border-input px-3 py-2 text-xs text-muted-foreground">
              暂无可选项，可在输入框直接补充说明后发送。
            </p>
          )}
        </RadioGroup>

        {error && (
          <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="!flex-row !justify-end !gap-2 sm:space-x-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleSkip()}
            disabled={busy}
            className="mr-auto h-8 px-3 text-muted-foreground"
          >
            <SkipForward className="mr-1 size-3.5" />
            跳过
          </Button>
          <Button variant="outline" size="sm" onClick={close} disabled={busy} className="h-8 px-4">
            取消
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleConfirm}
            disabled={busy || !value}
            className="h-8 px-4"
          >
            {busy ? '确认中…' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
