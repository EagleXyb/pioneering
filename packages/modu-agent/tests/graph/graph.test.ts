import { describe, it, expect } from 'vitest'
import { ModuGraph, type ModuGraphInterface } from '@/graph/graph.js'

/**
 * P9.1.4: ModuGraph 类型安全与 Proxy 委托正确性测试。
 *
 * 不依赖真实 LangGraph 编译图，使用满足核心接口的 mock 对象验证：
 *   - ModuGraphInterface 方法签名能正确委托到底层编译图
 *   - 自身属性（orchestrator / compiled）优先于 Proxy 委托
 *   - recursionLimit 透传与 setter 行为
 *   - stream / astream / invoke / getState / updateState 委托
 *   - checkpointer 透传
 */

/** 构造一个满足 CompiledStateGraph 最小契约的 mock 对象。 */
function createMockCompiled(overrides: Record<string, any> = {}) {
  const streamCalls: Array<{ input: any; config: any }> = []
  const invokeCalls: Array<{ input: any; config: any }> = []
  const getStateCalls: Array<{ config: any; options: any }> = []
  const updateStateCalls: Array<{ input: any; config: any; asNode?: string }> = []

  const compiled = {
    recursionLimit: 42,
    checkpointer: { name: 'mock-checkpointer', async getTuple() { return null } },
    async stream(input: any, config?: any) {
      streamCalls.push({ input, config })
      async function* gen() {
        yield { type: 'values', data: { ok: true } }
      }
      return gen()
    },
    async astream(input: any, config?: any) {
      return compiled.stream(input, config)
    },
    async invoke(input: any, config?: any) {
      invokeCalls.push({ input, config })
      return { ok: true, input }
    },
    async getState(config?: any, options?: any) {
      getStateCalls.push({ config, options })
      return { next: ['human_review'], values: {}, metadata: { created_at: Date.now() } }
    },
    async updateState(input: any, config?: any, asNode?: string) {
      updateStateCalls.push({ input, config, asNode })
    },
    ...overrides,
  }
  return { compiled, streamCalls, invokeCalls, getStateCalls, updateStateCalls }
}

describe('ModuGraph (P9.1.4 类型安全)', () => {
  it('implements ModuGraphInterface（编译期检查通过）', () => {
    const { compiled } = createMockCompiled()
    const graph: ModuGraphInterface = new ModuGraph(compiled, null)
    // 此处编译期已校验 ModuGraph 可赋值给 ModuGraphInterface
    expect(graph).toBeInstanceOf(ModuGraph)
  })

  it('orchestrator 作为自身属性优先返回，不委托给底层', () => {
    const orch = { name: 'mock-orchestrator' }
    const { compiled } = createMockCompiled()
    const graph = new ModuGraph(compiled, orch)
    expect(graph.orchestrator).toBe(orch)
  })

  it('compiled getter 返回底层编译图实例', () => {
    const { compiled } = createMockCompiled()
    const graph = new ModuGraph(compiled, null)
    expect(graph.compiled).toBe(compiled)
  })

  it('checkpointer 透传自底层编译图', () => {
    const { compiled } = createMockCompiled()
    const graph = new ModuGraph(compiled, null)
    expect(graph.checkpointer).toBe(compiled.checkpointer)
  })

  it('recursionLimit getter 透传自底层编译图', () => {
    const { compiled } = createMockCompiled({ recursionLimit: 100 })
    const graph = new ModuGraph(compiled, null)
    expect(graph.recursionLimit).toBe(100)
  })

  it('recursionLimit setter 写入底层编译图', () => {
    const { compiled } = createMockCompiled()
    const graph = new ModuGraph(compiled, null)
    graph.recursionLimit = 200
    expect(compiled.recursionLimit).toBe(200)
    expect(graph.recursionLimit).toBe(200)
  })

  it('stream() 委托到底层并绑定 this', async () => {
    const { compiled, streamCalls } = createMockCompiled()
    const graph = new ModuGraph(compiled, null)
    const input = { prompt: 'hello' }
    const config = { configurable: { thread_id: 's1' } }
    const stream = await graph.stream(input, config)
    const events: any[] = []
    for await (const ev of stream) events.push(ev)
    expect(streamCalls).toHaveLength(1)
    expect(streamCalls[0].input).toBe(input)
    expect(streamCalls[0].config).toBe(config)
    expect(events).toEqual([{ type: 'values', data: { ok: true } }])
  })

  it('astream() 委托到底层 stream', async () => {
    const { compiled } = createMockCompiled()
    const graph = new ModuGraph(compiled, null)
    const stream = await graph.astream({ prompt: 'hi' })
    const events: any[] = []
    for await (const ev of stream) events.push(ev)
    expect(events).toHaveLength(1)
  })

  it('invoke() 委托到底层并返回结果', async () => {
    const { compiled, invokeCalls } = createMockCompiled()
    const graph = new ModuGraph(compiled, null)
    const result = await graph.invoke({ prompt: 'q' }, { configurable: { thread_id: 's2' } })
    expect(invokeCalls).toHaveLength(1)
    expect(result).toEqual({ ok: true, input: { prompt: 'q' } })
  })

  it('getState() 委托到底层并返回 StateSnapshot', async () => {
    const { compiled, getStateCalls } = createMockCompiled()
    const graph = new ModuGraph(compiled, null)
    const config = { configurable: { thread_id: 's1' } }
    const state = await graph.getState(config)
    expect(getStateCalls).toHaveLength(1)
    expect(getStateCalls[0].config).toBe(config)
    expect(state.next).toEqual(['human_review'])
  })

  it('updateState() 委托到底层并传递 asNode', async () => {
    const { compiled, updateStateCalls } = createMockCompiled()
    const graph = new ModuGraph(compiled, null)
    const config = { configurable: { thread_id: 's1' } }
    await graph.updateState({ x: 1 }, config, 'agent')
    expect(updateStateCalls).toHaveLength(1)
    expect(updateStateCalls[0].input).toEqual({ x: 1 })
    expect(updateStateCalls[0].asNode).toBe('agent')
  })

  it('Proxy has trap 同时检查自身与底层编译图', () => {
    const { compiled } = createMockCompiled()
    const graph = new ModuGraph(compiled, null)
    // 自身属性
    expect('orchestrator' in graph).toBe(true)
    expect('compiled' in graph).toBe(true)
    expect('stream' in graph).toBe(true)
    // 底层属性（未在自身定义的）通过 Proxy 委托
    expect('checkpointer' in graph).toBe(true)
    expect('recursionLimit' in graph).toBe(true)
  })

  it('未在接口中声明的底层属性仍可通过 Proxy 访问（向后兼容）', () => {
    const { compiled } = createMockCompiled({ customField: 'hello' })
    const graph = new ModuGraph(compiled, null)
    // customField 不在 ModuGraphInterface，但 Proxy 仍透传
    expect((graph as any).customField).toBe('hello')
  })

  it('底层方法被正确绑定 this（不丢失上下文）', async () => {
    let thisInStream: any = null
    const compiledObj = {
      recursionLimit: 10,
      _self: null as any,
      async stream(this: any, input: any) {
        thisInStream = this
        async function* gen() { yield {} }
        return gen()
      },
    }
    compiledObj._self = compiledObj
    const graph = new ModuGraph(compiledObj as any, null)
    await graph.stream({})
    // stream 调用时 this 应绑定到底层 compiled 而非 ModuGraph 实例
    expect(thisInStream).toBe(compiledObj)
  })
})
