// ============================================================
// HitlChoiceDialog — HITL 多选确认弹窗（图2）
// RadioGroup 单选（一期）或多选，选项来自 item.options，确认 → resolve()。
// 一期后端无节点支撑，仅做前端就绪（kind='choice' 事件到达时可渲染）。
// ============================================================

import { useState } from 'react'
import { ListChecks } from 'lucide-react'
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
  const dismiss = useHitlStore((s) => s.dismiss)
  const [value, setValue] = useState<string>(item.options?.[0]?.id ?? '')
  const [resolving, setResolving] = useState(false)

  const options = item.options ?? []

  const close = () => {
    if (!resolving) dismiss()
  }

  const handleConfirm = async () => {
    if (resolving) return
    setResolving(true)
    // 单选：把所选 id 作为 feedback 回传；后续多选可扩展为逗号分隔
    await resolve(true, value || undefined)
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
          {item.message || item.question || 'Agent 需要你从以下选项中选择一个。'}
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
        </RadioGroup>

        <DialogFooter className="!flex-row !justify-end !gap-2 sm:space-x-0">
          <Button variant="outline" size="sm" onClick={close} disabled={resolving} className="h-8 px-4">
            取消
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={handleConfirm}
            disabled={resolving || !value}
            className="h-8 px-4"
          >
            {resolving ? '确认中…' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
