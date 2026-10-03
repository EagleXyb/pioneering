// ============================================================
// HitlHost — HITL 待答复项挂载容器（审批内嵌化后的空宿主）
//
// 通道收敛历史：
//   - 阶段三：三类中断（tool_confirm / clarifying / choice）均渲染居中模态弹窗；
//   - 阶段四：clarifying / choice 迁入输入框上方内嵌条；
//   - 审批内嵌化：tool_confirm 同样迁入输入框上方内嵌卡（工具列表 + 参数
//     展开/改参 + 拒绝/批准，见 ChatArea → InputArea 的 pro-input-hitl-panel）。
//
// 当前三类中断统一走 resolveHitlSurface()='inline'，由输入框卡片承接，
// 因此本宿主不再渲染任何弹窗（恒返回 null）。
//
// 回退方式：
//   1. 将 hitl-surface.ts 中对应 kind 改回 'dialog'；
//   2. 恢复下方被注释的 <HitlToolConfirmDialog item={currentItem} /> 分支。
//   弹窗组件文件（HitlToolConfirmDialog / HitlClarifyDialog / HitlChoiceDialog）
//   均完整保留，未被删除。
//
// 挂载位置保留在 App.tsx（Router 之外）：设置/聊天页切换不卸载，
// 也便于未来新增"必须模态"的中断类型时直接在此挂载。
// ============================================================

// import { useHitlStore } from '@/stores/hitlStore'
// import { useChatStore } from '@/stores/chatStore'
// import { resolveHitlSurface } from '@/lib/hitl-surface'
// import { HitlToolConfirmDialog } from './HitlToolConfirmDialog'

export function HitlHost() {
  // 审批已内嵌到输入框上方，模态弹窗通道无路由，宿主恒为空。
  return null
}

/* —— 回退模板（审批重新改回模态弹窗时恢复此实现）——
import { ListChecks } from 'lucide-react'

export function HitlHost() {
  const currentItem = useHitlStore((s) => s.currentItem)
  const status = useHitlStore((s) => s.status)
  const queueLength = useHitlStore((s) => s.pendingQueue.length)
  const currentSessionId = useChatStore((s) => s.currentSessionId)

  const surface = resolveHitlSurface(currentItem, status, currentSessionId)
  if (surface !== 'dialog' || !currentItem) return null

  return (
    <>
      <HitlToolConfirmDialog item={currentItem} />
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
*/
