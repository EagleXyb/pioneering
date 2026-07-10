// 对应 Python: core/interfaces/reasoning.py
// BaseReasoningEngine + BaseReasoningStrategy 抽象接口

/**
 * 推理引擎抽象接口。
 * 对应 Python BaseReasoningEngine（reason / stream）。
 *
 * reason 返回元组 [content, usage, tool_calls]：
 *   - content: 生成的文本
 *   - usage: token 用量 { prompt_tokens, completion_tokens, total_tokens }
 *   - tool_calls: 原生 function calling 解析结果
 *     [{ tool, parameters }, ...]，无工具调用时为空数组
 */
export abstract class BaseReasoningEngine {
  abstract reason(
    prompt: string,
    context: Record<string, any>,
    ...args: any[]
  ): Promise<[string, Record<string, number>, Array<Record<string, any>>]>

  abstract stream(
    prompt: string,
    context: Record<string, any>,
  ): AsyncGenerator<string, void, unknown>
}

/**
 * 推理策略抽象接口。
 * 对应 Python BaseReasoningStrategy（name / select_engine / should_fallback）。
 */
export abstract class BaseReasoningStrategy {
  abstract name(): string

  abstract selectEngine(context: Record<string, any>): BaseReasoningEngine

  abstract shouldFallback(error?: Error | null): boolean
}
