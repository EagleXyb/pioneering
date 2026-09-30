// P1（T-10）：统一策略引擎契约（`PolicyEngine` / `PolicyRule`）。
//
// 背景（详见 `packages/docs/Agent架构分层解耦实施计划.md` §0.1 #1~#3 与 §4.1.3）：
//   权限是唯一**完全没有抽象接口**的底座 —— 判定散落在 4 处：
//     ① `perception/security/guard.ts` 的私有正则库（注入/PII/密钥/内网 IP）；
//     ② `tools/tool-guardrails.ts` 的 `ACTION_GUARDRAILS`（5 条）+ 判定纯函数
//        `decideToolApprovals`（P0 T-09 已把 `nodes.ts` 内联判定收敛于此）；
//     ③ 各工具的 `requiresApproval` / `requiresApprovalFor`；
//     ④ 输出护栏（`guard.ts` 的 `sanitizeOutput`，P0 T-05 以节点装饰器接线）。
//
// 本契约提供**三层统一判定入口**（input / tool / output），但不搬迁既有执行点：
//   - **判定层（本契约）**：只产出 `PolicyDecision`（allow / deny / require_approval）；
//   - **执行层（不变）**：
//       · tool  → `graph/nodes.ts` 的 `interrupt` 审批链路；
//       · output→ `perception/security/output-guard-node.ts` 的文本脱敏；
//       · input → `nodes.ts` 的 `routeAfterPerception` 路由阻断。
//   —— 见 D-18 决策："只登记规则、不迁执行"，避免双实现（风险 R-13）。
//
// 兼容关键（默认行为零变化）：
//   1. 无规则命中 → `allow`（等价现状）；
//   2. `require_approval` 等价于既有 `requiresApprovalFor() === true` 语义；
//   3. 整体受 `policy.engine.enabled`（默认 false）门控 —— 关闭时主链路完全走原路径。

/** 策略评估阶段（三层护栏统一入口）。 */
export type PolicyStage = 'input' | 'tool' | 'output'

/**
 * 待评估主体。
 *
 * - `input` 阶段：使用 `text`（用户输入文本）；
 * - `tool` 阶段：使用 `toolName` / `args` / `toolCalls`；
 * - `output` 阶段：使用 `text`（最终响应文本）。
 */
export interface PolicySubject {
  /** 阶段（须与 `PolicyRule.stage` 一致） */
  kind: PolicyStage
  /** 文本内容（input / output 阶段） */
  text?: string
  /** 工具名（tool 阶段，单工具判定时） */
  toolName?: string
  /** 工具参数（tool 阶段） */
  args?: Record<string, any>
  /** 工具元信息（tool 阶段，如静态 requiresApproval） */
  toolMeta?: { requiresApproval?: boolean }
  /**
   * 批量工具调用（tool 阶段）。
   *
   * 一次决策覆盖多个 `tool_calls`，避免每工具一次 `decide()` 调用；
   * 与 `tools/tool-guardrails.ts` 的 `decideToolApprovals(toolCalls, ...)` 对应。
   */
  toolCalls?: Array<Record<string, any>>
}

/** 评估上下文。 */
export interface PolicyContext {
  /** 用户 id */
  userId?: string
  /** 会话 id */
  sessionId?: string
  /** trace id */
  traceId?: string
  /** 任务类型 */
  taskType?: string
  /** 是否 dry-run（对应 `react_optimization.action_guardrails.dry_run_enabled`） */
  dryRun?: boolean
  /** tool 阶段：组件注册表（供规则委派工具自身的 `requiresApprovalFor`） */
  registry?: any
  /** tool 阶段：敏感工具名列表（`tools.human_in_loop.sensitive_tools`） */
  sensitiveTools?: string[]
  /** tool 阶段：是否启用 guardrail（`react_optimization.action_guardrails.enabled`） */
  guardrailsEnabled?: boolean
  /** tool 阶段：guardrail dry-run 预检（`react_optimization.action_guardrails.dry_run_enabled`） */
  guardrailDryRun?: boolean
}

/** 策略效果。 */
export type PolicyEffect = 'allow' | 'deny' | 'require_approval'

/**
 * 工具审批判定明细。
 *
 * 与 `tools/tool-guardrails.ts` 的 `ToolApprovalDecision` **结构兼容**
 * （后者可赋值给本类型），使 `PolicyEngine` 的判定结果可直接被
 * `human_review` 节点消费，无需二次映射。
 */
export interface ToolApprovalDetail {
  toolCallId: string
  toolName: string
  requiresApproval: boolean
  /** 判定来源（'guardrail' | 'sensitive_list' | 'tool_policy' | 'none' 等） */
  source: string
  ruleId?: string
}

/** 策略判定结果。 */
export interface PolicyDecision {
  effect: PolicyEffect
  /** 命中的规则 id（用于审计与调试） */
  ruleId?: string
  /** 判定原因（人类可读） */
  reason?: string
  /**
   * 脱敏/改写后的文本（output 阶段）。
   *
   * 注意：**执行方仍为 `output-guard-node.ts`**，本字段仅用于传递结果，
   * 不允许在引擎内直接改写响应（避免双脱敏）。
   */
  sanitizedText?: string
  /** tool 阶段：逐工具审批明细 */
  details?: ToolApprovalDetail[]
}

/**
 * 策略规则。
 *
 * 实现方应保证 `evaluate` 无副作用；异常由引擎逐项隔离（不中断判定链）。
 */
export interface PolicyRule {
  /** 规则唯一 id（用于审计与调试） */
  readonly id: string
  /** 适用阶段 */
  readonly stage: PolicyStage
  /** 优先级：数值越小越先评估（缺省视为 100） */
  readonly priority?: number
  /** 评估主体 */
  evaluate(
    subject: PolicySubject,
    ctx: PolicyContext,
  ): Promise<PolicyDecision> | PolicyDecision
}

/**
 * 策略引擎。
 *
 * 语义：
 *   - 按 `priority` 升序评估同阶段规则；
 *   - 首个返回非 `allow` 的规则**短路**（命中即返回）；
 *   - 全部规则返回 `allow`（或规则抛异常被隔离）→ 返回 `allow`；
 *   - 同阶段无规则 → `allow`（等价现状）。
 */
export interface PolicyEngine {
  /** 注册规则（同 id 覆盖） */
  use(rule: PolicyRule): void
  /** 执行判定 */
  decide(
    stage: PolicyStage,
    subject: PolicySubject,
    ctx?: PolicyContext,
  ): Promise<PolicyDecision>
  /** 列出规则 id（可按阶段过滤） */
  listRules(stage?: PolicyStage): string[]
  /**
   * 移除规则；返回规则此前是否存在。
   *
   * 场景包卸载 / `ComponentRegistry.unregisterPolicyRule` 时调用，
   * 保证规则从引擎内摘除，避免"注册表已删、引擎仍命中"的权限残留。
   */
  remove(id: string): boolean
}
