// 对应 Python: components/action/executors/synchronous.py
// SyncActionExecutor：同步行动执行器（基于 ComponentRegistry 查找工具并调用）
import { BaseActionExecutor } from '../core/interfaces/action.js'
import type { ComponentRegistry } from '../core/registry.js'
import { getRegistry } from '../core/registry.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[sync-executor] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[sync-executor] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[sync-executor] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[sync-executor] ${msg}`, ...args),
}

/**
 * 同步行动执行器。
 * 对应 Python SyncActionExecutor。
 *
 * 通过 ComponentRegistry 查找已注册工具并调用其 invoke 方法。
 * 工具未找到返回 TOOL_001，执行异常返回 TOOL_002。
 *
 * 注：Python 版 execute 为同步方法；TS 版因 BaseTool.invoke 可返回 Promise，
 * 故 execute 标记为 async 以统一处理同步/异步工具。
 *
 * @deprecated 对应文档 §4.3 建议7：本类已被 LangGraph 的 ToolNode + wrap_modu_tool
 *   完全取代，生产路径已不再使用。保留仅为向后兼容与旧 Coordinator 调用方过渡，
 *   新代码请使用 `build_langchain_tools()` 构建工具并通过 ToolNode 调度。
 *   计划在 v2.0 移除。
 */
export class SyncActionExecutor extends BaseActionExecutor {
  private _registry: ComponentRegistry

  constructor(registry?: ComponentRegistry | null) {
    super()
    this._registry = registry ?? getRegistry()
  }

  async execute(
    actionName: string,
    params: Record<string, any>,
    context: Record<string, any>,
  ): Promise<Record<string, any>> {
    const tool = this._registry.getTool(actionName)
    if (tool === undefined) {
      logger.error('Tool not found: %s', actionName)
      return {
        status: 'error',
        error_code: 'TOOL_001',
        data: { message: `Tool not found: ${actionName}` },
      }
    }

    try {
      const result = await tool.invoke(params, context)
      logger.debug('Tool executed: %s', actionName)
      return result
    } catch (e) {
      logger.error('Tool execution error: %s - %s', actionName, String(e))
      return {
        status: 'error',
        error_code: 'TOOL_002',
        data: { message: `Tool execution failed: ${e}` },
      }
    }
  }

  listActions(): string[] {
    return Object.keys(this._registry.listTools())
  }
}
