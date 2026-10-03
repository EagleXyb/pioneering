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
import type { CompiledStateGraph } from '@langchain/langgraph'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import type { RunnableConfig } from '@langchain/core/runnables'

import { getConfig } from '../config/runtime-config.js'
import type { ModuAgentState } from './state.js'
// P2（T-13）: 图拓扑声明化（GraphSpec）—— `buildModuGraph` 成为
// `buildFromSpec(composeDefaultGraph(profile), deps)` 的兼容包装。
import {
  buildFromSpec,
  type EdgeSpec,
  type GraphProfile,
  type GraphSpec,
  type ModuGraphDeps,
  type NodeSpec,
} from './spec.js'
// P0（T-05）: 输出护栏节点包装器（接线此前为零调用的 sanitizeOutput/detectOutputSensitive）
import { makeOutputGuardNode } from '../perception/security/output-guard-node.js'
// P3-C: PolicyEngine output 阶段消费（gated）
import {
  makeOutputPolicyNode,
  policyEngineEnabled,
} from '../perception/security/policy-consumers.js'
import {
  makeAgentNode,
  makeConsensusNode,
  makeFeedbackNode,
  makeClarifyNode,
  makeHumanReviewNode,
  makeMemoryQueryNode,
  makeMemoryUpdateNode,
  makePerceptionNode,
  makeSubagentNode,
  makeToolResultProcessor,
  responseNode,
  routeAfterAgent,
  routeAfterHumanReview,
  routeAfterMemoryQuery,
  routeAfterPerception,
  docGenEnforceNode,
  docFinalAnswerNode,
} from './nodes.js'
// 阶段3：澄清粗筛（同步；LLM 复判在 clarify 节点内异步执行）
import { assessClarificationCoarse } from '../perception/clarity-detector.js'
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
// P1（T-11）: 记忆策略统一契约（可选注入；null 时 memory 节点走 store 直连，行为不变）
import type { MemoryStrategy } from '../core/interfaces/memory-strategy.js'

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
 * P2（T-13）起本函数为**兼容包装**：
 *   `buildModuGraph(...) === buildFromSpec(composeDefaultGraph(profile), deps)`
 * 14 个位置参数签名与行为保持不变（§4.1.5 兼容硬约束）。
 *
 * @param tools LangChain StructuredTool 列表（通过 buildLangchainTools() 构建）
 * @param llm ChatModel 实例（通过 buildChatModel() 构建，已绑定工具）
 * @param checkpointer 检查点保存器（null=不持久化，MemorySaver=内存持久化）
 * @param store 长期记忆存储（null=跳过长期记忆查询）
 * @param systemPrompt 系统提示词（可选）
 * @param recursionLimit 递归限制（null=按配置动态计算，见 computeRecursionLimit）
 * @param orchestrator EvolutionOrchestrator 实例（null=跳过反馈评估）
 * @param hitlEnabled P3-12.3.2 是否启用人工审批节点；null 时从配置读取
 * @param multiAgentEnabled P3-12.3.1 是否启用多 Agent 协作；null 时从配置读取
 * @param judgeLlm P3-12.3.1 LLM 裁决器（仅 llm_judge 共识策略需要）
 * @param planExecuteEnabled P4 是否启用 Plan-and-Execute 模式；null 时从配置读取
 * @param rawLlm P4 未绑定工具的原始 LLM（Planner 节点专用，规划阶段禁止工具）
 * @param complexityAssessor P0-1 复杂度评估器（null=不启用）
 * @param observationDistiller P0-3 Observation 蒸馏器（null=不启用）
 * @param llmRouteResolver P0（T-08）模型路由解析器（null=不路由）
 * @param memoryStrategyResolver P1（T-11）记忆策略解析器（null=store 直连）
 * @returns 编译后的 StateGraph
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
  // P0（T-08）: 模型路由解析器（null 时不启用模型路由，行为与改造前逐字节一致）
  llmRouteResolver: ((state: ModuAgentState) => any | null) | null = null,
  // P1（T-11）: 记忆策略解析器（null 时 memory 节点走 store 直连，行为与改造前一致）
  memoryStrategyResolver: ((taskType?: string) => MemoryStrategy | undefined) | null = null,
): CompiledStateGraph<any, any> {
  const profile = resolveGraphProfile({
    hitlEnabled,
    multiAgentEnabled,
    planExecuteEnabled,
    orchestrator,
    complexityAssessor,
    observationDistiller,
  })
  const deps: ModuGraphDeps = {
    tools,
    llm,
    checkpointer,
    store,
    systemPrompt,
    recursionLimit,
    orchestrator,
    judgeLlm,
    rawLlm,
    complexityAssessor,
    observationDistiller,
    llmRouteResolver,
    memoryStrategyResolver,
    profile,
    runtimeConfig: getConfig(),
  }

  const compiled = buildFromSpec(composeDefaultGraph(profile), deps)

  logger.info(
    'ModuAgent LangGraph built: tools=%d checkpointer=%s store=%s recursion_limit=%d hitl=%s multi_agent=%s plan_execute=%s',
    tools.length,
    checkpointer ? checkpointer.constructor?.name : 'None',
    store ? store.constructor?.name : 'None',
    (compiled as any).recursionLimit,
    profile.hitlEnabled ? 'enabled' : 'disabled',
    profile.multiAgentEnabled ? 'enabled' : 'disabled',
    profile.planExecuteEnabled ? 'enabled' : 'disabled',
  )

  return compiled
}

/**
 * 解析图模式画像（P2/T-13，含原 T-10c「HITL 拓扑声明化」）。
 *
 * 取代改造前 `buildModuGraph` 内的 4 个布尔分支与散落的配置读取：
 *   参数显式传入（非 null）优先，否则读配置；配置读取异常时取安全默认（false）。
 *
 * 默认行为零变化：全部开关默认 false（与 `DEFAULT_CONFIG` 一致）。
 */
export function resolveGraphProfile(args: {
  hitlEnabled?: boolean | null
  multiAgentEnabled?: boolean | null
  planExecuteEnabled?: boolean | null
  orchestrator?: any
  complexityAssessor?: any
  observationDistiller?: any
  /** P3（T-20）：场景包注入的扩展开关（显式传参优先） */
  extra?: Record<string, boolean> | null
}): GraphProfile {
  const readBool = (key: string, dflt: boolean): boolean => {
    try {
      return Boolean(getConfig().get(key, dflt))
    } catch {
      return dflt
    }
  }

  // P3（T-20）：画像扩展开关落地。
  // 单一事实源为配置 `graph.spec.extra`（场景包可注入）；显式传参优先。
  // 默认 `{}` → `profileFlag()` 一律返回 dflt(false) → 默认路径行为零变化。
  const readExtra = (): Record<string, boolean> => {
    try {
      const raw = getConfig().get('graph.spec.extra', {}) as Record<string, unknown>
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
      const out: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(raw)) {
        if (v !== null && v !== undefined) out[k] = Boolean(v)
      }
      return out
    } catch {
      return {}
    }
  }

  let hitlEnabled = args.hitlEnabled ?? null
  if (hitlEnabled === null) {
    hitlEnabled = readBool('tools.human_in_loop.enabled', false)
  }
  let multiAgentEnabled = args.multiAgentEnabled ?? null
  if (multiAgentEnabled === null) {
    multiAgentEnabled = readBool('orchestration.multi_agent.enabled', false)
  }
  let planExecuteEnabled = args.planExecuteEnabled ?? null
  if (planExecuteEnabled === null) {
    planExecuteEnabled = readBool('plan_execute.enabled', false)
  }

  // v1.2 #6: 解除 plan_execute 与 multi_agent 互斥（对应文档 §4.1 建议6）
  // 允许组合模式：plan_execute 模式下 task_type=delegation 的步骤路由到 supervisor 节点
  if (multiAgentEnabled && planExecuteEnabled) {
    logger.info(
      'Both multi_agent and plan_execute enabled (combined mode): ' +
      'plan_execute takes precedence for entry; task_type=delegation steps route to supervisor',
    )
  }

  return {
    hitlEnabled: Boolean(hitlEnabled),
    multiAgentEnabled: Boolean(multiAgentEnabled),
    planExecuteEnabled: Boolean(planExecuteEnabled),
    clarifyEnabled: readBool('perception.clarification.enabled', false),
    complexityAssessmentEnabled: args.complexityAssessor != null,
    observationDistillationEnabled: args.observationDistiller != null,
    outputGuardEnabled: readBool('perception.security.sanitize_output.enabled', false),
    feedbackEnabled: args.orchestrator != null,
    fewShotEnabled: readBool('react_optimization.few_shot.enabled', false),
    // P3（T-20）：扩展开关（参数优先，否则读 graph.spec.extra）
    extra: args.extra ?? readExtra(),
  }
}

/**
 * 默认图拓扑声明（对应改造前 `buildModuGraph` 的 addNode/addEdge 序列）。
 *
 * 顺序约定（与改造前逐条对应，快照测试锁定）：
 *   - 节点：perception → memory_query → agent → tools → tool_processor →
 *     finalize_response → doc_gen_enforce → doc_final_answer → [feedback] →
 *     memory_update → [human_review] → [clarify] → [supervisor, subagent_run, consensus] →
 *     [planner, step_dispatch, step_finalize]
 *   - 边：见 `EdgeSpec` 声明顺序。
 *
 * 宿主扩展：另经 `registry.registerNode/registerEdge/registerSubgraph` 追加
 * （见 `buildFromSpec`）。默认 spec **不含** `subgraphs` → 扩展子图仅在宿主显式
 * 注册时参与装配，默认拓扑与行为零变化。
 */
export function composeDefaultGraph(profile: GraphProfile): GraphSpec {
  // 感知后路由包装：仅在节点确实挂载时才允许路由到 clarify，
  // 避免"路由返回未注册目标"导致的图运行时错误（闭包传递，无模块级可变状态）
  const perceptionRouter = profile.clarifyEnabled
    ? (state: ModuAgentState): string => {
        const base = routeAfterPerception(state)
        if (base !== 'memory_query') return base
        // 阶段3：粗筛（规则命中，或 llm_judge 启用且输入在候选区间）→ 进 clarify 节点精判。
        // 规则未命中且未启用 LLM 复判时与迁移前逐条等价（零回归）。
        return assessClarificationCoarse(state).needed ? 'clarify' : 'memory_query'
      }
    : routeAfterPerception

  const nodes: NodeSpec[] = [
    // P0-1/P3-C: complexityAssessor 非空时带复杂度评估；makePerceptionNode 同时
    // 在 policy.engine.enabled 时消费 PolicyEngine input 阶段（默认关闭→行为零变化）。
    {
      name: 'perception',
      factory: (deps) => makePerceptionNode(deps.complexityAssessor),
    },
    // P1（T-11）工厂版本恒非空：无 store 且无策略时返回空 knowledge（等价既有 memoryQueryNode）
    {
      name: 'memory_query',
      factory: (deps) => makeMemoryQueryNode(deps.store, deps.memoryStrategyResolver),
    },
    {
      name: 'agent',
      factory: (deps) => makeAgentNode(
        deps.llm,
        deps.systemPrompt,
        0.5,
        0.3,
        // P4: plan_execute 模式下注入步骤上下文（默认 null 时行为不变）
        deps.profile.planExecuteEnabled ? makePlanContextInjector() : null,
        null,
        null,
        // P2-2: few_shot 启用时注入 DynamicFewShotSelector（默认 null 时行为不变）。
        // 门控统一由 `GraphProfile.fewShotEnabled` 承载（T-13 声明化），
        // 与 `createFewShotSelector()` 内部读取的是同一个配置键 → 行为等价。
        deps.profile.fewShotEnabled ? createFewShotSelector() : null,
        // P0（T-08）: 模型路由解析器（null 时行为不变）
        deps.llmRouteResolver,
      ),
    },
    {
      name: 'tools',
      // `deps.tools` 由 buildModuGraph 保证为数组；直接调用 buildFromSpec 的宿主
      // 可能省略该字段，故显式兜底（等价于"空工具集"分支）。
      factory: (deps) => ((deps.tools ?? []).length > 0
        ? new ToolNode(deps.tools)
        : _noopToolsNode),
    },
    {
      name: 'tool_processor',
      factory: (deps) => makeToolResultProcessor(deps.observationDistiller),
    },
    // P0（T-05）: 输出护栏（PII / 密钥 / 内网 IP 脱敏）。
    // 门控 perception.security.sanitize_output.enabled（默认 false）→ 默认直接使用原节点，
    // response 文本逐字节不变（等价现状）。
    // P3-C: policy.engine.enabled=true 时外层再套 PolicyEngine output 判定
    //  （deny→拦截 / sanitizedText→替换）；两开关默认全 false → 零变化。
    {
      name: 'finalize_response',
      factory: (deps) => {
        let node: any = responseNode
        if (deps.profile.outputGuardEnabled) node = makeOutputGuardNode(node)
        if (policyEngineEnabled()) node = makeOutputPolicyNode(node)
        return node
      },
    },
    { name: 'doc_gen_enforce', factory: () => docGenEnforceNode },
    { name: 'doc_final_answer', factory: () => docFinalAnswerNode },
    // P0-1: 反馈评估节点（有 orchestrator 时评估，否则跳过）
    {
      name: 'feedback',
      factory: (deps) => makeFeedbackNode(deps.orchestrator),
      when: (p) => p.feedbackEnabled,
    },
    // P0-3: 记忆更新节点
    {
      name: 'memory_update',
      factory: (deps) => makeMemoryUpdateNode(deps.store, deps.memoryStrategyResolver),
    },
    // P3-12.3.2: 人工审批节点（HITL 开启时插入 agent → tools 之间）
    {
      name: 'human_review',
      factory: () => makeHumanReviewNode(),
      when: (p) => p.hitlEnabled,
    },
    // 需求澄清节点（perception.clarification.enabled=true 时插入）
    {
      name: 'clarify',
      // 阶段3：注入未绑定工具的原始 LLM（供 use_llm 润色 / llm_judge 复判；
      // 两者默认关闭时不产生任何 LLM 调用）
      factory: (deps) => makeClarifyNode(null, deps.rawLlm ?? deps.llm),
      when: (p) => p.clarifyEnabled,
    },
    // P3-12.3.1: 多 Agent 协作节点
    {
      name: 'supervisor',
      factory: (deps) => make_supervisor_node(null, null, deps.rawLlm ?? deps.llm),
      when: (p) => p.multiAgentEnabled,
    },
    {
      name: 'subagent_run',
      factory: (deps) => makeSubagentNode(deps.llm, deps.systemPrompt, deps.tools),
      when: (p) => p.multiAgentEnabled,
    },
    {
      name: 'consensus',
      factory: (deps) => makeConsensusNode(null, deps.judgeLlm),
      when: (p) => p.multiAgentEnabled,
    },
    // P4: Plan-and-Execute 节点（Planner 使用未绑定工具的原始 LLM）
    {
      name: 'planner',
      factory: (deps) => makePlannerNode(deps.rawLlm ?? deps.llm, getRegistry()),
      when: (p) => p.planExecuteEnabled,
    },
    {
      name: 'step_dispatch',
      factory: () => makeStepDispatchNode(),
      when: (p) => p.planExecuteEnabled,
    },
    {
      name: 'step_finalize',
      factory: () => makeStepFinalizeNode(),
      when: (p) => p.planExecuteEnabled,
    },
  ]

  const edges: EdgeSpec[] = [
    { from: 'START', to: 'perception' },
    // 感知后条件路由：熔断 → finalize_response，需澄清 → clarify，正常 → memory_query
    {
      from: 'perception',
      to: {
        router: perceptionRouter,
        targets: (has) => ({
          memory_query: 'memory_query',
          __end__: 'finalize_response',
          // 澄清节点未挂载时不注册该目标（LangGraph 要求目标必须存在）
          ...(has('clarify') ? { clarify: 'clarify' } : {}),
        }),
      },
    },
    // 澄清完成后回到正常路径（补充后的需求进入记忆查询 → agent）
    { from: 'clarify', to: 'memory_query', when: (p) => p.clarifyEnabled },
  ]

  // 记忆查询后进入 agent / supervisor / planner
  // v1.2 #6: 组合模式（plan_execute + multi_agent）下 plan_execute 优先
  edges.push({
    from: 'memory_query',
    to: { router: routeAfterMemoryQuery, targets: { agent: 'agent', planner: 'planner' } },
    when: (p) => p.planExecuteEnabled,
  })
  edges.push({
    from: 'memory_query',
    to: { router: routeAfterMemoryQuery, targets: { agent: 'agent', supervisor: 'supervisor' } },
    when: (p) => !p.planExecuteEnabled && p.multiAgentEnabled,
  })
  edges.push({
    from: 'memory_query',
    to: 'agent',
    when: (p) => !p.planExecuteEnabled && !p.multiAgentEnabled,
  })

  // P4 Plan-and-Execute 主循环
  edges.push({
    from: 'planner',
    to: {
      router: routeAfterPlan,
      targets: { step_dispatch: 'step_dispatch', response: 'finalize_response' },
    },
    when: (p) => p.planExecuteEnabled,
  })
  edges.push({
    from: 'step_dispatch',
    to: {
      router: stepDispatch,
      targets: (has) => ({
        agent: 'agent',
        response: 'finalize_response',
        planner: 'planner',
        ...(has('supervisor') ? { supervisor: 'supervisor' } : {}),
      }),
    },
    when: (p) => p.planExecuteEnabled,
  })
  edges.push({
    from: 'step_finalize',
    to: 'step_dispatch',
    when: (p) => p.planExecuteEnabled,
  })

  // Agent 后条件路由：
  // - HITL 关闭: 有 tool_calls → tools，无 tool_calls → finalize_response（原行为）
  // - HITL 开启: 有 tool_calls → human_review，无 tool_calls → finalize_response
  edges.push({
    from: 'agent',
    to: {
      router: routeAfterAgent,
      targets: (has) => ({
        tools: has('human_review') ? 'human_review' : 'tools',
        __end__: 'finalize_response',
        // P4: plan_execute 模式下 routeAfterAgent 可能返回 'step_finalize'（当前步骤完成）
        ...(has('step_finalize') ? { step_finalize: 'step_finalize' } : {}),
        // 文档生成强制回退路由
        doc_gen_enforce: 'doc_gen_enforce',
        // 文档生成最终回复提醒路由（doc_writer 成功后补写终答正文）
        doc_final_answer: 'doc_final_answer',
      }),
    },
  })
  // human_review 后条件路由：通过 → tools，拒绝/错误 → finalize_response
  edges.push({
    from: 'human_review',
    to: {
      router: routeAfterHumanReview,
      targets: { tools: 'tools', finalize_response: 'finalize_response' },
    },
    when: (p) => p.hitlEnabled,
  })

  // 组合模式（plan_execute + multi_agent）: supervisor → subagent_run → consensus → step_finalize
  edges.push({
    from: 'supervisor',
    to: { router: route_from_supervisor, targets: ['subagent_run'] },
    when: (p) => p.multiAgentEnabled,
  })
  edges.push({
    from: 'subagent_run',
    to: 'consensus',
    when: (p) => p.multiAgentEnabled,
  })
  edges.push({
    from: 'consensus',
    to: 'step_finalize',
    when: (p) => p.multiAgentEnabled && p.planExecuteEnabled,
  })
  // 纯 multi_agent 模式：consensus → finalize_response（进入响应阶段）
  edges.push({
    from: 'consensus',
    to: 'finalize_response',
    when: (p) => p.multiAgentEnabled && !p.planExecuteEnabled,
  })

  // 工具执行后处理结果，再回到 agent（ReAct 循环）
  edges.push({ from: 'tools', to: 'tool_processor' })
  edges.push({ from: 'tool_processor', to: 'agent' })
  // 文档生成强制回退：注入提醒后回到 agent 继续推理
  edges.push({ from: 'doc_gen_enforce', to: 'agent' })
  // 文档生成最终回复：注入终答提醒后回到 agent 输出正文
  edges.push({ from: 'doc_final_answer', to: 'agent' })

  // P0-1/P0-3: finalize_response → [feedback] → memory_update → END
  edges.push({
    from: 'finalize_response',
    to: 'feedback',
    when: (p) => p.feedbackEnabled,
  })
  edges.push({
    from: 'feedback',
    to: 'memory_update',
    when: (p) => p.feedbackEnabled,
  })
  edges.push({
    from: 'finalize_response',
    to: 'memory_update',
    when: (p) => !p.feedbackEnabled,
  })
  edges.push({ from: 'memory_update', to: 'END' })

  return { nodes, edges }
}

/**
 * P2-2: 构造 Few-shot 选择器（gated by `react_optimization.few_shot.enabled`）。
 *
 * 从 `buildModuGraph` 迁入（T-13）；异常时返回 null（等价改造前的 warning + skip）。
 */
export function createFewShotSelector(): any {
  try {
    if (getConfig().get('react_optimization.few_shot.enabled', false)) {
      // 使用内存示例库（生产环境可替换为 ChromaExampleStore）
      const store = new InMemoryExampleStore()
      return DynamicFewShotSelector.fromConfig(store)
    }
  } catch (e: any) {
    logger.warning('[P2-2] Few-shot selector init failed, skipping: %s', String(e?.message ?? e))
  }
  return null
}

/** 空工具节点（无工具时使用）。 */
function _noopToolsNode(_state: ModuAgentState): Partial<ModuAgentState> {
  return {}
}
