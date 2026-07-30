// ============================================================
// ObservationResult — 工具返回结果的智能展示（timeline 路径）
// 逻辑统一收口到 ToolResultRenderer，本组件仅保留语义包装。
// ============================================================

import { ToolResultRenderer } from './ToolResultRenderer'

interface ObservationResultProps {
  raw: string
  /** @deprecated 保留兼容，实际样式由 ToolResultRenderer 统一控制 */
  inline?: boolean
}

export function ObservationResult({ raw }: ObservationResultProps) {
  return <ToolResultRenderer raw={raw} variant="timeline" />
}
