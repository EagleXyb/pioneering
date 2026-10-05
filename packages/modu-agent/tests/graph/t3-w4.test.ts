import { describe, it, expect } from 'vitest'
import { AGUIEventType, AGUI_EVENT_TYPE_COUNT } from '@/orchestration/communication/agui-adapter.js'
import { DEFAULT_AGENT_CONTEXT_FRAGMENTS } from '@/graph/context-strategies.js'
import { DEFAULT_CONFIG } from '@/config/runtime-config.js'
import { getRegistry, resetRegistry } from '@/core/registry.js'
import { makeMemoryUpdateNode } from '@/graph/nodes.js'
import { HumanMessage, AIMessage } from '@langchain/core/messages'

describe('T4 agui 事件数派生常量', () => {
  it('派生常量与对象长度一致（24 种）', () => {
    expect(AGUI_EVENT_TYPE_COUNT).toBe(Object.keys(AGUIEventType).length)
    expect(AGUI_EVENT_TYPE_COUNT).toBe(24)
  })
})

describe('T4-1 ContextStrategy 片段数', () => {
  it('实际片段数与文件注释一致（6 段）', () => {
    expect(DEFAULT_AGENT_CONTEXT_FRAGMENTS.length).toBe(6)
  })
})

describe('T4 memory.max_persist_chars 配置键', () => {
  it('已声明且默认为 8000', () => {
    expect((DEFAULT_CONFIG as any).memory.max_persist_chars).toBe(8000)
  })
})

describe('T3-6 memory_update 增量写入', () => {
  const mkStore = () => {
    const puts: any[] = []
    return {
      puts,
      store: {
        put: async (ns: any, key: string, val: any) => { puts.push({ ns, key, val }) },
      } as any,
    }
  }

  it('第二轮只写入新增消息（不再重写全量 history）', async () => {
    resetRegistry()
    const { puts, store } = mkStore()
    const node = makeMemoryUpdateNode(store, null)
    const m1 = new HumanMessage('第一个问题')
    const a1 = new AIMessage('第一个回答')
    const r1: any = await node({
      messages: [m1, a1], user_id: 'u', session_id: 's',
    } as any)
    expect(r1.memory_update_status).toBe('success')
    expect(r1.memory_persisted_count).toBe(2)
    expect(puts[0].val.content).toContain('第一个问题')

    const m2 = new HumanMessage('第二个问题')
    const a2 = new AIMessage('第二个回答')
    const r2: any = await node({
      messages: [m1, a1, m2, a2], user_id: 'u', session_id: 's',
      memory_persisted_count: r1.memory_persisted_count,
    } as any)
    expect(r2.memory_update_status).toBe('success')
    expect(puts.length).toBe(2)
    // 关键断言：第二条记录只含新增内容，不含第一轮内容
    expect(puts[1].val.content).toContain('第二个问题')
    expect(puts[1].val.content).not.toContain('第一个问题')
    expect(puts[1].val.message_count).toBe(2)
    expect(r2.memory_persisted_count).toBe(4)
  })

  it('无新增消息时跳过写入', async () => {
    resetRegistry()
    const { puts, store } = mkStore()
    const node = makeMemoryUpdateNode(store, null)
    const r: any = await node({
      messages: [new HumanMessage('x'), new AIMessage('y')],
      user_id: 'u', session_id: 's', memory_persisted_count: 2,
    } as any)
    expect(r.memory_update_status).toBe('skipped_no_new_messages')
    expect(puts.length).toBe(0)
  })

  it('游标越界时安全回退为全量（不静默丢数据）', async () => {
    resetRegistry()
    const { puts, store } = mkStore()
    const node = makeMemoryUpdateNode(store, null)
    const r: any = await node({
      messages: [new HumanMessage('a'), new AIMessage('b')],
      user_id: 'u', session_id: 's', memory_persisted_count: 99,
    } as any)
    expect(r.memory_update_status).toBe('success')
    expect(puts[0].val.content).toContain('a')
    expect(r.memory_persisted_count).toBe(2)
  })

  it('超长内容被截断并标记', async () => {
    resetRegistry()
    const { puts, store } = mkStore()
    const node = makeMemoryUpdateNode(store, null)
    const long = 'x'.repeat(20000)
    await node({
      messages: [new HumanMessage(long)], user_id: 'u', session_id: 's',
    } as any)
    expect(puts[0].val.content.length).toBe(8000)
    expect(puts[0].val.truncated).toBe(true)
  })

  it('同轮多次写入的 key 不冲突', async () => {
    resetRegistry()
    const { puts, store } = mkStore()
    const node = makeMemoryUpdateNode(store, null)
    const msgs = [new HumanMessage('m1'), new AIMessage('m2')]
    const r1: any = await node({ messages: msgs, user_id: 'u', session_id: 's' } as any)
    const m3 = new AIMessage('m3')
    const r2: any = await node({
      messages: [...msgs, m3], user_id: 'u', session_id: 's',
      memory_persisted_count: r1.memory_persisted_count,
    } as any)
    expect(puts[0].key).not.toBe(puts[1].key)
    expect(r2.memory_persisted_count).toBe(3)
  })
})
