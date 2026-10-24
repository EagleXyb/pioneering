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
  /**
   * P0（RP-2）：是否强制"非核心层不得覆盖角色/安全约束"。
   *
   * 开启后，domain / taskSpec / runtimeContext 中若出现与核心层同名的保留段落
   * （IDENTITY / SCOPE / DECISION POLICY / REFUSAL / SAFETY），该段落会被剥离。
   * 默认 false，保证既有字符等价测试与默认路径零变化；create_agent 显式开启。
   */
  enforcePolicy?: boolean
}

/** 只允许出现在核心层的保留段落标题（大小写不敏感前缀匹配）。 */
const _RESERVED_HEADINGS: ReadonlyArray<string> = [
  'IDENTITY',
  'AUDIENCE',
  'SCOPE',
  'NON-GOALS',
  'DECISION POLICY',
  'CAPABILITIES',
  'DELIVERY CONTRACT',
  'REFUSAL',
  'SAFETY',
  'SAFETY & TRUTHFULNESS',
  'TOOL BUDGET',
  'USER PREFERENCE',
]

/**
 * 剥离文本中的保留段落（P0 / RP-2）。
 *
 * 仅识别 `## <Heading>` 形式的段落；标题命中 `_RESERVED_HEADINGS` 时整段移除。
 * 返回剥离后的文本；未命中时原样返回，保证默认路径字符等价。
 */
export function dropReservedSections(text: string): string {
  if (!text) return text
  const blocks = text.split(/\n(?=##\s+)/)
  const kept = blocks.filter((block) => {
    const m = block.match(/^##\s+([^\n]+)/)
    if (!m) return true
    const title = m[1].trim().toUpperCase()
    return !_RESERVED_HEADINGS.some((r) => title === r || title.startsWith(`${r} `))
  })
  return kept.join('\n').trim()
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

    // P0（RP-2）：非核心层不得覆盖身份/安全约束。
    const guard = (text: string): string =>
      input.enforcePolicy === true ? dropReservedSections(text) : text

    // Domain 层：通过 DOMAIN_ADAPTERS 注册表查找并渲染
    if (input.domain) {
      const adapter = getDomainAdapter(input.domain)
      const rendered = renderDomainAdapter(adapter)
      const safe = rendered ? guard(rendered) : ''
      if (safe) parts.push(safe)
    }

    // TaskSpec 层：直接拼接（由调用方组装内容）
    if (input.taskSpec) {
      const safe = guard(input.taskSpec)
      if (safe) parts.push(safe)
    }

    // RuntimeContext 层：直接拼接
    if (input.runtimeContext) {
      const safe = guard(input.runtimeContext)
      if (safe) parts.push(safe)
    }

    return parts.join('\n\n')
  }
}
