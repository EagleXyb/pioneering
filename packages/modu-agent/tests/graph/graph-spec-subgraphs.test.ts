// graph-spec-subgraphs.test.ts
//
// P3（T-20）：骨架闭环 —— `GraphSpec.subgraphs` 消费 + `GraphProfile.extra` 落地。
//
// 背景（P3 开工前复核 §5.4.1 #8/#9）：
//   - `GraphSpec.subgraphs` 此前**仅声明未消费**（`buildFromSpec` 零引用），
//     使 `sop/graph.yaml`（场景包自定义子图）成为空承诺；
//   - `GraphProfile.extra` 已声明但 `resolveGraphProfile` / `composeDefaultGraph`
//     均未写入/消费，SOP 包"按开关注入新节点"的通路缺失。
//
// 本测试锁定：① 默认路径（零注册 / 空 extra）行为零变化；② 子图与扩展开关真实生效。
import { describe, it, expect, afterEach } from 'vitest'

import {
  buildFromSpec,
  describeGraphSpec,
  profileFlag,
  type GraphProfile,
  type GraphSpec,
  type ModuGraphDeps,
} from '@/graph/spec.js'
import { composeDefaultGraph, resolveGraphProfile } from '@/graph/graph.js'
import { getConfig } from '@/config/runtime-config.js'
import { getRegistry, resetRegistry } from '@/core/registry.js'

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

describe('P3/T-20: GraphSpec.subgraphs 消费', () => {
  afterEach(() => {
    resetRegistry()
  })

  it('回归哨兵：默认 spec 不含 subgraphs，默认拓扑不变', () => {
    const spec = composeDefaultGraph(profile())
    expect(spec.subgraphs).toBeUndefined()

    const snap = describeGraphSpec(spec, profile(), minDeps(profile()))
    expect(snap.nodes).toEqual([
      'perception',
      'memory_query',
      'agent',
      'tools',
      'tool_processor',
      'finalize_response',
      'doc_gen_enforce',
      'doc_final_answer',
      'memory_update',
    ])
  })

  it('spec.subgraphs 的挂载点计入拓扑快照', () => {
    const spec: GraphSpec = {
      ...minimalSpec(),
      subgraphs: [{ name: 'sg', parentNode: 'sub', builder: () => () => ({}) }],
    }
    const snap = describeGraphSpec(spec, profile(), minDeps(profile()))
    expect(snap.nodes).toEqual(['only', 'sub'])
  })

  it('buildFromSpec 真正装配子图并按声明执行（此前为零消费）', async () => {
    const spec: GraphSpec = {
      nodes: minimalSpec().nodes,
      edges: [
        { from: 'START', to: 'only' },
        { from: 'only', to: 'sub' },
        { from: 'sub', to: 'END' },
      ],
      subgraphs: [
        {
          name: 'sg',
          parentNode: 'sub',
          builder: () => () => ({ response: 'SUB' }),
        },
      ],
    }
    const compiled: any = buildFromSpec(spec, minDeps(profile()))
    const out = await compiled.invoke({})
    expect(out.response).toBe('SUB')
  })

  it('宿主经 registry.registerSubgraph 注册的子图被消费（不改 graph.ts 即可扩展）', async () => {
    const registry = getRegistry()
    registry.registerSubgraph({
      name: 'sg',
      parentNode: 'sub',
      builder: () => () => ({ response: 'SUB-FROM-REGISTRY' }),
    })
    registry.registerEdge({ from: 'only', to: 'sub' })
    registry.registerEdge({ from: 'sub', to: 'END' })

    const spec: GraphSpec = {
      nodes: minimalSpec().nodes,
      edges: [{ from: 'START', to: 'only' }],
    }
    const compiled: any = buildFromSpec(spec, minDeps(profile()))
    const out = await compiled.invoke({})
    expect(out.response).toBe('SUB-FROM-REGISTRY')
    expect(registry.listSubgraphs().map((s) => s.name)).toEqual(['sg'])
  })

  it('挂载点与已启用节点同名时跳过（内置/声明节点优先）', async () => {
    const spec: GraphSpec = {
      nodes: minimalSpec().nodes,
      edges: [
        { from: 'START', to: 'only' },
        { from: 'only', to: 'END' },
      ],
      subgraphs: [{ name: 'sg', parentNode: 'only', builder: () => () => ({ response: 'SUB' }) }],
    }
    const compiled: any = buildFromSpec(spec, minDeps(profile()))
    const out = await compiled.invoke({ cleaned_text: 'hi' })
    expect(out.response).toBe('only:hi')
  })

  it('parentNode 为虚拟端点（START / END 及别名）时跳过（避免破坏图）', async () => {
    const spec: GraphSpec = {
      nodes: minimalSpec().nodes,
      edges: [
        { from: 'START', to: 'only' },
        { from: 'only', to: 'END' },
      ],
      subgraphs: [
        { name: 'sg1', parentNode: 'START', builder: () => () => ({ response: 'BAD1' }) },
        { name: 'sg2', parentNode: '__end__', builder: () => () => ({ response: 'BAD2' }) },
      ],
    }
    // ① 快照口径：虚拟挂载点不出现在节点集合中
    expect(describeGraphSpec(spec, profile(), minDeps(profile())).nodes).toEqual(['only'])
    // ② 执行口径：图未被破坏，仍按原拓扑产出（不做 LangGraph 内部结构断言 ——
    //    `getGraph().nodes` 恒含 __start__/__end__，无法据此判断是否被覆盖）
    const compiled: any = buildFromSpec(spec, minDeps(profile()))
    const out = await compiled.invoke({ cleaned_text: 'ok' })
    expect(out.response).toBe('only:ok')
  })

  it('多个子图声明同一 parentNode 时仅首个生效', async () => {
    const spec: GraphSpec = {
      nodes: minimalSpec().nodes,
      edges: [
        { from: 'START', to: 'only' },
        { from: 'only', to: 'sub' },
        { from: 'sub', to: 'END' },
      ],
      subgraphs: [
        { name: 'first', parentNode: 'sub', builder: () => () => ({ response: 'FIRST' }) },
        { name: 'second', parentNode: 'sub', builder: () => () => ({ response: 'SECOND' }) },
      ],
    }
    const compiled: any = buildFromSpec(spec, minDeps(profile()))
    const out = await compiled.invoke({})
    expect(out.response).toBe('FIRST')
  })

  it('builder 抛错 / 返回空值时隔离跳过（不阻断建图）', async () => {
    const spec: GraphSpec = {
      nodes: minimalSpec().nodes,
      edges: [
        { from: 'START', to: 'only' },
        { from: 'only', to: 'END' },
      ],
      subgraphs: [
        {
          name: 'boom',
          parentNode: 'bad1',
          builder: () => {
            throw new Error('builder failed')
          },
        },
        { name: 'empty', parentNode: 'bad2', builder: () => null },
      ],
    }
    const compiled: any = buildFromSpec(spec, minDeps(profile()))
    const out = await compiled.invoke({ cleaned_text: 'x' })
    expect(out.response).toBe('only:x')
    expect(compiled.getGraph().nodes['bad1']).toBeUndefined()
    expect(compiled.getGraph().nodes['bad2']).toBeUndefined()
  })

  it('when 为 false 时不挂载子图', async () => {
    const spec: GraphSpec = {
      nodes: minimalSpec().nodes,
      edges: [
        { from: 'START', to: 'only' },
        { from: 'only', to: 'END' },
      ],
      subgraphs: [
        { name: 'sg', parentNode: 'sub', builder: () => () => ({ response: 'SUB' }), when: () => false },
      ],
    }
    const compiled: any = buildFromSpec(spec, minDeps(profile()))
    const out = await compiled.invoke({ cleaned_text: 'y' })
    expect(out.response).toBe('only:y')
    expect(compiled.getGraph().nodes['sub']).toBeUndefined()
  })

  it('graph.spec.enabled=false 时忽略 registry 注册的子图（单点回滚）', async () => {
    const cfg = getConfig()
    const prev = cfg.get('graph.spec.enabled', true)
    const registry = getRegistry()
    registry.registerSubgraph({ name: 'sg', parentNode: 'sub', builder: () => () => ({ response: 'SUB' }) })
    registry.registerEdge({ from: 'only', to: 'sub' })
    registry.registerEdge({ from: 'sub', to: 'END' })

    try {
      cfg.set('graph.spec.enabled', false)
      // 子图与边均被忽略 → 图中仅 `only`，且 only 无出边（END 不可达时 LangGraph 会终止）
      const snap = describeGraphSpec(
        { nodes: minimalSpec().nodes, edges: [{ from: 'START', to: 'only' }] },
        profile(),
        minDeps(profile()),
      )
      expect(snap.nodes).toEqual(['only'])
      const compiled: any = buildFromSpec(
        { nodes: minimalSpec().nodes, edges: [{ from: 'START', to: 'only' }, { from: 'only', to: 'END' }] },
        minDeps(profile()),
      )
      const out = await compiled.invoke({ cleaned_text: 'z' })
      expect(out.response).toBe('only:z')
    } finally {
      cfg.set('graph.spec.enabled', prev)
    }
  })

  it('registerSubgraph 入参校验 + 重复注册抛错 + clearGraphSpecs 清空', () => {
    const registry = getRegistry()
    expect(() => registry.registerSubgraph({ name: '', parentNode: 'p', builder: () => ({}) })).toThrow()
    expect(() => registry.registerSubgraph({ name: 'a', parentNode: '', builder: () => ({}) })).toThrow()
    expect(() =>
      (registry as any).registerSubgraph({ name: 'a', parentNode: 'p', builder: 'not-a-fn' }),
    ).toThrow()

    registry.registerSubgraph({ name: 'a', parentNode: 'p', builder: () => ({}) })
    expect(() => registry.registerSubgraph({ name: 'a', parentNode: 'q', builder: () => ({}) })).toThrow(/already registered/)

    expect(registry.listSubgraphs().length).toBe(1)
    registry.clearGraphSpecs()
    expect(registry.listSubgraphs()).toEqual([])
  })

  it('listSubgraphs 返回副本（外部修改不污染注册表）', () => {
    const registry = getRegistry()
    registry.registerSubgraph({ name: 'a', parentNode: 'p', builder: () => ({}) })
    const list = registry.listSubgraphs()
    list.push({ name: 'b', parentNode: 'q', builder: () => ({}) })
    expect(registry.listSubgraphs().length).toBe(1)
  })
})

describe('P3/T-20: GraphProfile.extra 落地', () => {
  afterEach(() => {
    resetRegistry()
  })

  it('profileFlag：键不存在取 dflt，显式布尔值生效', () => {
    expect(profileFlag(profile(), 'x')).toBe(false)
    expect(profileFlag(profile(), 'x', true)).toBe(true)
    expect(profileFlag(profile({ extra: { x: true } }), 'x')).toBe(true)
    expect(profileFlag(profile({ extra: { x: false } }), 'x', true)).toBe(false)
  })

  it('resolveGraphProfile 从 graph.spec.extra 读取扩展开关（默认 {} → 全 false）', () => {
    const cfg = getConfig()
    const prev = cfg.get('graph.spec.extra', {})
    try {
      cfg.set('graph.spec.extra', {})
      expect(resolveGraphProfile({}).extra).toEqual({})

      cfg.set('graph.spec.extra', { my_sop: true, other: false, weird: 1 })
      expect(resolveGraphProfile({}).extra).toEqual({ my_sop: true, other: false, weird: true })
    } finally {
      cfg.set('graph.spec.extra', prev)
    }
  })

  it('显式 extra 参数优先于配置', () => {
    const cfg = getConfig()
    const prev = cfg.get('graph.spec.extra', {})
    try {
      cfg.set('graph.spec.extra', { from_config: true })
      expect(resolveGraphProfile({ extra: { from_arg: true } }).extra).toEqual({ from_arg: true })
    } finally {
      cfg.set('graph.spec.extra', prev)
    }
  })

  it('graph.spec.extra 非法值降级为 {}（数组 / 字符串 / null）', () => {
    const cfg = getConfig()
    const prev = cfg.get('graph.spec.extra', {})
    try {
      for (const bad of [[1, 2], 'nope', null, 42]) {
        cfg.set('graph.spec.extra', bad)
        expect(resolveGraphProfile({}).extra).toEqual({})
      }
    } finally {
      cfg.set('graph.spec.extra', prev)
    }
  })

  it('端到端：profileFlag 驱动宿主注册节点的 when（SOP 包扩展开关通路）', async () => {
    const cfg = getConfig()
    const prev = cfg.get('graph.spec.extra', {})
    const registry = getRegistry()
    registry.registerNode({
      name: 'extra_node',
      factory: () => () => ({ response: 'EXTRA' }),
      when: (p) => profileFlag(p, 'extra_node_enabled'),
    })
    registry.registerEdge({ from: 'only', to: 'extra_node' })
    registry.registerEdge({ from: 'extra_node', to: 'END' })

    const spec: GraphSpec = { nodes: minimalSpec().nodes, edges: [{ from: 'START', to: 'only' }] }
    try {
      cfg.set('graph.spec.extra', {})
      const off: any = buildFromSpec(spec, minDeps(resolveGraphProfile({})))
      const outOff = await off.invoke({})
      expect(outOff.response).toBe('only:')
      expect(off.getGraph().nodes['extra_node']).toBeUndefined()

      cfg.set('graph.spec.extra', { extra_node_enabled: true })
      const on: any = buildFromSpec(spec, minDeps(resolveGraphProfile({})))
      const outOn = await on.invoke({})
      expect(outOn.response).toBe('EXTRA')
    } finally {
      cfg.set('graph.spec.extra', prev)
    }
  })
})
