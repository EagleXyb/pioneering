// 对应 Python: feedback/metrics/efficiency.py
// EfficiencyMetrics: 系统效率指标

export class EfficiencyMetrics {
  /** 系统效率指标。 */

  /**
   * 计算效率指标。
   *
   * 指标：
   * - token_efficiency：token 效率（output_tokens / input_tokens）
   * - iteration_efficiency：迭代效率（有用输出 / 迭代次数）
   * - tokens_per_second：吞吐量
   */
  calculate(
    usage: Record<string, number>,
    iterationCount: number,
    latencyMs: number,
  ): Record<string, number> {
    // P1-13 修复：兼容 state.ts 中 usage 的 prompt_tokens/completion_tokens
    // 与历史 input_tokens/output_tokens 两种字段命名
    const inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0
    const outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0

    // token_efficiency: output_tokens / input_tokens
    const tokenEfficiency = inputTokens > 0 ? outputTokens / inputTokens : 0.0

    // iteration_efficiency: output_tokens / iteration_count
    const iterationEfficiency = iterationCount > 0 ? outputTokens / iterationCount : 0.0

    // tokens_per_second: total_tokens / (latency_ms / 1000)
    const totalTokens = inputTokens + outputTokens
    const tokensPerSecond = latencyMs > 0 ? totalTokens / (latencyMs / 1000) : 0.0

    return {
      token_efficiency: tokenEfficiency,
      iteration_efficiency: iterationEfficiency,
      tokens_per_second: tokensPerSecond,
    }
  }
}
