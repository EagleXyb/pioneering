// ============================================================
// HITL 展示通道决策（阶段4 → 审批内嵌化）
//
// 通道收敛历史：
//   - 阶段4：clarifying / choice 率先迁入输入框内联条，tool_confirm 保留模态弹窗；
//   - 审批内嵌化：tool_confirm 也改由输入框上方内嵌卡承载（工具列表 + 参数
//     展开/改参 + 拒绝/批准，见 InputArea 的 pro-input-hitl-panel），
//     三类 HITL 中断统一为 inline 通道，消除"弹窗 + 输入框锁定"的双阻塞。
//
// 决策收敛为纯函数：HitlHost 与测试共用同一份规则，
// 避免"卡片隐藏了但没有组件接管"的空窗状态。'dialog' 取值保留仅为类型向后兼容，
// 当前无任何 kind 会路由到模态弹窗（回退弹窗组件文件仍保留）。
// ============================================================

import type { UserQuestionRequestPayload } from '@shared/types'

/** 展示通道：dialog=模态弹窗（当前已无路由）；inline=输入框内嵌卡；none=不展示 */
export type HitlSurfaceKind = 'dialog' | 'inline' | 'none'

export interface HitlSurfaceItem {
  kind: UserQuestionRequestPayload['kind']
  sessionId: string
}

/**
 * 决策规则：
 *   1. 无展示项 / idle / resolving → none
 *   2. 暂停项不属于当前会话 → none（避免在 B 会话回答 A 会话的问题）
 *   3. tool_confirm / clarifying / choice 一律 → inline（统一内嵌卡）
 */
export function resolveHitlSurface(
  item: HitlSurfaceItem | null,
  status: 'idle' | 'paused' | 'awaiting' | 'resolving',
  currentSessionId: string | null,
): HitlSurfaceKind {
  if (!item || status === 'idle' || status === 'resolving') return 'none'
  if (currentSessionId && item.sessionId !== currentSessionId) return 'none'
  return 'inline'
}
