// 对应 Python: components/action/__init__.py
// 行动层组件包（P2-3: 补充模块导出；P0-优化: 补齐全部内置工具导出）

// @deprecated §4.3 建议7：SyncActionExecutor 已被 ToolNode + wrap_modu_tool 取代，
// 仅为向后兼容保留，新代码请使用 build_langchain_tools()。
export { SyncActionExecutor } from './synchronous-executor.js'
export { CalculatorTool } from './calculator.js'
export { SearchTool } from './search.js'
export { DateTimeTool } from './datetime-tool.js'
export { HttpRequestTool } from './http-request.js'
export { FileOpsTool } from './file-ops.js'
export { CodeExecutorTool } from './code-executor.js'
export { SqlQueryTool } from './sql-query.js'
// P1-5: 工具能力矩阵 + 意图路由
export {
  TOOL_CAPABILITY_MATRIX,
  registerToolCapability,
  getToolCapability,
  filterToolsByTaskType,
  filterToolsByIntent,
  filterToolsByTaskTypeAndIntent,
  type ToolCapability,
} from './tool-registry.js'
