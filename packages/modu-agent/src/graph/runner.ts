// 对应 Python: modu_graph/runner.py
// ModuAgent LangGraph 运行入口（流式/非流式）。
//
// P0-2: LangGraph 成为唯一引擎，移除 legacy Coordinator 分支。
//
// 提供：
//   - stream_response(): 流式调用，使用 LangGraph astream
//   - run_sync(): 非流式调用
//   - get_runner(): 获取 LangGraph ModuGraph 实例
//   - process_request_compat(): 统一调用接口（保留向后兼容）
//   - resume_sync() / resume_stream(): HITL 恢复入口
//   - get_interrupt_state(): 查询 interrupt 暂停状态
//
// LangGraph 提供 4 种 stream_mode：
//   - messages: token 级流式
//   - updates: 节点状态更新
//   - values: 完整状态快照
//   - custom: 自定义事件
//
// 与 Python 版的差异：
//   1. get_runner 为 async——create_agent 在 Node.js 中是异步的
//      （MCP 工具发现 listAllTools 是异步的，无法像 Python 那样新建事件循环）。
//   2. Python threading.Lock → Node 单线程无需锁（简化为直接访问）。
//   3. Python @contextmanager _span → TS [Symbol.dispose] + using 语法。
import crypto from 'crypto'
import { performance } from 'perf_hooks'
import { randomUUID } from 'crypto'

import { Command } from '@langchain/langgraph'

import { getConfig } from '../config/runtime-config.js'
import { PerceptionInputSchema, ValueError } from '../config/schemas.js'
import { ErrorCode } from '../orchestration/communication/protocol.js'
import type { SpanHandle } from '../observability/tracing.js'
import { get_span_manager } from '../observability/tracing.js'
import { get_metrics_registry } from '../observability/metrics.js'
import { LangGraphEventBridge } from './adapters/event-bridge.js'
import type { ModuGraph } from './graph.js'
import { makeInitialState, migrate_state } from './state.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[runner] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[runner] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[runner] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[runner] ${msg}`, ...args),
}

/**
 * 从 ModuGraph 提取 recursionLimit 并注入 lgConfig。
 *
 * 修复：LangGraph JS 使用 camelCase `recursionLimit` 作为 RunnableConfig 键名
 * （与 Python 版的 snake_case `recursion_limit` 不同）。ensureLangGraphConfig 仅保留
 * 白名单内的键（含 `recursionLimit`），snake_case 键会被丢弃，回退到默认值 25。
 * 此函数读取图上的 recursionLimit 并以正确的 camelCase 键注入到 stream 调用的 config 中。
 *
 * P9.1.4: 直接通过 ModuGraphInterface.recursionLimit 读取，无需访问 _compiled 或 as any。
 */
function _withRecursionLimit(graph: ModuGraph, lgConfig: Record<string, any>): Record<string, any> {
  const limit = graph?.recursionLimit
  if (limit && typeof limit === 'number' && limit > 0) {
    return { ...lgConfig, recursionLimit: limit }
  }
  return lgConfig
}

// ============================================================
// P1-12.2.6: CompiledStateGraph 实例缓存，避免每次 get_runner() 都重建图。
// 配置变更（通过 hash 检测）时自动失效重建。
// Node.js 单线程模型无需锁（Python threading.Lock 在此简化为直接访问）。
//
// P9.5.1: 引入两层优化降低图重建频率：
//   1. debounce（100ms）：连续配置变更合并为一次 reset_runner_cache()
//   2. LLM 参数软失效：llm.temperature / llm.max_tokens /
//      llm.max_reasoning_iterations 仅影响 LLM 行为，不改变图拓扑，
//      通过 RunnableConfig.configurable per-request 注入（复用
//      config_overrides 机制），不触发缓存失效。下次 get_runner()
//      的 hash 检测仍会兜底重建，保证最终一致。
// ============================================================

let _runnerCache: ModuGraph | null = null
let _runnerConfigHash: string | null = null

// P2-12.2.4: 配置热更新主动传导——回调注册标志
let _configCallbackRegistered = false

// P2-12.2.4: 触发图重建的配置 key 前缀
const _GRAPH_REBUILD_PREFIXES = ['llm.', 'tools.', 'memory.', 'orchestration.', 'streaming.', 'plan_execute.']

// P9.5.1: 仅影响 LLM 行为（不改变图拓扑）的配置 key——软失效，不触发缓存重置。
// 这些参数通过 RunnableConfig.configurable 在 per-request 层注入（复用
// config_overrides 机制），避免每次温度/max_tokens 调整都重建图。
//
// P1-修正(2026-07-30): max_reasoning_iterations 语义边界澄清。
//   该参数有双重作用:
//     (1) 作为 LLM 行为参数,通过 configurable.llm_params 注入 agent 节点(软失效路径)
//     (2) 作为 recursionLimit 计算输入(见 graph.ts baseLimit 公式),图编译时硬写入
//   软失效路径只覆盖 (1),(2) 仍依赖下次 get_runner() 的 hash 惰性重建兜底。
//   即:运行时改 max_reasoning_iterations 后,LLM 行为立即生效,但 recursionLimit
//   要等下次配置 hash 变化触发重建才更新。这是已知的设计折衷,非 bug——
//   避免每次调参都重建图(昂贵),以最终一致性换取低开销。
const _LLM_PARAM_ONLY_KEYS = new Set([
  'llm.temperature',
  'llm.max_tokens',
  'llm.max_reasoning_iterations',
])

// P9.5.1: debounce 窗口（毫秒）。连续配置变更在窗口内合并为一次缓存重置。
const _REBUILD_DEBOUNCE_MS = 100

// P9.5.1: debounce 定时器句柄（null=无待触发的重置）
let _debouncedResetTimer: ReturnType<typeof setTimeout> | null = null

// P9.5.1: debounce 窗口内累计的配置变更 keyPath 列表，用于判断窗口结束时
// 是否仍需重置（若全部为 LLM 参数软失效，则跳过）。
let _pendingChangeKeys: string[] = []

/**
 * P1-12.2.6: 计算运行时配置的哈希，用于判断是否需要重建图。
 *
 * @param config RuntimeConfig 实例
 * @returns 配置内容的 SHA256 十六进制摘要
 */
function _hashConfig(config: any): string {
  let data: Record<string, any>
  try {
    data = config.asDict()
  } catch {
    data = {}
  }
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
}

/**
 * P2-9 + P3-12.3.5: span 埋点，支持 OTel 升级。
 *
 * 委托给 observability.tracing.OtelSpanManager.span()：
 *   - 当 observability.tracing.enabled=True 时创建 OTel span（支持分布式追踪）
 *   - 当 tracing 未启用时退化为日志记录（与 P2-9 行为一致，零侵入）
 *
 * 返回 SpanHandle，支持 `using` 语法（[Symbol.dispose]）或手动 end()/recordError()。
 *
 * @param name span 名称（如 "run_sync", "stream_response"）
 * @param traceId 链路追踪 ID
 * @param attributes span 属性（如 user_id, session_id）
 */
function _span(
  name: string,
  traceId: string = '',
  attributes: Record<string, any> = {},
): SpanHandle {
  try {
    const manager = get_span_manager()
    return manager.span(name, traceId, attributes)
  } catch (e: any) {
    logger.debug('OTel span manager unavailable, using fallback: %s', String(e))
  }

  // 降级路径：原始日志记录行为（observability 模块不可用时）
  const start = performance.now()
  const attrs = { trace_id: traceId, ...attributes }
  logger.debug('span.start: %s attrs=%s', name, attrs)
  return {
    end(): void {
      const elapsedMs = performance.now() - start
      logger.info('span.end: %s elapsed=%.2fms attrs=%s', name, elapsedMs, attrs)
    },
    recordError(error: unknown): void {
      const elapsedMs = performance.now() - start
      logger.error(
        'span.error: %s elapsed=%.2fms error=%s attrs=%s',
        name, elapsedMs, String(error), attrs,
      )
    },
    [Symbol.dispose](): void {
      this.end()
    },
  }
}

/**
 * P1-6: 入口层输入校验。
 *
 * 使用 PerceptionInputSchema 验证 input_data 的关键字段，
 * 在进入 LangGraph 图之前拒绝非法输入。
 *
 * @param inputData 输入数据字典
 * @throws ValueError 输入数据不合法
 */
function _validateInputData(inputData: Record<string, any>): void {
  const inputType = inputData['input_type'] ?? 'text'
  const prompt = inputData['prompt'] ?? ''

  // 使用 PerceptionInputSchema 校验 input_type 和 sensitivity_level
  const rawContent =
    typeof prompt === 'string' ? Buffer.from(prompt, 'utf-8') : Buffer.alloc(0)
  const sensitivityLevel = inputData['sensitivity_level'] ?? 0

  try {
    new PerceptionInputSchema({
      inputType,
      rawContent: new Uint8Array(rawContent),
      sensitivityLevel,
    })
  } catch (e: any) {
    if (e instanceof ValueError) {
      logger.warning('Input validation failed: %s', String(e))
      throw new ValueError(`Invalid input data: ${e.message}`)
    }
    throw e
  }

  // 文本输入必须有 prompt
  if (inputType === 'text' && !prompt) {
    throw new ValueError('prompt is required for text input')
  }
}

/**
 * P0-2: 从 checkpointer 读取上一次会话状态的 config_overrides。
 *
 * @param graph ModuGraph 实例
 * @param sessionId 会话标识
 * @returns config_overrides 字典（空字典表示无覆盖）
 */
async function _loadPrevConfigOverrides(
  graph: ModuGraph,
  sessionId: string,
): Promise<Record<string, any>> {
  const configOverrides: Record<string, any> = {}

  try {
    // P9.1.4: 通过 ModuGraphInterface.checkpointer 访问，无需 as any
    const checkpointer = graph.checkpointer
    if (checkpointer != null && typeof checkpointer.getTuple === 'function') {
      const config = { configurable: { thread_id: sessionId } }
      // LangGraph JS: getTuple 是异步的（Python 版为同步）
      const stateTuple = await checkpointer.getTuple(config)
      if (stateTuple != null) {
        const stateValues = stateTuple.values ?? null
        if (stateValues && typeof stateValues === 'object') {
          // 状态 schema 迁移（对应文档 §2.3 建议3）：
          //   历史 checkpoint 可能缺少新字段（如 state_schema_version），
          //   migrate_state 按版本号补齐/清理，保证运行时状态结构一致
          const migrated = migrate_state(stateValues as Record<string, any>)
          const prevOverrides = (migrated as any).config_overrides ?? {}
          if (prevOverrides && typeof prevOverrides === 'object') {
            Object.assign(configOverrides, prevOverrides)
            logger.info(
              'Loaded config overrides from previous state for session %s (schema_version=%d): %s',
              sessionId, migrated.state_schema_version, Object.keys(prevOverrides),
            )
          }
        }
      }
    }
  } catch (e: any) {
    logger.debug('Failed to load config overrides from checkpointer: %s', String(e))
  }

  return configOverrides
}

/**
 * P0-2: 构建带 config_overrides 的 LangGraph 配置。
 *
 * 将 config_overrides 合并到 configurable 中。
 *
 * P9.5.1: 同时注入当前 LLM 参数（temperature / max_tokens / max_reasoning_iterations）
 * 到 configurable.llm_params，使 agent 节点能 per-request 读取最新值——避免 LLM
 * 参数热更新触发图重建（与软失效策略配套）。
 *
 * @param sessionId 会话标识
 * @param configOverrides 配置覆盖字典
 * @returns 包含 configurable 字段的配置字典
 */
function _buildConfigWithOverrides(
  sessionId: string,
  configOverrides: Record<string, any>,
): Record<string, any> {
  const configurable: Record<string, any> = { thread_id: sessionId }
  if (configOverrides && Object.keys(configOverrides).length > 0) {
    Object.assign(configurable, configOverrides)
  }

  // P9.5.1: 注入当前 LLM 参数到 per-request configurable，
  // 供 agent 节点在 config_overrides 未覆盖时使用全局最新值
  const llmParams = _collectCurrentLLMParams()
  if (llmParams && Object.keys(llmParams).length > 0) {
    // 已有的 config_overrides 优先（per-session 隔离），llm_params 仅作兜底
    configurable.llm_params = { ...llmParams, ...(configOverrides.llm_params ?? {}) }
  }

  return { configurable }
}

/**
 * P9.5.1: 从 RuntimeConfig 收集当前 LLM 参数（temperature / max_tokens /
 * max_reasoning_iterations）。
 *
 * 这些参数不触发图重建（见 `_LLM_PARAM_ONLY_KEYS`），而是通过 per-request
 * `RunnableConfig.configurable.llm_params` 注入到 agent 节点。
 *
 * @returns LLM 参数字典（空对象表示无配置或读取失败）
 */
function _collectCurrentLLMParams(): Record<string, any> {
  const params: Record<string, any> = {}
  try {
    const config = getConfig()
    const temperature = config.get('llm.temperature', null)
    if (temperature !== null && typeof temperature === 'number') {
      params['temperature'] = temperature
    }
    const maxTokens = config.get('llm.max_tokens', null)
    if (maxTokens !== null && typeof maxTokens === 'number') {
      params['max_tokens'] = maxTokens
    }
    const maxReasoningIterations = config.get('llm.max_reasoning_iterations', null)
    if (maxReasoningIterations !== null && typeof maxReasoningIterations === 'number') {
      params['max_reasoning_iterations'] = maxReasoningIterations
    }
  } catch (e: any) {
    logger.debug('Failed to collect current LLM params: %s', String(e))
  }
  return params
}

/**
 * 将 LangGraph JS stream 产出的 [mode, chunk] 元组归一化为 {type, node?, data} 对象格式。
 *
 * LangGraph JS 在 streamMode 为数组（如 ['messages', 'updates', 'values']）时，
 * 每个事件产出为 [mode, chunk] 二元组。但下游 LangGraphEventBridge / AGUIStreamAdapter
 * 期望 {type, node, data} 对象格式。此函数填补这一断层：
 *
 *   - updates 模式：chunk 是 {node_name: state_update}，拆分为 node + data
 *   - messages 模式：chunk 是 message 对象，同时设置 event 和 data 兼容下游
 *   - values / 其他：chunk 直接作为 data
 *   - 非元组对象（已格式化）：直接透传
 */
async function* _normalizeLangGraphStream(
  rawStream: AsyncIterable<any>,
): AsyncGenerator<Record<string, any>> {
  let rawIdx = 0
  let normIdx = 0
  console.info('[runner.normalize] start')

  for await (const event of rawStream) {
    rawIdx++
    const isArray = Array.isArray(event)
    console.info(
      '[runner.normalize] raw[%d] isArray=%s type=%s',
      rawIdx, isArray,
      isArray ? `[${event[0]}]` : ((event as any)?.type ?? typeof event),
    )

    if (isArray && event.length === 2) {
      const [mode, chunk] = event
      if (mode === 'updates' && chunk && typeof chunk === 'object' && !Array.isArray(chunk)) {
        for (const [node, data] of Object.entries(chunk)) {
          normIdx++
          console.info(
            '[runner.normalize] yield[%d] type=updates node=%s',
            normIdx, node,
          )
          yield { type: 'updates', node, data: data ?? {} }
        }
      } else if (mode === 'messages') {
        // LangGraph JS messages streamMode 产出 [message_chunk, metadata] 元组
        // message_chunk（如 AIMessageChunk）才是实际的消息对象，需提取后传递
        // 保留 metadata（含 langgraph_node / langgraph_step 等）供下游区分轮次/节点
        const msgObj = Array.isArray(chunk) ? chunk[0] : chunk
        const msgMeta = Array.isArray(chunk) && chunk.length > 1 ? (chunk[1] ?? {}) : {}
        normIdx++
        const msgType = msgObj?._getType?.() ?? msgObj?.constructor?.name ?? typeof msgObj
        console.info('[runner.normalize] yield[%d] type=messages msg_type=%s node=%s', normIdx, msgType, msgMeta?.langgraph_node ?? '')
        yield { type: 'messages', event: msgObj, data: msgObj, metadata: msgMeta }
      } else {
        normIdx++
        console.info('[runner.normalize] yield[%d] type=%s', normIdx, mode)
        yield { type: mode, data: chunk }
      }
    } else if (event && typeof event === 'object' && !Array.isArray(event)) {
      normIdx++
      console.info(
        '[runner.normalize] yield[%d] passthrough type=%s',
        normIdx, (event as any)?.type ?? '',
      )
      yield event as Record<string, any>
    } else {
      console.warn(
        '[runner.normalize] raw[%d] skipped unknown format: %s',
        rawIdx, typeof event,
      )
    }
  }

  console.info('[runner.normalize] end raw=%d normalized=%d', rawIdx, normIdx)
}

/**
 * 替代 Coordinator.stream_request()。
 *
 * 使用 LangGraph 原生 stream 实现流式输出，
 * 通过 EventBridge 桥接到现有 EventBus。
 *
 * @param graph ModuGraph 实例
 * @param userId 用户标识
 * @param sessionId 会话标识（LangGraph thread_id）
 * @param inputData 输入数据（input_type / prompt / required_fields 等）
 * @param traceId 链路追踪 ID（null=自动生成）
 * @param eventBridge 事件桥接器（null=自动创建）
 * @param extraConfigurable P4: 额外的 configurable 字段（如 plan_execute_enabled），
 *                          传入后会合并到 lgConfig.configurable，供运行时路由函数读取
 * @yields LangGraph stream 事件字典
 */
export async function* stream_response(
  graph: ModuGraph,
  userId: string,
  sessionId: string,
  inputData: Record<string, any>,
  traceId?: string | null,
  eventBridge?: LangGraphEventBridge | null,
  extraConfigurable?: Record<string, any> | null,
): AsyncGenerator<Record<string, any>> {
  // P1-6: 入口层输入校验
  _validateInputData(inputData)

  if (!traceId) {
    traceId = randomUUID()
  }

  // P0-2: 从 checkpointer 读取上一次会话的 config_overrides
  const configOverrides = await _loadPrevConfigOverrides(graph, sessionId)

  const initialState = makeInitialState(userId, sessionId, traceId, inputData)
  // P0-2: 将 config_overrides 注入 initial_state，供 agent_node 读取
  if (Object.keys(configOverrides).length > 0) {
    ;(initialState as any).config_overrides = configOverrides
  }

  // P4: 合并 extraConfigurable（如 plan_execute_enabled）到 lgConfig.configurable，
  // 使运行时路由函数（routeAfterMemoryQuery）能通过 config.configurable 读取 per-request 配置
  const lgConfig = _buildConfigWithOverrides(sessionId, configOverrides)
  if (extraConfigurable && Object.keys(extraConfigurable).length > 0) {
    Object.assign((lgConfig as any).configurable, extraConfigurable)
  }

  let bridge = eventBridge
  if (bridge === null || bridge === undefined) {
    // P0-1: 从图上读取 orchestrator 的 evolution_collector，激活 EventBridge 的信号收集
    // P9.1.4: 通过 ModuGraphInterface.orchestrator 访问，无需 as any
    let evolutionCollector: any = graph.orchestrator
    evolutionCollector = evolutionCollector?.evolutionCollector ?? null
    bridge = new LangGraphEventBridge(
      null,
      evolutionCollector,
      traceId,
      sessionId,
      userId,
    )
  }

  // LangGraph JS 的 stream() 返回 Promise<IterableReadableStream>（Promise 包裹的 async iterable），
  // 必须先 await 解包才能用 for await...of 遍历，否则会抛 "not async iterable" 错误。
  // 修复：显式注入 recursionLimit（camelCase），否则 LangGraph 回退到默认 25
  // P9.1.4: 通过 ModuGraphInterface.stream() 调用，无需 as any
  const streamConfig = _withRecursionLimit(graph, {
    ...lgConfig,
    streamMode: ['messages', 'updates', 'values'],
  })
  const rawStream = await graph.stream(initialState, streamConfig)

  // LangGraph JS stream 产出 [mode, chunk] 元组，bridge.consume 期望 {type, node, data} 对象，
  // 需通过 _normalizeLangGraphStream 归一化后才能交给 EventBridge 消费。
  const normalizedStream = _normalizeLangGraphStream(rawStream)

  // P2-9: span 埋点——流式响应的总耗时（生成器生命周期由调用者控制，用 try/finally 确保结束记录）
  const streamStart = performance.now()
  try {
    for await (const event of bridge.consume(normalizedStream)) {
      yield event
    }
  } finally {
    const elapsedMs = performance.now() - streamStart
    logger.info(
      'span.end: stream_response elapsed=%.2fms trace_id=%s user_id=%s session_id=%s',
      elapsedMs, traceId, userId, sessionId,
    )
    // P3-12.3.5: 记录流式请求指标
    try {
      get_metrics_registry().record_request('success', elapsedMs / 1000.0)
    } catch {
      // no-op
    }
  }
}

/**
 * 替代 Coordinator.process_request()。
 *
 * 非流式调用，等待完整结果。
 *
 * @param graph ModuGraph 实例
 * @param userId 用户标识
 * @param sessionId 会话标识（LangGraph thread_id）
 * @param inputData 输入数据
 * @param traceId 链路追踪 ID（null=自动生成）
 * @param eventBridge 事件桥接器（null=自动创建）
 * @returns 响应字典
 */
export async function run_sync(
  graph: ModuGraph,
  userId: string,
  sessionId: string,
  inputData: Record<string, any>,
  traceId?: string | null,
  eventBridge?: LangGraphEventBridge | null,
): Promise<Record<string, any>> {
  // P1-6: 入口层输入校验
  try {
    _validateInputData(inputData)
  } catch (e: any) {
    if (e instanceof ValueError) {
      return {
        status: 'error',
        error_code: ErrorCode.PERCEPTION_INPUT_INVALID,
        data: { message: String(e), trace_id: traceId ?? randomUUID() },
      }
    }
    throw e
  }

  if (!traceId) {
    traceId = randomUUID()
  }

  // P3-12.3.5: metrics 计时起点
  const metricsStart = performance.now()

  const recordMetrics = (status: string): void => {
    try {
      get_metrics_registry().record_request(status, performance.now() - metricsStart)
    } catch {
      // no-op
    }
  }

  // P0-2: 从 checkpointer 读取上一次会话的 config_overrides
  const configOverrides = await _loadPrevConfigOverrides(graph, sessionId)

  const initialState = makeInitialState(userId, sessionId, traceId, inputData)
  // P0-2: 将 config_overrides 注入 initial_state，供 agent_node 读取
  if (Object.keys(configOverrides).length > 0) {
    ;(initialState as any).config_overrides = configOverrides
  }

  const lgConfig = _buildConfigWithOverrides(sessionId, configOverrides)

  let bridge = eventBridge
  if (bridge === null || bridge === undefined) {
    // P0-1: 从图上读取 orchestrator 的 evolution_collector
    // P9.1.4: 通过 ModuGraphInterface.orchestrator 访问，无需 as any
    let evolutionCollector: any = graph.orchestrator
    evolutionCollector = evolutionCollector?.evolutionCollector ?? null
    bridge = new LangGraphEventBridge(
      null,
      evolutionCollector,
      traceId,
      sessionId,
      userId,
    )
  }

  try {
    // P2-9: span 埋点——run_sync 总耗时
    using span = _span('run_sync', traceId, { user_id: userId, session_id: sessionId })

    let finalState: Record<string, any> | null = null
    // stream() 返回 Promise<IterableReadableStream>，需 await 解包后再遍历
    // 修复：显式注入 recursionLimit（camelCase）
    // P9.1.4: 通过 ModuGraphInterface.stream() 调用，无需 as any
    const streamConfig = _withRecursionLimit(graph, {
      ...lgConfig,
      streamMode: ['updates', 'values'],
    })
    const rawStream = await graph.stream(initialState, streamConfig)

    // 归一化 [mode, chunk] 元组为 {type, node, data} 对象后交给 EventBridge
    const normalizedStream = _normalizeLangGraphStream(rawStream)
    for await (const event of bridge.consume(normalizedStream)) {
      // event 是普通 JS 对象（非 Map），用方括号访问
      if (event['type'] === 'values') {
        finalState = event['data'] ?? {}
      }
    }

    // P1-4: astream 失败时不应回退到 ainvoke，应直接报错
    // 避免请求被执行两次（一次 astream 一次 ainvoke）
    if (finalState === null) {
      logger.error('LangGraph astream produced no values event, trace_id=%s', traceId)
      return {
        status: 'error',
        error_code: ErrorCode.LLM_GENERATION_FAILED,
        data: { message: 'No output produced', trace_id: traceId },
      }
    }

    const errorCode = finalState['error_code'] ?? ''
    if (errorCode) {
      recordMetrics('error')
      return {
        status: 'error',
        error_code: errorCode,
        data: {
          message: finalState['error_message'] ?? '',
          trace_id: traceId,
        },
      }
    }

    const config = getConfig()
    const sensitivityThreshold = config.get('perception.sensitivity_threshold', 5)
    const sensitivityLevel = finalState['sensitivity_level'] ?? 0
    if (sensitivityLevel >= sensitivityThreshold) {
      recordMetrics('circuit_breaker')
      return {
        status: 'error',
        error_code: ErrorCode.PERCEPTION_SENSITIVITY_REJECTED,
        data: { message: 'Input rejected due to sensitive content' },
      }
    }

    recordMetrics('success')
    return {
      status: 'success',
      error_code: '',
      data: {
        response: finalState['response'] ?? '',
        tool_results: finalState['tool_results'] ?? [],
        trace_id: traceId,
        // 评测支持（向后兼容的新增字段）：过程层指标（token 成本/迭代效率）所需的过程数据。
        // 供 @pioneering/evals 评测引擎消费；现有调用方不受影响。
        usage: finalState['usage'] ?? {},
        iteration: finalState['iteration'] ?? 0,
        reasoning_round_count: finalState['reasoning_round_count'] ?? 0,
      },
    }
  } catch (e: any) {
    logger.error('LangGraph run_sync failed: %s', String(e))
    recordMetrics('error')
    return {
      status: 'error',
      error_code: ErrorCode.LLM_GENERATION_FAILED,
      data: { message: String(e), trace_id: traceId },
    }
  }
}

/**
 * 获取 LangGraph ModuGraph 实例。
 *
 * P0-2: LangGraph 成为唯一引擎，移除 legacy Coordinator 分支。
 * engine 参数保留用于向后兼容，但仅支持 "langgraph"（其他值将记录警告）。
 *
 * P1-12.2.6: 缓存编译图实例，配合配置 hash 检测；配置变更时自动重建。
 * 避免每次请求都重新构建图（含 LLM/工具/checkpointer/store 初始化）的开销。
 *
 * P2-12.2.4: 注册配置变更回调，llm. * / tools. * 等关键配置变更时主动触发缓存失效，
 * 无需等待下次 get_runner() 的 hash 检测——实现"主动传导"而非"惰性重建"。
 *
 * 与 Python 版差异：为 async——create_agent 在 Node.js 中是异步的
 * （MCP 工具发现 listAllTools 是异步的）。
 *
 * @param engine 引擎类型（保留向后兼容，默认从配置读取）
 * @returns ModuGraph 包装器（透明委托 CompiledStateGraph 的所有方法）
 */
export async function get_runner(engine?: string | null): Promise<ModuGraph> {
  // P2-12.2.4: 首次调用时注册配置变更回调（仅注册一次）
  _ensureConfigCallbackRegistered()

  const config = getConfig()
  engine = engine || config.get('orchestration.engine', 'langgraph')

  if (engine !== 'langgraph') {
    logger.warning("Engine '%s' is no longer supported, falling back to langgraph", engine)
  }

  const currentHash = _hashConfig(config)
  // Node 单线程无需锁——直接检查缓存
  if (_runnerCache !== null && currentHash === _runnerConfigHash) {
    return _runnerCache
  }

  logger.info(
    'Rebuilding LangGraph runner (config_hash changed: %s -> %s)',
    _runnerConfigHash, currentHash,
  )

  // 延迟导入避免循环依赖
  const { create_agent } = await import('./factory.js')
  _runnerCache = await create_agent()
  _runnerConfigHash = currentHash
  return _runnerCache
}

/**
 * P2-12.2.4: 确保配置变更回调已注册（仅注册一次）。
 *
 * 注册一个回调到 RuntimeConfig，当 llm. * / tools. * / memory. * 等影响图结构的
 * 配置变更时，主动调用 reset_runner_cache() 使缓存失效。
 * 下次 get_runner() 调用时将重建图——实现配置热更新的主动传导。
 *
 * 与 P1-12.2.6 的 hash 惰性重建互补：
 * - hash 惰性重建：兜底机制，确保最终一致性
 * - 回调主动传导：即时响应，避免缓存窗口期内的旧图请求
 */
function _ensureConfigCallbackRegistered(): void {
  if (_configCallbackRegistered) {
    return
  }
  try {
    const config = getConfig()
    config.registerChangeCallback(_onConfigChange)
    _configCallbackRegistered = true
    logger.info('Config change callback registered for runner cache invalidation')
  } catch (e: any) {
    logger.warning('Failed to register config change callback: %s', String(e))
  }
}

/**
 * P2-12.2.4 + P9.5.1: 配置变更回调——影响图结构的配置变更时主动失效缓存。
 *
 * P9.5.1 优化：
 *   1. **debounce（100ms）**：连续多次配置变更在 100ms 窗口内合并为一次
 *      `reset_runner_cache()`，避免连续微调参数导致频繁重建。
 *   2. **LLM 参数软失效**：`llm.temperature` / `llm.max_tokens` /
 *      `llm.max_reasoning_iterations` 仅影响 LLM 推理行为，不改变图拓扑，
 *      不触发缓存重置。这些参数通过 `RunnableConfig.configurable`
 *      在 per-request 层注入（复用 config_overrides 机制）。
 *      下次 `get_runner()` 的 hash 检测仍会兜底重建，保证最终一致。
 *
 * @param keyPath 变更的配置路径（如 "llm.temperature"）
 * @param _oldValue 旧值（未使用）
 * @param _newValue 新值（未使用）
 */
function _onConfigChange(
  keyPath: string,
  _oldValue: any,
  _newValue: any,
): void {
  // P9.5.1: 仅匹配 _GRAPH_REBUILD_PREFIXES 的 key 才进入 debounce 流程
  let matched = false
  for (const prefix of _GRAPH_REBUILD_PREFIXES) {
    if (keyPath.startsWith(prefix)) {
      matched = true
      break
    }
  }
  if (!matched) {
    return
  }

  // P9.5.1: 记录变更 key 到 pending 列表（用于窗口结束时判断是否仍需重置）
  _pendingChangeKeys.push(keyPath)
  logger.info(
    "Config change detected ('%s'), queued for debounced cache invalidation (pending=%d)",
    keyPath, _pendingChangeKeys.length,
  )

  // 若已有待触发的 debounce 定时器，不重复创建（合并到同一次）
  if (_debouncedResetTimer !== null) {
    return
  }

  _debouncedResetTimer = setTimeout(_flushDebouncedCacheReset, _REBUILD_DEBOUNCE_MS)
}

/**
 * P9.5.1: debounce 窗口结束时的回调——判断是否真正触发缓存重置。
 *
 * 遍历窗口内累计的变更 keyPath：
 *   - 若存在任一非 LLM 参数软失效 key → 触发 reset_runner_cache()
 *   - 若全部为 LLM 参数软失效 key → 跳过重置，由下次 get_runner() 的
 *     hash 检测兜底（保证最终一致，但避免立即重建）
 */
function _flushDebouncedCacheReset(): void {
  const pending = _pendingChangeKeys
  _pendingChangeKeys = []
  _debouncedResetTimer = null

  if (pending.length === 0) {
    return
  }

  // 判断是否全部为 LLM 参数软失效 key
  const allSoftLLM = pending.every((k) => _LLM_PARAM_ONLY_KEYS.has(k))
  if (allSoftLLM) {
    logger.info(
      'Skipping runner cache reset: all %d changes are LLM-param-only soft invalidation (%s)',
      pending.length, pending.join(', '),
    )
    return
  }

  // 存在非软失效 key → 触发重置
  const nonSoftKeys = pending.filter((k) => !_LLM_PARAM_ONLY_KEYS.has(k))
  logger.info(
    "Debounced cache reset triggered by %d config changes (non-soft: %s)",
    pending.length, nonSoftKeys.join(', '),
  )
  reset_runner_cache()
}

/**
 * P9.5.1: 同步刷新 debounce 队列（仅供测试用）。
 *
 * 取消待触发的定时器，立即执行 flush 逻辑。生产代码不应调用此函数——
 * debounce 由 Node.js 事件循环自然驱动。
 */
export function _flushDebouncedResetForTest(): void {
  if (_debouncedResetTimer !== null) {
    clearTimeout(_debouncedResetTimer)
    _debouncedResetTimer = null
  }
  _flushDebouncedCacheReset()
}

/**
 * P9.5.1: 重置 debounce 内部状态（仅供测试用，确保测试隔离）。
 */
export function _resetDebounceStateForTest(): void {
  if (_debouncedResetTimer !== null) {
    clearTimeout(_debouncedResetTimer)
    _debouncedResetTimer = null
  }
  _pendingChangeKeys = []
}

/**
 * P9.5.1: 直接调用配置变更回调（仅供测试用）。
 *
 * 测试中可通过此函数直接触发 `_onConfigChange` 逻辑，无需依赖 RuntimeConfig
 * 回调注册（避免与 `_configCallbackRegistered` 全局标志相互干扰）。
 */
export function _triggerConfigChangeForTest(
  keyPath: string,
  oldValue: any = null,
  newValue: any = null,
): void {
  _onConfigChange(keyPath, oldValue, newValue)
}

/**
 * 重置 runner 缓存（测试隔离用）。
 *
 * P1-12.2.6: 测试在修改配置后应调用此函数，确保下次 get_runner() 重建图。
 */
export function reset_runner_cache(): void {
  _runnerCache = null
  _runnerConfigHash = null
}

/**
 * 统一调用接口（P0-2: 仅支持 LangGraph ModuGraph）。
 *
 * @param runner ModuGraph 实例
 * @param userId 用户标识
 * @param sessionId 会话标识
 * @param inputData 输入数据
 * @param traceId 链路追踪 ID
 * @returns 统一格式的响应字典
 */
export async function process_request_compat(
  runner: any,
  userId: string,
  sessionId: string,
  inputData: Record<string, any>,
  traceId?: string | null,
): Promise<Record<string, any>> {
  if (typeof runner.stream === 'function' || typeof runner.invoke === 'function') {
    return await run_sync(runner, userId, sessionId, inputData, traceId)
  }
  throw new TypeError(`Unsupported runner type: ${typeof runner}`)
}

/**
 * 统一流式调用接口（P0-2: 仅支持 LangGraph ModuGraph）。
 *
 * @param runner ModuGraph 实例
 * @param userId 用户标识
 * @param sessionId 会话标识
 * @param inputData 输入数据
 * @param traceId 链路追踪 ID
 * @yields LangGraph stream 事件字典
 */
export async function* stream_request_compat(
  runner: any,
  userId: string,
  sessionId: string,
  inputData: Record<string, any>,
  traceId?: string | null,
): AsyncGenerator<Record<string, any>> {
  if (typeof runner.stream === 'function') {
    for await (const event of stream_response(runner, userId, sessionId, inputData, traceId)) {
      yield event
    }
  } else {
    throw new TypeError(`Unsupported runner type: ${typeof runner}`)
  }
}

// ============================================================
// P3-12.3.2 Human-in-the-loop resume 入口
// ============================================================

/**
 * P3-12.3.2: 恢复被 interrupt 暂停的图执行。
 *
 * 当 human_review_node 调用 interrupt(...) 暂停图后，
 * 调用者通过此方法提供审批结果并恢复执行。
 *
 * @param graph 已暂停的 ModuGraph 实例
 * @param sessionId 会话标识（必须与原请求一致，用于从 checkpoint 恢复）
 * @param approved 审批结果（true=通过，false=拒绝）
 * @param feedback 审批反馈备注（可选）
 * @param traceId 链路追踪 ID（可选，用于日志关联）
 * @returns 恢复执行后的最终状态字典
 */
export async function resume_sync(
  graph: ModuGraph,
  sessionId: string,
  approved: boolean,
  feedback: string = '',
  traceId?: string | null,
  options?: { timeout?: boolean },
): Promise<Record<string, any>> {
  if (!traceId) {
    traceId = randomUUID()
  }

  const lgConfig = { configurable: { thread_id: sessionId } }
  // P9.4.3: options.timeout=true 时在 payload 中携带 timeout 标记，
  // 供 human_review 节点识别超时场景并使用 TOOL_APPROVAL_TIMEOUT 错误码
  const resumePayload: Record<string, any> = {
    approved: Boolean(approved),
    feedback: String(feedback || ''),
  }
  if (options?.timeout === true) {
    resumePayload['timeout'] = true
  }

  try {
    using span = _span('resume_sync', traceId, { session_id: sessionId, approved })

    let finalState: Record<string, any> | null = null
    // stream() 返回 Promise<IterableReadableStream>，需 await 解包后再遍历
    // 修复：显式注入 recursionLimit（camelCase）
    // P9.1.4: 通过 ModuGraphInterface.stream() 调用，无需 as any
    const stream = await graph.stream(
      new Command({ resume: resumePayload }),
      _withRecursionLimit(graph, { ...lgConfig, streamMode: ['updates', 'values'] }),
    )

    for await (const event of stream) {
      // LangGraph JS stream 产出 [mode, chunk] 元组
      if (Array.isArray(event) && event.length === 2) {
        const [mode, chunk] = event
        if (mode === 'values' && chunk && typeof chunk === 'object') {
          finalState = chunk as Record<string, any>
        }
      } else if (event && typeof event === 'object' && !Array.isArray(event)) {
        const evt = event as Record<string, any>
        if (evt['type'] === 'values') {
          finalState = evt['data'] ?? {}
        }
      }
    }

    if (finalState === null) {
      logger.error(
        'Resume produced no values event, trace_id=%s session_id=%s',
        traceId, sessionId,
      )
      return {
        status: 'error',
        error_code: ErrorCode.LLM_GENERATION_FAILED,
        data: { message: 'Resume produced no output', trace_id: traceId },
      }
    }

    const errorCode = finalState['error_code'] ?? ''
    if (errorCode) {
      return {
        status: 'error',
        error_code: errorCode,
        data: {
          message: finalState['error_message'] ?? '',
          trace_id: traceId,
        },
      }
    }

    return {
      status: 'success',
      error_code: '',
      data: {
        response: finalState['response'] ?? '',
        tool_results: finalState['tool_results'] ?? [],
        trace_id: traceId,
        approval_status: finalState['approval_status'] ?? '',
      },
    }
  } catch (e: any) {
    logger.error(
      'Resume failed: %s (trace_id=%s session_id=%s)',
      String(e), traceId, sessionId,
    )
    return {
      status: 'error',
      error_code: ErrorCode.LLM_GENERATION_FAILED,
      data: { message: String(e), trace_id: traceId },
    }
  }
}

/**
 * P3-12.3.2: 恢复被 interrupt 暂停的图执行（流式版本）。
 *
 * 与 resume_sync 类似，但通过 astream 流式产出事件。
 *
 * @param graph 已暂停的 ModuGraph 实例
 * @param sessionId 会话标识
 * @param approved 审批结果
 * @param feedback 审批反馈备注
 * @param traceId 链路追踪 ID
 * @param options 可选：modifiedArgs（改参批准，按 tool_call_id 覆盖原参数）/ timeout（超时标记）
 * @yields LangGraph stream 事件字典
 */
export async function* resume_stream(
  graph: ModuGraph,
  sessionId: string,
  approved: boolean,
  feedback: string = '',
  traceId?: string | null,
  options?: { modifiedArgs?: Record<string, Record<string, any>>; timeout?: boolean },
): AsyncGenerator<Record<string, any>> {
  if (!traceId) {
    traceId = randomUUID()
  }

  const lgConfig = { configurable: { thread_id: sessionId } }
  const resumePayload: Record<string, any> = {
    approved: Boolean(approved),
    feedback: String(feedback || ''),
  }
  // v1.2 §4.3 建议3：改参批准（modified_args），与 resume_sync 对齐
  if (options?.modifiedArgs && Object.keys(options.modifiedArgs).length > 0) {
    resumePayload['modified_args'] = options.modifiedArgs
  }
  // P9.4.3: 超时标记
  if (options?.timeout === true) {
    resumePayload['timeout'] = true
  }

  const streamStart = performance.now()
  try {
    // P9.1.4: 通过 ModuGraphInterface.stream() 调用，无需 as any
    const stream = await graph.stream(
      new Command({ resume: resumePayload }),
      _withRecursionLimit(graph, { ...lgConfig, streamMode: ['messages', 'updates', 'values'] }),
    )

    for await (const event of stream) {
      // LangGraph JS stream 产出 [mode, chunk] 元组
      if (Array.isArray(event) && event.length === 2) {
        const [mode, chunk] = event
        yield { type: mode, data: chunk }
      } else if (event && typeof event === 'object' && !Array.isArray(event)) {
        yield event as Record<string, any>
      }
    }
  } finally {
    const elapsedMs = performance.now() - streamStart
    logger.info(
      'span.end: resume_stream elapsed=%.2fms trace_id=%s session_id=%s approved=%s',
      elapsedMs, traceId, sessionId, approved,
    )
  }
}

/**
 * P3-12.3.2: 查询指定 session 当前是否处于 interrupt 暂停状态。
 *
 * 用于调用者在决定是否调用 resume_sync 之前检查图状态。
 *
 * @param graph ModuGraph 实例
 * @param sessionId 会话标识
 * @returns
 *   - null: 未暂停或无 checkpoint
 *   - dict: 暂停时的 interrupt payload（含 tool_calls / message 等）
 */
export async function get_interrupt_state(
  graph: ModuGraph,
  sessionId: string,
): Promise<Record<string, any> | null> {
  try {
    const lgConfig = { configurable: { thread_id: sessionId } }
    // P9.1.4: 通过 ModuGraphInterface.getState() 调用，无需 as any
    // 注：LangGraph JS getState 返回 Promise<StateSnapshot>，需 await
    const state = await graph.getState(lgConfig)
    if (state === null || state === undefined) {
      return null
    }
    // 检查是否在 interrupt 暂停状态
    // LangGraph JS: state.next 包含下一个待执行节点
    const nextNodes = (state.next ?? []) as string[]
    if (!nextNodes || nextNodes.length === 0) {
      return null
    }
    // 检查是否为 human_review 节点的暂停
    if (!nextNodes.includes('human_review')) {
      return null
    }
    // 从 state.values 提取 interrupt 上下文
    const values = (state.values ?? {}) as Record<string, any>
    // 从 state.metadata 读取 interrupt 创建时间（LangGraph StateSnapshot.metadata.created_at）
    // 用于 HITL 超时检查（对应 CODE_WIKI 9.4.3）
    const meta = (state.metadata ?? {}) as Record<string, any>
    const createdAt = meta['created_at'] ?? null
    return {
      session_id: sessionId,
      next_nodes: [...nextNodes],
      pending_tool_calls: values['pending_tool_calls'] ?? [],
      tool_requires_approval: values['tool_requires_approval'] ?? false,
      trace_id: values['trace_id'] ?? '',
      user_id: values['user_id'] ?? '',
      created_at: createdAt,
    }
  } catch (e: any) {
    logger.debug('Failed to query interrupt state: %s', String(e))
    return null
  }
}

// ============================================================
// P9.4.3: HITL 审批超时机制
// ============================================================

/**
 * P9.4.3: 检查指定 session 的 interrupt 是否已超时。
 *
 * 读取 `tools.human_in_loop.approval_timeout_seconds`（默认 300s）配置，
 * 与 interrupt 创建时间（StateSnapshot.metadata.created_at）对比判断是否超时。
 *
 * 当 `auto_reject_on_timeout=true`（默认）时，超时后自动调用 resume_sync
 * 以 `approved=false` 恢复图执行，返回 `TOOL_APPROVAL_TIMEOUT` 错误码，
 * 避免长期占用 checkpointer 存储与会话上下文。
 *
 * @param graph ModuGraph 实例
 * @param sessionId 会话标识
 * @returns
 *   - 'active': 仍在审批窗口内，未超时
 *   - 'expired': 已超时（若 auto_reject_on_timeout=true，已自动 resume）
 *   - 'no_interrupt': 无 interrupt 暂停（无需处理）
 *   - 'no_config': 未启用超时配置（disabled）
 *   - 'resume_failed': 自动 resume 调用失败
 */
export async function checkInterruptTimeout(
  graph: ModuGraph,
  sessionId: string,
): Promise<'active' | 'expired' | 'no_interrupt' | 'no_config' | 'resume_failed'> {
  const config = getConfig()
  const hitlCfg = config.get('tools.human_in_loop', {}) ?? {}
  const timeoutSeconds = Number(hitlCfg['approval_timeout_seconds'] ?? 300)
  const autoReject = hitlCfg['auto_reject_on_timeout'] ?? true

  // timeout<=0 视为禁用超时检查
  if (!(timeoutSeconds > 0)) {
    return 'no_config'
  }

  const state = await get_interrupt_state(graph, sessionId)
  if (state === null) {
    return 'no_interrupt'
  }

  const createdAt = state['created_at']
  if (!createdAt) {
    // 缺少 created_at（旧 checkpoint 或 LangGraph 版本差异），保守不触发
    return 'active'
  }

  // createdAt 可能为 ISO 字符串、Unix 秒、Unix 毫秒；统一解析为毫秒
  let createdAtMs: number
  if (typeof createdAt === 'number') {
    createdAtMs = createdAt > 1e12 ? createdAt : createdAt * 1000
  } else {
    const parsed = Date.parse(String(createdAt))
    if (Number.isNaN(parsed)) {
      return 'active'
    }
    createdAtMs = parsed
  }

  const nowMs = Date.now()
  const elapsedSec = (nowMs - createdAtMs) / 1000
  if (elapsedSec < timeoutSeconds) {
    return 'active'
  }

  logger.warning(
    'HITL interrupt timed out: session_id=%s elapsed=%.1fs timeout=%ds auto_reject=%s',
    sessionId, elapsedSec, timeoutSeconds, autoReject,
  )

  if (!autoReject) {
    // 未启用自动拒绝，仅标记为已过期，由调用方处理
    return 'expired'
  }

  // 自动拒绝：调用 resume_sync(approved=false) 触发被拒工具降级路径
  try {
    const result = await resume_sync(
      graph,
      sessionId,
      false,
      `auto-rejected: approval timed out after ${timeoutSeconds}s`,
      `hitl-timeout-${sessionId}-${Math.floor(nowMs)}`,
      { timeout: true },  // P9.4.3: 携带 timeout 标记，human_review 使用 TOOL_APPROVAL_TIMEOUT
    )
    // resume_sync 成功（即使内部业务返回 error_code 也算图已恢复）
    if (result && result['status'] === 'error') {
      logger.error(
        'HITL auto-reject resume returned error: session_id=%s error_code=%s',
        sessionId, result['error_code'] ?? 'unknown',
      )
      return 'resume_failed'
    }
    return 'expired'
  } catch (e: any) {
    logger.error(
      'HITL auto-reject resume failed: session_id=%s error=%s',
      sessionId, String(e),
    )
    return 'resume_failed'
  }
}

/**
 * P9.4.3: 批量扫描并处理超时的 interrupt（清理任务入口）。
 *
 * 遍历给定的 session_id 列表，对每个 session 调用 checkInterruptTimeout。
 * 适合由外部定时任务（setInterval / cron）定期触发，清理长期占用 checkpointer
 * 存储的过期 interrupt 状态。
 *
 * @param graph ModuGraph 实例
 * @param sessionIds 待检查的 session_id 列表
 * @returns 每个 session 的检查结果汇总
 */
export async function sweepExpiredInterrupts(
  graph: ModuGraph,
  sessionIds: string[],
): Promise<Record<string, 'active' | 'expired' | 'no_interrupt' | 'no_config' | 'resume_failed'>> {
  const results: Record<string, 'active' | 'expired' | 'no_interrupt' | 'no_config' | 'resume_failed'> = {}
  for (const sessionId of sessionIds) {
    try {
      results[sessionId] = await checkInterruptTimeout(graph, sessionId)
    } catch (e: any) {
      logger.error(
        'sweepExpiredInterrupts: session_id=%s error=%s',
        sessionId, String(e),
      )
      results[sessionId] = 'resume_failed'
    }
  }
  return results
}
