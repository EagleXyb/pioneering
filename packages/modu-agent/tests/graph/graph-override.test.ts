// graph-override.test.ts
//
// P3-D：NodeSpec 受控覆盖 + 边裁剪 测试。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  buildFromSpec,
  type GraphProfile,
  type GraphSpec,
  type ModuGraphDeps,
} from '@/graph/spec.js'
import {
  getRegistry,
  resetRegistry,
} from '@/core/registry.js'
import { getConfig, resetConfig } from '@/config/runtime-config.js'
import { resetSopRegistry } from '@/orchestration/sop-registry.js'

/** 最小合法画像。 */
const profile: GraphProfile = {
  hitlEnabled: false,
  multiAgentEnabled: false,
  planExecuteEnabled: false,
  clarifyEnabled: false,
  complexityAssessmentEnabled: false,
  observationDistillationEnabled: false,
  outputGuardEnabled: false,
  feedbackEnabled: false,
  fewShotEnabled: false,
}

const deps = {
  profile,
  runtimeConfig: getConfig(),
  tools: [],
  llm: {},
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
} as unknown as ModuGraphDeps

beforeEach(() => {
  resetRegistry()
  resetConfig()
  resetSopRegistry()
})

afterEach(() => {
  resetRegistry()
  resetConfig()
  resetSopRegistry()
})

describe('P3-D Node/Edge 受控覆盖', () => {
  it('override=true：同名扩展节点替换内置节点（工厂被执行）', () => {
    let builtinFactoryCalls = 0
    let overrideFactoryCalls = 0

    const spec: GraphSpec = {
      nodes: [
        { name: 'a', factory: () => { builtinFactoryCalls++; return async () => ({}) } },
        { name: 'b', factory: () => async () => ({}) },
      ],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'END' },
      ],
    }

    buildFromSpec(spec, deps)
    expect(builtinFactoryCalls).toBe(1)

    getRegistry().registerNode({
      name: 'a',
      override: true,
      factory: () => { overrideFactoryCalls++; return async () => ({}) },
    })

    buildFromSpec(spec, deps)
    expect(overrideFactoryCalls).toBe(1)
    expect(builtinFactoryCalls).toBe(1) // 内置工厂第二次不再执行
  })

  it('override 缺省：同名扩展跳过（内置优先）', () => {
    let builtinFactoryCalls = 0
    let extensionFactoryCalls = 0

    const spec: GraphSpec = {
      nodes: [
        { name: 'a', factory: () => { builtinFactoryCalls++; return async () => ({}) } },
      ],
      edges: [{ from: 'START', to: 'a' }, { from: 'a', to: 'END' }],
    }
    buildFromSpec(spec, deps)

    getRegistry().registerNode({
      name: 'a',
      factory: () => { extensionFactoryCalls++; return async () => ({}) },
    })
    buildFromSpec(spec, deps)

    expect(builtinFactoryCalls).toBe(2)
    expect(extensionFactoryCalls).toBe(0)
  })

  it('边裁剪：移除 a→b 后该边不参与构建（编译期可证）', async () => {
    const spec: GraphSpec = {
      nodes: [
        { name: 'a', factory: () => async () => ({}) },
        { name: 'b', factory: () => async () => ({}) },
      ],
      edges: [
        { from: 'START', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'b', to: 'END' },
      ],
    }

    // 对照：无裁剪时编译成功
    expect(() => buildFromSpec(spec, deps)).not.toThrow()

    getRegistry().registerEdgeRemoval({ from: 'a', to: 'b' })
    // a→b 被裁剪 → b 不可达 → LangGraph 编译直接报错（边确实未参与构建）
    expect(() => buildFromSpec(spec, deps)).toThrow(/not reachable/)
  })
})
