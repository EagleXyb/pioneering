/**
 * checkpointer 共享单例回归（2026-10-14）
 *
 * 缺陷：build_checkpointer 的 sqlite 降级路径 `return new MemorySaver()`
 * 每次调用都新建实例。plan_execute 请求图与 GET /agent/state（recover）/
 * resume 的图因 configurable 差异各自重建（get_runner 缓存 hash 不同），
 * checkpoint 数据互不可见，表现为：
 *   - recover 得到 pending=false → 前端"[已失效] 待确认的操作已失效"；
 *   - resume 找不到 interrupt，暂停任务永远无法继续。
 *
 * 修复：降级路径与 memory 路径共用 _getOrCreateSharedMemoryCheckpointer() 单例。
 */
import { describe, it, expect } from 'vitest'

import {
  build_checkpointer,
  _getOrCreateSharedMemoryCheckpointer,
} from '@/graph/factory.js'

describe('checkpointer 共享单例（HITL 暂停态跨图实例可见）', () => {
  it('惰性单例：多次获取为同一实例', async () => {
    const a = await _getOrCreateSharedMemoryCheckpointer()
    const b = await _getOrCreateSharedMemoryCheckpointer()
    expect(a).toBeTruthy()
    expect(a).toBe(b)
  })

  it('memory 类型复用共享单例', async () => {
    const shared = await _getOrCreateSharedMemoryCheckpointer()
    expect(await build_checkpointer('memory')).toBe(shared)
  })

  it('sqlite 不可用时降级到共享单例（不再每次新建）', async () => {
    let sqliteAvailable = true
    try {
      await import('@langchain/langgraph-checkpoint-sqlite')
    } catch {
      sqliteAvailable = false
    }

    const cp1 = await build_checkpointer('sqlite')
    const cp2 = await build_checkpointer('sqlite')
    expect(cp1).toBeTruthy()

    if (!sqliteAvailable) {
      // 降级路径：必须复用共享单例（原实现每次 new MemorySaver() → 暂停态丢失）
      const shared = await _getOrCreateSharedMemoryCheckpointer()
      expect(cp1).toBe(shared)
      expect(cp2).toBe(shared)
    }
  })

  it('none 类型返回 null（不构建实例）', async () => {
    expect(await build_checkpointer('none')).toBeNull()
  })
})
