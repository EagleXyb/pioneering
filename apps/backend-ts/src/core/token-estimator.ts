/**
 * Token 估算（统一口径）
 *
 * 背景：历史实现统一用 `length / 4`，对中文系统性低估（中文单字常接近 1 token），
 * 导致上下文预算放行过多历史、配额预扣与结算偏小。
 *
 * 这里按字符类别估算，而不是换一个固定除数：
 *   - CJK（汉字 / 假名 / 谚文 / 全角标点）：1 字符 ≈ 1 token（保守上界）
 *   - 拉丁字母与其他符号：4 字符 ≈ 1 token
 *   - 数字：3 字符 ≈ 1 token
 *   - 空白：5 字符 ≈ 1 token
 *
 * 有上游真实 usage 时必须优先使用真实值；本函数只作为缺失 usage 时的兜底，
 * 并保证「上下文预算 / 配额预扣 / 用量结算」三处采用同一口径。
 */

const CJK_RE =
  /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/u
const DIGIT_RE = /[0-9]/u
const WHITESPACE_RE = /\s/u

export function estimateTokens(text: string, _model?: string | null): number {
  if (!text) return 0

  let total = 0
  for (const ch of text) {
    if (CJK_RE.test(ch)) total += 1
    else if (WHITESPACE_RE.test(ch)) total += 0.2
    else if (DIGIT_RE.test(ch)) total += 1 / 3
    else total += 0.25
  }

  return Math.max(1, Math.ceil(total))
}

/** 估算一段对话的输入 token（逐条累加，避免长文本被单条上界截断）。 */
export function estimateMessagesTokens(
  messages: ReadonlyArray<{ content: string }>,
  model?: string | null,
): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content, model), 0)
}
