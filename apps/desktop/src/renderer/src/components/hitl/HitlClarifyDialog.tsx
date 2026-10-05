// ============================================================
// HitlClarifyDialog — HITL 澄清追问弹窗（图1）
// 自由文本 input，发送 → resolve({ answer })。后端 kind='clarifying' 事件到达时渲染。
//
// 阶段四：澄清已改由输入框上方内联澄清条承载（见 ChatArea/InputArea 的
// hitl 内联条），本组件当前无挂载点、保留作为回退组件——
// 恢复方式见 HitlHost 头部注释（T20：原 hitl-surface 决策层已删除）。
//
// 阶段三补强：
//   - "跳过"按钮接入 hitlStore.skip()（跳过本问、按现有信息继续执行）
//   - resume 未真正启动时展示 store.error（不再静默失败）
// ============================================================

import { useState } from 'react'
import { HelpCircle, SkipForward } from 'lucide-react'
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
  const skip = useHitlStore((s) => s.skip)
  const dismiss = useHitlStore((s) => s.dismiss)
  const error = useHitlStore((s) => s.error)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => {
    if (!busy) dismiss()
  }

  const handleSend = async () => {
    if (busy) return
    setBusy(true)
    const ok = await resolve({ approved: true, answer: value.trim() || undefined })
    // 失败时回滚到可编辑态，错误由 store.error 呈现
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
            disabled={busy}
          />
        </div>

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
          <Button variant="default" size="sm" onClick={handleSend} disabled={busy} className="h-8 px-4">
            {busy ? '发送中…' : '发送'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
