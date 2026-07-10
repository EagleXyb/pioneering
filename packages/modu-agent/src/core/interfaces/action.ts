// 对应 Python: core/interfaces/action.py
// BaseActionExecutor + BaseTool 抽象接口（含 HITL 钩子）

/**
 * 行动执行器抽象接口。
 * 对应 Python BaseActionExecutor（execute / list_actions）。
 */
export abstract class BaseActionExecutor {
  abstract execute(
    actionName: string,
    params: Record<string, any>,
    context: Record<string, any>,
  ): Promise<Record<string, any>> | Record<string, any>

  abstract listActions(): string[]
}

/**
 * 工具抽象基类。
 * 对应 Python BaseTool（name / description / parameters_schema / invoke + HITL 钩子）。
 *
 * 工具是 ModuAgent 的行动原语，通过 tool_adapter 适配为 LangChain BaseTool 后
 * 进入 LangGraph ToolNode。
 */
export abstract class BaseTool {
  abstract name(): string
  abstract description(): string
  abstract parametersSchema(): Record<string, any>
  abstract invoke(
    params: Record<string, any>,
    context: Record<string, any>,
  ): Promise<Record<string, any>> | Record<string, any>

  // === P3-12.3.2 Human-in-the-loop ===

  /**
   * 是否需要人工审批（默认 false，敏感工具覆写为 true）。
   */
  requiresApproval(): boolean {
    return false
  }

  /**
   * 审批拒绝时返回的降级结果。
   * 默认实现返回标准化错误结构；敏感工具可覆写以提供更友好的降级响应。
   */
  onApprovalRejected(_params: Record<string, any>): Record<string, any> {
    return {
      status: 'error',
      error_code: 'TOOL_APPROVAL_REJECTED',
      data: { message: 'Tool execution rejected by human reviewer' },
    }
  }
}
