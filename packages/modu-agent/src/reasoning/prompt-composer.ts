// P1-4: 四层 Prompt 解耦架构（对应文档 §2.1 + §5.2 P1-4）
//
// 将 system prompt 拆解为四层，支持领域适配与任务规格注入：
//   1. System Prompt（通用层）：ReAct 框架规则 + 通用约束 + 安全护栏
//   2. Domain Adapter（领域适配层）：领域术语 + 推理模式 + 输出要求
//   3. Task Spec（任务规格层）：具体任务描述 + 输入/输出格式 + Few-shot 示例
//   4. Runtime Context（运行时上下文层）：用户画像 + 会话历史 + 环境信息
//
// 字符等价回归（对应风险 R-08 策略①）：
//   - compose({systemCore}) === systemCore（domain/taskSpec/runtimeContext 均空时）
//   - compose({systemCore, taskSpec}) === systemCore + '\n\n' + taskSpec
//   - 启用 PromptComposer 后，domain/runtimeContext 为空时输出与现状完全一致
//
// 设计原则：
//   - 纯函数 + 无副作用，便于单元测试
//   - 任一层缺失（null/空字符串）跳过该层，不产生多余分隔符
//   - DOMAIN_ADAPTERS 查找失败返回空字符串，不抛异常（策略②）

import {
  getDomainAdapter,
  renderDomainAdapter,
} from './domain-adapters.js'

/**
 * 四层 Prompt 组装输入。
 */
export interface PromptComposerInput {
  /** 通用系统提示词（必填，作为基础层） */
  systemCore: string
  /** 领域标识（如 'financial_analysis'）；空/null 时跳过 domain 层 */
  domain?: string | null
  /** 任务规格片段（Few-shot 示例、输出格式等）；空/null 时跳过 taskSpec 层 */
  taskSpec?: string | null
  /** 运行时上下文片段（用户画像、环境信息等）；空/null 时跳过 runtime 层 */
  runtimeContext?: string | null
}

/**
 * 四层 Prompt 组装器。
 *
 * 静态方法实现，无状态，便于单元测试与并发安全。
 *
 * 拼接顺序：systemCore → domain → taskSpec → runtimeContext
 * 各层之间以双换行（\n\n）分隔；空层跳过，不产生多余分隔符。
 */
export class PromptComposer {
  /**
   * 按四层架构组装 system prompt。
   *
   * @param input 四层输入
   * @returns 拼接后的 system prompt
   */
  static compose(input: PromptComposerInput): string {
    const parts: string[] = []
    if (input.systemCore) parts.push(input.systemCore)

    // Domain 层：通过 DOMAIN_ADAPTERS 注册表查找并渲染
    if (input.domain) {
      const adapter = getDomainAdapter(input.domain)
      const rendered = renderDomainAdapter(adapter)
      if (rendered) parts.push(rendered)
    }

    // TaskSpec 层：直接拼接（由调用方组装内容）
    if (input.taskSpec) parts.push(input.taskSpec)

    // RuntimeContext 层：直接拼接
    if (input.runtimeContext) parts.push(input.runtimeContext)

    return parts.join('\n\n')
  }
}
