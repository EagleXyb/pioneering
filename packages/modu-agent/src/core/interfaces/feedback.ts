// 对应 Python: core/interfaces/feedback.py
// BaseFeedbackLoop + BaseEvolutionSignal 抽象接口

/**
 * 反馈循环抽象接口。
 * 对应 Python BaseFeedbackLoop（evaluate / should_evolve）。
 */
export abstract class BaseFeedbackLoop {
  abstract evaluate(
    output: Record<string, any>,
    context: Record<string, any>,
  ): Promise<Record<string, any>> | Record<string, any>

  abstract shouldEvolve(metrics: Record<string, number>, threshold: number): boolean
}

/**
 * 进化信号抽象接口。
 * 对应 Python BaseEvolutionSignal（signal_type / generate）。
 */
export abstract class BaseEvolutionSignal {
  abstract signalType(): string

  abstract generate(
    source: string,
    metrics: Record<string, number>,
    context: Record<string, any>,
  ): Record<string, any>
}
