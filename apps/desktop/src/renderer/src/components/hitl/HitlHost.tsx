// ============================================================
// HitlHost — HITL 弹窗挂载容器
// 阶段三 3.2/3.3：订阅 hitlStore，按 currentItem.kind 分发给三类弹窗。
// 挂在 App.tsx 的 RootLayout 之外（Router 之外），保证设置/聊天页切换不卸载，
// 暂停项不丢失；resolving 期间 currentItem 已置空，自动关闭弹窗。
// ============================================================

import { useHitlStore } from '@/stores/hitlStore'
import { HitlToolConfirmDialog } from './HitlToolConfirmDialog'
import { HitlChoiceDialog } from './HitlChoiceDialog'
import { HitlClarifyDialog } from './HitlClarifyDialog'

export function HitlHost() {
  const currentItem = useHitlStore((s) => s.currentItem)
  const status = useHitlStore((s) => s.status)

  // 无展示项或处于 resume 进行中：不渲染弹窗
  if (!currentItem || status === 'resolving' || status === 'idle') return null

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
}
