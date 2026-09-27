// ============================================================
// HitlHost — HITL 弹窗挂载容器
// 阶段三 3.2/3.3：订阅 hitlStore，按 currentItem.kind 分发给三类弹窗。
// 挂在 App.tsx 的 RootLayout 之外（Router 之外），保证设置/聊天页切换不卸载，
// 暂停项不丢失；resolving 期间 currentItem 已置空，自动关闭弹窗。
//
// 阶段三补强：
//   - 会话过滤：只展示属于当前会话的暂停项，杜绝"在 B 会话回答 A 会话的问题"
//     （切到对应会话由 hitlStore.resolve 自动完成）
//   - 队列徽标：串行多 interrupt 时提示"还有 N 个待答复"
// ============================================================

import { useHitlStore } from '@/stores/hitlStore'
import { useChatStore } from '@/stores/chatStore'
import { HitlToolConfirmDialog } from './HitlToolConfirmDialog'
import { HitlChoiceDialog } from './HitlChoiceDialog'
import { HitlClarifyDialog } from './HitlClarifyDialog'
import { ListChecks } from 'lucide-react'

export function HitlHost() {
  const currentItem = useHitlStore((s) => s.currentItem)
  const status = useHitlStore((s) => s.status)
  const queueLength = useHitlStore((s) => s.pendingQueue.length)
  const currentSessionId = useChatStore((s) => s.currentSessionId)

  // 无展示项或处于 resume 进行中：不渲染弹窗
  if (!currentItem || status === 'resolving' || status === 'idle') return null
  // 会话归属过滤：当前会话不是暂停项所属会话时不展示（避免误答其它会话）
  if (currentSessionId && currentItem.sessionId !== currentSessionId) return null

  const dialog = (() => {
    switch (currentItem.kind) {
      case 'tool_confirm':
        return <HitlToolConfirmDialog item={currentItem} />
      case 'choice':
        return <HitlChoiceDialog item={currentItem} />
      case 'clarifying':
        return <HitlClarifyDialog item={currentItem} />
      default:
        // 未知 kind 兜底：按工具审批处理
        return <HitlToolConfirmDialog item={currentItem} />
    }
  })()

  return (
    <>
      {dialog}
      {queueLength > 0 && (
        <div
          className="pointer-events-none fixed right-6 top-6 z-[60] inline-flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
          role="status"
          aria-live="polite"
        >
          <ListChecks className="size-3.5" />
          还有 {queueLength} 个待答复
        </div>
      )}
    </>
  )
}
