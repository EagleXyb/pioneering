import { describe, it, expect, afterEach } from 'vitest'

import {
  buildFromSpec,
  computeRecursionLimit,
  describeGraphSpec,
  type GraphProfile,
  type GraphSpec,
  type ModuGraphDeps,
} from '@/graph/spec.js'
import { composeDefaultGraph, resolveGraphProfile } from '@/graph/graph.js'
import { getConfig } from '@/config/runtime-config.js'
import { getRegistry, resetRegistry } from '@/core/registry.js'

// ============================================================
// P2（T-13）GraphSpec 测试
//
// 目标一（L4 拓扑等价）：`composeDefaultGraph(profile)` 的节点/边集合与
//   改造前 `buildModuGraph` 的 addNode/addEdge 序列**逐条一致**（golden 快照）。
//   快照为"改造前源码的等价转写"：节点顺序 = 原 addNode 顺序；
//   staticEdges/conditionalEdges 顺序 = 原 addEdge/addConditionalEdges 顺序。
// 目标二：`buildFromSpec` 可用 + 宿主扩展点（registry.registerNode/registerEdge）
//   真实生效 + `graph.spec.enabled` 回滚开关有效。
// ============================================================

/** 构造画像（未指定的开关一律 false，与 DEFAULT_CONFIG 一致）。 */
function profile(over: Partial<GraphProfile> = {}): GraphProfile {
  return {
    hitlEnabled: false,
    multiAgentEnabled: false,
    planExecuteEnabled: false,
    clarifyEnabled: false,
    complexityAssessmentEnabled: false,
    observationDistillationEnabled: false,
    outputGuardEnabled: false,
    feedbackEnabled: false,
    fewShotEnabled: false,
    ...over,
  }
}

/** 构造最小 deps（仅用于 describeGraphSpec / 最小 spec 编译）。 */
function minDeps(p: GraphProfile): ModuGraphDeps {
  return {
    tools: [],
    llm: null,
    checkpointer: null,
    store: null,
    systemPrompt: null,
    recursionLimit: null,
    orchestrator: null,
    judgeLlm: null,
    rawLlm: null,
    complexityAssessor: null,
    observationDistiller: null,
    llmRouteResolver: null,
    memoryStrategyResolver: null,
    profile: p,
    runtimeConfig: getConfig(),
  }
}

function snapshot(p: GraphProfile) {
  const spec = composeDefaultGraph(p)
  return describeGraphSpec(spec, p, minDeps(p))
}

describe('P2/T-13: 拓扑等价快照（composeDefaultGraph ⇄ 改造前 addNode/addEdge 序列）', () => {
  afterEach(() => {
    resetRegistry()
  })

  it('全部开关关闭（默认 ReAct 路径）', () => {
    expect(snapshot(profile())).toEqual({
      nodes: [
        'perception',
        'memory_query',
        'agent',
        'tools',
        'tool_processor',
        'finalize_response',
        'doc_gen_enforce',
        'doc_final_answer',
        'memory_update',
      ],
      staticEdges: [
        'START→perception',
        'memory_query→agent',
        'tools→tool_processor',
        'tool_processor→agent',
        'doc_gen_enforce→agent',
        'doc_final_answer→agent',
        'finalize_response→memory_update',
        'memory_update→END',
      ],
      conditionalEdges: [
        { from: 'perception', targets: ['memory_query', 'finalize_response'] },
        {
          from: 'agent',
          targets: ['tools', 'finalize_response', 'doc_gen_enforce', 'doc_final_answer'],
        },
      ],
    })
  })

  it('HITL + 澄清 + 反馈开启：插入 human_review / clarify / feedback', () => {
    const p = profile({ hitlEnabled: true, clarifyEnabled: true, feedbackEnabled: true })
    expect(snapshot(p)).toEqual({
      nodes: [
        'perception',
        'memory_query',
        'agent',
        'tools',
        'tool_processor',
        'finalize_response',
        'doc_gen_enforce',
        'doc_final_answer',
        'feedback',
        'memory_update',
        'human_review',
        'clarify',
      ],
      staticEdges: [
        'START→perception',
        'clarify→memory_query',
        'memory_query→agent',
        'tools→tool_processor',
        'tool_processor→agent',
        'doc_gen_enforce→agent',
        'doc_final_answer→agent',
        'finalize_response→feedback',
        'feedback→memory_update',
        'memory_update→END',
      ],
      conditionalEdges: [
        { from: 'perception', targets: ['memory_query', 'finalize_response', 'clarify'] },
        {
          from: 'agent',
          targets: ['human_review', 'finalize_response', 'doc_gen_enforce', 'doc_final_answer'],
        },
        { from: 'human_review', targets: ['tools', 'finalize_response'] },
      ],
    })
  })

  it('多 Agent 开启（无 plan_execute）：memory_query → supervisor 分叉', () => {
    const p = profile({ multiAgentEnabled: true })
    expect(snapshot(p)).toEqual({
      nodes: [
        'perception',
        'memory_query',
        'agent',
        'tools',
        'tool_processor',
        'finalize_response',
        'doc_gen_enforce',
        'doc_final_answer',
        'memory_update',
        'supervisor',
        'subagent_run',
        'consensus',
      ],
      staticEdges: [
        'START→perception',
        'subagent_run→consensus',
        'consensus→finalize_response',
        'tools→tool_processor',
        'tool_processor→agent',
        'doc_gen_enforce→agent',
        'doc_final_answer→agent',
        'finalize_response→memory_update',
        'memory_update→END',
      ],
      conditionalEdges: [
        { from: 'perception', targets: ['memory_query', 'finalize_response'] },
        { from: 'memory_query', targets: ['agent', 'supervisor'] },
        {
          from: 'agent',
          targets: ['tools', 'finalize_response', 'doc_gen_enforce', 'doc_final_answer'],
        },
        { from: 'supervisor', targets: ['subagent_run'] },
      ],
    })
  })

  it('plan_execute 开启（无多 Agent）：planner → step_dispatch 主循环', () => {
    const p = profile({ planExecuteEnabled: true })
    expect(snapshot(p)).toEqual({
      nodes: [
        'perception',
        'memory_query',
        'agent',
        'tools',
        'tool_processor',
        'finalize_response',
        'doc_gen_enforce',
        'doc_final_answer',
        'memory_update',
        'planner',
        'step_dispatch',
        'step_finalize',
      ],
      staticEdges: [
        'START→perception',
        'step_finalize→step_dispatch',
        'tools→tool_processor',
        'tool_processor→agent',
        'doc_gen_enforce→agent',
        'doc_final_answer→agent',
        'finalize_response→memory_update',
        'memory_update→END',
      ],
      conditionalEdges: [
        { from: 'perception', targets: ['memory_query', 'finalize_response'] },
        { from: 'memory_query', targets: ['agent', 'planner'] },
        { from: 'planner', targets: ['step_dispatch', 'finalize_response'] },
        { from: 'step_dispatch', targets: ['agent', 'finalize_response', 'planner'] },
        {
          from: 'agent',
          targets: [
            'tools',
            'finalize_response',
            'step_finalize',
            'doc_gen_enforce',
            'doc_final_answer',
          ],
        },
      ],
    })
  })

  it('组合模式（plan_execute + multi_agent + HITL）：全部节点与分支共存', () => {
    const p = profile({
      planExecuteEnabled: true,
      multiAgentEnabled: true,
      hitlEnabled: true,
    })
    expect(snapshot(p)).toEqual({
      nodes: [
        'perception',
        'memory_query',
        'agent',
        'tools',
        'tool_processor',
        'finalize_response',
        'doc_gen_enforce',
        'doc_final_answer',
        'memory_update',
        'human_review',
        'supervisor',
        'subagent_run',
        'consensus',
        'planner',
        'step_dispatch',
        'step_finalize',
      ],
      staticEdges: [
        'START→perception',
        'step_finalize→step_dispatch',
        'subagent_run→consensus',
        'consensus→step_finalize',
        'tools→tool_processor',
        'tool_processor→agent',
        'doc_gen_enforce→agent',
        'doc_final_answer→agent',
        'finalize_response→memory_update',
        'memory_update→END',
      ],
      conditionalEdges: [
        { from: 'perception', targets: ['memory_query', 'finalize_response'] },
        // T0-2：组合模式下 supervisor 已挂载，故 memory_query 入口边注册 supervisor 目标
        { from: 'memory_query', targets: ['agent', 'planner', 'supervisor'] },
        { from: 'planner', targets: ['step_dispatch', 'finalize_response'] },
        {
          from: 'step_dispatch',
          targets: ['agent', 'finalize_response', 'planner', 'supervisor'],
        },
        {
          from: 'agent',
          targets: [
            'human_review',
            'finalize_response',
            'step_finalize',
            'doc_gen_enforce',
            'doc_final_answer',
          ],
        },
        { from: 'human_review', targets: ['tools', 'finalize_response'] },
        { from: 'supervisor', targets: ['subagent_run'] },
      ],
    })
  })

  it('describeGraphSpec 剔除源/目标未启用的静态边（与 buildFromSpec 一致）', () => {
    const spec: GraphSpec = {
      nodes: [{ name: 'a', factory: () => () => ({}) }],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'END' },
        { from: 'a', to: 'ghost' },   // 目标未启用 → 剔除
        { from: 'ghost', to: 'a' },   // 源未启用 → 剔除
      ],
    }
    expect(describeGraphSpec(spec, profile(), minDeps(profile()))).toEqual({
      nodes: ['a'],
      staticEdges: ['START→a', 'a→END'],
      conditionalEdges: [],
    })
  })

  it('resolveGraphProfile：显式参数优先于配置，null 时回落到配置值', () => {
    const cfg = getConfig()
    const cfgHitl = Boolean(cfg.get('tools.human_in_loop.enabled', false))
    const cfgMulti = Boolean(cfg.get('orchestration.multi_agent.enabled', false))
    const cfgPlan = Boolean(cfg.get('plan_execute.enabled', false))

    // 显式参数优先（取配置值的反值，确保断言能区分两条路径）
    const explicit = resolveGraphProfile({
      hitlEnabled: !cfgHitl,
      multiAgentEnabled: !cfgMulti,
      planExecuteEnabled: !cfgPlan,
      orchestrator: null,
      complexityAssessor: null,
      observationDistiller: null,
    })
    expect(explicit.hitlEnabled).toBe(!cfgHitl)
    expect(explicit.multiAgentEnabled).toBe(!cfgMulti)
    expect(explicit.planExecuteEnabled).toBe(!cfgPlan)
    expect(explicit.feedbackEnabled).toBe(false)
    expect(explicit.complexityAssessmentEnabled).toBe(false)
    expect(explicit.observationDistillationEnabled).toBe(false)

    // null → 读配置
    const fromConfig = resolveGraphProfile({
      hitlEnabled: null,
      multiAgentEnabled: null,
      planExecuteEnabled: null,
      orchestrator: {},
      complexityAssessor: {},
      observationDistiller: {},
    })
    expect(fromConfig.hitlEnabled).toBe(cfgHitl)
    expect(fromConfig.multiAgentEnabled).toBe(cfgMulti)
    expect(fromConfig.planExecuteEnabled).toBe(cfgPlan)
    expect(fromConfig.feedbackEnabled).toBe(true)
    expect(fromConfig.complexityAssessmentEnabled).toBe(true)
    expect(fromConfig.observationDistillationEnabled).toBe(true)
    expect(fromConfig.clarifyEnabled).toBe(Boolean(cfg.get('perception.clarification.enabled', false)))
    expect(fromConfig.outputGuardEnabled).toBe(
      Boolean(cfg.get('perception.security.sanitize_output.enabled', false)),
    )
  })

  it('computeRecursionLimit：逐项复刻改造前公式（HITL/澄清/多 Agent/plan_execute 预留）', () => {
    const cfg = getConfig()
    const maxIter = Number(cfg.get('llm.max_reasoning_iterations', 3))
    const base = (maxIter + 2) * 3 + 15

    expect(computeRecursionLimit(minDeps(profile()), () => false)).toBe(base)

    // HITL(+2) + 澄清(+2 + maxRounds*2)
    const maxRounds = Number(cfg.get('perception.clarification.max_clarify_rounds', 2))
    const hasHitlClarify = (name: string) => name === 'human_review' || name === 'clarify'
    expect(computeRecursionLimit(minDeps(profile()), hasHitlClarify))
      .toBe(base + 2 + (2 + Math.max(0, maxRounds) * 2))

    // 多 Agent(+4)
    expect(computeRecursionLimit(minDeps(profile()), (n) => n === 'supervisor')).toBe(base + 4)

    // plan_execute：stepBudget = (maxSteps*maxIter)*4 + maxSteps；plannerBudget = (maxReplans+1)*2+2
    const maxSteps = Number(cfg.get('plan_execute.max_steps', 10))
    const maxReplans = Number(cfg.get('plan_execute.max_replans', 2))
    const planLimit = computeRecursionLimit(
      minDeps(profile({ planExecuteEnabled: true })), () => false,
    )
    expect(planLimit).toBe(base + (maxSteps * maxIter * 4 + maxSteps) + ((maxReplans + 1) * 2 + 2))
  })
})

describe('P2/T-13: buildFromSpec（最小 spec / 宿主扩展 / 回滚开关）', () => {
  afterEach(() => {
    resetRegistry()
  })

  /** 最小 spec：START → only → END。 */
  function minimalSpec(): GraphSpec {
    return {
      nodes: [
        {
          name: 'only',
          factory: () => (state: any) => ({ response: `only:${state?.cleaned_text ?? ''}` }),
        },
      ],
      edges: [
        { from: 'START', to: 'only' },
        { from: 'only', to: 'END' },
      ],
    }
  }

  it('最小 spec 可编译并按声明执行', async () => {
    const compiled: any = buildFromSpec(minimalSpec(), minDeps(profile()))
    const out = await compiled.invoke({ cleaned_text: 'hi' })
    expect(out.response).toBe('only:hi')
    expect(compiled.recursionLimit).toBe(
      computeRecursionLimit(minDeps(profile()), (n) => n === 'only'),
    )
  })

  it('recursionLimit 显式传入时覆盖动态计算', () => {
    const deps = minDeps(profile())
    deps.recursionLimit = 77
    const compiled: any = buildFromSpec(minimalSpec(), deps)
    expect(compiled.recursionLimit).toBe(77)
  })

  it('宿主注册的节点/边被追加进图（不改 graph.ts 即可扩展拓扑）', async () => {
    const registry = getRegistry()
    registry.registerNode({
      name: 'extra',
      factory: () => () => ({ response: 'EXTRA' }),
    })
    registry.registerEdge({ from: 'only', to: 'extra' })
    registry.registerEdge({ from: 'extra', to: 'END' })

    // 去掉默认 spec 中 only→END（避免与扩展边冲突）
    const spec: GraphSpec = {
      nodes: minimalSpec().nodes,
      edges: [{ from: 'START', to: 'only' }],
    }
    const compiled: any = buildFromSpec(spec, minDeps(profile()))
    const out = await compiled.invoke({})
    expect(out.response).toBe('EXTRA')

    expect(registry.listNodeSpecs().map((n) => n.name)).toEqual(['extra'])
    expect(registry.listEdgeSpecs().length).toBe(2)
  })

  it('graph.spec.enabled=false 时忽略宿主注册的图扩展（单点回滚）', async () => {
    const cfg = getConfig()
    const prev = cfg.get('graph.spec.enabled', true)
    const registry = getRegistry()
    registry.registerNode({ name: 'extra', factory: () => () => ({ response: 'EXTRA' }) })
    registry.registerEdge({ from: 'only', to: 'extra' })
    registry.registerEdge({ from: 'extra', to: 'END' })

    try {
      cfg.set('graph.spec.enabled', false)
      const compiled: any = buildFromSpec(
        { nodes: minimalSpec().nodes, edges: [{ from: 'START', to: 'only' }] },
        minDeps(profile()),
      )
      const out = await compiled.invoke({})
      // 扩展节点未参与构建：仅 内置 `only` 节点执行
      expect(out.response).toBe('only:')
    } finally {
      cfg.set('graph.spec.enabled', prev)
    }
  })

  it('同名节点声明冲突时以内置为准（扩展声明被忽略）', async () => {
    const registry = getRegistry()
    registry.registerNode({ name: 'only', factory: () => () => ({ response: 'HOST' }) })
    const compiled: any = buildFromSpec(minimalSpec(), minDeps(profile()))
    const out = await compiled.invoke({ cleaned_text: 'x' })
    expect(out.response).toBe('only:x')
    expect(registry.listNodeSpecs().map((n) => n.name)).toEqual(['only'])
  })

  it('NodeSpec/EdgeSpec 非法声明被拒绝', () => {
    const registry = getRegistry()
    expect(() => registry.registerNode({ name: '', factory: () => () => ({}) }))
      .toThrow(TypeError)
    expect(() => registry.registerNode({ name: 'x', factory: undefined as any }))
      .toThrow(TypeError)
    expect(() => registry.registerEdge({ from: '', to: 'x' })).toThrow(TypeError)
    expect(() => registry.registerNode({ name: 'x', factory: () => () => ({}) }))
      .not.toThrow()
    // 同名重复注册被拒绝
    expect(() => registry.registerNode({ name: 'x', factory: () => () => ({}) }))
      .toThrow()
    registry.clearGraphSpecs()
    expect(registry.listNodeSpecs()).toEqual([])
    expect(registry.listEdgeSpecs()).toEqual([])
  })

  it('describeGraphSpec 与 buildFromSpec 使用一致的 when 判定', () => {
    const p = profile({ hitlEnabled: true })
    const spec = composeDefaultGraph(p)
    expect(describeGraphSpec(spec, p, minDeps(p)).nodes).toContain('human_review')

    const p2 = profile()
    const spec2 = composeDefaultGraph(p2)
    expect(describeGraphSpec(spec2, p2, minDeps(p2)).nodes).not.toContain('human_review')
  })
})
