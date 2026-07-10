// 对应 Python: modu_graph/adapters/mcp_tool_adapter.py
// MCP Tool → ModuAgent BaseTool 适配器。
//
// 将 MCP 远程工具适配为 ModuAgent BaseTool 接口，
// 使 LangGraph 的 ToolNode 可无感调用。
//
// 设计原则：
//   - 零侵入：MCP 工具适配为 BaseTool 子类后，与内置工具
//     （calculator/search/code_executor 等）在 registry 和图中无差异。
//   - 异步原生：JS 中 ToolNode 调用 StructuredTool 的 async func，
//     适配器内部直接使用 async/await 调用 MCP 异步接口。
//   - 复用现有基础设施：HITL 审批、重试、事件发布等机制对 MCP 工具同样生效。
//
// 调用链路:
//   ToolNode → StructuredTool.func → MCPToolAdapter.invoke
//   → MCPClient.call_tool → MCPSession.call_tool → Transport.request
//   → JSON-RPC → MCP Server → 返回结果
import { BaseTool } from '../../core/interfaces/action.js'
import { getMcpClient } from '../../mcp/client.js'
import type { ToolInfo } from '../../mcp/discovery.js'
import { MCPError, MCPTimeoutError } from '../../mcp/errors.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.mcp_tool_adapter] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.mcp_tool_adapter] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.mcp_tool_adapter] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.mcp_tool_adapter] ${msg}`, ...args),
}

/**
 * 将 MCP 远程工具适配为 ModuAgent BaseTool。
 *
 * 每个 ToolInfo 实例对应一个 MCPToolAdapter。
 * 注册到 ComponentRegistry 后，build_langchain_tools() 自动取出，
 * 经 wrap_modu_tool() 包装为 StructuredTool，绑定到 LLM。
 */
export class MCPToolAdapter extends BaseTool {
  private _toolInfo: ToolInfo
  private _mcpClient: any

  constructor(toolInfo: ToolInfo) {
    super()
    this._toolInfo = toolInfo
    this._mcpClient = getMcpClient()
  }

  /**
   * 工具全限定名（server_name__raw_name）。
   *
   * 使用全限定名避免不同 Server 的同名工具冲突。
   */
  name(): string {
    return this._toolInfo.qualifiedName
  }

  /**
   * 工具描述（来自 MCP Server 的 tools/list 响应）。
   *
   * 在描述前缀中标注来源 Server，便于 LLM 区分工具来源。
   */
  description(): string {
    const desc = this._toolInfo.description
    const server = this._toolInfo.serverName
    return `[MCP:${server}] ${desc}`
  }

  /** JSON Schema 参数定义（来自 MCP Server 的 inputSchema）。 */
  parametersSchema(): Record<string, any> {
    return this._toolInfo.toBaseToolSchema()
  }

  /**
   * 调用 MCP 远程工具。
   *
   * JS 中直接使用 async/await 调用 MCP 异步接口。
   *
   * 返回结构与内置工具一致：{"status": "success/error", "data": {...}}
   */
  async invoke(
    params: Record<string, any>,
    context: Record<string, any>,
  ): Promise<Record<string, any>> {
    try {
      const result = await this._invokeAsync(params)
      return this._formatResult(result)
    } catch (e: any) {
      if (e instanceof MCPTimeoutError) {
        logger.error("MCP tool '%s' timeout: %s", this.name(), e)
        return {
          status: 'error',
          error_code: e.error_code,
          data: { message: String(e), tool: this.name() },
        }
      }
      if (e instanceof MCPError) {
        logger.error("MCP tool '%s' error: %s", this.name(), e)
        return {
          status: 'error',
          error_code: e.error_code,
          data: { message: String(e), tool: this.name() },
        }
      }
      // 执行隔离：捕获未预期异常
      logger.error("MCP tool '%s' unexpected error: %s", this.name(), e)
      return {
        status: 'error',
        error_code: 'MCP_000',
        data: { message: String(e), tool: this.name() },
      }
    }
  }

  /**
   * 异步调用 MCP 工具。
   *
   * @param params 工具参数
   * @returns MCP 标准返回格式
   */
  private async _invokeAsync(params: Record<string, any>): Promise<Record<string, any>> {
    return await this._mcpClient.callTool(
      this._toolInfo.qualifiedName,
      params,
      30.0,
    )
  }

  /**
   * 将 MCP 返回格式转换为 ModuAgent 标准结构。
   *
   * MCP 返回格式:
   *   {"content": [{"type": "text", "text": "..."}], "isError": false}
   *
   * ModuAgent 标准结构:
   *   {"status": "success", "data": {"result": ...}}
   */
  private _formatResult(mcpResult: Record<string, any>): Record<string, any> {
    const isError = mcpResult.isError || false
    const content = mcpResult.content || []

    // 提取文本内容
    const textParts: string[] = []
    for (const item of content) {
      if (typeof item === 'object' && item.type === 'text') {
        textParts.push(item.text || '')
      }
    }

    const resultText = textParts.length > 0
      ? textParts.join('\n')
      : JSON.stringify(mcpResult)

    if (isError) {
      return {
        status: 'error',
        error_code: 'MCP_004',
        data: { message: resultText, tool: this.name() },
      }
    }

    return {
      status: 'success',
      data: {
        result: resultText,
        source: 'mcp',
        server: this._toolInfo.serverName,
      },
    }
  }

  /**
   * MCP 工具默认不需要审批。
   *
   * 可通过配置 tools.human_in_loop.sensitive_tools 指定
   * 特定 MCP 工具名需审批（由 human_review_node 的 _tool_requires_approval 检查）。
   */
  requiresApproval(): boolean {
    return false
  }
}
