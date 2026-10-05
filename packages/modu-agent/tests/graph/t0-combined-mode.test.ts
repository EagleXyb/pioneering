import { describe, it, expect, afterEach } from 'vitest'

import {
  buildFromSpec,
  describeGraphSpec,
  type GraphProfile,
  type ModuGraphDeps,
} from '@/graph/spec.js'
import { composeDefaultGraph, resolveGraphProfile } from '@/graph/graph.js'
import { routeAfterMemoryQuery } from '@/graph/nodes.js'
import { getConfig, overrideConfig, RuntimeConfig } from '@/config/runtime-config.js'
import { getRegistry, resetRegistry } from '@/core/registry.js'

// ============================================================
// T0-2 回归：组合模式（plan_execute + multi_agent）入口断链
//
// 缺陷：`routeAfterMemoryQuery` 在 mode_router 命中 multi_agent 规则时返回
//       'supervisor'，而 memory_query 的 plan_execute 分支边只注册了
//       {agent, planner} → LangGraph 抛 unknown destination 崩溃。
// 修复：入口边补 supervisor 目标（未启用时由 buildFromSpec 自动剔除）。
// ============================================================

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

/** 取 memory_query 入口条件边的已注册目标。 */
function memoryQueryTargets(p: GraphProfile): string[] {
  const spec = composeDefaultGraph(p)
  const snap = describeGraphSpec(spec, p, minDeps(p))
  const edge = snap.conditionalEdges.find((e) => e.from === 'memory_query')
  return edge ? edge.targets : []
}

describe('T0-2 组合模式入口路由', () => {
  afterEach(() => {
    resetRegistry()
    overrideConfig(new RuntimeConfig())
  })

  it('plan_execute 单开：入口目标不含 supervisor（保持修复前拓扑，零回归）', () => {
    const targets = memoryQueryTargets(profile({ planExecuteEnabled: true }))
    expect(targets).toContain('agent')
    expect(targets).toContain('planner')
    expect(targets).not.toContain('supervisor')
  })

  it('组合模式：入口目标注册 supervisor（修复崩溃）', () => {
    const targets = memoryQueryTargets(
      profile({ planExecuteEnabled: true, multiAgentEnabled: true }),
    )
    expect(targets).toContain('agent')
    expect(targets).toContain('planner')
    expect(targets).toContain('supervisor')
  })

  it('multi_agent 单开：入口边走另一分支，行为不变', () => {
    const targets = memoryQueryTargets(profile({ multiAgentEnabled: true }))
    expect(targets).toContain('agent')
    expect(targets).toContain('supervisor')
    expect(targets).not.toContain('planner')
  })

  it('resolveGraphProfile：组合模式下 plan/multi 画像均生效', () => {
    // resolveGraphProfile 内部 readBool 走全局 getConfig()，故用 overrideConfig 注入
    overrideConfig(
      new RuntimeConfig({
        plan_execute: { enabled: true },
        orchestration: { multi_agent: { enabled: true } },
      }),
    )
    const p = resolveGraphProfile({})
    expect(p.planExecuteEnabled).toBe(true)
    expect(p.multiAgentEnabled).toBe(true)
  })

  it('mode_router 顺序：plan_execute 规则优先于 multi_agent（组合模式入口走 planner）', () => {
    const cfg = new RuntimeConfig({
      plan_execute: { enabled: true },
      orchestration: { multi_agent: { enabled: true } },
    })
    overrideConfig(cfg)
    expect(routeAfterMemoryQuery({} as any)).toBe('planner')
  })

  it('mode_router 顺序：单开 multi_agent 时仍返回 supervisor（无回归）', () => {
    overrideConfig(new RuntimeConfig({ orchestration: { multi_agent: { enabled: true } } }))
    expect(routeAfterMemoryQuery({} as any)).toBe('supervisor')
  })

  it('mode_router 顺序：单开 plan_execute 时返回 planner（无回归）', () => {
    overrideConfig(new RuntimeConfig({ plan_execute: { enabled: true } }))
    expect(routeAfterMemoryQuery({} as any)).toBe('planner')
  })

  it('mode_router 顺序：全关时返回 agent（无回归）', () => {
    overrideConfig(new RuntimeConfig())
    expect(routeAfterMemoryQuery({} as any)).toBe('agent')
  })

  it('组合模式可成功编译建图（回归：修复前运行期 unknown destination 崩溃）', () => {
    const p = profile({ planExecuteEnabled: true, multiAgentEnabled: true })
    // makeAgentNode 在构造期即读取 boundLlm._llm / temperature，故需最小可用桩
    const stubLlm = { _llm: {}, temperature: 0.7, bindTools: () => stubLlm }
    const deps = { ...minDeps(p), llm: stubLlm, rawLlm: stubLlm }
    const built = buildFromSpec(composeDefaultGraph(p), deps)
    expect(built).toBeTruthy()
    expect(typeof (built as any).invoke).toBe('function')
  })

  it('组合模式下入口路由返回的 supervisor 目标确实存在于建图中', () => {
    // 崩溃根因是"router 返回值 ∉ 已注册目标"；此用例直接对拍两者
    const p = profile({ planExecuteEnabled: true, multiAgentEnabled: true })
    const targets = memoryQueryTargets(p)
    const cfg = new RuntimeConfig({
      plan_execute: { enabled: true },
      orchestration: { multi_agent: { enabled: true } },
    })
    overrideConfig(cfg)
    const stubLlm = { _llm: {}, temperature: 0.7, bindTools: () => stubLlm }
    const built = buildFromSpec(composeDefaultGraph(p), { ...minDeps(p), llm: stubLlm, rawLlm: stubLlm })
    const route = routeAfterMemoryQuery({} as any)
    // planner 入口与 supervisor 入口都必须是已注册目标，否则运行期报 unknown destination
    expect(['planner', 'supervisor']).toContain(route)
    expect(targets).toContain(route)
    expect(typeof (built as any).invoke).toBe('function')
  })
})
