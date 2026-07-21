// 对应 Python: modu_graph/nodes.py
// ModuAgent LangGraph 图节点定义。
//
// 将 orchestration/coordinator.py 的 Coordinator 主流程拆解为独立节点函数，
// 用 LangGraph 编排替代 1047 行的"上帝类"。
//
// 节点列表：
//   - perceptionNode: 对应 _run_perception_pipeline + 敏感度熔断
//   - memoryQueryNode: 对应 _storage_adapter.query_all
//   - agentNode: 对应 _llm_adapter.generate + bind_tools（原生 function calling）
//   - toolsNode: 对应 _tool_adapter.invoke_tool（由 LangGraph ToolNode 接管）
//   - memoryUpdateNode: 记忆更新节点（新增）
//   - humanReviewNode (P3-12.3.2): 工具调用审批节点，敏感工具执行前 interrupt
//
// 路由函数：
//   - routeAfterPerception: 敏感度熔断 + 注入检测熔断
//   - routeAfterAgent: ReAct 循环退出判断（检查 tool_calls）
//   - routeAfterHumanReview (P3-12.3.2): 审批后路由（通过→tools，拒绝→response）
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import { interrupt } from '@langchain/langgraph'

import { getConfig } from '../config/runtime-config.js'
import { getRegistry } from '../core/registry.js'
import {
  buildPerceptionEventMetadata,
  extractPerceptionContext,
} from '../perception/index.js'
import {
  runPerceptionPipeline,
  runPerceptionPipelineAsync,
} from '../perception/pipeline.js'
import { get_event_bus } from '../orchestration/communication/message-bus.js'
import {
  AgentEvent,
  EventAction,
  EventDomain,
} from '../orchestration/communication/protocol.js'
import { create_consensus_strategy, ConsensusPattern } from '../orchestration/patterns/consensus.js'
import { _getSystemPrompt } from './subgraph/builder.js'
import type { ModuAgentState } from './state.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.nodes] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.nodes] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph.nodes] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph.nodes] ${msg}`, ...args),
}

// ============================================================
// 感知节点（对应 Coordinator._run_perception_pipeline + 熔断）
// ============================================================

/**
 * 从融合后的感知结果构建状态更新字典。
 *
 * 供 perceptionNode（异步）和 perceptionNodeSync（同步回退）共用。
 */
function _buildPerceptionResult(
  fused: Record<string, any> | null,
  prompt: string,
): Partial<ModuAgentState> {
  if (!fused) {
    return {
      perception_result: null,
      cleaned_text: prompt,
      sensitivity_level: 0,
      confidence: 1.0,
      detected_language: null,
      injection_detected: false,
      pii_detected: false,
    }
  }

  let cleanedText: string | null = null
  const parsedContent = fused['parsed_content']
  if (parsedContent) {
    cleanedText = parsedContent['text'] ?? null
  }

  const meta = fused['metadata'] ?? {}
  const detectedLevel = meta['sensitivity_level'] ?? 0
  const confidence = fused['confidence'] ?? 1.0
  const injectionDetected = meta['injection_detected'] ?? false
  const piiDetected = meta['pii_detected'] ?? false
  const detectedLanguage = fused['detected_language'] ?? null

  return {
    perception_result: fused,
    cleaned_text: cleanedText || prompt,
    sensitivity_level: detectedLevel,
    confidence,
    detected_language: detectedLanguage,
    injection_detected: injectionDetected,
    pii_detected: piiDetected,
  }
}

/**
 * 感知层节点：输入路由 + 感知器链 + 多路融合。
 *
 * P1-5: 委托至公共感知管线函数，消除与 coordinator._run_perception_pipeline 的重复逻辑。
 * P2-12.2.3: 改为异步节点，使用 runPerceptionPipelineAsync 并行执行独立感知器，
 * 显著提升多感知器场景下的感知延迟（如 text+image+audio 多模态输入）。
 */
export async function perceptionNode(
  state: ModuAgentState,
): Promise<Partial<ModuAgentState>> {
  const config = getConfig()
  const registry = getRegistry()
  const inputData = state.input_data ?? {}
  const prompt = (inputData['prompt'] as string) ?? ''

  const fused = await runPerceptionPipelineAsync(inputData, config, registry)
  return _buildPerceptionResult(fused, prompt)
}

/**
 * 感知层节点同步版本（向后兼容 / 测试直接调用）。
 *
 * 使用同步串行的 runPerceptionPipeline，不享受并行加速。
 * 生产环境推荐使用异步 perceptionNode。
 */
export async function perceptionNodeSync(
  state: ModuAgentState,
): Promise<Partial<ModuAgentState>> {
  const config = getConfig()
  const registry = getRegistry()
  const inputData = state.input_data ?? {}
  const prompt = (inputData['prompt'] as string) ?? ''

  const fused = await runPerceptionPipeline(inputData, config, registry)
  return _buildPerceptionResult(fused, prompt)
}

// ============================================================
// 记忆查询节点（对应 Coordinator._storage_adapter.query_all）
// ============================================================

/**
 * 记忆查询节点（无 Store 版本）：返回空知识列表。
 *
 * 短期历史由 LangGraph Checkpointer 通过 thread_id 自动管理。
 * 长期知识查询需通过 makeMemoryQueryNode(store) 创建带 Store 的版本。
 */
export function memoryQueryNode(
  state: ModuAgentState,
): Partial<ModuAgentState> {
  return { knowledge: [] }
}

/**
 * 创建带 Store 的记忆查询节点。
 *
 * @param store LangGraph BaseStore 实例（null 时退化为无查询）
 * @returns 记忆查询节点函数
 */
export function makeMemoryQueryNode(
  store: any,
): (state: ModuAgentState) => Promise<Partial<ModuAgentState>> {
  async function _memoryQueryNode(
    state: ModuAgentState,
  ): Promise<Partial<ModuAgentState>> {
    const userId = state.user_id ?? ''
    const cleanedText = state.cleaned_text ?? ''

    const knowledge: Array<Record<string, any>> = []

    if (store && cleanedText) {
      try {
        const items = await store.search(
          [userId, 'knowledge'],
          { query: cleanedText, limit: 5 },
        )
        for (const item of items) {
          knowledge.push(item.value)
        }
      } catch (e) {
        logger.warning('Store search error: %s', String(e))
      }
    }

    return { knowledge }
  }

  return _memoryQueryNode
}

// ============================================================
// 记忆更新节点（新增）
// ============================================================

/**
 * 记忆更新节点（无 Store 版本）：跳过更新。
 *
 * P0-3: 需通过 makeMemoryUpdateNode(store) 创建带 Store 的版本，
 * 并在 buildModuGraph() 中作为图节点接入。
 */
export function memoryUpdateNode(
  state: ModuAgentState,
): Partial<ModuAgentState> {
  return { memory_update_status: 'skipped_no_store' }
}

/**
 * 创建带 Store 的记忆更新节点（P0-3）。
 *
 * 替代 coordinator.py 中 fire-and-forget 的记忆更新，
 * 将记忆更新接入图结构，确保更新可观测、异常可追踪。
 */
export function makeMemoryUpdateNode(
  store: any,
): (state: ModuAgentState) => Promise<Partial<ModuAgentState>> {
  async function _memoryUpdateNode(
    state: ModuAgentState,
  ): Promise<Partial<ModuAgentState>> {
    if (store === null || store === undefined) {
      return { memory_update_status: 'skipped_no_store' }
    }

    // 熔断场景跳过记忆更新
    const errorCode = state.error_code ?? ''
    if (errorCode) {
      return { memory_update_status: 'skipped_circuit_breaker' }
    }

    const messages = state.messages ?? []
    const userId = state.user_id ?? ''
    const sessionId = state.session_id ?? ''

    if (messages.length === 0) {
      return { memory_update_status: 'skipped_no_messages' }
    }

    try {
      // 构建对话历史文本
      const historyParts: string[] = []
      for (const msg of messages) {
        let role: string
        let content: any
        if (msg instanceof HumanMessage) {
          role = 'user'
          content = msg.content
        } else if (msg instanceof AIMessage) {
          role = 'assistant'
          content = msg.content
        } else if ((msg as any)._getType && (msg as any)._getType() === 'tool') {
          role = 'tool'
          const toolName = (msg as any).name ?? 'unknown'
          content = `[${toolName}] ${(msg as any).content}`
        } else {
          continue
        }
        historyParts.push(`${role}: ${content}`)
      }

      if (historyParts.length > 0) {
        const historyText = historyParts.join('\n')
        const key = `${sessionId}_${Math.floor(Date.now() / 1000)}`

        await store.put(
          [userId, 'history'],
          key,
          {
            content: historyText,
            session_id: sessionId,
            message_count: messages.length,
            timestamp: Math.floor(Date.now() / 1000),
          },
        )
        return { memory_update_status: 'success', memory_update_key: key }
      }
    } catch (e) {
      logger.error('Memory update error: %s', String(e))
      return { memory_update_status: 'error', memory_update_error: String(e) }
    }

    return { memory_update_status: 'skipped' }
  }

  return _memoryUpdateNode
}

// ============================================================
// 路由函数
// ============================================================

/**
 * 感知后路由：敏感度熔断 + 注入检测熔断 + PII 阻断（P2-6）。
 *
 * 对应 coordinator.py 中 process_request 的熔断逻辑：
 *   - 敏感度 >= threshold → END（返回错误）
 *   - 注入检测 + block_on_injection → END（返回错误）
 *   - PII 检测 + block_on_pii → END（返回错误）
 *   - 否则 → memory_query
 */
export function routeAfterPerception(state: ModuAgentState): string {
  const config = getConfig()

  const sensitivityThreshold = config.get('perception.sensitivity_threshold', 5)
  const sensitivityLevel = state.sensitivity_level ?? 0
  if (sensitivityLevel >= sensitivityThreshold) {
    logger.warning(
      'Sensitivity circuit breaker: level=%d >= threshold=%d',
      sensitivityLevel,
      sensitivityThreshold,
    )
    return '__end__'
  }

  const securityConfig = config.get('perception.security', {}) ?? {}
  if (securityConfig['block_on_injection'] && state.injection_detected) {
    logger.warning('Injection detected, circuit breaker triggered')
    return '__end__'
  }

  // P2-6: PII 阻断接入熔断逻辑
  if (securityConfig['block_on_pii'] && state.pii_detected) {
    logger.warning('PII detected, circuit breaker triggered')
    return '__end__'
  }

  return 'memory_query'
}

/**
 * 推理后路由：ReAct 循环退出判断。
 *
 * 检查最后一条消息是否包含 tool_calls：
 *   - 有 tool_calls → "tools"（进入 ReAct 循环）
 *   - 无 tool_calls → "__end__"（正常结束）
 *
 * LangGraph 的 recursionLimit 替代 max_iterations。
 */
export function routeAfterAgent(state: ModuAgentState): string {
  const messages = state.messages ?? []
  if (messages.length === 0) {
    return '__end__'
  }

  const lastMsg = messages[messages.length - 1] as any
  if (lastMsg.tool_calls && Array.isArray(lastMsg.tool_calls) && lastMsg.tool_calls.length > 0) {
    return 'tools'
  }
  // P4 Plan-and-Execute：执行阶段中"无 tool_calls"表示当前步骤完成，
  // 而非全局结束——转入 step_finalize 收尾本步。
  // 纯 ReAct 路径下 plan_phase 恒为空串，行为不变。
  if (state.plan_phase === 'executing') {
    return 'step_finalize'
  }
  return '__end__'
}

// ============================================================
// Agent 节点工厂（对应 _llm_adapter.generate + bind_tools）
// ============================================================

/**
 * 创建 agent 节点函数。
 *
 * 使用绑定了工具的 LLM（boundLlm）进行推理，
 * 通过 LangChain 原生 bind_tools 实现原生 function calling，
 * 替代手写正则解析 ```tool_call``` 。
 *
 * 新增功能：
 * - 当感知置信度 < confidenceThreshold 时，使用保守温度 conservativeTemperature
 * - P0-2: 从 state.config_overrides 读取 per-session 参数覆盖
 *   （temperature、max_reasoning_iterations 等）
 */
export function makeAgentNode(
  boundLlm: any,
  systemPrompt: string | null = null,
  confidenceThreshold: number = 0.5,
  conservativeTemperature: number = 0.3,
  planContextInjector: ((state: ModuAgentState) => SystemMessage | null) | null = null,
): (state: ModuAgentState) => Promise<Partial<ModuAgentState>> {
  // 获取原始 LLM 用于动态调整温度
  const _originalLlm = (boundLlm as any)._llm ?? boundLlm
  const _defaultTemperature = (boundLlm as any).temperature ?? 0.7

  async function agentNode(
    state: ModuAgentState,
  ): Promise<Partial<ModuAgentState>> {
    const messages: BaseMessage[] = [...(state.messages ?? [])]

    // 如果没有消息，使用 cleaned_text 作为 HumanMessage
    if (messages.length === 0) {
      const cleanedText = state.cleaned_text ?? state.input_data?.['prompt'] ?? ''
      if (cleanedText) {
        messages.push(new HumanMessage({ content: cleanedText }))
      }
    }

    // 注入系统提示词
    if (systemPrompt && (messages.length === 0 || !(messages[0] instanceof SystemMessage))) {
      messages.unshift(new SystemMessage({ content: systemPrompt }))
    }

    // 注入感知上下文（对应 coordinator.py 中 context["perception"] 注入）
    const perceptionResult = state.perception_result
    if (perceptionResult) {
      const perceptionCtx = extractPerceptionContext(perceptionResult)
      if (perceptionCtx && Object.keys(perceptionCtx).length > 0) {
        const ctxMsg = new SystemMessage({
          content: `Perception context: ${JSON.stringify(perceptionCtx)}`,
        })
        const insertIdx = systemPrompt ? 1 : 0
        messages.splice(insertIdx, 0, ctxMsg)
      }
    }

    // 注入长期知识
    const knowledge = state.knowledge ?? []
    if (knowledge.length > 0) {
      const knowledgeText = knowledge
        .filter((item) => item && typeof item === 'object')
        .map((item) => item['content'] ?? '')
        .join('\n')
      if (knowledgeText) {
        messages.splice(
          systemPrompt ? 1 : 0,
          0,
          new SystemMessage({ content: `Relevant knowledge from memory:\n${knowledgeText}` }),
        )
      }
    }

    // P4 Plan-and-Execute：注入当前步骤上下文（仅 plan_execute 模式传入注入器时生效，
    // 默认 null 时行为与原逻辑完全一致）
    if (planContextInjector) {
      try {
        const stepMsg = planContextInjector(state)
        if (stepMsg) {
          messages.push(stepMsg)
        }
      } catch (e) {
        logger.warning('planContextInjector failed, continuing without step context: %s', String(e))
      }
    }

    if (messages.length === 0) {
      return { response: '' }
    }

    // P0-2: 从 state.config_overrides 读取 per-session 参数覆盖
    const configOverrides = state.config_overrides ?? {}
    const overrideTemperature = configOverrides['temperature']

    // 低置信度保守模式：检测置信度并调整温度
    const confidence = state.confidence ?? 1.0
    let effectiveTemperature = _defaultTemperature

    // P0-2: config_overrides 中的 temperature 优先级高于默认值
    if (overrideTemperature !== undefined && overrideTemperature !== null) {
      effectiveTemperature = Number(overrideTemperature)
    }

    let needCustomTemp = false

    if (confidence < confidenceThreshold) {
      effectiveTemperature = conservativeTemperature
      needCustomTemp = true
      logger.info(
        'Low confidence (%.2f < %.2f), using conservative temperature %.2f',
        confidence, confidenceThreshold, conservativeTemperature,
      )
    } else if (overrideTemperature !== undefined && overrideTemperature !== null) {
      needCustomTemp = true
      logger.debug(
        'Using config_overrides temperature: %.2f',
        overrideTemperature,
      )
    }

    let response: any
    if (needCustomTemp) {
      // 克隆 LLM 并设置温度
      try {
        const llmWithTemp = boundLlm.bind({ temperature: effectiveTemperature })
        response = await llmWithTemp.invoke(messages)
      } catch {
        // 如果 bind 不支持 temperature，直接使用原 LLM
        response = await boundLlm.invoke(messages)
      }
    } else {
      response = await boundLlm.invoke(messages)
    }

    return { messages: [response] }
  }

  return agentNode
}

// ============================================================
// 工具结果处理节点（对应 coordinator.py 工具结果观察拼接）
// ============================================================

/**
 * 创建工具结果处理节点函数。
 *
 * 在 ToolNode 执行后，将工具结果提取为 tool_results 列表，
 * 对应 coordinator.py 中 iteration_results 收集逻辑。
 *
 * LangGraph 的 ToolNode 已自动将工具结果作为 ToolMessage 追加到 messages，
 * 此节点仅用于提取 tool_results 供最终响应使用。
 */
export function makeToolResultProcessor(): (state: ModuAgentState) => Partial<ModuAgentState> {
  function toolResultProcessor(
    state: ModuAgentState,
  ): Partial<ModuAgentState> {
    const messages = state.messages ?? []
    const toolResults: Array<Record<string, any>> = [...(state.tool_results ?? [])]

    for (const msg of messages) {
      const msgType = typeof (msg as any)._getType === 'function' ? (msg as any)._getType() : (msg as any).type
      if (msgType === 'tool') {
        const content = (msg as any).content ?? ''
        const toolName = (msg as any).name ?? 'unknown'
        const toolCallId = (msg as any).tool_call_id ?? ''

        let parsedContent: any
        try {
          parsedContent = typeof content === 'string' ? JSON.parse(content) : content
        } catch {
          parsedContent = { raw: content }
        }

        const existingIds = new Set(toolResults.map((r) => r['execution_id']))
        if (!existingIds.has(toolCallId)) {
          toolResults.push({
            tool: toolName,
            execution_id: toolCallId,
            result: typeof parsedContent === 'object' && parsedContent !== null ? parsedContent : { data: parsedContent },
            status: 'success',
          })
        }
      }
    }

    return { tool_results: toolResults }
  }

  return toolResultProcessor
}

// ============================================================
// 最终响应节点（增强：包含完整响应结构）
// ============================================================

/**
 * 最终响应节点：提取最终响应文本。
 *
 * 对应 coordinator.py 中 process_request 的返回结构构建。
 *
 * 增强：返回完整响应结构（response + tool_results + usage + error_code）
 */
export function responseNode(
  state: ModuAgentState,
): Partial<ModuAgentState> {
  const messages = state.messages ?? []
  let response = ''
  let usage = state.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  const toolResults = state.tool_results ?? []

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg instanceof AIMessage && msg.content) {
      response = msg.content as string
      // 尝试从 AIMessage 获取 usage 信息
      const usageMetadata = (msg as any).usage_metadata
      if (usageMetadata) {
        usage = {
          prompt_tokens: usageMetadata['input_tokens'] ?? 0,
          completion_tokens: usageMetadata['output_tokens'] ?? 0,
          total_tokens: usageMetadata['total_tokens'] ?? 0,
        }
      }
      break
    }
  }

  const errorCode = state.error_code ?? ''
  if (errorCode) {
    return {
      response,
      error_code: errorCode,
      error_message: state.error_message ?? '',
      tool_results: toolResults,
      usage,
    }
  }

  return {
    response,
    tool_results: toolResults,
    usage,
    error_code: '',
    error_message: '',
  }
}

// ============================================================
// 反馈评估节点（P0-1: feedback/evolution 闭环）
// ============================================================

/**
 * 创建反馈评估节点（P0-1）。
 *
 * 在 response 之后、memory_update 之前执行，评估响应质量并决定是否触发进化。
 *
 * P0-2 修复：将 session_id 传递给 orchestrator，
 * 并将 config_overrides 保存到 state 中，
 * 供下一次请求时注入 RunnableConfig.configurable。
 */
export function makeFeedbackNode(
  orchestrator: any,
): (state: ModuAgentState) => Promise<Partial<ModuAgentState>> {
  async function _feedbackNode(
    state: ModuAgentState,
  ): Promise<Partial<ModuAgentState>> {
    // 熔断场景跳过评估
    const errorCode = state.error_code ?? ''
    if (errorCode) {
      return {
        evaluation: null,
        should_evolve: false,
        evolution_action: null,
      }
    }

    const sessionId = state.session_id ?? ''

    // 构建评估输入
    const output = {
      response: state.response ?? '',
      tool_results: state.tool_results ?? [],
      usage: state.usage ?? {},
    }

    const context = {
      prompt: state.input_data?.['prompt'] ?? '',
      perception_result: state.perception_result,
      tool_results: state.tool_results ?? [],
      iteration: state.iteration ?? 0,
    }

    try {
      const result = await orchestrator.evaluateAndEvolve(
        output,
        context,
        sessionId,
      )
      const evolutionAction = result['evolution_action']

      // P0-2: 从 evolution_action 提取 config_overrides，保存到 state
      // 供下一次同会话请求时注入 RunnableConfig.configurable
      let configOverrides: Record<string, any> = {}
      if (evolutionAction && evolutionAction['adjusted']) {
        configOverrides = evolutionAction['config_overrides'] ?? {}
        if (configOverrides && Object.keys(configOverrides).length > 0) {
          logger.info(
            'Config overrides saved for session %s: %s',
            sessionId, Object.keys(configOverrides),
          )
        }
      }

      return {
        evaluation: result['evaluation'],
        should_evolve: result['should_evolve'] ?? false,
        evolution_action: evolutionAction,
        config_overrides: configOverrides,
      }
    } catch (e) {
      logger.error('Feedback node failed: %s', String(e))
      return {
        evaluation: null,
        should_evolve: false,
        evolution_action: null,
        config_overrides: {},
      }
    }
  }

  return _feedbackNode
}

// ============================================================
// 事件发布辅助函数（对应 coordinator.py 中事件发布）
// ============================================================

/** 发布感知事件到 EventBus。 */
export async function publishPerceptionEvent(
  state: ModuAgentState,
): Promise<void> {
  const eventBus = get_event_bus()
  const traceId = state.trace_id ?? ''
  const sessionId = state.session_id ?? ''
  const userId = state.user_id ?? ''
  const perceptionResult = state.perception_result
  const inputData = state.input_data ?? {}
  const inputType = (inputData['input_type'] as string) ?? 'text'

  const metadata =
    perceptionResult
      ? buildPerceptionEventMetadata(perceptionResult, inputType)
      : {
          input_type: inputType,
          sensitivity_level: '0',
          truncated: 'false',
        }

  const event = new AgentEvent({
    trace_id: traceId,
    session_id: sessionId,
    user_id: userId,
    domain: EventDomain.PERCEPTION,
    action: EventAction.ANALYZE,
    metadata,
  })
  await eventBus.publish(event)
}

/** 发布记忆查询事件到 EventBus。 */
export async function publishMemoryEvent(
  state: ModuAgentState,
): Promise<void> {
  const eventBus = get_event_bus()
  const traceId = state.trace_id ?? ''
  const sessionId = state.session_id ?? ''
  const userId = state.user_id ?? ''
  const knowledge = state.knowledge ?? []

  const event = new AgentEvent({
    trace_id: traceId,
    session_id: sessionId,
    user_id: userId,
    domain: EventDomain.MEMORY,
    action: EventAction.QUERY,
    metadata: { has_knowledge: String(knowledge.length > 0) },
  })
  await eventBus.publish(event)
}

/** 发布行动事件到 EventBus。 */
export async function publishActionEvent(
  state: ModuAgentState,
): Promise<void> {
  const eventBus = get_event_bus()
  const traceId = state.trace_id ?? ''
  const sessionId = state.session_id ?? ''
  const userId = state.user_id ?? ''
  const toolResults = state.tool_results ?? []

  const event = new AgentEvent({
    trace_id: traceId,
    session_id: sessionId,
    user_id: userId,
    domain: EventDomain.ACTION,
    action: EventAction.EXECUTE,
    metadata: { tool_count: String(toolResults.length) },
  })
  await eventBus.publish(event)
}

/** 发布工具调用与执行事件到 EventBus。 */
export async function publishToolEvents(
  state: ModuAgentState,
  toolCalls: Array<Record<string, any>>,
  toolResults: Array<Record<string, any>>,
): Promise<void> {
  const eventBus = get_event_bus()
  const traceId = state.trace_id ?? ''
  const sessionId = state.session_id ?? ''
  const userId = state.user_id ?? ''

  for (const tc of toolCalls) {
    const invokeEvent = new AgentEvent({
      trace_id: traceId,
      session_id: sessionId,
      user_id: userId,
      domain: EventDomain.TOOL,
      action: EventAction.INVOKE,
      metadata: { tool_name: tc['name'] ?? '' },
    })
    await eventBus.publish(invokeEvent)
  }

  for (const tr of toolResults) {
    const executeEvent = new AgentEvent({
      trace_id: traceId,
      session_id: sessionId,
      user_id: userId,
      domain: EventDomain.TOOL,
      action: EventAction.EXECUTE,
      metadata: {
        tool_name: tr['tool'] ?? '',
        tool_status: tr['status'] ?? 'unknown',
        error_code: tr['error_code'] ?? '',
      },
    })
    await eventBus.publish(executeEvent)
  }
}

// ============================================================
// P3-12.3.2 Human-in-the-loop 节点
// ============================================================

/**
 * P3-12.3.2: 检测工具是否需要人工审批。
 *
 * 判定逻辑（任一命中即视为需要审批）：
 *   1. 工具名在 sensitiveTools 配置列表中
 *   2. 工具实例的 requiresApproval() 返回 true
 */
function _toolRequiresApproval(
  toolName: string,
  registry: any,
  sensitiveTools: string[],
): boolean {
  if (sensitiveTools.includes(toolName)) {
    return true
  }
  if (registry !== null && registry !== undefined) {
    const moduTool = registry.getTool(toolName)
    if (moduTool) {
      try {
        return Boolean(moduTool.requiresApproval())
      } catch {
        // 工具方法异常时不阻断流程，按不需要审批处理
        return false
      }
    }
  }
  return false
}

/**
 * P3-12.3.2: 创建人工审批节点工厂。
 *
 * 节点行为：
 *   1. 检查最近一条 AIMessage 的 tool_calls
 *   2. 若任一工具调用需要审批，调用 interrupt(...) 暂停图执行
 *   3. 调用者通过 Command(resume={"approved": bool, "feedback": str}) 恢复
 *   4. 审批通过：返回 {"approval_status": "approved"}，由后续节点（ToolNode）执行工具
 *   5. 审批拒绝：构造每个被拒工具的降级 ToolMessage，路由到 response 节点
 *
 * 当 tools.human_in_loop.enabled=false 时，节点为 no-op，透传到 ToolNode。
 */
export function makeHumanReviewNode(
  registry: any = null,
  config: any = null,
): (state: ModuAgentState) => Promise<Partial<ModuAgentState>> {
  async function _humanReviewNode(
    state: ModuAgentState,
  ): Promise<Partial<ModuAgentState>> {
    // 读取 HITL 配置
    let hitlCfg: Record<string, any>
    if (config !== null && config !== undefined) {
      hitlCfg = config.get('tools.human_in_loop', {}) ?? {}
    } else {
      hitlCfg = getConfig().get('tools.human_in_loop', {}) ?? {}
    }

    if (!hitlCfg['enabled']) {
      // HITL 关闭，直接透传
      return { approval_status: 'skipped' }
    }

    const sensitiveTools: string[] = hitlCfg['sensitive_tools'] ?? []

    // 获取最近一条 AIMessage
    const messages = state.messages ?? []
    if (messages.length === 0) {
      return { approval_status: 'no_tool_calls' }
    }

    const lastMsg = messages[messages.length - 1] as any
    const toolCalls = lastMsg.tool_calls ?? []
    if (toolCalls.length === 0) {
      return { approval_status: 'no_tool_calls' }
    }

    // 识别需要审批的工具调用
    const reg = registry ?? getRegistry()
    const pending = toolCalls.filter((tc: Record<string, any>) =>
      _toolRequiresApproval(tc['name'] ?? '', reg, sensitiveTools),
    )

    if (pending.length === 0) {
      // 无需审批，透传
      return {
        approval_status: 'not_required',
        tool_requires_approval: false,
        pending_tool_calls: [],
      }
    }

    // 触发 interrupt 暂停图执行
    // interrupt(value) 返回由 Command(resume=...) 提供的恢复值
    const resumePayload = interrupt({
      tool_calls: pending,
      trace_id: state.trace_id ?? '',
      session_id: state.session_id ?? '',
      user_id: state.user_id ?? '',
      message: 'Tool calls require human approval before execution',
    }) as any

    // 解析 resume payload
    let approved: boolean
    let feedback: string
    if (resumePayload && typeof resumePayload === 'object') {
      approved = Boolean(resumePayload['approved'])
      feedback = String(resumePayload['feedback'] ?? '')
    } else {
      approved = false
      feedback = ''
    }

    if (approved) {
      return {
        approval_status: 'approved',
        approval_feedback: feedback,
        tool_requires_approval: false,
        pending_tool_calls: [],
      }
    }

    // 拒绝：为每个待审批工具调用生成降级 ToolMessage
    const rejectionMessages: ToolMessage[] = []
    for (const tc of pending) {
      const toolName = tc['name'] ?? ''
      const args = tc['args'] ?? {}
      const callId = tc['id'] ?? ''

      let rejectionResult: Record<string, any>
      const moduTool = reg ? reg.getTool(toolName) : null
      if (moduTool) {
        try {
          rejectionResult = moduTool.onApprovalRejected(args)
        } catch (e) {
          rejectionResult = {
            status: 'error',
            error_code: 'TOOL_APPROVAL_REJECTED',
            data: { message: `Tool ${toolName} rejected: ${e}` },
          }
        }
      } else {
        rejectionResult = {
          status: 'error',
          error_code: 'TOOL_APPROVAL_REJECTED',
          data: { message: `Tool ${toolName} rejected by reviewer` },
        }
      }

      rejectionMessages.push(new ToolMessage({
        content: JSON.stringify(rejectionResult),
        tool_call_id: callId,
        name: toolName,
      }))
    }

    return {
      approval_status: 'rejected',
      approval_feedback: feedback,
      tool_requires_approval: false,
      pending_tool_calls: [],
      messages: rejectionMessages,
    }
  }

  return _humanReviewNode
}

/**
 * P3-12.3.2: 审批后路由。
 *
 * - "rejected" / "error" → "response"（跳过工具执行，进入响应阶段）
 * - 其他（approved / not_required / no_tool_calls / skipped）→ "tools"（执行 ToolNode）
 */
export function routeAfterHumanReview(state: ModuAgentState): string {
  const approvalStatus = state.approval_status ?? ''
  if (approvalStatus === 'rejected' || approvalStatus === 'error') {
    return 'response'
  }
  return 'tools'
}

// ============================================================
// P3-12.3.1 多 Agent 协作节点
// ============================================================

/**
 * P3-12.3.1: memory_query 后路由——多 Agent 或单 Agent。
 *
 * - orchestration.multi_agent.enabled=true → "supervisor"
 * - 否则 → "agent"（原行为）
 */
export function routeAfterMemoryQuery(state: ModuAgentState): string {
  const config = getConfig()
  if (config.get('orchestration.multi_agent.enabled', false)) {
    return 'supervisor'
  }
  // P4 Plan-and-Execute：与 multi_agent 互斥（multi_agent 优先）
  if (config.get('plan_execute.enabled', false)) {
    return 'planner'
  }
  return 'agent'
}

/**
 * P3-12.3.1: 创建子 Agent 节点（处理单个子任务）。
 *
 * 通过 Send API 并行调用，每次处理一个 current_subtask。
 * 结果写入 subtask_results（经 mergeSubtaskResults reducer 合并）。
 */
export function makeSubagentNode(
  boundLlm: any,
  systemPrompt: string | null = null,
): (state: ModuAgentState) => Promise<Partial<ModuAgentState>> {
  async function _subagentNode(
    state: ModuAgentState,
  ): Promise<Partial<ModuAgentState>> {
    const task = state.current_subtask ?? {}
    if (Object.keys(task).length === 0) {
      return { subtask_results: {} }
    }

    const taskId = task['task_id'] ?? ''
    const taskType = task['task_type'] ?? 'default'
    const taskInput = task['task_input'] ?? {}
    const promptText = (taskInput['prompt'] as string) ?? String(taskInput)

    // 选择系统提示词
    const effectivePrompt = systemPrompt ?? _getSystemPrompt(taskType)

    const messages: BaseMessage[] = [
      new SystemMessage({ content: effectivePrompt }),
      new HumanMessage({ content: promptText }),
    ]

    let result: Record<string, any>
    try {
      const response = await boundLlm.invoke(messages)
      const content = (response as any).content ?? String(response)
      result = {
        task_id: taskId,
        task_type: taskType,
        status: 'success',
        output: content,
      }
    } catch (e) {
      logger.error('Sub-agent LLM invoke failed (task_id=%s): %s', taskId, String(e))
      result = {
        task_id: taskId,
        task_type: taskType,
        status: 'error',
        error: String(e),
        output: '',
      }
    }

    // 仅返回 subtask_results（不返回 current_subtask，避免并行写冲突）
    return { subtask_results: { [taskId]: result } }
  }

  return _subagentNode
}

/**
 * P3-12.3.1: 创建共识聚合节点。
 *
 * 收集所有子 Agent 结果，通过共识策略聚合，生成最终响应。
 * 共识失败时发布 FEEDBACK 事件作为进化信号。
 */
export function makeConsensusNode(
  strategy: any = null,
  judgeLlm: any = null,
  eventBus: any = null,
): (state: ModuAgentState) => Promise<Partial<ModuAgentState>> {
  async function _consensusNode(
    state: ModuAgentState,
  ): Promise<Partial<ModuAgentState>> {
    const subtaskResults = state.subtask_results ?? {}
    const traceId = state.trace_id ?? ''
    const sessionId = state.session_id ?? ''
    const userId = state.user_id ?? ''

    const config = getConfig()
    const multiAgentCfg = config.get('orchestration.multi_agent', {}) ?? {}
    const quorum = multiAgentCfg['consensus_quorum'] ?? 2

    // 收集有效结果
    const results = Object.values(subtaskResults)
    const validResults = results.filter((r) => r['status'] === 'success')

    // quorum 校验
    if (validResults.length < quorum) {
      logger.warning(
        'Consensus quorum not met: %d/%d (trace_id=%s)',
        validResults.length, quorum, traceId,
      )
      // 发布共识失败事件（进化信号）
      if (multiAgentCfg['consensus_failure_as_evolution_signal']) {
        try {
          const pattern = new ConsensusPattern(quorum, undefined, eventBus)
          await pattern._publish_consensus_failure(
            { trace_id: traceId, session_id: sessionId, user_id: userId },
            results,
            `Quorum not met: ${validResults.length}/${quorum}`,
          )
        } catch (e) {
          logger.error('Failed to publish consensus failure: %s', String(e))
        }
      }

      // 降级：取最佳可用结果或空响应
      let fallbackOutput = ''
      if (validResults.length > 0) {
        fallbackOutput = validResults[0]['output'] ?? ''
      } else if (results.length > 0) {
        fallbackOutput = results[0]['output'] ?? 'Consensus failed'
      }

      return {
        consensus_result: { status: 'failed', consensus: null },
        consensus_failed: true,
        response: fallbackOutput || 'Unable to reach consensus among agents.',
      }
    }

    // 创建/使用策略
    let effectiveStrategy = strategy
    if (effectiveStrategy === null) {
      const strategyName = multiAgentCfg['consensus_strategy'] ?? 'majority_vote'
      const taskDesc = state.input_data?.['prompt'] ?? ''
      effectiveStrategy = create_consensus_strategy(
        strategyName,
        judgeLlm,
        taskDesc,
      )
    }

    // 聚合
    try {
      const consensus = await effectiveStrategy.aggregate(validResults, quorum)
      const consensusContent = consensus['consensus']
      // 提取响应文本
      let responseText: string
      if (consensusContent && typeof consensusContent === 'object') {
        responseText = consensusContent['output'] ?? String(consensusContent)
      } else if (typeof consensusContent === 'string') {
        responseText = consensusContent
      } else {
        responseText = String(consensusContent)
      }

      return {
        consensus_result: {
          status: 'success',
          consensus,
          agreement_count: consensus['agreement_count'] ?? validResults.length,
          strategy: consensus['strategy'] ?? effectiveStrategy.constructor.name,
        },
        consensus_failed: false,
        response: responseText,
      }
    } catch (e) {
      logger.error('Consensus aggregation failed: %s', String(e))
      return {
        consensus_result: { status: 'error', error: String(e) },
        consensus_failed: true,
        response: `Consensus aggregation error: ${e}`,
      }
    }
  }

  return _consensusNode
}
