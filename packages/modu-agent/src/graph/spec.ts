// P2（T-13）: 图拓扑规格（GraphSpec）—— 声明式图构建。
//
// 目标（对应评估报告 G-4「拓扑可注册」）：
//   把 `graph/graph.ts` 中硬编码的 `addNode` / `addEdge` / `addConditionalEdges`
//   序列抽取为**数据声明**（NodeSpec / EdgeSpec / GraphProfile），
//   由 `buildFromSpec` 统一执行；
//   `buildModuGraph(14 args)` 保留为
//   `buildFromSpec(composeDefaultGraph(profile), deps)` 的兼容包装。
//
// 兼容硬约束（§4.1.5）：
//   1. `composeDefaultGraph` 产出的节点顺序/边顺序与改造前**逐一对应**，
//      因此 LangGraph 编译结果与行为逐字节等价（快照测试见
//      tests/graph/graph-spec-equivalence.test.ts）；
//   2. `buildModuGraph` 的 14 个位置参数签名**保持不变**；
//   3. 宿主经 `registry.registerNode/registerEdge` 注册的声明**追加**在默认声明之后，
//      默认路径（零注册）行为零变化，受 `graph.spec.extensions_enabled` 门控。
//
// 循环依赖说明：本文件 **值** 依赖 `core/registry.ts`（读取宿主注册的扩展声明），
// `core/registry.ts` 仅 **类型** 依赖本文件（`import type`，编译期擦除）→ 运行时无环。

import { END, START, StateGraph, type CompiledStateGraph } from '@langchain/langgraph'
import type { StructuredTool } from '@langchain/core/tools'

import type { RuntimeConfig } from '../config/runtime-config.js'
import { getConfig } from '../config/runtime-config.js'
import { getRegistry } from '../core/registry.js'
import type { MemoryStrategy } from '../core/interfaces/memory-strategy.js'
import type { ComplexityAssessor } from '../reasoning/complexity-assessor.js'
import { ModuAgentStateAnnotation, type ModuAgentState } from './state.js'
import type { ObservationDistiller } from './adapters/observation-distiller.js'

const logger = {
  info: (msg: string, ...args: any[]) => console.info(`[graph.spec] ${msg}`, ...args),
  warning: (msg: string, ...args: any[]) => console.warn(`[graph.spec] ${msg}`, ...args),
}

// ============================================================
// 契约（对应实施计划 §4.1.5）
// ============================================================

/**
 * 图模式画像：决定哪些**可选节点/边**参与构建。
 *
 * - `hitlEnabled` / `multiAgentEnabled` / `planExecuteEnabled` / `clarifyEnabled`
 *   对应改造前 `buildModuGraph` 内的 4 个布尔分支（P2 起由 profile 统一承载，
 *   即原计划 T-10c「HITL 拓扑声明化」）；
 * - 其余为构建期已解析的能力开关（由 `resolveGraphProfile` 从配置读出），
 *   一并声明化以避免在 spec 内部再读配置。
 */
export interface GraphProfile {
  hitlEnabled: boolean
  multiAgentEnabled: boolean
  planExecuteEnabled: boolean
  clarifyEnabled: boolean
  /** P0-1: 复杂度评估（perception 节点包装） */
  complexityAssessmentEnabled: boolean
  /** P0-3: Observation 蒸馏（tool_processor 节点） */
  observationDistillationEnabled: boolean
  /** P0-5: 输出护栏（finalize_response 节点包装） */
  outputGuardEnabled: boolean
  /** P0-1: 反馈节点（需 orchestrator 非空） */
  feedbackEnabled: boolean
  /** P2-2: Few-shot 示例选择器是否启用 */
  fewShotEnabled: boolean
  /**
   * 场景包注入的扩展开关（P3/T-20 起**已落地**）。
   *
   * 单一事实源为配置 `graph.spec.extra`（由 `resolveGraphProfile` 读取；显式传参优先）；
   * 宿主注册的 `NodeSpec` / `EdgeSpec` 经 `profileFlag(profile, key)` 读取。
   */
  extra?: Record<string, boolean>
}

/**
 * 图构建依赖（节点工厂的唯一输入）。
 */
export interface ModuGraphDeps {
  /** LangChain 工具列表（ToolNode 使用） */
  tools: StructuredTool[]
  /** 已绑定工具的 LLM（agent / subagent 节点使用） */
  llm: any
  /** 检查点保存器（null=不持久化） */
  checkpointer: any
  /** 长期记忆存储（null=不查询） */
  store: any
  /** 系统提示词（agent / subagent 节点使用） */
  systemPrompt: string | null
  /** 递归限制（null=按配置动态计算） */
  recursionLimit: number | null
  /** 进化编排器（null=不注册 feedback 节点） */
  orchestrator: any
  /** 多 Agent 裁决 LLM（llm_judge 共识策略） */
  judgeLlm: any
  /** P4: 未绑定工具的原始 LLM（Planner 节点专用） */
  rawLlm: any
  /** P0-1: 复杂度评估器 */
  complexityAssessor: ComplexityAssessor | null
  /** P0-3: Observation 蒸馏器 */
  observationDistiller: ObservationDistiller | null
  /** P0（T-08）: 模型路由解析器 */
  llmRouteResolver: ((state: ModuAgentState) => any | null) | null
  /** P1（T-11）: 记忆策略解析器 */
  memoryStrategyResolver: ((taskType?: string) => MemoryStrategy | undefined) | null
  /** 已解析的图模式画像 */
  profile: GraphProfile
  /** 运行时配置（递归预算等） */
  runtimeConfig: RuntimeConfig
}

/** 节点存在性判定（供条件边目标映射使用）。 */
export type NodePredicate = (nodeName: string) => boolean

/** 条件边目标：静态映射、映射工厂（依赖已启用节点集合）或节点名数组。 */
export type EdgeTargets =
  | Record<string, string>
  | string[]
  | ((has: NodePredicate) => Record<string, string>)

/** 节点声明。 */
export interface NodeSpec {
  name: string
  /**
   * 节点工厂：返回 `addNode` 可接受的节点实现。
   *
   * 返回类型为 `any`（不窄化为 `(...args) => any`）：LangGraph 的 `addNode`
   * 同时接受普通函数与 `Runnable`（如 `ToolNode`），收窄会误拒绝后者。
   */
  factory: (deps: ModuGraphDeps) => any
  /** 条件注册（返回 false 时不挂载该节点） */
  when?: (profile: GraphProfile, deps: ModuGraphDeps) => boolean
}

/** 边声明（`to` 为字符串 = 静态边；为对象 = 条件边）。 */
export interface EdgeSpec {
  from: string
  to: string | { router: (...args: any[]) => any; targets: EdgeTargets }
  when?: (profile: GraphProfile, deps: ModuGraphDeps) => boolean
}

/**
 * 场景包扩展子图声明（真子图，复用 `subgraph/builder.ts` 的 compile 范式）。
 *
 * P3（T-20）落地：本类型此前以匿名结构声明于 `GraphSpec.subgraphs` 却**零消费**，
 * 使 `sop/graph.yaml`（场景包自定义子图）成为空承诺。现由 `buildFromSpec` 实际装配。
 *
 * 语义：`parentNode` 是**该子图在父图中挂载的节点名**（等价 `addNode(parentNode, built)`）；
 * `name` 为子图标识（日志与冲突判定用，允许与 `parentNode` 不同名）。
 */
export interface SubgraphSpec {
  /** 子图标识 */
  name: string
  /** 子图在**父图**中挂载的节点名 */
  parentNode: string
  /** 构建器：返回 `addNode` 可接受的实现（通常为已 `compile()` 的子图） */
  builder: (deps: ModuGraphDeps) => any
  /** 条件注册（返回 false 时不挂载该子图） */
  when?: (profile: GraphProfile, deps: ModuGraphDeps) => boolean
}

/** 图拓扑声明。 */
export interface GraphSpec {
  nodes: NodeSpec[]
  edges: EdgeSpec[]
  /** 场景包扩展子图（真子图，复用 `subgraph/builder.ts` 的 compile 范式） */
  subgraphs?: SubgraphSpec[]
}

/**
 * 读取画像扩展开关（`GraphProfile.extra`）——供 `NodeSpec` / `EdgeSpec` 的 `when` 使用。
 *
 * 典型用法（场景包声明"我的 SOP 节点仅在 `my_sop_enabled=true` 时挂载"）：
 * ```ts
 * registry.registerNode({ name: 'my_step', factory: ..., when: (p) => profileFlag(p, 'my_sop_enabled') })
 * ```
 *
 * `extra` 为空 / 键不存在时返回 `dflt`（默认 false）→ 默认路径行为零变化。
 */
export function profileFlag(profile: GraphProfile, key: string, dflt = false): boolean {
  const v = profile?.extra?.[key]
  return v === undefined ? dflt : Boolean(v)
}

/** 拓扑快照（供等价性测试与调试使用）。 */
export interface GraphSpecSnapshot {
  nodes: string[]
  staticEdges: string[]
  conditionalEdges: Array<{ from: string; targets: string[] }>
}

// ============================================================
// 执行
// ============================================================

function _safeHas(profile: GraphProfile, deps: ModuGraphDeps, when: NodeSpec['when']): boolean {
  if (!when) return true
  try {
    return Boolean(when(profile, deps))
  } catch (e: any) {
    logger.warning('graph spec node condition failed, skipping node: %s', String(e?.message ?? e))
    return false
  }
}

function _safeHasEdge(profile: GraphProfile, deps: ModuGraphDeps, when: EdgeSpec['when']): boolean {
  if (!when) return true
  try {
    return Boolean(when(profile, deps))
  } catch (e: any) {
    logger.warning('graph spec edge condition failed, skipping edge: %s', String(e?.message ?? e))
    return false
  }
}

/**
 * LangGraph 虚拟端点（`START` / `END` 及其别名）。
 *
 * 这些名字**不可**作为节点名注册/覆盖（否则 `addNode(START, ...)` 会破坏图），
 * 故扩展子图的 `parentNode` 命中时一律跳过（`buildFromSpec` 与 `describeGraphSpec` 口径一致）。
 */
function _isVirtualEndpoint(name: string): boolean {
  return name === 'START' || name === '__start__' || name === 'END' || name === '__end__'
}

/** 读取宿主注册的扩展声明（registry 未实现该扩展或抛错时安全返回空列表）。 */
function _listRegistered<T>(method: string): T[] {
  if (!deps_extensionEnabled()) return []
  try {
    const registry: any = getRegistry()
    if (typeof registry[method] !== 'function') return []
    const out = registry[method]()
    return Array.isArray(out) ? (out as T[]) : []
  } catch (e: any) {
    logger.warning('list %s failed: %s', method, String(e?.message ?? e))
    return []
  }
}

/** `graph.spec.enabled`（默认 true；关闭后宿主注册的图扩展声明被忽略）。 */
function deps_extensionEnabled(): boolean {
  try {
    return Boolean(getConfig().get('graph.spec.enabled', true))
  } catch {
    return true
  }
}

/**
 * 按声明构建并编译 LangGraph。
 *
 * 执行顺序严格复刻改造前的 `buildModuGraph`：
 *   1. 按声明顺序 `addNode`（可选节点由 `when` 过滤）；
 *   2. 按声明顺序 `addEdge` / `addConditionalEdges`；
 *   3. 计算递归预算（`recursionLimit` 为空时按配置动态计算）；
 *   4. `compile({checkpointer, store})`。
 *
 * 宿主扩展：`registry.registerNode/registerEdge` 的声明追加在默认声明之后
 * （同名内置节点以默认为准，扩展声明被忽略并告警）。
 */
export function buildFromSpec(spec: GraphSpec, deps: ModuGraphDeps): CompiledStateGraph<any, any> {
  const profile = deps.profile
  const profileDeps = deps

  // ---- 1. 解析节点（默认声明 + 宿主扩展声明） ----
  const enabledNodeNames = new Set<string>()
  const resolvedNodes: NodeSpec[] = []
  for (const node of spec.nodes) {
    if (!_safeHas(profile, profileDeps, node.when)) continue
    if (enabledNodeNames.has(node.name)) continue
    enabledNodeNames.add(node.name)
    resolvedNodes.push(node)
  }
  for (const node of _listRegistered<NodeSpec>('listNodeSpecs')) {
    if (!node || !node.name) continue
    if (enabledNodeNames.has(node.name)) {
      logger.warning('registered node spec %s conflicts with built-in node, skipped', node.name)
      continue
    }
    if (!_safeHas(profile, profileDeps, node.when)) continue
    enabledNodeNames.add(node.name)
    resolvedNodes.push(node)
  }

  const has: NodePredicate = (name) => enabledNodeNames.has(name)

  // ---- 1b. 解析扩展子图（P3/T-20）----
  // 语义：把 `builder(deps)` 的产物作为**真子图节点**挂到 `parentNode`；
  // 与已启用节点同名时以**内置/声明节点为准**（子图被忽略并告警），
  // 与 `registerNode` 的同名冲突策略保持一致（避免静默覆盖拓扑）。
  const subgraphs: SubgraphSpec[] = [
    ...(spec.subgraphs ?? []),
    ..._listRegistered<SubgraphSpec>('listSubgraphs'),
  ]
  const mountedSubgraphs: string[] = []
  for (const sg of subgraphs) {
    if (!sg || !sg.name || !sg.parentNode || typeof sg.builder !== 'function') {
      logger.warning('invalid subgraph spec, skipped: %s', String((sg as any)?.name ?? '(anonymous)'))
      continue
    }
    if (!_safeHas(profile, profileDeps, sg.when)) continue
    if (_isVirtualEndpoint(sg.parentNode)) {
      logger.warning(
        'subgraph %s mount node %s is a reserved virtual endpoint, skipped',
        sg.name,
        sg.parentNode,
      )
      continue
    }
    if (enabledNodeNames.has(sg.parentNode)) {
      logger.warning(
        'subgraph %s mount node %s conflicts with an enabled node, skipped',
        sg.name,
        sg.parentNode,
      )
      continue
    }
    let built: any
    try {
      built = sg.builder(deps)
    } catch (e: any) {
      logger.warning('subgraph %s builder failed, skipped: %s', sg.name, String(e?.message ?? e))
      continue
    }
    if (built === null || built === undefined) {
      logger.warning('subgraph %s builder returned empty, skipped', sg.name)
      continue
    }
    enabledNodeNames.add(sg.parentNode)
    resolvedNodes.push({ name: sg.parentNode, factory: () => built })
    mountedSubgraphs.push(sg.parentNode)
  }

  // ---- 2. 建图 ----
  const graph: any = new StateGraph(ModuAgentStateAnnotation)
  for (const node of resolvedNodes) {
    graph.addNode(node.name, node.factory(deps))
  }

  const edgeSpecs: EdgeSpec[] = [...spec.edges, ..._listRegistered<EdgeSpec>('listEdgeSpecs')]
  let staticEdgeCount = 0
  let conditionalEdgeCount = 0
  for (const edge of edgeSpecs) {
    if (!_safeHasEdge(profile, profileDeps, edge.when)) continue
    const from = edge.from === 'START' ? START : edge.from === 'END' ? END : edge.from
    if (typeof from === 'string' && from !== START && from !== END && !has(from)) {
      logger.warning('graph spec edge from=%s skipped: source node not enabled', edge.from)
      continue
    }
    if (typeof edge.to === 'string') {
      const target = edge.to === 'END' ? END : edge.to
      if (typeof target === 'string' && target !== END && !has(target)) {
        logger.warning('graph spec edge %s→%s skipped: target node not enabled', edge.from, edge.to)
        continue
      }
      graph.addEdge(from, target)
      staticEdgeCount += 1
      continue
    }
    const { router, targets } = edge.to
    let resolvedTargets: Record<string, string> | string[]
    if (typeof targets === 'function') {
      resolvedTargets = targets(has)
    } else {
      resolvedTargets = targets
    }
    // 条件边目标过滤：剔除未启用节点（等价改造前的 `...(clarifyNode ? {...} : {})` 写法）
    if (!Array.isArray(resolvedTargets)) {
      const filtered: Record<string, string> = {}
      for (const [key, value] of Object.entries(resolvedTargets)) {
        if (value === '__end__' || value === 'END' || has(value)) {
          filtered[key] = value
        }
      }
      resolvedTargets = filtered
    }
    graph.addConditionalEdges(from, router, resolvedTargets as any)
    conditionalEdgeCount += 1
  }

  // ---- 3. 编译 ----
  const compileKwargs: Record<string, any> = {}
  if (deps.checkpointer) compileKwargs['checkpointer'] = deps.checkpointer
  if (deps.store) compileKwargs['store'] = deps.store
  const compiled = graph.compile(compileKwargs)
  const compiledAny = compiled as any

  if (deps.recursionLimit) {
    compiledAny.recursionLimit = deps.recursionLimit
  } else {
    compiledAny.recursionLimit = computeRecursionLimit(deps, has)
  }

  logger.info(
    'Graph built from spec: nodes=%d (subgraphs=%d) static_edges=%d conditional_edges=%d recursion_limit=%d',
    resolvedNodes.length,
    mountedSubgraphs.length,
    staticEdgeCount,
    conditionalEdgeCount,
    compiledAny.recursionLimit,
  )
  return compiled
}

/**
 * 递归预算计算（逐字复刻改造前 `buildModuGraph` 的公式，含各模式的额外预留）。
 */
export function computeRecursionLimit(deps: ModuGraphDeps, has: NodePredicate): number {
  const config = deps.runtimeConfig ?? getConfig()
  const maxIterations = config.get('llm.max_reasoning_iterations', 3)
  const effectiveIterations = maxIterations + 2
  let baseLimit = effectiveIterations * 3 + 15
  if (has('human_review')) baseLimit += 2
  if (has('clarify')) {
    const maxRounds = Number(config.get('perception.clarification.max_clarify_rounds', 2))
    baseLimit += 2 + Math.max(0, maxRounds) * 2
  }
  if (has('supervisor')) baseLimit += 4
  if (deps.profile.planExecuteEnabled) {
    const maxSteps = Number(config.get('plan_execute.max_steps', 10))
    const maxReplans = Number(config.get('plan_execute.max_replans', 2))
    const estimatedTotalIters = estimatePlanTotalIterations(config, maxSteps, maxIterations)
    const stepBudget = estimatedTotalIters * 4 + maxSteps * 1
    const plannerBudget = (maxReplans + 1) * 2 + 2
    baseLimit += stepBudget + plannerBudget
  }
  return baseLimit
}

/**
 * 估算 plan 总迭代数（对应文档 §2.3 建议5：递归预算动态计算）。
 *
 * 从 `graph/graph.ts` 原样迁入（T-13），语义与实现不变。
 */
export function estimatePlanTotalIterations(
  config: { get: (key: string, dflt?: any) => any },
  maxSteps: number,
  maxIterations: number,
): number {
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
        total += maxIterations
      }
    }
    if (hasEstimate) {
      return total
    }
  }
  return maxSteps * maxIterations
}

/**
 * 生成拓扑快照（节点集合 + 边集合），供等价性测试断言。
 *
 * 与 `buildFromSpec` 使用**相同**的 when/目标过滤逻辑，因此快照可直接与
 * 改造前 `buildModuGraph` 的 addNode/addEdge 序列对照。
 */
export function describeGraphSpec(
  spec: GraphSpec,
  profile: GraphProfile,
  deps: ModuGraphDeps,
): GraphSpecSnapshot {
  const enabledNodeNames = new Set<string>()
  const nodes: string[] = []
  for (const node of spec.nodes) {
    if (!_safeHas(profile, deps, node.when)) continue
    enabledNodeNames.add(node.name)
    nodes.push(node.name)
  }
  // P3（T-20）：扩展子图挂载点同样计入节点集合，保持与 `buildFromSpec` 一致
  // （默认 spec 无 subgraphs → 既有拓扑快照逐条不变）。
  for (const sg of spec.subgraphs ?? []) {
    if (!sg || !sg.parentNode) continue
    if (!_safeHas(profile, deps, sg.when)) continue
    // 与 `buildFromSpec` 同口径：虚拟端点不可作为挂载点
    if (_isVirtualEndpoint(sg.parentNode)) continue
    if (enabledNodeNames.has(sg.parentNode)) continue
    enabledNodeNames.add(sg.parentNode)
    nodes.push(sg.parentNode)
  }
  const has: NodePredicate = (name) => enabledNodeNames.has(name)

  // START / END（及其 `__start__`/`__end__` 别名）是 LangGraph 的虚拟端点，
  // 恒"存在"，不参与 `has()` 判定 —— 与 `buildFromSpec` 的处理保持一致。
  const isVirtual = _isVirtualEndpoint

  const staticEdges: string[] = []
  const conditionalEdges: Array<{ from: string; targets: string[] }> = []
  for (const edge of spec.edges) {
    if (!_safeHasEdge(profile, deps, edge.when)) continue
    if (!isVirtual(edge.from) && !has(edge.from)) continue
    if (typeof edge.to === 'string') {
      if (!isVirtual(edge.to) && !has(edge.to)) continue
      staticEdges.push(`${edge.from}→${edge.to}`)
      continue
    }
    const raw = typeof edge.to.targets === 'function' ? edge.to.targets(has) : edge.to.targets
    const targets = Array.isArray(raw) ? [...raw] : Object.values(raw)
    conditionalEdges.push({ from: edge.from, targets })
  }
  return { nodes, staticEdges, conditionalEdges }
}
