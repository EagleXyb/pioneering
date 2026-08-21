// ============================================================
// HitlClarifyDialog — HITL 澄清追问弹窗（图1）
// 自由文本 input，发送 → resolve({ feedback })。一期后端无节点支撑，
// 仅做前端就绪（kind='clarifying' 事件到达时可渲染）。
// ============================================================

import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { useHitlStore, type HitlItem } from '@/stores/hitlStore'

export function HitlClarifyDialog({ item }: { item: HitlItem }) {
  const resolve = useHitlStore((s) => s.resolve)
  const dismiss = useHitlStore((s) => s.dismiss)
  const [value, setValue] = useState('')
  const [resolving, setResolving] = useState(false)

  const close = () => {
    if (!resolving) dismiss()
  }

  const handleSend = async () => {
    if (resolving) return
    setResolving(true)
    await resolve(true, value.trim() || undefined)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent
        hideClose
        className="w-[460px] max-w-[90vw] !rounded-[12px] !p-6 !gap-0 shadow-xl border"
      >
        <DialogHeader className="!space-y-0 !text-left">
          <div className="flex items-center gap-2 mb-1">
            <HelpCircle className="h-5 w-5 shrink-0 text-blue-500" />
            <h2 className="text-base font-semibold leading-none text-foreground">需要你补充信息</h2>
          </div>
        </DialogHeader>

        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          {item.question || item.message || '请补充必要的信息，以便 Agent 继续执行。'}
        </p>

        <div className="mb-5">
          <Label htmlFor="hitl-clarify-input" className="mb-1.5 block">
            你的回复
          </Label>
          <Input
            id="hitl-clarify-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder="输入回复…"
            autoFocus
            disabled={resolving}
          />
        </div>

        <DialogFooter className="!flex-row !justify-end !gap-2 sm:space-x-0">
          <Button variant="outline" size="sm" onClick={close} disabled={resolving} className="h-8 px-4">
            取消
          </Button>
          <Button variant="default" size="sm" onClick={handleSend} disabled={resolving} className="h-8 px-4">
            {resolving ? '发送中…' : '发送'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
