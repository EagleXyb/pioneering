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
import { makeInitialState } from './state.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[runner] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[runner] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[runner] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[runner] ${msg}`, ...args),
}

// ============================================================
// P1-12.2.6: CompiledStateGraph 实例缓存，避免每次 get_runner() 都重建图。
// 配置变更（通过 hash 检测）时自动失效重建。
// Node.js 单线程模型无需锁（Python threading.Lock 在此简化为直接访问）。
// ============================================================

let _runnerCache: ModuGraph | null = null
let _runnerConfigHash: string | null = null

// P2-12.2.4: 配置热更新主动传导——回调注册标志
let _configCallbackRegistered = false

// P2-12.2.4: 触发图重建的配置 key 前缀
const _GRAPH_REBUILD_PREFIXES = ['llm.', 'tools.', 'memory.', 'orchestration.', 'streaming.']

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
    const checkpointer = (graph as any).checkpointer
    if (checkpointer != null && typeof checkpointer.getTuple === 'function') {
      const config = { configurable: { thread_id: sessionId } }
      // LangGraph JS: getTuple 是异步的（Python 版为同步）
      const stateTuple = await checkpointer.getTuple(config)
      if (stateTuple != null) {
        const stateValues = stateTuple.values ?? null
        if (stateValues && typeof stateValues === 'object') {
          const prevOverrides = (stateValues as any).config_overrides ?? {}
          if (prevOverrides && typeof prevOverrides === 'object') {
            Object.assign(configOverrides, prevOverrides)
            logger.info(
              'Loaded config overrides from previous state for session %s: %s',
              sessionId, Object.keys(prevOverrides),
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
  return { configurable }
}

/**
 * 替代 Coordinator.stream_request()。
 *
 * 使用 LangGraph 原生 astream 实现流式输出，
 * 通过 EventBridge 桥接到现有 EventBus。
 *
 * @param graph ModuGraph 实例
 * @param userId 用户标识
 * @param sessionId 会话标识（LangGraph thread_id）
 * @param inputData 输入数据（input_type / prompt / required_fields 等）
 * @param traceId 链路追踪 ID（null=自动生成）
 * @param eventBridge 事件桥接器（null=自动创建）
 * @yields LangGraph stream 事件字典
 */
export async function* stream_response(
  graph: ModuGraph,
  userId: string,
  sessionId: string,
  inputData: Record<string, any>,
  traceId?: string | null,
  eventBridge?: LangGraphEventBridge | null,
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

  const lgConfig = _buildConfigWithOverrides(sessionId, configOverrides)

  let bridge = eventBridge
  if (bridge === null || bridge === undefined) {
    // P0-1: 从图上读取 orchestrator 的 evolution_collector，激活 EventBridge 的信号收集
    let evolutionCollector: any = (graph as any).orchestrator
    evolutionCollector = evolutionCollector?.evolutionCollector ?? null
    bridge = new LangGraphEventBridge(
      null,
      evolutionCollector,
      traceId,
      sessionId,
      userId,
    )
  }

  const rawStream = (graph as any).astream(initialState, {
    ...lgConfig,
    streamMode: ['messages', 'updates', 'values'],
  })

  // P2-9: span 埋点——流式响应的总耗时（生成器生命周期由调用者控制，用 try/finally 确保结束记录）
  const streamStart = performance.now()
  try {
    for await (const event of bridge.consume(rawStream)) {
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
    let evolutionCollector: any = (graph as any).orchestrator
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
    const rawStream = (graph as any).astream(initialState, {
      ...lgConfig,
      streamMode: ['updates', 'values'],
    })

    for await (const event of bridge.consume(rawStream)) {
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
 * P2-12.2.4: 配置变更回调——影响图结构的配置变更时主动失效缓存。
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
  for (const prefix of _GRAPH_REBUILD_PREFIXES) {
    if (keyPath.startsWith(prefix)) {
      logger.info(
        "Config change detected ('%s'), invalidating runner cache for proactive rebuild",
        keyPath,
      )
      reset_runner_cache()
      return
    }
  }
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
  if (typeof runner.astream === 'function' || typeof runner.invoke === 'function') {
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
  if (typeof runner.astream === 'function') {
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
): Promise<Record<string, any>> {
  if (!traceId) {
    traceId = randomUUID()
  }

  const lgConfig = { configurable: { thread_id: sessionId } }
  const resumePayload = { approved: Boolean(approved), feedback: String(feedback || '') }

  try {
    using span = _span('resume_sync', traceId, { session_id: sessionId, approved })

    let finalState: Record<string, any> | null = null
    const stream = (graph as any).astream(
      new Command({ resume: resumePayload }),
      { ...lgConfig, streamMode: ['updates', 'values'] },
    )

    for await (const event of stream) {
      // LangGraph JS astream 产出 [mode, chunk] 元组
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
 * @yields LangGraph stream 事件字典
 */
export async function* resume_stream(
  graph: ModuGraph,
  sessionId: string,
  approved: boolean,
  feedback: string = '',
  traceId?: string | null,
): AsyncGenerator<Record<string, any>> {
  if (!traceId) {
    traceId = randomUUID()
  }

  const lgConfig = { configurable: { thread_id: sessionId } }
  const resumePayload = { approved: Boolean(approved), feedback: String(feedback || '') }

  const streamStart = performance.now()
  try {
    const stream = (graph as any).astream(
      new Command({ resume: resumePayload }),
      { ...lgConfig, streamMode: ['messages', 'updates', 'values'] },
    )

    for await (const event of stream) {
      // LangGraph JS astream 产出 [mode, chunk] 元组
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
export function get_interrupt_state(
  graph: ModuGraph,
  sessionId: string,
): Record<string, any> | null {
  try {
    const lgConfig = { configurable: { thread_id: sessionId } }
    const state = (graph as any).getState(lgConfig)
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
    return {
      session_id: sessionId,
      next_nodes: [...nextNodes],
      pending_tool_calls: values['pending_tool_calls'] ?? [],
      tool_requires_approval: values['tool_requires_approval'] ?? false,
      trace_id: values['trace_id'] ?? '',
      user_id: values['user_id'] ?? '',
    }
  } catch (e: any) {
    logger.debug('Failed to query interrupt state: %s', String(e))
    return null
  }
}
