// 对应 Python: core/interfaces/reasoning.py
// BaseReasoningEngine + BaseReasoningStrategy 抽象接口

/**
 * 推理引擎抽象接口。
 * 对应 Python BaseReasoningEngine（reason）。
 *
 * reason 返回元组 [content, usage, tool_calls]：
 *   - content: 生成的文本
 *   - usage: token 用量 { prompt_tokens, completion_tokens, total_tokens }
 *   - tool_calls: 原生 function calling 解析结果
 *     [{ tool, parameters }, ...]，无工具调用时为空数组
 *
 * 统一 LLM 接口改造（对应文档 §2.1）：
 *   - 移除原 abstract stream(prompt, context)，避免与 ModuLLM.stream(messages, options)
 *     签名冲突（BaseLLMReasoner 同时 extends 本类并 implements ModuLLM）
 *   - 旧流式接口由 BaseLLMReasoner.astream(prompt, context) 提供（@deprecated）
 *   - 新代码应通过 ModuLLM.stream(messages, options) 消费
 *
 * @deprecated 整个类为旧推理抽象，新代码应面向 ModuLLM 接口编程。
 *             保留用于 ComponentRegistry 的历史 API 兼容。
 */
export abstract class BaseReasoningEngine {
  abstract reason(
    prompt: string,
    context: Record<string, any>,
    ...args: any[]
  ): Promise<[string, Record<string, number>, Array<Record<string, any>>]>
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
