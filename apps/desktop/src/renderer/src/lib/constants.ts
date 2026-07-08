// ============================================================
// UI 常量集中 — 收口散落在各处的魔法数，避免数值漂移
// ============================================================

/** 最近项目保留上限（useWorkspaceStore.addRecentProject 的 slice 上限） */
export const RECENT_PROJECTS_LIMIT = 10

/** 三栏 / 覆盖布局断点（像素，按平台区分，见 useResponsiveLayout） */
export const LAYOUT_BREAKPOINT_MAC = 980
export const LAYOUT_BREAKPOINT_DEFAULT = 1080

/** 会话列表行高（像素，用于 @tanstack/react-virtual 固定行高虚拟化） */
export const CONVERSATION_ROW_HEIGHT = 34
export const CONVERSATION_LIST_OVERSCAN = 8
