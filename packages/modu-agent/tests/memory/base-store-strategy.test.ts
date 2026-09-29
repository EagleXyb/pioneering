// P1（T-11）BaseStore 记忆策略测试。
//
// 核心断言：策略路径与改造前 `memory_query` / `memory_update` 的 store 直连路径
// **逐字段等价**（否则默认行为会漂移）。
import { describe, it, expect } from 'vitest'

import { BaseStoreMemoryStrategy } from '@/memory/base-store-strategy.js'
import { makeMemoryQueryNode, makeMemoryUpdateNode } from '@/graph/nodes.js'
import { ComponentRegistry } from '@/core/registry.js'
import type { MemoryStrategy } from '@/core/interfaces/memory-strategy.js'
import { registerBaseStoreMemoryStrategy } from '@/memory/memory-strategy.js'
import { HumanMessage, AIMessage } from '@langchain/core/messages'

/** 最小 BaseStore 替身：只实现 search / put，并记录调用参数。 */
class FakeStore {
  data: Array<{ ns: string[]; key: string; value: Record<string, any> }> = []
  calls: Array<{ op: string; ns: string[]; args: Record<string, any> }> = []

  async search(ns: string[], opts: { query: string; limit: number }) {
    this.calls.push({ op: 'search', ns, args: { ...opts } })
    return this.data
      .filter((d) => d.ns.join('/') === ns.join('/'))
      .map((d) => ({ key: d.key, value: d.value }))
  }

  async put(ns: string[], key: string, value: Record<string, any>) {
    this.calls.push({ op: 'put', ns, args: { key, value } })
    this.data.push({ ns, key, value })
  }
}

function makeState(overrides: Record<string, any> = {}): any {
  return {
    user_id: 'u1',
    session_id: 's1',
    cleaned_text: 'what is modu-agent',
    task_type: null,
    messages: [],
    ...overrides,
  }
}

describe('P1-T11 · BaseStoreMemoryStrategy 与 store 直连等价', () => {
  it('recall 使用 [userId, knowledge] 命名空间与 limit=5（与改造前一致）', async () => {
    const store = new FakeStore()
    store.data.push({ ns: ['u1', 'knowledge'], key: 'k1', value: { content: 'doc-1' } })

    const strategy = new BaseStoreMemoryStrategy(store)
    const items = await strategy.recall('q', { userId: 'u1' })

    expect(store.calls[0]).toEqual({
      op: 'search',
      ns: ['u1', 'knowledge'],
      args: { query: 'q', limit: 5 },
    })
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('k1')
    expect(items[0].value).toEqual({ content: 'doc-1' })
  })

  it('recall 支持 topK 覆盖', async () => {
    const store = new FakeStore()
    const strategy = new BaseStoreMemoryStrategy(store)
    await strategy.recall('q', { userId: 'u1', topK: 2 })
    expect(store.calls[0].args.limit).toBe(2)
  })

  it('recall 空 query / 空 store 返回空数组（不发调用）', async () => {
    const store = new FakeStore()
    const strategy = new BaseStoreMemoryStrategy(store)
    expect(await strategy.recall('', { userId: 'u1' })).toEqual([])
    expect(store.calls).toHaveLength(0)

    const noStore = new BaseStoreMemoryStrategy(null)
    expect(await noStore.recall('q', { userId: 'u1' })).toEqual([])
  })

  it('persist 写入 [userId, history]，payload = {content, ...metadata}', async () => {
    const store = new FakeStore()
    const strategy = new BaseStoreMemoryStrategy(store)

    await strategy.persist(
      [{ id: 's1_1700000000', content: 'user: hi\nassistant: hello', metadata: { session_id: 's1', message_count: 2, timestamp: 1700000000 } }],
      { userId: 'u1', sessionId: 's1' },
    )

    expect(store.calls[0].op).toBe('put')
    expect(store.calls[0].ns).toEqual(['u1', 'history'])
    expect(store.calls[0].args.key).toBe('s1_1700000000')
    expect(store.calls[0].args.value).toEqual({
      content: 'user: hi\nassistant: hello',
      session_id: 's1',
      message_count: 2,
      timestamp: 1700000000,
    })
  })

  it('命名空间单一来源：读写两侧共用构造参数，消除硬编码脱节', async () => {
    const store = new FakeStore()
    const strategy = new BaseStoreMemoryStrategy(store, {
      knowledgeNamespace: 'kb',
      historyNamespace: 'log',
    })

    await strategy.recall('q', { userId: 'u1' })
    await strategy.persist([{ id: 'k', content: 'c' }], { userId: 'u1' })

    expect(store.calls[0].ns).toEqual(['u1', 'kb'])
    expect(store.calls[1].ns).toEqual(['u1', 'log'])
  })

  it('supports() 为通用兜底（任意 taskType 均可用）', () => {
    const strategy = new BaseStoreMemoryStrategy(new FakeStore())
    expect(strategy.supports()).toBe(true)
    expect(strategy.supports('document_generation')).toBe(true)
  })
})

describe('P1-T11 · memory 节点与策略接线等价', () => {
  it('查询节点：策略路径与 store 直连路径产出相同 knowledge', async () => {
    const makeStore = () => {
      const s = new FakeStore()
      s.data.push({ ns: ['u1', 'knowledge'], key: 'k1', value: { content: 'doc-1' } })
      s.data.push({ ns: ['u1', 'knowledge'], key: 'k2', value: { content: 'doc-2' } })
      return s
    }

    const direct = await makeMemoryQueryNode(makeStore())(makeState())

    const strategyStore = makeStore()
    const withStrategy = await makeMemoryQueryNode(
      strategyStore,
      () => new BaseStoreMemoryStrategy(strategyStore),
    )(makeState())

    expect(withStrategy).toEqual(direct)
    expect(withStrategy.knowledge).toEqual([
      { content: 'doc-1' },
      { content: 'doc-2' },
    ])
  })

  it('更新节点：策略路径写入的 store 内容与直连路径逐字段一致', async () => {
    const state = makeState({
      messages: [new HumanMessage('hi'), new AIMessage('hello')],
      task_type: 'document_generation',
    })

    const directStore = new FakeStore()
    await makeMemoryUpdateNode(directStore)(state)

    const strategyStore = new FakeStore()
    await makeMemoryUpdateNode(
      strategyStore,
      () => new BaseStoreMemoryStrategy(strategyStore),
    )(state)

    // 跳过 key 中的时间戳比对（两次调用可能跨秒），比对字段集合与命名空间
    expect(strategyStore.calls[0].ns).toEqual(directStore.calls[0].ns)
    expect(Object.keys(strategyStore.calls[0].args.value).sort()).toEqual(
      Object.keys(directStore.calls[0].args.value).sort(),
    )
    expect(strategyStore.calls[0].args.value).toMatchObject({
      content: 'user: hi\nassistant: hello',
      session_id: 's1',
      message_count: 2,
    })
  })

  it('更新节点：store 为空但存在策略时仍可写入（策略自带后端）', async () => {
    const store = new FakeStore()
    const state = makeState({ messages: [new HumanMessage('hi')] })

    const out = await makeMemoryUpdateNode(null, () => new BaseStoreMemoryStrategy(store))(state)

    expect(out.memory_update_status).toBe('success')
    expect(store.data).toHaveLength(1)
  })

  it('更新节点：无策略且无 store 时保持 skipped_no_store', async () => {
    const out = await makeMemoryUpdateNode(null)(makeState({ messages: [new HumanMessage('hi')] }))
    expect(out.memory_update_status).toBe('skipped_no_store')
  })

  it('更新节点：无策略（解析器返回 undefined）且无 store 时同样 skipped_no_store', async () => {
    const out = await makeMemoryUpdateNode(null, () => undefined)(
      makeState({ messages: [new HumanMessage('hi')] }),
    )
    expect(out.memory_update_status).toBe('skipped_no_store')
  })
})

describe('P1-T11 复查修正 · 无 store 时仍支持宿主注册的策略', () => {
  // 缺陷：graph.ts 此前仅当 `store` 非空时才把策略解析器传给记忆节点，
  // 导致宿主注册的**非 BaseStore 后端**（如 Redis / 自研向量库）在
  // `memory.store_type='none'` 场景下被完全忽略 —— 而该配置正是宿主
  // "停用内置 store、只用自己的策略"时的自然选择。
  // 修正：graph.ts 恒使用工厂版本并传入解析器；无策略时返回值与既有
  // memoryQueryNode / memoryUpdateNode 逐字段一致（默认行为不变）。

  it('查询节点：store 为空但存在策略时经策略召回', async () => {
    const store = new FakeStore()
    const strategy = new BaseStoreMemoryStrategy(store)
    const node = makeMemoryQueryNode(null, () => strategy)

    // 空后端 → 空 knowledge（与无 store 的既有行为一致）
    expect((await node(makeState())).knowledge).toEqual([])

    // 后端有数据 → 经策略召回
    store.data.push({ ns: ['u1', 'knowledge'], key: 'k1', value: { content: 'doc-1' } })
    const out = await node(makeState())
    expect(out.knowledge).toEqual([{ content: 'doc-1' }])
  })

  it('更新节点：store 为空但存在策略时经策略写入', async () => {
    const store = new FakeStore()
    const strategy = new BaseStoreMemoryStrategy(store)
    const node = makeMemoryUpdateNode(null, () => strategy)

    const out = await node(makeState({ messages: [new HumanMessage('hi')] }))

    expect(out.memory_update_status).toBe('success')
    expect(store.data).toHaveLength(1)
    expect(store.data[0].ns).toEqual(['u1', 'history'])
  })

  it('查询节点：无策略且无 store 时返回空 knowledge（默认行为不变）', async () => {
    const out = await makeMemoryQueryNode(null, () => undefined)(makeState())
    expect(out).toEqual({ knowledge: [] })
  })
})

describe('P1-T11 · 记忆策略注册表', () => {
  it('register/get/list/resolve 基础语义', () => {
    const reg = new ComponentRegistry()
    const a: MemoryStrategy = {
      id: 'a',
      supports: (t) => t === 'document_generation',
      recall: async () => [],
      persist: async () => {},
    }
    const b: MemoryStrategy = {
      id: 'b',
      supports: () => true,
      recall: async () => [],
      persist: async () => {},
    }

    reg.registerMemoryStrategy(a)
    reg.registerMemoryStrategy(b)

    expect(reg.listMemoryStrategies()).toEqual(['a', 'b'])
    expect(reg.getMemoryStrategy('a')).toBe(a)
    // 首个注册者自动成为默认
    expect(reg.getDefaultMemoryStrategyId()).toBe('a')
    // 任务级命中优先于默认
    expect(reg.resolveMemoryStrategy('document_generation')).toBe(a)
    // 'other' 命中通用策略 b（supports 返回 true），说明任务级匹配按注册顺序短路
    expect(reg.resolveMemoryStrategy('other')).toBe(b)
    // taskType 为空时不参与任务级匹配 → 回退默认策略 a
    expect(reg.resolveMemoryStrategy()).toBe(a)
  })

  it('makeDefault 与 setDefaultMemoryStrategy 生效', () => {
    const reg = new ComponentRegistry()
    const a: MemoryStrategy = { id: 'a', supports: () => false, recall: async () => [], persist: async () => {} }
    const b: MemoryStrategy = { id: 'b', supports: () => false, recall: async () => [], persist: async () => {} }
    reg.registerMemoryStrategy(a)
    reg.registerMemoryStrategy(b, { makeDefault: true })
    expect(reg.resolveMemoryStrategy()).toBe(b)

    reg.setDefaultMemoryStrategy('a')
    expect(reg.resolveMemoryStrategy()).toBe(a)
    expect(() => reg.setDefaultMemoryStrategy('missing')).toThrow()
  })

  it('supports() 抛异常时被隔离，不影响解析结果', () => {
    const reg = new ComponentRegistry()
    const broken: MemoryStrategy = {
      id: 'broken',
      supports: () => { throw new Error('boom') },
      recall: async () => [],
      persist: async () => {},
    }
    const ok: MemoryStrategy = { id: 'ok', supports: (t) => t === 'x', recall: async () => [], persist: async () => {} }
    reg.registerMemoryStrategy(broken)
    reg.registerMemoryStrategy(ok)
    expect(reg.resolveMemoryStrategy('x')).toBe(ok)
  })

  it('registerMemoryStrategy 拒绝空 id', () => {
    const reg = new ComponentRegistry()
    expect(() => reg.registerMemoryStrategy({ id: '' } as any)).toThrow(TypeError)
  })

  it('registerBaseStoreMemoryStrategy：store 为空返回 null', () => {
    const reg = new ComponentRegistry()
    expect(registerBaseStoreMemoryStrategy(reg, null)).toBeNull()
    expect(reg.listMemoryStrategies()).toEqual([])
  })

  it('registerBaseStoreMemoryStrategy：宿主已注册同 id 时不覆盖', () => {
    const reg = new ComponentRegistry()
    const host: MemoryStrategy = { id: 'base_store', supports: () => true, recall: async () => [], persist: async () => {} }
    reg.registerMemoryStrategy(host)

    const out = registerBaseStoreMemoryStrategy(reg, new FakeStore())

    expect(reg.getMemoryStrategy('base_store')).toBe(host)
    expect(out).toBeNull() // 非同类型 → 返回 null（宿主自定义实现不视为 BaseStore 策略）
  })

  it('registerBaseStoreMemoryStrategy：正常注册并成为默认策略', () => {
    const reg = new ComponentRegistry()
    const store = new FakeStore()
    const strategy = registerBaseStoreMemoryStrategy(reg, store)

    expect(strategy).toBeInstanceOf(BaseStoreMemoryStrategy)
    expect(reg.getMemoryStrategy('base_store')).toBe(strategy)
    expect(reg.getDefaultMemoryStrategyId()).toBe('base_store')
    expect(reg.resolveMemoryStrategy(undefined)).toBe(strategy)
  })
})
