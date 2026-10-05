// ============================================================
// HitlHost — HITL 待答复项挂载容器（审批内嵌化后的空宿主）
//
// 通道收敛历史：
//   - 阶段三：三类中断（tool_confirm / clarifying / choice）均渲染居中模态弹窗；
//   - 阶段四：clarifying / choice 迁入输入框上方内嵌条；
//   - 审批内嵌化：tool_confirm 同样迁入输入框上方内嵌卡（工具列表 + 参数
//     展开/改参 + 拒绝/批准，见 ChatArea → InputArea 的 pro-input-hitl-panel）。
//
// T20 清理（修复任务清单 T20）：原 resolveHitlSurface() 纯函数在全部 HITL 统一为
// inline 通道后已无生产调用方（仅测试引用），已随其单测一并删除，避免维护者
// 按注释改一个不会被任何渲染路径读取的「回退开关」。
//
// 当前宿主恒返回 null；挂载位置保留在 App.tsx（Router 之外），
// 设置/聊天页切换不卸载，便于未来新增「必须模态」的中断类型时直接在此挂载。
//
// 回退方式（若未来某类中断需要恢复模态弹窗）：
//   1. 在本文件直接按 useHitlStore 的 currentItem.kind 条件渲染对应 Dialog；
//   2. 恢复下方注释模板中的挂载逻辑（弹窗组件文件均完整保留）；
//   3. 无需恢复任何 surface 决策层——inline/dialog 的取舍直接在此组件表达。
// ============================================================

// import { useHitlStore } from '@/stores/hitlStore'
// import { useChatStore } from '@/stores/chatStore'
// import { HitlToolConfirmDialog } from './HitlToolConfirmDialog'

export function HitlHost() {
  // 审批已内嵌到输入框上方，模态弹窗通道无路由，宿主恒为空。
  return null
}

/* —— 回退模板（某类中断重新需要模态弹窗时在此按 kind 条件挂载）——
import { ListChecks } from 'lucide-react'

export function HitlHost() {
  const currentItem = useHitlStore((s) => s.currentItem)
  const status = useHitlStore((s) => s.status)
  const queueLength = useHitlStore((s) => s.pendingQueue.length)
  const currentSessionId = useChatStore((s) => s.currentSessionId)

  // 归属校验：非当前会话的暂停项不在此弹窗（答复入口会先切换会话）
  if (!currentItem || status === 'resolving' || status === 'idle') return null
  if (currentSessionId && currentItem.sessionId !== currentSessionId) return null

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
