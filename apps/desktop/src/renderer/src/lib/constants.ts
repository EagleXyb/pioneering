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
 * 工具名 → 中文显示名映射（P1）
 * 后端 toolName 为英文蛇形命名，这里归一为用户可读的自然语言。
 * 未命中的工具名原样返回，不阻断渲染。
 */
const TOOL_NAME_MAP: Record<string, string> = {
  datetime: '获取当前时间',
  search_engine: '网页搜索',
  web_search: '网页搜索',
  web_fetch: '网页抓取',
  python_execute: '执行 Python 代码',
  python: '执行 Python 代码',
  code_execute: '执行代码',
  file_read: '读取文件',
  file_write: '写入文件',
  file_search: '搜索文件',
  calculator: '计算器',
  weather: '查询天气',
  news: '新闻搜索',
  image_generate: '生成图片',
  image_search: '搜索图片',
  rag_search: '知识库检索',
  rag: '知识库检索',
  sql_query: '数据库查询',
  api_call: 'API 调用',
  url_fetch: '网页抓取'
}

/** 根据工具名获取中文显示名，未匹配时返回原始名称 */
export function getToolDisplayName(toolName: string): string {
  return TOOL_NAME_MAP[toolName] ?? toolName
}
