// CoT 锚点模板与反思后缀（对应文档 P0-2：思维链锚点 + 反思式推理后缀）
//
// 在 Thought 阶段强制插入结构化"锚点"，防止推理偏移；
// 在确定下一步 Action 前插入反思自检，提升单轮推理质量。
//
// 设计要点：
//   1. 锚点模板与反思后缀作为独立常量，由 factory.ts 按 tier 条件拼接
//   2. tier_3 强制启用锚点 + 反思，tier_2 启用锚点，tier_1 可选（默认关闭）
//   3. 总 token 控制在 300 以内，避免挤压有效上下文
//
// 风险控制（对应风险登记表 R-02）：
//   - 仅修改 prompt 字符串拼接，不改变图拓扑/路由/状态
//   - feature flag enable_cot_anchor 控制开关，默认 false
//   - 下游不强制解析 Thought 结构（function calling 模式下 LLM 直接输出 tool_calls）

import type { ComplexityTier } from './complexity-assessor.js'

/**
 * CoT 锚点模板（对应文档 P0-2 策略 B）。
 *
 * 强制 LLM 在每个 Thought 轮次中按结构化锚点组织思考，
 * 防止推理偏移与"盲目行动"。
 *
 * 控制在 ~200 tokens 以内。
 */
export const COT_ANCHOR_TEMPLATE = `
THOUGHT ANCHOR TEMPLATE (organize your thinking each round, can be concise but key items must not be omitted):
[Current Goal] The specific problem to solve in this round
[Known Info] Key facts extracted from Observation
[Missing Info] What still needs to be obtained
[Next Step] What tool to call / what to do
[Expected Result] What you expect to get
[Risk Preview] What might go wrong
`.trim()

/**
 * 反思式推理后缀（对应文档 P0-2 策略 B）。
 *
 * 在 LLM 确定下一步 Action 前插入自检提示，
 * 减少逻辑跳跃与工具选择失误。
 *
 * 控制在 ~100 tokens 以内。
 */
export const REFLECTION_SUFFIX = `
Before finalizing your next Action, self-check:
1. Is there any logical leap in the current reasoning?
2. Is there a more efficient tool choice?
3. If the current plan fails, what is the fallback?
`.trim()

/**
 * Tier 到 CoT 配置的映射。
 *
 * tier_1: 默认不启用锚点（快速直答，避免 prompt 膨胀）
 * tier_2: 启用锚点（结构化思考，但跳过反思以控制延迟）
 * tier_3: 启用锚点 + 反思（深度推理，强制自检）
 */
export const TIER_COT_CONFIG: Record<ComplexityTier, {
  enable_anchor: boolean
  enable_reflection: boolean
}> = {
  tier_1: { enable_anchor: false, enable_reflection: false },
  tier_2: { enable_anchor: true, enable_reflection: false },
  tier_3: { enable_anchor: true, enable_reflection: true },
}

/**
 * 按 tier 组装 CoT 增强 prompt 片段。
 *
 * @param tier 复杂度层级（null 时按 tier_2 处理，等价默认）
 * @param forceEnable 强制启用（忽略 tier 配置，用于 feature flag override）
 * @returns 拼接后的 CoT prompt 片段；未启用时返回空字符串
 */
export function composeCotPrompt(
  tier: ComplexityTier | null | undefined,
  forceEnable: boolean = false,
): string {
  // tier 缺失时按 tier_2 处理（等价默认行为，不改变现状）
  const effectiveTier: ComplexityTier = tier ?? 'tier_2'
  const config = TIER_COT_CONFIG[effectiveTier] ?? TIER_COT_CONFIG.tier_2

  const useAnchor = forceEnable || config.enable_anchor
  const useReflection = forceEnable || config.enable_reflection

  const parts: string[] = []
  if (useAnchor) parts.push(COT_ANCHOR_TEMPLATE)
  if (useReflection) parts.push(REFLECTION_SUFFIX)

  return parts.length > 0 ? parts.join('\n\n') : ''
}
