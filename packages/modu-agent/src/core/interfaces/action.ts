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
   * 动态敏感性判定（对应文档 §2.5 建议6）。
   *
   * 基于具体参数动态判定是否需要审批，补充 requiresApproval() 的静态判定：
   *   - 默认实现回退到 requiresApproval()，保持向后兼容
   *   - 敏感工具可覆写以实现参数级判定，例如：
   *       http_request：URL 匹配内网 CIDR 时才需审批
   *       file_ops：写入操作需审批，读取操作不需要
   *
   * @param params   工具调用参数
   * @param context  调用上下文（含 user_id / session_id 等）
   * @returns 是否需要人工审批
   */
  requiresApprovalFor(
    _params: Record<string, any>,
    _context: Record<string, any>,
  ): boolean {
    return this.requiresApproval()
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

  // === P4 Plan-and-Execute 工具元数据 ===

  /**
   * 声明本工具是否提供实时/外部数据（对应文档 §4.1 建议7）。
   *
   * Plan-Execute 模式的 Planner 节点优先读取此元方法推断 step.requires_tool，
   * 替代旧版基于关键词硬编码的 _REALTIME_DATA_KEYWORDS 兜底逻辑：
   *   - 默认 false：纯计算/格式化工具（如 calculator）不强制 step 调用工具
   *   - 覆写为 true：search_engine / datetime / http_request 等返回实时/外部数据
   *                 的工具，Planner 据此将相关步骤标记为 requires_tool=true，
   *                 step_finalize 会校验是否实际调用了工具
   *
   * 注意：返回 true 仅声明"工具能力"，不强制 LLM 必须调用本工具；
   *       Planner 仍可基于 step description 决定是否在 plan 中引用本工具。
   *
   * @returns 本工具是否提供实时/外部数据
   */
  providesRealtimeData(): boolean {
    return false
  }

  // === 工具元数据 ===

  /**
   * 工具版本号（对应文档 §4.3 建议8）。
   *
   * 用于工具 schema 升级时的兼容性检测与运行时调度决策：
   *   - 默认 '1.0.0'：所有未覆写的工具默认版本
   *   - 工具实现可在 schema 升级时覆写返回值（如 '2.0.0'）
   *   - 调用方可结合 version() 与 parametersSchema() 做版本化路由
   *
   * 遵循 semver 语义：
   *   - major 升级：破坏性 schema 变更（删字段/改类型）
   *   - minor 升级：向后兼容的新增字段
   *   - patch 升级：描述/文档修正
   *
   * @returns semver 格式版本字符串
   */
  version(): string {
    return '1.0.0'
  }

  /**
   * 声明本工具的后续推荐工具（对应文档 §4.3 建议9）。
   *
   * 用于工具组合 API：当本工具执行完成后，可推荐一组"自然的下一步工具"，
   * 供 LLM 或编排层在 ReAct 决策时参考。例如：
   *   - search_engine → 返回 [http_request]（搜索结果中的 URL 可继续抓取）
   *   - http_request → 返回 [code_executor]（抓取的 HTML 可由代码执行器解析）
   *
   * 默认实现返回空数组，表示无推荐后续工具。
   *
   * 设计原则：
   *   - 仅声明"工具间组合关系"，不强制 LLM 必须调用推荐工具
   *   - 由 tool_adapter 注入到工具描述中（如 "[followUp: http_request]"），
   *     让 LLM 在 prompt 中可见，但仍由 LLM 自主决策
   *   - 不替代 ReAct 循环，仅作为决策提示
   *
   * @returns 推荐的后续工具名列表（空数组表示无推荐）
   */
  followUpTools(): string[] {
    return []
  }
}
