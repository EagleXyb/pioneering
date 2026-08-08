// 对应 Python: modu_graph/graph.py
// ModuAgent LangGraph 图构建。
//
// 将 coordinator.py 的 process_request 主流程构建为 LangGraph StateGraph，
// 用图编排替代 1047 行的"上帝类"。
//
// 图结构：
//   START → perception → [routeAfterPerception]
//                               ├─ memory_query → agent → [routeAfterAgent]
//                               │                                  ├─ tools → agent (ReAct 循环)
//                               │                                  └─ END
//                               └─ END (熔断)
//
// 关键收益：
//   - 删除手写 ReAct 循环（约 160 行）
//   - 删除 _parse_tool_calls_with_errors / _build_tool_descriptions / _build_native_tools（约 120 行）
//   - max_iterations 由 LangGraph recursionLimit 配置
//   - max_format_retries 由原生 function calling 消除
import type { StructuredTool } from '@langchain/core/tools'
import { END, START, StateGraph, type CompiledStateGraph } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import type { RunnableConfig } from '@langchain/core/runnables'

import { getConfig } from '../config/runtime-config.js'
import { ModuAgentStateAnnotation, type ModuAgentState } from './state.js'
import {
  makeAgentNode,
  makeConsensusNode,
  makeFeedbackNode,
  makeHumanReviewNode,
  makeMemoryQueryNode,
  makeMemoryUpdateNode,
  makePerceptionNode,
  makeSubagentNode,
  makeToolResultProcessor,
  memoryQueryNode,
  memoryUpdateNode,
  perceptionNode,
  responseNode,
  routeAfterAgent,
  routeAfterHumanReview,
  routeAfterMemoryQuery,
  routeAfterPerception,
  docGenEnforceNode,
} from './nodes.js'
// P0-1: 复杂度评估器
import { ComplexityAssessor } from '../reasoning/complexity-assessor.js'
// P0-3: Observation 蒸馏器
import { ObservationDistiller } from './adapters/observation-distiller.js'
// P2-2: Few-shot 动态示例选择
import {
  DynamicFewShotSelector,
  InMemoryExampleStore,
} from '../skills/few-shot-selector.js'
import { make_supervisor_node, route_from_supervisor } from './subgraph/supervisor.js'
import {
  makePlanContextInjector,
  makePlannerNode,
  makeStepDispatchNode,
  makeStepFinalizeNode,
  routeAfterPlan,
  stepDispatch,
} from './plan-execute/index.js'
import { getRegistry } from '../core/registry.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph] ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`[graph] ${msg}`, ...args),
  debug: (msg: string, ...args: any[]) => console.debug(`[graph] ${msg}`, ...args),
}

/**
 * P1-12.2.3 + P9.1.4: CompiledStateGraph 包装类，显式持有 orchestrator 引用。
 *
 * 替代在 CompiledStateGraph 实例上 monkey-patch `graph.orchestrator` 的做法：
 * 第三方对象（CompiledStateGraph）不应被附加非标准属性，否则会引入隐式契约、
 * 难以追踪的副作用与类型检查盲区。
 *
 * 本包装器通过 Proxy 将所有未在自身定义的属性访问透明委托给底层
 * 编译图（astream / ainvoke / checkpointer / recursionLimit 等），
 * 同时以普通实例属性形式持有 orchestrator，供 runner 读取以共享
 * evolution_collector。
 *
 * P9.1.4: 显式声明 ModuGraphInterface 接口列出 runner 实际依赖的核心方法
 * 与属性，并使用 `satisfies` 确保 Proxy handler 的类型签名与目标一致。
 * 这样 runner.ts 可直接通过接口类型访问 graph.stream / getState 等，
 * 无需 `as any` 断言。
 *
 * 用法与 CompiledStateGraph 一致：
 *   const graph = createAgent()        // 返回 ModuGraph
 *   for await (const ev of graph.stream(state, config)) { ... }
 *   const orch = graph.orchestrator     // 显式属性，非 monkey-patch
 */
export interface ModuGraphInterface {
  /** 底层编译图（用于显式访问原始实例）。 */
  readonly compiled: CompiledStateGraph<any, any>
  /** EvolutionOrchestrator 实例引用（无 orchestrator 时为 null）。 */
  orchestrator: any
  /** LangGraph 检查点保存器（透传自底层编译图）。 */
  readonly checkpointer: any
  /** 递归限制（透传自底层编译图，对应 maxIterations）。 */
  recursionLimit: number
  /** 流式调用：透传 stream() 至底层编译图。 */
  stream(
    input: any,
    config?: RunnableConfig,
  ): Promise<IterableReadableStream<any>>
  /** 异步流式调用：透传 astream() 至底层编译图。 */
  astream(
    input: any,
    config?: RunnableConfig,
  ): Promise<IterableReadableStream<any>>
  /** 同步调用：透传 invoke() 至底层编译图。 */
  invoke(input: any, config?: RunnableConfig): Promise<any>
  /** 查询线程状态：透传 getState() 至底层编译图。 */
  getState(config?: RunnableConfig, options?: any): Promise<any>
  /** 更新线程状态：透传 updateState() 至底层编译图。 */
  updateState(input: any, config?: RunnableConfig, asNode?: string): Promise<void>
  /** 查询状态历史：透传 getStateHistory() 至底层编译图（对应文档 §2.3 建议6）。 */
  getStateHistory(
    config?: RunnableConfig,
    filter?: any,
    limit?: number,
    before?: any,
  ): Promise<Iterable<any>>
  /**
   * 状态回滚：基于 Checkpointer 历史快照回滚到 N 步之前的状态
   * （对应文档 §2.3 建议6）。
   */
  rollback(threadId: string, steps?: number): Promise<any>
}

/** IterableReadableStream 类型别名（避免引入额外类型导入）。 */
type IterableReadableStream<T> = AsyncGenerator<T, void, unknown>

export class ModuGraph implements ModuGraphInterface {
  private _compiled: CompiledStateGraph<any, any>
  orchestrator: any

  constructor(compiled: CompiledStateGraph<any, any>, orchestrator: any = null) {
    // 必须先设置 _compiled，使后续 Proxy 委托可生效
    this._compiled = compiled
    this.orchestrator = orchestrator

    // P9.1.4: 使用 `satisfies` 确保 Proxy handler 类型签名与目标一致。
    // `target` 即 ModuGraph 实例本身，`prop` 类型为 string | symbol。
    const handler: ProxyHandler<ModuGraph> = {
      get(target, prop, receiver) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver)
        }
        // 委托给底层编译图
        const compiled = target._compiled as any
        const value = compiled[prop]
        if (typeof value === 'function') {
          return value.bind(compiled)
        }
        return value
      },
      has(target, prop) {
        return prop in target || prop in (target._compiled as any)
      },
    } satisfies ProxyHandler<ModuGraph>

    // 使用 Proxy 将未定义的属性访问委托给底层编译图
    return new Proxy(this, handler)
  }

  /** 返回底层编译图实例。 */
  get compiled(): CompiledStateGraph<any, any> {
    return this._compiled
  }

  /** 透传 checkpointer。 */
  get checkpointer(): any {
    return (this._compiled as any).checkpointer
  }

  /** 透传 recursionLimit。 */
  get recursionLimit(): number {
    return (this._compiled as any).recursionLimit
  }

  /** 透传 recursionLimit（写入）。 */
  set recursionLimit(value: number) {
    ;(this._compiled as any).recursionLimit = value
  }

  /** 透传 stream() 至底层编译图。 */
  stream(
    input: any,
    config?: RunnableConfig,
  ): Promise<IterableReadableStream<any>> {
    const fn = (this._compiled as any).stream
    return fn.call(this._compiled, input, config)
  }

  /** 透传 astream() 至底层编译图。 */
  astream(
    input: any,
    config?: RunnableConfig,
  ): Promise<IterableReadableStream<any>> {
    const fn = (this._compiled as any).astream
    return fn.call(this._compiled, input, config)
  }

  /** 透传 invoke() 至底层编译图。 */
  invoke(input: any, config?: RunnableConfig): Promise<any> {
    const fn = (this._compiled as any).invoke
    return fn.call(this._compiled, input, config)
  }

  /** 透传 getState() 至底层编译图。 */
  async getState(config?: RunnableConfig, options?: any): Promise<any> {
    const fn = (this._compiled as any).getState
    return fn.call(this._compiled, config, options)
  }

  /** 透传 updateState() 至底层编译图。 */
  async updateState(
    input: any,
    config?: RunnableConfig,
    asNode?: string,
  ): Promise<void> {
    const fn = (this._compiled as any).updateState
    return fn.call(this._compiled, input, config, asNode)
  }

  /**
   * 透传 getStateHistory() 至底层编译图（对应文档 §2.3 建议6）。
   *
   * 返回按时间倒序的状态历史快照迭代器，每个快照对应一次节点执行后的状态。
   */
  async getStateHistory(
    config?: RunnableConfig,
    filter?: any,
    limit?: number,
    before?: any,
  ): Promise<Iterable<any>> {
    const fn = (this._compiled as any).getStateHistory
    if (typeof fn !== 'function') {
      throw new Error('Underlying compiled graph does not support getStateHistory')
    }
    return fn.call(this._compiled, config, filter, limit, before)
  }

  /**
   * 状态回滚 API（对应文档 §2.3 建议6）。
   *
   * 基于 Checkpointer 历史快照回滚到 N 步之前的状态：
   *   1. 通过 getStateHistory 获取状态历史
   *   2. 取第 N 个快照（steps=1 表示上一步，steps=2 表示上上步，依此类推）
   *   3. 通过 updateState 将状态恢复到该快照
   *
   * 注意：
   *   - 回滚后 checkpointer 会新增一条快照记录（而非删除后续历史）
   *   - 仅支持内存/sqlite/postgres checkpointer，无 checkpointer 时抛错
   *   - steps 超过历史长度时回滚到最早可用快照
   *
   * @param threadId 会话 ID（对应 checkpointer 的 thread_id）
   * @param steps    回滚步数（1=回滚到上一步）
   * @returns 回滚后的状态快照
   */
  async rollback(threadId: string, steps: number = 1): Promise<any> {
    if (steps < 1) {
      throw new Error(`steps must be >= 1, got ${steps}`)
    }
    const checkpointer = this.checkpointer
    if (checkpointer == null) {
      throw new Error('Cannot rollback: no checkpointer configured')
    }

    const config: RunnableConfig = { configurable: { thread_id: threadId } } as RunnableConfig

    // 获取状态历史（按时间倒序，最新在前）
    const historyIter = await this.getStateHistory(config)
    const history: any[] = []
    for await (const snapshot of historyIter) {
      history.push(snapshot)
      // 多取 1 条以防最新快照为当前状态
      if (history.length > steps + 1) {
        break
      }
    }

    if (history.length === 0) {
      throw new Error(`Cannot rollback: no state history found for thread_id=${threadId}`)
    }

    // 索引 0 通常是当前状态，steps=1 取索引 1（上一步）
    // 若 steps 超过历史长度，取最后一个可用快照
    const targetIdx = Math.min(steps, history.length - 1)
    if (targetIdx < 1 && history.length === 1) {
      // 仅一条历史，无法回滚
      throw new Error(`Cannot rollback: only 1 state snapshot available for thread_id=${threadId}`)
    }
    const targetSnapshot = history[targetIdx]
    const targetValues = targetSnapshot?.values ?? {}

    // 通过 updateState 恢复状态（asNode=null 表示作为外部更新）
    await this.updateState(targetValues, config)
    logger.info(
      'Rolled back thread_id=%s by %d steps (target snapshot checkpoint_id=%s)',
      threadId, steps, targetSnapshot?.checkpoint_id ?? 'unknown',
    )

    // 返回回滚后的最新状态
    return await this.getState(config)
  }
}

/**
 * 构建 ModuAgent LangGraph。
 *
 * @param tools LangChain StructuredTool 列表（通过 buildLangchainTools() 构建）
 * @param llm ChatModel 实例（通过 buildChatModel() 构建，已绑定工具）
 * @param checkpointer 检查点保存器（null=不持久化，MemorySaver=内存持久化）
 * @param store 长期记忆存储（null=跳过长期记忆查询）
 * @param systemPrompt 系统提示词（可选）
 * @param recursionLimit 递归限制（默认 = maxIterations * 3 + 7，见下方计算）
 * @param orchestrator EvolutionOrchestrator 实例（null=跳过反馈评估）
 * @param hitlEnabled P3-12.3.2 是否启用人工审批节点；null 时从配置读取
 * @param multiAgentEnabled P3-12.3.1 是否启用多 Agent 协作；null 时从配置读取
 * @param judgeLlm P3-12.3.1 LLM 裁决器（仅 llm_judge 共识策略需要）
 * @param planExecuteEnabled P4 是否启用 Plan-and-Execute 模式；null 时从配置读取
 * @param rawLlm P4 未绑定工具的原始 LLM（Planner 节点专用，规划阶段禁止工具）；
 *               null 时回退使用 llm 参数（若其已绑定工具，Planner 提示词仍约束其输出纯 JSON）
 * @returns 编译后的 StateGraph
 *
 * 图结构（multi_agent 关闭，HITL 关闭）：
 *   START → perception → routeAfterPerception
 *                             ├─ memory_query → agent → routeAfterAgent
 *                             │                                    ├─ tools → tool_processor → agent
 *                             │                                    └─ response → feedback → memory_update → END
 *                             └─ response → feedback → memory_update → END (熔断)
 *
 * 图结构（multi_agent 开启，P3-12.3.1）：
 *   START → perception → routeAfterPerception
 *                             ├─ memory_query → routeAfterMemoryQuery
 *                             │                    ├─ supervisor → routeFromSupervisor (Send × N)
 *                             │                    │                ├─ subagent_run → consensus → response
 *                             │                    └─ agent (multi_agent 关闭时)
 *                             └─ response (熔断)
 */
export function buildModuGraph(
  tools: StructuredTool[],
  llm: any,
  checkpointer: any = null,
  store: any = null,
  systemPrompt: string | null = null,
  recursionLimit: number | null = null,
  orchestrator: any = null,
  hitlEnabled: boolean | null = null,
  multiAgentEnabled: boolean | null = null,
  judgeLlm: any = null,
  planExecuteEnabled: boolean | null = null,
  rawLlm: any = null,
  // P0-1: 复杂度评估器（null 时不启用复杂度评估，等价原行为）
  complexityAssessor: ComplexityAssessor | null = null,
  // P0-3: Observation 蒸馏器（null 时不启用蒸馏，等价原行为）
  observationDistiller: ObservationDistiller | null = null,
): CompiledStateGraph<any, any> {
  // LLM 已经在 factory 中绑定了工具，此处直接使用
  const boundLlm = llm

  // 读取 HITL 配置（P3-12.3.2）
  if (hitlEnabled === null) {
    try {
      hitlEnabled = Boolean(getConfig().get('tools.human_in_loop.enabled', false))
    } catch {
      hitlEnabled = false
    }
  }

  // 读取多 Agent 配置（P3-12.3.1）
  if (multiAgentEnabled === null) {
    try {
      multiAgentEnabled = Boolean(getConfig().get('orchestration.multi_agent.enabled', false))
    } catch {
      multiAgentEnabled = false
    }
  }

  // 读取 Plan-and-Execute 配置（P4）
  if (planExecuteEnabled === null) {
    try {
      planExecuteEnabled = Boolean(getConfig().get('plan_execute.enabled', false))
    } catch {
      planExecuteEnabled = false
    }
  }

  // v1.2 #6: 解除 plan_execute 与 multi_agent 互斥（对应文档 §4.1 建议6）
  // 允许组合模式：plan_execute 模式下 task_type=delegation 的步骤路由到 supervisor 节点
  // - plan_execute 优先：memory_query → planner → step_dispatch
  // - task_type=delegation 步骤：step_dispatch → supervisor → subagent_run → consensus → step_finalize
  // - task_type=reasoning/tool_use 步骤：step_dispatch → agent → step_finalize
  // - 纯 multi_agent 模式（plan_execute 关闭）：memory_query → supervisor → ... → response
  if (multiAgentEnabled && planExecuteEnabled) {
    logger.info(
      'Both multi_agent and plan_execute enabled (combined mode): ' +
      'plan_execute takes precedence for entry; task_type=delegation steps route to supervisor',
    )
  }

  // 创建图
  // 注：LangGraph JS 的 StateGraph 类型系统无法追踪 builder 模式中通过 addNode
  // 注册的节点名，addEdge/addConditionalEdges 的字符串参数仅接受 "__start__"|"__end__"。
  // 此处使用 any 绕过此限制（运行时行为正确，与 Python 版一致）。
  const graph: any = new StateGraph(ModuAgentStateAnnotation)

  // 创建节点函数
  // P4: plan_execute 模式下为 agent 节点注入步骤上下文（默认 null 时行为不变）
  // P2-2: few_shot 启用时注入 DynamicFewShotSelector（默认 null 时行为不变）
  let _fewShotSelector: any = null
  try {
    if (getConfig().get('react_optimization.few_shot.enabled', false)) {
      // 使用内存示例库（生产环境可替换为 ChromaExampleStore）
      const store = new InMemoryExampleStore()
      _fewShotSelector = DynamicFewShotSelector.fromConfig(store)
    }
  } catch (e: any) {
    logger.warning('[P2-2] Few-shot selector init failed, skipping: %s', String(e?.message ?? e))
  }
  const agentNode = planExecuteEnabled
    ? makeAgentNode(boundLlm, systemPrompt, 0.5, 0.3, makePlanContextInjector(), null, null, _fewShotSelector)
    : makeAgentNode(boundLlm, systemPrompt, 0.5, 0.3, null, null, null, _fewShotSelector)
  const memoryNode = store ? makeMemoryQueryNode(store) : null
  // P0-3: 创建记忆更新节点（带 Store 时写入长期记忆，否则跳过）
  const memoryUpdate = store ? makeMemoryUpdateNode(store) : memoryUpdateNode
  // P0-3: 传入 Observation 蒸馏器（null 时等价原行为）
  const toolResultProcessor = makeToolResultProcessor(observationDistiller)
  // P0-1: 创建反馈评估节点（有 orchestrator 时评估，否则跳过）
  const feedbackNode = orchestrator ? makeFeedbackNode(orchestrator) : null
  // P3-12.3.2: 人工审批节点（HITL 开启时插入 agent → tools 之间）
  const humanReviewNode = hitlEnabled ? makeHumanReviewNode() : null
  // P3-12.3.1: 多 Agent 协作节点（multi_agent 开启时替代单 agent 路径）
  let supervisorNode: ((state: ModuAgentState) => Promise<Partial<ModuAgentState>>) | null = null
  let subagentNode: ((state: ModuAgentState) => Promise<Partial<ModuAgentState>>) | null = null
  let consensusNode: ((state: ModuAgentState) => Promise<Partial<ModuAgentState>>) | null = null
  if (multiAgentEnabled) {
    // v1.4 §4.4 建议1：传入 plannerLlm 启用 LLM 驱动任务拆分
    //   use_llm_decompose 配置默认开启，plannerLlm 为空时自动 fallback 到规则化拆分
    const supervisorPlannerLlm = rawLlm ?? boundLlm
    supervisorNode = make_supervisor_node(null, null, supervisorPlannerLlm)
    // v1.4 §4.4 建议2：传入 tools 启用子 Agent 工具能力
    // 子 Agent 按 task_type 过滤工具（research→search/http，coding→calculator/code_executor）
    subagentNode = makeSubagentNode(boundLlm, systemPrompt, tools)
    consensusNode = makeConsensusNode(null, judgeLlm)
  }

  // P4 Plan-and-Execute 节点（plan_execute 开启时挂载）
  let plannerNode: ((state: ModuAgentState) => Promise<Partial<ModuAgentState>>) | null = null
  let stepDispatchNodeFn: ((state: ModuAgentState) => Partial<ModuAgentState>) | null = null
  let stepFinalizeNode: ((state: ModuAgentState) => Promise<Partial<ModuAgentState>>) | null = null
  if (planExecuteEnabled) {
    // Planner 使用未绑定工具的原始 LLM（规划阶段禁止工具）；
    // rawLlm 为空时回退 boundLlm（提示词约束其输出纯 JSON，不产生 tool_calls）
    const plannerLlm = rawLlm ?? boundLlm
    plannerNode = makePlannerNode(plannerLlm, getRegistry())
    stepDispatchNodeFn = makeStepDispatchNode()
    stepFinalizeNode = makeStepFinalizeNode()
  }

  // 添加节点
  // P0-1: complexityAssessor 非空时使用带复杂度评估的感知节点，否则等价原行为
  const perceptionNodeFn = complexityAssessor
    ? makePerceptionNode(complexityAssessor)
    : perceptionNode
  graph.addNode('perception', perceptionNodeFn)

  if (memoryNode) {
    graph.addNode('memory_query', memoryNode)
  } else {
    // 无 Store 时使用空查询节点
    graph.addNode('memory_query', memoryQueryNode)
  }

  graph.addNode('agent', agentNode)
  graph.addNode('tools', tools.length > 0 ? new ToolNode(tools) : _noopToolsNode)
  graph.addNode('tool_processor', toolResultProcessor)
  graph.addNode('finalize_response', responseNode)
  // 文档生成强制节点：检测到 doc_writer 未调用时注入提醒并回退到 agent
  graph.addNode('doc_gen_enforce', docGenEnforceNode)
  // P0-1: 反馈评估节点接入图
  if (feedbackNode) {
    graph.addNode('feedback', feedbackNode)
  }
  // P0-3: 记忆更新节点接入图
  graph.addNode('memory_update', memoryUpdate)
  // P3-12.3.2: 人工审批节点接入图
  if (humanReviewNode) {
    graph.addNode('human_review', humanReviewNode)
  }
  // P3-12.3.1: 多 Agent 协作节点接入图
  if (supervisorNode) {
    graph.addNode('supervisor', supervisorNode)
    graph.addNode('subagent_run', subagentNode!)
    graph.addNode('consensus', consensusNode!)
  }
  // P4: Plan-and-Execute 节点接入图
  if (plannerNode) {
    graph.addNode('planner', plannerNode)
    graph.addNode('step_dispatch', stepDispatchNodeFn!)
    graph.addNode('step_finalize', stepFinalizeNode!)
  }

  // 添加边
  graph.addEdge(START, 'perception')

  // 感知后条件路由：熔断 → response，正常 → memory_query
  graph.addConditionalEdges(
    'perception',
    routeAfterPerception,
    {
      memory_query: 'memory_query',
      __end__: 'finalize_response',
    },
  )

  // 记忆查询后进入 agent / supervisor / planner
  // v1.2 #6: 组合模式（plan_execute + multi_agent）下，plan_execute 优先，task_type=delegation 步骤路由到 supervisor
  if (plannerNode) {
    // P4: memory_query → planner → step_dispatch 执行循环
    graph.addConditionalEdges(
      'memory_query',
      routeAfterMemoryQuery,
      { agent: 'agent', planner: 'planner' },
    )
    // planner 后路由：plan 就绪 → step_dispatch；解析失败 → response（降级直答）
    graph.addConditionalEdges(
      'planner',
      routeAfterPlan,
      { step_dispatch: 'step_dispatch', response: 'finalize_response' },
    )
    // step_dispatch 路由目标：
    //   - agent（task_type=reasoning/tool_use 或单步就绪）
    //   - supervisor（task_type=delegation，组合模式）
    //   - response（全部完成）
    //   - planner（重规划）
    //   - Send[]（DAG 并行分发）
    const stepDispatchTargets: Record<string, string> = {
      agent: 'agent',
      response: 'finalize_response',
      planner: 'planner',
    }
    if (supervisorNode) {
      stepDispatchTargets['supervisor'] = 'supervisor'
    }
    graph.addConditionalEdges(
      'step_dispatch',
      stepDispatch,
      stepDispatchTargets,
    )
    // step_finalize：单步收尾后回到 step_dispatch 推进游标
    graph.addEdge('step_finalize', 'step_dispatch')

    // v1.2 #6: 组合模式下 supervisor → subagent_run → consensus → step_finalize
    if (supervisorNode) {
      graph.addConditionalEdges(
        'supervisor',
        route_from_supervisor,
        ['subagent_run'],
      )
      graph.addEdge('subagent_run', 'consensus')
      // 组合模式：consensus → step_finalize（回到 plan_execute 循环）
      graph.addEdge('consensus', 'step_finalize')
    }
  } else if (supervisorNode) {
    // 纯 multi_agent 模式：memory_query → supervisor → subagent_run → consensus → response
    graph.addConditionalEdges(
      'memory_query',
      routeAfterMemoryQuery,
      { agent: 'agent', supervisor: 'supervisor' },
    )
    graph.addConditionalEdges(
      'supervisor',
      route_from_supervisor,
      ['subagent_run'],
    )
    graph.addEdge('subagent_run', 'consensus')
    // 纯 multi_agent 模式：consensus → response（进入响应阶段）
    graph.addEdge('consensus', 'finalize_response')
  } else {
    graph.addEdge('memory_query', 'agent')
  }

  // Agent 后条件路由：
  // - HITL 关闭: 有 tool_calls → tools，无 tool_calls → response（原行为）
  // - HITL 开启: 有 tool_calls → human_review，无 tool_calls → response（P3-12.3.2）
  // Agent 后条件路由的目标映射。
  // P4: plan_execute 模式下 routeAfterAgent 可能返回 'step_finalize'（当前步骤完成）。
  const agentRouteTargets: Record<string, string> = humanReviewNode
    ? { tools: 'human_review', __end__: 'finalize_response' }
    : { tools: 'tools', __end__: 'finalize_response' }
  if (stepFinalizeNode) {
    agentRouteTargets['step_finalize'] = 'step_finalize'
  }
  // 文档生成强制回退路由
  agentRouteTargets['doc_gen_enforce'] = 'doc_gen_enforce'

  if (humanReviewNode) {
    graph.addConditionalEdges(
      'agent',
      routeAfterAgent,
      agentRouteTargets,
    )
    // human_review 后条件路由：通过 → tools，拒绝/错误 → response
    graph.addConditionalEdges(
      'human_review',
      routeAfterHumanReview,
      {
        tools: 'tools',
        response: 'finalize_response',
      },
    )
  } else {
    graph.addConditionalEdges(
      'agent',
      routeAfterAgent,
      agentRouteTargets,
    )
  }

  // 工具执行后处理结果，再回到 agent（ReAct 循环）
  graph.addEdge('tools', 'tool_processor')
  graph.addEdge('tool_processor', 'agent')
  // 文档生成强制回退：注入提醒后回到 agent 继续推理
  graph.addEdge('doc_gen_enforce', 'agent')

  // P0-1/P0-3: response → feedback → memory_update → END
  if (feedbackNode) {
    graph.addEdge('finalize_response', 'feedback')
    graph.addEdge('feedback', 'memory_update')
  } else {
    // 无 orchestrator 时直接 response → memory_update
    graph.addEdge('finalize_response', 'memory_update')
  }
  graph.addEdge('memory_update', END)

  // 编译图
  const compileKwargs: Record<string, any> = {}
  if (checkpointer) {
    compileKwargs['checkpointer'] = checkpointer
  }
  if (store) {
    compileKwargs['store'] = store
  }

  const compiled = graph.compile(compileKwargs)

  // 设置递归限制（对应 max_iterations）
  const compiledAny = compiled as any
  if (recursionLimit) {
    compiledAny.recursionLimit = recursionLimit
  } else {
    // 默认：max_reasoning_iterations * 3 + 12（每个 ReAct 循环实际 3 个节点
    //   agent → tools → tool_processor，加固定开销 perception + memory_query
    //   + 终答 agent + finalize_response + memory_update/feedback 共 5~6 节点）
    //
    // P0-修复(2026-07-30): 固定余量从 +7 提到 +12。
    //   原公式 +7 在 max_reasoning_iterations=3 时给出 recursionLimit=16,
    //   仅能容纳 4 轮 ReAct(14 节点)+ 2 步余量。但防幻觉提示词规则 7-11
    //   逼迫 LLM 多步闭环(如"日期→搜索→验证→总结"),LLM 倾向多调工具,
    //   5 轮 ReAct(17 节点)即超限,触发 GraphRecursionError。
    //   提到 +12 后 recursionLimit=21,可容纳 5 轮 ReAct(15 节点)+ 6 固定开销,
    //   与 max_reasoning_iterations=3 的语义("最多 3 轮工具调用 + 终答")匹配,
    //   并为多步任务留出足够预算。
    //
    // 注：旧公式按"每循环 2 个节点"计算会低估，导致 max_reasoning_iterations=3 时
    //   合法运行的节点数(14) 超过预算(13)，正常推理也会抛 GraphRecursionError。
    // P3-12.3.2: HITL 开启时额外加 2（human_review + 路由开销）
    // P3-12.3.1: multi_agent 开启时额外加 4（supervisor + subagent_run + consensus + 路由开销）
    const config = getConfig()
    const maxIterations = config.get('llm.max_reasoning_iterations', 3)
    let baseLimit = maxIterations * 3 + 12
    if (humanReviewNode) {
      baseLimit += 2  // 为 human_review 节点预留递归预算
    }
    if (supervisorNode) {
      baseLimit += 4  // 为 supervisor + subagent + consensus 预留递归预算
    }
    if (planExecuteEnabled) {
      // 递归预算动态计算（对应文档 §2.3 建议5）：
      //   旧版粗放估算：maxSteps * (maxIterations * 3 + 2) 假设每步最多 ReAct maxIterations 轮
      //   新版按 plan 中各步骤的 estimated_iterations 动态累加：
      //     - 若 plan 已生成且步骤含 estimated_iterations 字段，按 sum(estimated_iterations) 计算
      //     - 否则回退到旧版上限估算（保持向后兼容）
      //   每步节点消耗：agent + tools + tool_processor + step_finalize = 4 个节点
      //   外加 planner/step_dispatch 与重规划预算
      const maxSteps = Number(config.get('plan_execute.max_steps', 10))
      const maxReplans = Number(config.get('plan_execute.max_replans', 2))

      // 尝试读取已持久化的 plan 估算总迭代数（动态计算路径）
      const estimatedTotalIters = _estimatePlanTotalIterations(config, maxSteps, maxIterations)

      // 每步固定开销：4 节点 * iterations + step_finalize 1 节点
      const stepBudget = estimatedTotalIters * 4 + maxSteps * 1
      // planner + step_dispatch + 重规划预算
      const plannerBudget = (maxReplans + 1) * 2 + 2
      baseLimit += stepBudget + plannerBudget
    }
    compiledAny.recursionLimit = baseLimit
  }

  logger.info(
    'ModuAgent LangGraph built: tools=%d checkpointer=%s store=%s recursion_limit=%d hitl=%s multi_agent=%s plan_execute=%s',
    tools.length,
    checkpointer ? checkpointer.constructor?.name : 'None',
    store ? store.constructor?.name : 'None',
    compiledAny.recursionLimit,
    humanReviewNode ? 'enabled' : 'disabled',
    supervisorNode ? 'enabled' : 'disabled',
    plannerNode ? 'enabled' : 'disabled',
  )

  return compiled
}

/** 空工具节点（无工具时使用）。 */
function _noopToolsNode(_state: ModuAgentState): Partial<ModuAgentState> {
  return {}
}

/**
 * 估算 plan 总迭代数（对应文档 §2.3 建议5：递归预算动态计算）。
 *
 * 策略：
 *   1. 若 runtimeConfig 中缓存了已生成的 plan（key: 'plan_execute._cached_plan'），
 *      且步骤含 estimated_iterations 字段，则按 sum(estimated_iterations) 计算
 *   2. 否则回退到旧版上限估算：maxSteps * maxIterations
 *
 * 注意：plan 在运行时由 planner 节点生成，buildModuGraph 阶段通常无 plan；
 *       此函数主要供后续按需重建图时使用，多数场景仍走回退路径。
 *       业务层如需精确预算，可在 planner 后调用 graph.recalculateRecursionLimit()。
 */
function _estimatePlanTotalIterations(
  config: ReturnType<typeof getConfig>,
  maxSteps: number,
  maxIterations: number,
): number {
  // 尝试读取已缓存 plan（由 planner 节点写入 runtimeConfig）
  const cachedPlan = config.get('plan_execute._cached_plan', null) as Array<Record<string, any>> | null
  if (Array.isArray(cachedPlan) && cachedPlan.length > 0) {
    let total = 0
    let hasEstimate = false
    for (const step of cachedPlan) {
      const est = step?.['estimated_iterations']
      if (typeof est === 'number' && est > 0) {
        total += est
        hasEstimate = true
      } else {
        // 单步无估算时按 maxIterations 兜底
        total += maxIterations
      }
    }
    if (hasEstimate) {
      return total
    }
  }
  // 回退：上限估算（每步最多 maxIterations 轮）
  return maxSteps * maxIterations
}
