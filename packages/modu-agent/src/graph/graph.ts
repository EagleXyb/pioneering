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

import { getConfig } from '../config/runtime-config.js'
import { ModuAgentStateAnnotation, type ModuAgentState } from './state.js'
import {
  makeAgentNode,
  makeConsensusNode,
  makeFeedbackNode,
  makeHumanReviewNode,
  makeMemoryQueryNode,
  makeMemoryUpdateNode,
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
} from './nodes.js'
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
 * P1-12.2.3: CompiledStateGraph 包装类，显式持有 orchestrator 引用。
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
 * 用法与 CompiledStateGraph 一致：
 *   const graph = createAgent()        // 返回 ModuGraph
 *   for await (const ev of graph.astream(state, config)) { ... }
 *   const orch = graph.orchestrator     // 显式属性，非 monkey-patch
 */
export class ModuGraph {
  private _compiled: CompiledStateGraph<any, any>
  orchestrator: any

  constructor(compiled: CompiledStateGraph<any, any>, orchestrator: any = null) {
    // 必须先设置 _compiled，使后续 Proxy 委托可生效
    this._compiled = compiled
    this.orchestrator = orchestrator

    // 使用 Proxy 将未定义的属性访问委托给底层编译图
    return new Proxy(this, {
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
    })
  }

  /** 返回底层编译图实例。 */
  get compiled(): CompiledStateGraph<any, any> {
    return this._compiled
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
 * @param recursionLimit 递归限制（对应 maxIterations * 2 + 4）
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

  // P4: multi_agent 与 plan_execute 互斥（multi_agent 优先，二者都消费 memory_query → 推理入口）
  if (multiAgentEnabled && planExecuteEnabled) {
    logger.warning(
      'Both multi_agent and plan_execute are enabled; multi_agent takes precedence, plan_execute disabled',
    )
    planExecuteEnabled = false
  }

  // 创建图
  // 注：LangGraph JS 的 StateGraph 类型系统无法追踪 builder 模式中通过 addNode
  // 注册的节点名，addEdge/addConditionalEdges 的字符串参数仅接受 "__start__"|"__end__"。
  // 此处使用 any 绕过此限制（运行时行为正确，与 Python 版一致）。
  const graph: any = new StateGraph(ModuAgentStateAnnotation)

  // 创建节点函数
  // P4: plan_execute 模式下为 agent 节点注入步骤上下文（默认 null 时行为不变）
  const agentNode = planExecuteEnabled
    ? makeAgentNode(boundLlm, systemPrompt, 0.5, 0.3, makePlanContextInjector())
    : makeAgentNode(boundLlm, systemPrompt)
  const memoryNode = store ? makeMemoryQueryNode(store) : null
  // P0-3: 创建记忆更新节点（带 Store 时写入长期记忆，否则跳过）
  const memoryUpdate = store ? makeMemoryUpdateNode(store) : memoryUpdateNode
  const toolResultProcessor = makeToolResultProcessor()
  // P0-1: 创建反馈评估节点（有 orchestrator 时评估，否则跳过）
  const feedbackNode = orchestrator ? makeFeedbackNode(orchestrator) : null
  // P3-12.3.2: 人工审批节点（HITL 开启时插入 agent → tools 之间）
  const humanReviewNode = hitlEnabled ? makeHumanReviewNode() : null
  // P3-12.3.1: 多 Agent 协作节点（multi_agent 开启时替代单 agent 路径）
  let supervisorNode: ((state: ModuAgentState) => Partial<ModuAgentState>) | null = null
  let subagentNode: ((state: ModuAgentState) => Promise<Partial<ModuAgentState>>) | null = null
  let consensusNode: ((state: ModuAgentState) => Promise<Partial<ModuAgentState>>) | null = null
  if (multiAgentEnabled) {
    supervisorNode = make_supervisor_node()
    subagentNode = makeSubagentNode(boundLlm, systemPrompt)
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
  graph.addNode('perception', perceptionNode)

  if (memoryNode) {
    graph.addNode('memory_query', memoryNode)
  } else {
    // 无 Store 时使用空查询节点
    graph.addNode('memory_query', memoryQueryNode)
  }

  graph.addNode('agent', agentNode)
  graph.addNode('tools', tools.length > 0 ? new ToolNode(tools) : _noopToolsNode)
  graph.addNode('tool_processor', toolResultProcessor)
  graph.addNode('response', responseNode)
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
      __end__: 'response',
    },
  )

  // 记忆查询后进入 agent / supervisor / planner（P3-12.3.1 多 Agent / P4 Plan-and-Execute 路由）
  if (supervisorNode) {
    graph.addConditionalEdges(
      'memory_query',
      routeAfterMemoryQuery,
      { agent: 'agent', supervisor: 'supervisor' },
    )
    // Supervisor 通过 Send API 并行分发到 subagent_run
    graph.addConditionalEdges(
      'supervisor',
      route_from_supervisor,
      ['subagent_run'],
    )
    // subagent_run 完成后进入 consensus
    graph.addEdge('subagent_run', 'consensus')
    // consensus → response（进入响应阶段）
    graph.addEdge('consensus', 'response')
  } else if (plannerNode) {
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
      { step_dispatch: 'step_dispatch', response: 'response' },
    )
    // step_dispatch：有剩余步骤 → agent；全部完成 → response；失败可重规划 → planner
    graph.addConditionalEdges(
      'step_dispatch',
      stepDispatch,
      { agent: 'agent', response: 'response', planner: 'planner' },
    )
    // step_finalize：单步收尾后回到 step_dispatch 推进游标
    graph.addEdge('step_finalize', 'step_dispatch')
  } else {
    graph.addEdge('memory_query', 'agent')
  }

  // Agent 后条件路由：
  // - HITL 关闭: 有 tool_calls → tools，无 tool_calls → response（原行为）
  // - HITL 开启: 有 tool_calls → human_review，无 tool_calls → response（P3-12.3.2）
  // Agent 后条件路由的目标映射。
  // P4: plan_execute 模式下 routeAfterAgent 可能返回 'step_finalize'（当前步骤完成）。
  const agentRouteTargets: Record<string, string> = humanReviewNode
    ? { tools: 'human_review', __end__: 'response' }
    : { tools: 'tools', __end__: 'response' }
  if (stepFinalizeNode) {
    agentRouteTargets['step_finalize'] = 'step_finalize'
  }

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
        response: 'response',
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

  // P0-1/P0-3: response → feedback → memory_update → END
  if (feedbackNode) {
    graph.addEdge('response', 'feedback')
    graph.addEdge('feedback', 'memory_update')
  } else {
    // 无 orchestrator 时直接 response → memory_update
    graph.addEdge('response', 'memory_update')
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
    // 默认：max_reasoning_iterations * 2 + 7（每个 ReAct 循环 2 个节点 + 固定开销含 feedback + memory_update）
    // P3-12.3.2: HITL 开启时额外加 2（human_review + 路由开销）
    // P3-12.3.1: multi_agent 开启时额外加 4（supervisor + subagent_run + consensus + 路由开销）
    const config = getConfig()
    const maxIterations = config.get('llm.max_reasoning_iterations', 3)
    let baseLimit = maxIterations * 2 + 7
    if (humanReviewNode) {
      baseLimit += 2  // 为 human_review 节点预留递归预算
    }
    if (supervisorNode) {
      baseLimit += 4  // 为 supervisor + subagent + consensus 预留递归预算
    }
    if (planExecuteEnabled) {
      // P4: 每步消耗 (agent + tools + tool_processor) * maxIterations + step_finalize，
      // 外加 planner/step_dispatch 与重规划预算；replan_count 上限由业务层 max_replans 控制
      const maxSteps = Number(config.get('plan_execute.max_steps', 10))
      const maxReplans = Number(config.get('plan_execute.max_replans', 2))
      baseLimit += maxSteps * (maxIterations * 3 + 2) + (maxReplans + 1) * 2 + 2
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
