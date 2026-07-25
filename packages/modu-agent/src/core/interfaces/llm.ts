// 统一 LLM 接口抽象
//
// 对应文档 §2.1 LLM 调用抽象建议：
//   - 定义统一 interface ModuLLM，让 BaseLLMReasoner 与 ChatOpenAI 适配层均实现该接口
//   - invoke() 返回结构化 LLMResult，替代三元组 [content, usage, toolCalls] 反模式
//   - 支持 bindTools / withRetry 链式调用
//
// 设计目标：消除双轨 LLM 抽象（自研 BaseLLMReasoner 与 LangChain ChatOpenAI）带来的
// 维护负担与鸭子类型适配，使调用方统一面向 ModuLLM 接口编程。

// ============================================================
// 消息与工具调用类型
// ============================================================

/**
 * LLM 消息角色。
 * 对应 OpenAI Chat Completions 协议的 role 字段。
 */
export type LLMMessageRole = 'system' | 'user' | 'assistant' | 'tool'

/**
 * LLM 工具调用描述（assistant 消息内）。
 *
 * 对应 OpenAI 协议 message.tool_calls[i]：
 *   - id: 工具调用 ID（用于 tool 角色消息回引）
 *   - name: 工具名
 *   - arguments: 已解析的参数对象（JSON 字符串解析后的结构化值）
 */
export interface LLMToolCall {
  id: string
  name: string
  arguments: Record<string, any>
}

/**
 * 统一 LLM 消息结构。
 *
 * 与 LangChain BaseMessage 互转：
 *   - SystemMessage → { role: 'system', content }
 *   - HumanMessage → { role: 'user', content }
 *   - AIMessage → { role: 'assistant', content, tool_calls }
 *   - ToolMessage → { role: 'tool', content, tool_call_id }
 */
export interface LLMMessage {
  role: LLMMessageRole
  content: string
  /** assistant 消息携带的工具调用列表 */
  tool_calls?: LLMToolCall[]
  /** tool 角色消息回引的 tool_call.id */
  tool_call_id?: string
  /** 任意附加元数据（如 name、images 等），按需透传 */
  metadata?: Record<string, unknown>
}

// ============================================================
// 用量与结果类型
// ============================================================

/**
 * LLM token 用量统计。
 */
export interface LLMUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/**
 * LLM 调用结构化返回。
 *
 * 替代旧版 BaseLLMReasoner.reason() 的三元组 [content, usage, toolCalls]。
 */
export interface LLMResult {
  /** 生成的文本内容 */
  content: string
  /** token 用量（用于成本核算与指标采集） */
  usage: LLMUsage
  /** 原生 function calling 解析结果，无工具调用时为空数组 */
  toolCalls: LLMToolCall[]
  /** 完成原因：stop / length / tool_calls / content_filter 等 */
  finishReason: string
  /** 透传 Provider 原始响应（调试与降级用） */
  raw: Record<string, any>
}

// ============================================================
// 调用选项与重试配置
// ============================================================

/**
 * LLM 调用选项。
 *
 * 所有字段可选，由具体实现按优先级解析（显式选项 > 实例默认 > 配置兜底）。
 */
export interface LLMInvokeOptions {
  temperature?: number
  maxTokens?: number
  /** 覆盖实例默认模型 */
  model?: string
  /** 本次调用绑定的工具（覆盖实例已绑定工具） */
  tools?: any[]
  /** 流式输出是否启用（stream 方法忽略此字段） */
  stream?: boolean
  /** 会话 ID（透传至成本核算事件） */
  sessionId?: string
  /** 用户 ID（透传至成本核算事件） */
  userId?: string
  /** 链路追踪 ID（透传至成本核算事件与 span 属性） */
  traceId?: string
  /** 任务类型（透传至成本核算事件，便于按任务维度统计） */
  taskType?: string
}

/**
 * LLM 重试配置。
 *
 * 与 graph/adapters/retry.ts 的 llm.retry 配置对齐。
 */
export interface LLMRetryOptions {
  maxAttempts?: number
  baseDelay?: number
  maxDelay?: number
}

// ============================================================
// ModuLLM 统一接口
// ============================================================

/**
 * 统一 LLM 接口。
 *
 * 所有 LLM 实现（BaseLLMReasoner、ChatOpenAI 适配层、未来 LLMRouter 代理）
 * 均实现此接口，调用方面向接口编程，消除鸭子类型适配。
 *
 * 期望行为：
 *   - invoke(): 非流式调用，返回完整 LLMResult
 *   - stream(): 流式调用，异步生成器逐 chunk 产出文本（不含 usage/toolCalls，
 *               调用方如需 usage 应在流结束后通过 onDone 回调或单独 invoke 获取）
 *   - bindTools(): 返回绑定了工具的新实例（不可变语义，原实例不受影响）
 *   - withRetry(): 返回带重试包装的新实例
 *
 * 实现方负责：
 *   1. token 用量采集：在 invoke 内从 Provider 响应解析 usage 字段
 *   2. 成本核算：发布 EventDomain.LLM + EventAction.COST 事件到 EventBus
 *   3. 超时控制：尊重实例 _timeout 或 options.timeout
 *   4. 错误处理：网络错误、超时、4xx/5xx 按可重试性分类抛出
 */
export interface ModuLLM {
  /** 非流式调用 */
  invoke(messages: LLMMessage[], options?: LLMInvokeOptions): Promise<LLMResult>

  /** 流式调用，逐 chunk 产出文本 */
  stream(
    messages: LLMMessage[],
    options?: LLMInvokeOptions,
  ): AsyncGenerator<string, void, unknown>

  /** 绑定工具，返回新实例（原生 function calling） */
  bindTools(tools: any[]): ModuLLM

  /** 应用重试包装，返回新实例 */
  withRetry(opts?: LLMRetryOptions): ModuLLM

  /** 当前实例绑定的模型名 */
  readonly model: string

  /** Provider 标识（glm/deepseek/gpt/qwen 等） */
  readonly provider: string
}

// ============================================================
// LLMRouter 接口
// ============================================================

/**
 * LLM 路由上下文。
 *
 * 由调用方在请求时构造，传递给 LLMRouter 决策。
 */
export interface LLMRouteContext {
  /** 任务类型（如 'chat' / 'planning' / 'judge' / 'summarization'） */
  taskType?: string
  /** 预估复杂度，影响模型选择（low → flash/mini，high → pro/max） */
  estimatedComplexity?: 'low' | 'medium' | 'high'
  /** 成本预算（token 单价 cents），超出则降级到更便宜模型 */
  costBudget?: number
  /** 会话 ID（便于按会话维度做粘性路由） */
  sessionId?: string
  /** 用户 ID */
  userId?: string
}

/**
 * LLM 模型路由器。
 *
 * 按任务复杂度 / 类型 / 成本预算路由到不同模型实例，
 * 实现简单问题用 flash、复杂问题用 pro 的成本优化策略。
 *
 * 简单实现（RuleBasedLLMRouter）按 llm.router.rules 配置匹配；
 * 复杂路由规则（如基于历史负载动态切换）可由宿主自行实现此接口注入。
 */
export interface LLMRouter {
  /** 根据上下文选择 LLM 实例 */
  route(ctx: LLMRouteContext): ModuLLM
}
