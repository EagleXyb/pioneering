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
import type { RunnableConfig } from '@langchain/core/runnables'

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
import { _getSystemPrompt, build_subagent_subgraph } from './subgraph/builder.js'
import type { ModuAgentState } from './state.js'

// ============================================================
// P9.3.1: LangChain 消息类型辅助（减少 as any 断言）
// ============================================================

/**
 * LangChain 消息上的标准扩展字段。
 *
 * BaseMessage 的最小公共接口不含 tool_calls / usage_metadata / tool_call_id 等，
 * 这些字段在 AIMessage / ToolMessage 上各自定义。为避免在路由判断中反复使用
 * `as any`，统一通过该接口访问运行时所需的字段，类型保持精确。
 */
interface MessageExt {
  tool_calls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }>
  tool_call_id?: string
  name?: string
  content?: string
  usage_metadata?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
  additional_kwargs?: Record<string, unknown>
}

/** 将 BaseMessage 视为带扩展字段的消息（用于路由判断等只读场景）。 */
function asMessageExt(msg: BaseMessage): BaseMessage & MessageExt {
  return msg as BaseMessage & MessageExt
}

/** 工具调用条目（用于 HITL 节点 interrupt payload 与拒绝路径）。 */
interface ToolCallItem {
  id?: string
  name?: string
  args?: Record<string, unknown>
}

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
        } else if (msg instanceof ToolMessage) {
          // P9.3.1: 直接使用 ToolMessage 类型判断，避免 as any 访问内部字段
          role = 'tool'
          const ext = asMessageExt(msg)
          const toolName = ext.name ?? 'unknown'
          content = `[${toolName}] ${ext.content ?? ''}`
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
 *
 * P2 兜底检测: 当本轮已有 ToolMessage(调过工具)、AIMessage 无 tool_calls、
 * 且文本含承诺词("然后搜索/接下来我会/let me then"等)时,LLM 可能发生了
 * "承诺但未执行"的提前终止。仅打 warning 日志,不改变路由(避免过度工程
 * 破坏正常对话流);日志便于事后追踪与调优提示词。
 */
export function routeAfterAgent(state: ModuAgentState): string {
  const messages = state.messages ?? []
  if (messages.length === 0) {
    return '__end__'
  }

  // P9.3.1: 使用 asMessageExt 替代 as any，保留类型精确性
  const lastMsg = asMessageExt(messages[messages.length - 1])
  const toolCalls = lastMsg.tool_calls

  if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
    return 'tools'
  }
  // P4 Plan-and-Execute：执行阶段中"无 tool_calls"表示当前步骤完成，
  // 而非全局结束——转入 step_finalize 收尾本步。
  // 纯 ReAct 路径下 plan_phase 恒为空串，行为不变。
  if (state.plan_phase === 'executing') {
    return 'step_finalize'
  }

  // P2 兜底检测: 承诺词 + 已有 ToolMessage → 可能提前终止
  // 不改变路由,仅打 warning 便于追踪
  _detectPrematureTermination(messages, lastMsg)

  return '__end__'
}

/**
 * P2: 检测 LLM "承诺但未执行"的提前终止行为。
 *
 * 触发条件(全部满足才打日志):
 *   1. 消息历史中存在至少一条 ToolMessage(说明本轮已调过工具)
 *   2. 最后一条 AIMessage 无 tool_calls(已在 routeAfterAgent 判断)
 *   3. AIMessage 文本含承诺词(中英文): "然后搜索/接下来/我会搜索/let me then/next I will" 等
 *
 * 仅记录 warning,不修改路由 —— 强制改路由会破坏"LLM 已完成任务正常结束"的对话流,
 * 真正的修复依赖 P0 提示词约束与 P1 ToolMessage 精简,这里只是可观测性兜底。
 */
const _PROMISE_KEYWORDS = [
  // 中文承诺词
  '然后搜索', '然后查询', '然后获取', '然后调用',
  '接下来', '下一步', '我会搜索', '我会查询', '我会获取',
  '让我搜索', '让我查询', '让我获取', '让我然后',
  // 英文承诺词
  'let me then', 'let me search', 'let me fetch',
  'next i will', 'then i will', 'i will now search',
  'i will now fetch', 'i will then',
]

function _detectPrematureTermination(
  messages: BaseMessage[],
  lastMsg: BaseMessage & MessageExt,
): void {
  // 条件1: 历史中存在 ToolMessage
  let hasToolMessage = false
  for (const msg of messages) {
    if (msg instanceof ToolMessage) {
      hasToolMessage = true
      break
    }
  }
  if (!hasToolMessage) return

  // 条件2: 最后一条是 AIMessage(无 tool_calls,由调用方保证)
  if (!(lastMsg instanceof AIMessage)) return

  // 条件3: 文本含承诺词
  const content = typeof lastMsg.content === 'string' ? lastMsg.content : ''
  if (!content) return
  const lowerContent = content.toLowerCase()
  const matched = _PROMISE_KEYWORDS.find((kw) =>
    content.includes(kw) || lowerContent.includes(kw.toLowerCase()),
  )
  if (matched) {
    logger.warning(
      '[premature-termination-detected] AIMessage 含承诺词 "%s" 但无 tool_calls, ' +
      '可能发生"承诺但未执行"的提前终止。建议加强 P0 提示词约束。',
      matched,
    )
  }
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
      // v1.2 §4.3 建议10：使用 instanceof 替代 (msg as any)._getType() 反射，
      // 类型安全且消除 any 断言（ToolMessage 已在文件头部导入）
      if (msg instanceof ToolMessage) {
        const content = msg.content ?? ''
        const toolName = msg.name ?? 'unknown'
        const toolCallId = msg.tool_call_id ?? ''

        let parsedContent: any
        try {
          parsedContent = typeof content === 'string' ? JSON.parse(content) : content
        } catch {
          parsedContent = { raw: content }
        }

        const existingIds = new Set(toolResults.map((r) => r['execution_id']))
        if (!existingIds.has(toolCallId)) {
          // 修复: 读取工具返回的真实 status，而非硬编码 'success'
          // 工具返回格式: { status: 'success'|'error', error_code: string, data: {...} }
          const toolStatus = (typeof parsedContent === 'object' && parsedContent !== null)
            ? (parsedContent['status'] === 'error' ? 'failed' : 'success')
            : 'success'
          toolResults.push({
            tool: toolName,
            execution_id: toolCallId,
            result: typeof parsedContent === 'object' && parsedContent !== null ? parsedContent : { data: parsedContent },
            status: toolStatus,
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
 *   2. 工具实例的 requiresApprovalFor(args, context) 返回 true
 *      （对应文档 §2.5 建议6 / §4.3 建议4：动态敏感性检测）
 *      - 默认实现回退到 requiresApproval() 静态判定，保持向后兼容
 *      - HttpRequestTool / FileOpsTool 等覆写为参数级判定
 *
 * v1.2 §4.3 建议4 修复：原实现仅调用静态 requiresApproval()，未传入 args/context，
 * 导致 requiresApprovalFor 接口虽已定义但运行时永不命中。现修正为优先调用
 * requiresApprovalFor(args, context)，让参数级判定真正生效。
 *
 * @param toolName       工具名
 * @param registry       组件注册表
 * @param sensitiveTools 配置的敏感工具名列表
 * @param args           工具调用参数（用于动态敏感性判定）
 * @param context        调用上下文（含 user_id / session_id 等）
 */
function _toolRequiresApproval(
  toolName: string,
  registry: any,
  sensitiveTools: string[],
  args?: Record<string, any>,
  context?: Record<string, any>,
): boolean {
  if (sensitiveTools.includes(toolName)) {
    return true
  }
  if (registry !== null && registry !== undefined) {
    const moduTool = registry.getTool(toolName)
    if (moduTool) {
      try {
        // 优先调用动态敏感性判定（默认实现回退到 requiresApproval）
        return Boolean(
          moduTool.requiresApprovalFor(args ?? {}, context ?? {}),
        )
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
    // v1.2 §4.3 建议4：传入 tc['args'] 与 context，让 requiresApprovalFor 真正生效
    const reg = registry ?? getRegistry()
    const hitlContext: Record<string, any> = {
      user_id: state.user_id ?? '',
      session_id: state.session_id ?? '',
      trace_id: state.trace_id ?? '',
    }
    const pending = toolCalls.filter((tc: Record<string, any>) =>
      _toolRequiresApproval(
        tc['name'] ?? '', reg, sensitiveTools,
        tc['args'] ?? {}, hitlContext,
      ),
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
    let isTimeout: boolean
    // v1.2 §4.3 建议3：支持改参批准（modified_args）
    //   审批者可在 resume 时携带 modified_args 字段，按 tool_call.id 覆盖原参数
    //   格式: { [tool_call_id]: { ...newArgs } }
    //   仅 approved=true 时生效；approved=false 时忽略（拒绝路径用原 args 调 onApprovalRejected）
    let modifiedArgs: Record<string, Record<string, any>> | null = null
    if (resumePayload && typeof resumePayload === 'object') {
      approved = Boolean(resumePayload['approved'])
      feedback = String(resumePayload['feedback'] ?? '')
      // P9.4.3: 超时自动拒绝时 resume_sync 携带 timeout=true 标记，
      // human_review 据此使用 TOOL_APPROVAL_TIMEOUT 错误码
      isTimeout = Boolean(resumePayload['timeout'] ?? false)
      // v1.2 §4.3 建议3：读取改参批准字段
      const modArgsRaw = resumePayload['modified_args']
      if (approved && modArgsRaw && typeof modArgsRaw === 'object') {
        modifiedArgs = modArgsRaw as Record<string, Record<string, any>>
      }
    } else {
      approved = false
      feedback = ''
      isTimeout = false
    }

    if (approved) {
      // v1.2 §4.3 建议3：若审批者提供了 modified_args，则用修改后的参数覆盖原 AIMessage 的 tool_calls
      //   生成新的 AIMessage 替换原消息，让下游 ToolNode 按修改后参数执行
      if (modifiedArgs && Object.keys(modifiedArgs).length > 0) {
        const updatedToolCalls = toolCalls.map((tc: Record<string, any>) => {
          const callId = tc['id'] ?? ''
          const mod = modifiedArgs![callId]
          if (mod && typeof mod === 'object') {
            logger.info(
              'HITL modified_args applied: tool=%s call_id=%s',
              tc['name'] ?? '', callId,
            )
            return { ...tc, args: { ...tc['args'] ?? {}, ...mod } }
          }
          return tc
        })
        // 用新 AIMessage 替换最后一条消息（保留其余字段）
        const newLastMsg = new AIMessage({
          content: lastMsg.content ?? '',
          tool_calls: updatedToolCalls as any,
          additional_kwargs: lastMsg.additional_kwargs ?? {},
        })
        const newMessages = [...messages.slice(0, -1), newLastMsg]
        return {
          approval_status: 'approved',
          approval_feedback: feedback,
          tool_requires_approval: false,
          pending_tool_calls: [],
          messages: newMessages,
        }
      }
      return {
        approval_status: 'approved',
        approval_feedback: feedback,
        tool_requires_approval: false,
        pending_tool_calls: [],
      }
    }

    // 拒绝：为每个待审批工具调用生成降级 ToolMessage
    // P9.4.3: 超时场景使用 TOOL_APPROVAL_TIMEOUT，普通拒绝使用 TOOL_APPROVAL_REJECTED
    const rejectionErrorCode = isTimeout ? 'TOOL_APPROVAL_TIMEOUT' : 'TOOL_APPROVAL_REJECTED'
    const rejectionMessages: ToolMessage[] = []
    for (const tc of pending) {
      const toolName = tc['name'] ?? ''
      const args = tc['args'] ?? {}
      const callId = tc['id'] ?? ''

      let rejectionResult: Record<string, any>
      const moduTool = reg ? reg.getTool(toolName) : null
      if (moduTool && !isTimeout) {
        // 普通拒绝：调用工具的 onApprovalRejected 钩子
        try {
          rejectionResult = moduTool.onApprovalRejected(args)
        } catch (e) {
          rejectionResult = {
            status: 'error',
            error_code: rejectionErrorCode,
            data: { message: `Tool ${toolName} rejected: ${e}` },
          }
        }
      } else {
        // 超时拒绝 / 无 moduTool：直接构造标准错误结果
        rejectionResult = {
          status: 'error',
          error_code: rejectionErrorCode,
          data: {
            message: isTimeout
              ? `Tool ${toolName} rejected: approval timed out`
              : `Tool ${toolName} rejected by reviewer`,
          },
        }
      }

      rejectionMessages.push(new ToolMessage({
        content: JSON.stringify(rejectionResult),
        tool_call_id: callId,
        name: toolName,
      }))
    }

    return {
      approval_status: isTimeout ? 'timeout' : 'rejected',
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
 * - "rejected" / "timeout" / "error" → "finalize_response"（跳过工具执行，进入响应阶段）
 *   （P9.4.3: timeout 也走 finalize_response 路径）
 * - 其他（approved / not_required / no_tool_calls / skipped）→ "tools"（执行 ToolNode）
 */
export function routeAfterHumanReview(state: ModuAgentState): string {
  const approvalStatus = state.approval_status ?? ''
  if (
    approvalStatus === 'rejected' ||
    approvalStatus === 'timeout' ||
    approvalStatus === 'error'
  ) {
    return 'finalize_response'
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
 * - P4: per-request configurable.plan_execute_enabled=true → "planner"
 * - 全局 plan_execute.enabled=true → "planner"
 * - 否则 → "agent"（原行为）
 *
 * P4 修复：除了全局配置外，还需检查 per-request 的 configurable.plan_execute_enabled，
 * 否则即使 factory 构建了带 planner 的图，运行时路由仍会走 agent 分支。
 * LangGraph JS 的条件路由函数支持第二参数 config: RunnableConfig。
 */
export function routeAfterMemoryQuery(
  state: ModuAgentState,
  config?: RunnableConfig,
): string {
  const runtimeConfig = getConfig()
  const configurable = config?.configurable as Record<string, any> | undefined

  // 路由分叉配置化（对应文档 §2.3 建议4）：优先读取 orchestration.mode_router 规则
  const rules = runtimeConfig.get('orchestration.mode_router', []) as Array<{
    when: {
      config_key?: string
      config_value?: any
      configurable_key?: string
      configurable_value?: any
    }
    route: string
  }>

  for (const rule of rules) {
    if (_matchRouteRule(rule, runtimeConfig, configurable)) {
      return rule.route
    }
  }

  // 内置默认回退（mode_router 缺失或无规则命中时，保持原优先级行为）
  if (runtimeConfig.get('orchestration.multi_agent.enabled', false)) {
    return 'supervisor'
  }
  // P4: 优先检查 per-request configurable（agent-bridge 传入的 plan_execute_enabled=true）
  if (configurable?.['plan_execute_enabled'] === true) {
    return 'planner'
  }
  // P4 Plan-and-Execute：全局配置兜底
  if (runtimeConfig.get('plan_execute.enabled', false)) {
    return 'planner'
  }
  return 'agent'
}

/**
 * 匹配单条路由规则（对应文档 §2.3 建议4）。
 *
 * 规则的 when 字段支持两种条件（可同时存在，需同时满足）：
 *   - config_key + config_value：检查 runtimeConfig.get(config_key) === config_value
 *   - configurable_key + configurable_value：检查 configurable[configurable_key] === configurable_value
 */
function _matchRouteRule(
  rule: {
    when: {
      config_key?: string
      config_value?: any
      configurable_key?: string
      configurable_value?: any
    }
    route: string
  },
  runtimeConfig: ReturnType<typeof getConfig>,
  configurable: Record<string, any> | undefined,
): boolean {
  const { config_key, config_value, configurable_key, configurable_value } = rule.when
  if (config_key !== undefined) {
    if (runtimeConfig.get(config_key, null) !== config_value) {
      return false
    }
  }
  if (configurable_key !== undefined) {
    if (configurable?.[configurable_key] !== configurable_value) {
      return false
    }
  }
  return true
}

/**
 * P3-12.3.1: 创建子 Agent 节点（处理单个子任务）。
 *
 * 通过 Send API 并行调用，每次处理一个 current_subtask。
 * 结果写入 subtask_results（经 mergeSubtaskResults reducer 合并）。
 *
 * v1.4 §4.4 改造：
 *   - 建议2：启用工具能力——优先使用 build_subagent_subgraph 构建 ReAct 循环子图，
 *     按 task_type 过滤工具（research→search_engine/http_request，coding→calculator/code_executor，
 *     review→无工具）。tools 为空时回退到原始单次 LLM 调用路径（向后兼容）
 *   - 建议6：子 Agent 超时——Promise.race 与 subgraph_timeout_ms 配置（默认 30s）
 *   - 建议14：子 Agent 重试——失败时按 max_retries（默认 1）重试，指数退避
 *   - 建议4：need_help 信号——子 Agent 输出 {status:'need_help', reason:'...'} 时
 *     Supervisor 可读取并触发重新拆分（由 consensus 节点检测并发布事件）
 */
export function makeSubagentNode(
  boundLlm: any,
  systemPrompt: string | null = null,
  tools: any[] | null = null,
): (state: ModuAgentState) => Promise<Partial<ModuAgentState>> {
  // v1.4 §4.4 建议2：预构建子图（按 task_type 过滤工具）
  //   - tools 为空或 null：保持原行为（单次 LLM 调用，无 ReAct 循环）
  //   - tools 非空：构建子图，子 Agent 可调用工具
  //   子图构建是 lazy 的——只在首次需要时构建并缓存
  const _subgraphCache: Map<string, any> = new Map()

  function _getSubgraphForTaskType(taskType: string): any | null {
    if (!tools || tools.length === 0) return null
    if (_subgraphCache.has(taskType)) return _subgraphCache.get(taskType)

    // v1.4 §4.4 建议2：按 task_type 过滤工具
    const filteredTools = _filterToolsByTaskType(tools!, taskType)
    if (filteredTools.length === 0) {
      _subgraphCache.set(taskType, null)
      return null
    }
    // 子图使用未绑定工具的 LLM，由子图内部 ToolNode 调度
    const subgraph = build_subagent_subgraph(
      boundLlm,
      filteredTools,
      systemPrompt,
      taskType,
      10, // recursionLimit，独立于主图
    )
    _subgraphCache.set(taskType, subgraph)
    logger.debug(
      'Subagent subgraph built for task_type=%s, tools=%d',
      taskType, filteredTools.length,
    )
    return subgraph
  }

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
    const traceId = state.trace_id ?? ''

    const config = getConfig()
    const multiAgentCfg = config.get('orchestration.multi_agent', {}) ?? {}
    const timeoutMs = Number(multiAgentCfg['subgraph_timeout_ms'] ?? 30000)
    const maxRetries = Number(multiAgentCfg['subagent_max_retries'] ?? 1)

    // v1.4 §4.4 建议3：读取共享黑板，注入到子任务上下文
    //   子 Agent 可读取其他已完成子 Agent 写入的中间结果（如 search_results）
    const blackboard = state.blackboard ?? {}
    const enrichedTaskInput = { ...taskInput }
    if (Object.keys(blackboard).length > 0) {
      enrichedTaskInput['blackboard'] = blackboard
    }

    // v1.4 §4.4 建议2：尝试使用子图（带工具循环）
    const subgraph = _getSubgraphForTaskType(taskType)

    let result: Record<string, any> | null = null
    let lastError: string = ''

    // v1.4 §4.4 建议14：失败重试
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        let content: string

        if (subgraph) {
          // v1.4 §4.4 建议2+6：子图执行 + 超时
          const subgraphResult = await _invokeWithTimeout(
            subgraph.invoke({
              task_id: taskId,
              task_type: taskType,
              task_input: enrichedTaskInput,
              messages: [],
              trace_id: traceId,
            }),
            timeoutMs,
            `Subagent (task_id=${taskId})`,
          )
          const taskOutput: Record<string, any> = (subgraphResult as any)?.['task_output'] ?? {}
          if (taskOutput['status'] === 'error') {
            throw new Error(taskOutput['error'] ?? 'subgraph error')
          }
          content = taskOutput['content'] ?? taskOutput['output'] ?? ''
        } else {
          // 回退路径：原始单次 LLM 调用（无工具）
          // v1.4 §4.4 建议3：将黑板上下文注入到 prompt
          const effectivePrompt = systemPrompt ?? _getSystemPrompt(taskType)
          const fullPromptText = Object.keys(blackboard).length > 0
            ? `${promptText}\n\n[Shared context from other agents]: ${JSON.stringify(blackboard)}`
            : promptText
          const messages: BaseMessage[] = [
            new SystemMessage({ content: effectivePrompt }),
            new HumanMessage({ content: fullPromptText }),
          ]
          const response = await _invokeWithTimeout(
            boundLlm.invoke(messages),
            timeoutMs,
            `Subagent (task_id=${taskId})`,
          )
          content = (response as any).content ?? String(response)
        }

        result = {
          task_id: taskId,
          task_type: taskType,
          status: 'success',
          output: content,
          attempts: attempt + 1,
        }
        lastError = ''
        break
      } catch (e) {
        lastError = String(e)
        if (attempt < maxRetries) {
          const backoffMs = Math.min(1000 * Math.pow(2, attempt), 8000)
          logger.warning(
            'Sub-agent attempt %d failed (task_id=%s), retrying in %dms: %s',
            attempt + 1, taskId, backoffMs, lastError,
          )
          await new Promise((r) => setTimeout(r, backoffMs))
        } else {
          logger.error(
            'Sub-agent failed after %d attempts (task_id=%s): %s',
            attempt + 1, taskId, lastError,
          )
        }
      }
    }

    if (lastError && result === null) {
      result = {
        task_id: taskId,
        task_type: taskType,
        status: 'error',
        error: lastError,
        output: '',
        attempts: maxRetries + 1,
      }
    }

    // 此时 result 一定非空（成功路径已赋值，失败路径上方已赋值）
    const finalResult: Record<string, any> = result!

    // v1.4 §4.4 建议3：将子 Agent 结果摘要写入黑板，供后续子 Agent 读取
    //   仅写入 status=success 的结果，避免错误结果污染黑板
    //   key 用 task_id 隔离，避免覆盖
    const blackboardUpdate = finalResult['status'] === 'success'
      ? { [taskId]: { task_type: taskType, output: finalResult['output'] } }
      : {}

    // 仅返回 subtask_results（不返回 current_subtask，避免并行写冲突）
    return {
      subtask_results: { [taskId]: finalResult },
      ...(Object.keys(blackboardUpdate).length > 0 ? { blackboard: blackboardUpdate } : {}),
    }
  }

  return _subagentNode
}

/**
 * v1.4 §4.4 建议2：按 task_type 过滤工具。
 *
 * 工具按 BaseTool.category() 或工具名前缀映射到 task_type：
 *   - research: search_engine, http_request
 *   - coding: calculator, code_executor
 *   - review: 无工具（纯 LLM 评审）
 *   - default: 全部工具（保守策略）
 *
 * 工具实例可能是 LangChain StructuredTool 或 BaseTool wrapper，
 * 通过 name 字段判断。
 */
function _filterToolsByTaskType(tools: any[], taskType: string): any[] {
  const _TOOL_TASK_TYPE_MAP: Record<string, string[]> = {
    research: ['search_engine', 'http_request'],
    coding: ['calculator', 'code_executor'],
    review: [],
  }
  const allowed = _TOOL_TASK_TYPE_MAP[taskType]
  if (!allowed) {
    // 未知 task_type：保守返回全部工具
    return tools
  }
  if (allowed.length === 0) return []
  return tools.filter((t) => {
    const name = typeof t.name === 'string' ? t.name : (t.name?.() ?? '')
    return allowed.includes(name)
  })
}

/**
 * v1.4 §4.4 建议6：带超时的 invoke 包装。
 *
 * 使用 Promise.race 实现，超时后抛出 TimeoutError。
 * 注意：超时不会真正中断底层 LLM 调用（JS 无法取消 Promise），
 * 但能释放主流程不被阻塞——子 Agent 慢时 consensus 仍可继续。
 */
async function _invokeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (timeoutMs <= 0) return promise
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]) as Promise<T>
}

/**
 * P3-12.3.1: 创建共识聚合节点。
 *
 * 收集所有子 Agent 结果，通过共识策略聚合，生成最终响应。
 * 共识失败时发布 FEEDBACK 事件作为进化信号。
 *
 * v1.4 §4.4 改造：
 *   - 建议8：consensus 结果作为 AIMessage 追加到 messages，修复 consensus_result
 *     与 finalize_response 脱节问题（finalize_response 从 messages 末条 AIMessage 提取）
 *   - 建议9：改用 ConsensusPattern.reach_consensus 统一入口（含 quorum + 超时处理）
 *   - 建议11：quorum 默认改为动态计算 max(1, ceil(subtask_count / 2))，避免 3 子 Agent
 *     下 1 个失败即共识失败
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

    // 收集有效结果
    const results = Object.values(subtaskResults)
    const validResults = results.filter((r) => r['status'] === 'success')

    // v1.4 §4.4 建议11：动态计算 quorum
    //   - 配置显式指定 consensus_quorum > 0 时沿用配置
    //   - 否则按 max(1, ceil(subtask_count / 2)) 动态计算，避免 3 子 Agent 下 1 个失败即失败
    const subtaskCount = Math.max(state.subtasks?.length ?? 0, results.length, 1)
    const configQuorum = Number(multiAgentCfg['consensus_quorum'] ?? 0)
    const quorum = configQuorum > 0
      ? configQuorum
      : Math.max(1, Math.ceil(subtaskCount / 2))

    // v1.4 §4.4 建议9：使用 ConsensusPattern 统一入口（含 quorum 校验 + 超时 + 事件发布）
    let effectiveStrategy = strategy
    if (effectiveStrategy === null) {
      const strategyName = multiAgentCfg['consensus_strategy'] ?? 'majority_vote'
      const taskDesc = state.input_data?.['prompt'] ?? ''
      effectiveStrategy = create_consensus_strategy(strategyName, judgeLlm, taskDesc)
    }

    const pattern = new ConsensusPattern(quorum, effectiveStrategy, eventBus)

    // 通过 reach_consensus 统一入口聚合
    //   participants 传入空数组——我们已有结果，直接通过 _aggregateResults 复用策略
    //   实际上 reach_consensus 期望传入 participant 函数列表，这里我们绕过它
    //   改为直接调用 pattern.strategy.aggregate + 手动 quorum 校验 + 失败事件发布
    //   以复用 reach_consensus 的失败发布逻辑
    if (validResults.length < quorum) {
      logger.warning(
        'Consensus quorum not met: %d/%d (trace_id=%s)',
        validResults.length, quorum, traceId,
      )
      if (multiAgentCfg['consensus_failure_as_evolution_signal']) {
        try {
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

      const fallbackText = fallbackOutput || 'Unable to reach consensus among agents.'
      // v1.4 §4.4 建议8：将降级结果作为 AIMessage 追加到 messages
      return {
        consensus_result: { status: 'failed', consensus: null },
        consensus_failed: true,
        response: fallbackText,
        messages: [...(state.messages ?? []), new AIMessage({ content: fallbackText })],
      }
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

      // v1.4 §4.4 建议8：将 consensus 结果作为 AIMessage 追加到 messages，
      // 确保 finalize_response 节点能从 messages 末条 AIMessage 提取到子 Agent 协作结果
      return {
        consensus_result: {
          status: 'success',
          consensus,
          agreement_count: consensus['agreement_count'] ?? validResults.length,
          strategy: consensus['strategy'] ?? effectiveStrategy.constructor.name,
        },
        consensus_failed: false,
        response: responseText,
        messages: [...(state.messages ?? []), new AIMessage({ content: responseText })],
      }
    } catch (e) {
      logger.error('Consensus aggregation failed: %s', String(e))
      const errText = `Consensus aggregation error: ${e}`
      return {
        consensus_result: { status: 'error', error: String(e) },
        consensus_failed: true,
        response: errText,
        messages: [...(state.messages ?? []), new AIMessage({ content: errText })],
      }
    }
  }

  return _consensusNode
}
