// P2（T-14）: Prompt 注册表契约。
//
// 目标（对应评估报告 G-4「拓扑与提示词可注册」）：
//   把散落在 `graph/plan-execute/prompts.ts`、`graph/subgraph/builder.ts`、
//   `graph/factory.ts`、`graph/nodes.ts` 中的内联 prompt 收敛为**可注册模板**，
//   使宿主可替换/新增任务级 prompt 而**不改内核源码**。
//
// 字符等价约束（R-02 缓解）：
//   模板渲染必须与迁移前逐字节一致。`render()` 在变量缺失时**保留原占位符**
//   （`{{name}}` 原样输出），从而"未提供变量"不会产生空串或多余分隔符。
//
// 层归属：`core/interfaces/` 仅声明契约（零实现、零依赖），
//   实现位于 `reasoning/prompt-registry.ts`（DefaultPromptRegistry），
//   内置模板位于 `graph/prompt-templates.ts`（贴近其消费方）。

/** 模板消息角色（当前仅为 system/user，避免引入 LangChain 依赖）。 */
export type PromptRole = 'system' | 'user'

/** 模板中的单条消息。 */
export interface PromptMessage {
  role: PromptRole
  content: string
}

/**
 * Prompt 模板（对应实施计划 §4.3）。
 */
export interface PromptTemplate {
  /** 唯一 id，如 'plan_execute.planner' / 'subagent.research' / 'agent.default_system' */
  id: string
  /** 模板版本（宿主可据此做灰度替换） */
  version: string
  /** 适用任务类型（subagent 角色选择依据；缺省 = 通用） */
  taskTypes?: string[]
  /** 消息序列；`render()` 以 `'\n\n'` 连接各条消息内容 */
  messages: PromptMessage[]
  /** 模板变量名清单（用于校验；渲染时缺失的变量保留占位符） */
  variables?: string[]
}

/**
 * Prompt 注册表接口。
 */
export interface PromptRegistry {
  /** 注册模板（同 id 覆盖：宿主显式注册即视为权威）。 */
  register(tpl: PromptTemplate): void
  get(id: string): PromptTemplate | undefined
  has(id: string): boolean
  /**
   * 渲染指定 id 的模板；模板不存在时返回空字符串（调用方须据此回退）。
   *
   * 变量替换规则：`{{name}}` → `String(vars.name)`；`vars` 中缺失该键时
   * **原样保留 `{{name}}`**（字符等价保证）。
   */
  render(id: string, vars: Record<string, unknown>): string
  /** 渲染模板对象本身（不经注册表查找）。 */
  renderTemplate(tpl: PromptTemplate, vars: Record<string, unknown>): string
  /**
   * 注册表优先渲染，未注册时回退到 `fallback` 模板。
   *
   * 用途：调用点既支持"宿主注册覆盖"，又保证"未接线时（如单元测试直接调用）
   * 输出与迁移前逐字节一致"。
   */
  renderOr(id: string, vars: Record<string, unknown>, fallback: PromptTemplate): string
  /** 列出模板（可按 taskType 过滤；未声明 taskTypes 的模板视为通用，总是返回）。 */
  list(taskType?: string): PromptTemplate[]
}
