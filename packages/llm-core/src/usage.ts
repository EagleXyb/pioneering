// 用量与成本核算（P1）
import type { ChatUsage, ModelDescriptor } from '@pioneering/llm-contracts'

/** 粗略 token 估算（无 tokenizer 时的兜底，约 4 字符 / token）。 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.max(1, Math.ceil(text.length / 4))
}

/** 合并两次用量（流式多段上报时使用，字段逐项累加）。 */
export function mergeUsage(a?: ChatUsage, b?: ChatUsage): ChatUsage | undefined {
  if (!a && !b) return undefined
  const sum = (x?: number, y?: number) =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0)
  return {
    promptTokens: sum(a?.promptTokens, b?.promptTokens),
    completionTokens: sum(a?.completionTokens, b?.completionTokens),
    totalTokens: sum(a?.totalTokens, b?.totalTokens),
  }
}

/**
 * 按目录单价估算成本（美元）。
 *
 * 价格语义沿用现有目录：每百万 token 的输入/输出单价。
 * 缺少价格或缺少用量时返回 undefined（不伪造 0）。
 */
export function computeCost(
  model: Pick<ModelDescriptor, 'pricing'>,
  usage?: ChatUsage,
): number | undefined {
  if (!usage || !model.pricing) return undefined
  const inputPrice = model.pricing.input_price
  const outputPrice = model.pricing.output_price
  if (inputPrice === undefined && outputPrice === undefined) return undefined

  const prompt = usage.promptTokens
  const completion = usage.completionTokens
  if (prompt === undefined && completion === undefined) return undefined

  const cost =
    ((prompt ?? 0) / 1_000_000) * (inputPrice ?? 0) +
    ((completion ?? 0) / 1_000_000) * (outputPrice ?? 0)
  return Number.isFinite(cost) ? cost : undefined
}
