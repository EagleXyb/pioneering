// P1-7：BoundedMemorySaver LRU 淘汰回归。
import { describe, it, expect } from 'vitest'

import { BoundedMemorySaver } from '@/graph/bounded-memory-saver.js'

function cfg(threadId: string, checkpointId = 'cp-1'): {
  configurable: { thread_id: string; checkpoint_id: string }
} {
  return { configurable: { thread_id: threadId, checkpoint_id: checkpointId } }
}

/** 读取配置（不带 checkpoint_id → getTuple 取该 thread 最新检查点）。 */
function readCfg(threadId: string): { configurable: { thread_id: string } } {
  return { configurable: { thread_id: threadId } }
}

/** 最小合法 Checkpoint 结构（仅满足 MemorySaver.put 的序列化需要）。 */
function minimalCheckpoint(id: string): any {
  return {
    id,
    channel_values: {},
    channel_versions: { __start__: 0 },
    versions_seen: {},
    pending_sends: [],
  }
}

describe('P1-7 · BoundedMemorySaver LRU 有界淘汰', () => {
  it('构造参数非法时抛 TypeError', () => {
    expect(() => new BoundedMemorySaver(0)).toThrow(TypeError)
    expect(() => new BoundedMemorySaver(-1)).toThrow(TypeError)
    expect(() => new BoundedMemorySaver(Number.NaN)).toThrow(TypeError)
    expect(new BoundedMemorySaver(2).maxThreads).toBe(2)
  })

  it('thread 数超阈值时淘汰最久未用 thread（putWrites 路径）', async () => {
    const saver = new BoundedMemorySaver(2)

    await saver.putWrites(cfg('t1'), [['ch', { v: 1 }]], 'task-a')
    await saver.putWrites(cfg('t2'), [['ch', { v: 2 }]], 'task-b')
    await saver.putWrites(cfg('t3'), [['ch', { v: 3 }]], 'task-c')

    expect(saver.threadCount).toBe(2)
    // writes 复合键按 thread 段清除：t1 清空、t3 保留
    const writeKeys = Object.keys((saver as any).writes)
    expect(writeKeys.some((k) => k.startsWith('["t1",'))).toBe(false)
    expect(writeKeys.some((k) => k.startsWith('["t3",'))).toBe(true)
  })

  it('put 路径同样淘汰，且被淘汰 thread 的 storage 被清除', async () => {
    const saver = new BoundedMemorySaver(2)

    await saver.put(cfg('t1'), minimalCheckpoint('c1'), { source: 'input', step: 0, writes: {} } as any)
    await saver.put(cfg('t2'), minimalCheckpoint('c1'), { source: 'input', step: 0, writes: {} } as any)
    await saver.put(cfg('t3'), minimalCheckpoint('c1'), { source: 'input', step: 0, writes: {} } as any)

    expect((saver as any).storage['t1']).toBeUndefined()
    expect((saver as any).storage['t3']).toBeDefined()
  })

  it('LRU 访问序：旧 thread 被 getTuple 触碰后不再最先淘汰', async () => {
    const saver = new BoundedMemorySaver(2)

    await saver.put(cfg('t1'), minimalCheckpoint('c1'), { source: 'input', step: 0, writes: {} } as any)
    await saver.put(cfg('t2'), minimalCheckpoint('c1'), { source: 'input', step: 0, writes: {} } as any)
    // t1 被读取 → 刷新为最近；t3 进入时应淘汰 t2 而非 t1
    expect(await saver.getTuple(readCfg('t1'))).toBeDefined()
    await saver.putWrites(cfg('t3'), [['ch', 1]], 'task')

    expect(saver.threadCount).toBe(2)
    expect((saver as any).storage['t2']).toBeUndefined()
    expect((saver as any).storage['t1']).toBeDefined()
    // t3 仅经过 putWrites（无 checkpoint put），在 writes 复合键中可查
    expect(Object.keys((saver as any).writes).some((k: string) => k.startsWith('["t3",'))).toBe(true)
    // t2 的 writes 随淘汰一并清除
    expect(Object.keys((saver as any).writes).some((k: string) => k.startsWith('["t2",'))).toBe(false)
  })

  it('被淘汰 thread resume 呈冷启动语义（getTuple 返回 undefined），最新 thread 存活', async () => {
    const saver = new BoundedMemorySaver(1)
    await saver.put(cfg('keep'), minimalCheckpoint('c1'), { source: 'input', step: 0, writes: {} } as any)
    await saver.put(cfg('survive'), minimalCheckpoint('c1'), { source: 'input', step: 0, writes: {} } as any)

    // max=1：先入的 keep 被淘汰，后入的 survive 可取回
    expect(await saver.getTuple(readCfg('keep'))).toBeUndefined()
    expect(await saver.getTuple(readCfg('survive'))).toBeDefined()
    expect(saver.threadCount).toBe(1)
  })
})
