// ============================================================
// UI 常量集中 — 收口散落在各处的魔法数，避免数值漂移
// ============================================================

/** 三栏 / 覆盖布局断点（像素，按平台区分，见 useResponsiveLayout） */
export const LAYOUT_BREAKPOINT_MAC = 980
export const LAYOUT_BREAKPOINT_DEFAULT = 1080

/** 会话列表行高（像素，用于 @tanstack/react-virtual 固定行高虚拟化） */
export const CONVERSATION_ROW_HEIGHT = 34
export const CONVERSATION_LIST_OVERSCAN = 8

/**
 * 消息列表虚拟化参数（P1 修复）
 * 消息高度差异大（短文本 ~60px，长代码块/工具调用可达数百 px），无法用固定行高，
 * 故 estimateSize 仅作初次渲染前的占位估算，实际高度由 measureElement 动态测量。
 */
export const MESSAGE_LIST_ESTIMATE_HEIGHT = 120
export const MESSAGE_LIST_OVERSCAN = 6
