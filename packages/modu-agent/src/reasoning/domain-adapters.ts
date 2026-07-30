// P1-4: 领域适配器注册表（对应文档 §2.1 四层 Prompt 解耦架构 — Domain Adapter 层）
//
// 设计要点：
//   1. 注册表模式：新领域接入仅需追加条目，不修改 PromptComposer 主逻辑
//   2. 查找失败返回 null（不抛异常），由调用方决定降级策略
//   3. 领域适配器输出为纯文本片段，由 PromptComposer 拼接到 domain 层
//
// 风险控制（对应风险登记表 R-08）：
//   - DOMAIN_ADAPTERS 查找失败时返回 null，PromptComposer 跳过 domain 层
//   - 默认 domain 为空字符串，等价现状（零侵入）

/**
 * 领域适配器结构（对应文档 §2.1 DOMAIN_ADAPTERS 字典条目）。
 *
 * 每个领域适配器声明该领域的：
 *   - 上下文声明（角色定位）
 *   - 术语表（key=术语，value=释义）
 *   - 推理模式提示（数组，每项一条规则）
 *   - 输出要求
 */
export interface DomainAdapter {
  /** 领域上下文声明（如 "你是金融分析领域的专业Agent"） */
  domain_context: string
  /** 领域术语表（key=术语，value=释义） */
  terminology?: Record<string, string>
  /** 领域推理模式提示（数组，每项一条规则） */
  reasoning_patterns?: string[]
  /** 输出要求（如 "数值结果保留2位小数"） */
  output_requirements?: string
}

/**
 * 领域适配器注册表。
 *
 * 初始为空对象——宿主应用按需通过 registerDomainAdapter 追加领域条目。
 * 不在此处内置任何领域，避免 prompt 膨胀与默认行为偏移（对应 R-08 策略④：domain 默认空，等价现状）。
 */
export const DOMAIN_ADAPTERS: Record<string, DomainAdapter> = {}

/**
 * 注册领域适配器。
 *
 * @param domain 领域标识（如 'financial_analysis'）
 * @param adapter 领域适配器配置
 */
export function registerDomainAdapter(domain: string, adapter: DomainAdapter): void {
  if (!domain) throw new Error('domain must be non-empty')
  DOMAIN_ADAPTERS[domain] = adapter
}

/**
 * 查询领域适配器。
 *
 * @param domain 领域标识
 * @returns 适配器实例；未注册或 domain 为空时返回 null（不抛异常）
 */
export function getDomainAdapter(domain: string | null | undefined): DomainAdapter | null {
  if (!domain) return null
  return DOMAIN_ADAPTERS[domain] ?? null
}

/**
 * 将领域适配器渲染为 prompt 片段。
 *
 * 渲染顺序：domain_context → terminology → reasoning_patterns → output_requirements
 * 各子项之间以双换行分隔；空子项跳过。
 *
 * @param adapter 领域适配器（null 时返回空字符串）
 * @returns 渲染后的文本片段；adapter 为 null 或全空时返回空字符串
 */
export function renderDomainAdapter(adapter: DomainAdapter | null): string {
  if (!adapter) return ''
  const parts: string[] = []
  if (adapter.domain_context) parts.push(adapter.domain_context)
  if (adapter.terminology && Object.keys(adapter.terminology).length > 0) {
    const terms = Object.entries(adapter.terminology)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n')
    parts.push(`领域术语表：\n${terms}`)
  }
  if (adapter.reasoning_patterns && adapter.reasoning_patterns.length > 0) {
    const patterns = adapter.reasoning_patterns.map((p) => `- ${p}`).join('\n')
    parts.push(`领域推理模式：\n${patterns}`)
  }
  if (adapter.output_requirements) parts.push(`输出要求：${adapter.output_requirements}`)
  return parts.join('\n\n')
}
