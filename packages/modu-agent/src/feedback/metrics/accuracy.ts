// 对应 Python: feedback/metrics/accuracy.py
// AccuracyMetrics: 工具调用准确性指标

export class AccuracyMetrics {
  /** 工具调用准确性指标。 */

  /**
   * 计算工具调用准确性。
   *
   * 指标：
   * - success_rate：工具调用成功率
   * - error_rate：错误率
   * - avg_time：平均执行时间
   */
  calculate(
    toolResults: Array<Record<string, any>>,
    expectedResults?: Array<Record<string, any>>,
  ): Record<string, number> {
    if (!toolResults || toolResults.length === 0) {
      return {
        success_rate: 0.0,
        error_rate: 0.0,
        avg_time: 0.0,
      }
    }

    const total = toolResults.length
    let successCount = 0
    let errorCount = 0
    let totalTime = 0.0

    for (const result of toolResults) {
      if (result.success === true) {
        successCount += 1
      } else {
        errorCount += 1
      }

      if ('execution_time' in result) {
        totalTime += result.execution_time
      }
    }

    return {
      success_rate: successCount / total,
      error_rate: errorCount / total,
      avg_time: total > 0 ? totalTime / total : 0.0,
    }
  }
}
