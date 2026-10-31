/**
 * checkpointer 上锁回归（第一档·止损与上锁）
 *
 * 背景：sqlite（optionalDep）缺失时，原实现静默降级 MemorySaver，导致
 * 「配置写 checkpointer_type=sqlite、实际 HITL 暂停态随重启丢失」——最难排查的一类故障。
 *
 * 修复（build_checkpointer）：SqliteSaver 不可用时
 *   - 默认（memory.allow_volatile_checkpointer=false）直接抛错，拒绝静默降级；
 *   - 仅在显式设 true 时才降级到共享内存单例，并把 mode 标记为 memory_fallback。
 *
 * 本文件用 mock 让 SqliteSaver 不可用，验证两条分支。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const SQLITE_MODULE = '@langchain/langgraph-checkpoint-sqlite'

/** 重置模块缓存，拿到干净的 factory 模块态（_sqliteSaverUnavailable 等为模块级单例） */
async function freshFactory() {
  vi.resetModules()
  return await import('@/graph/factory.js')
}

describe('checkpointer 上锁：SqliteSaver 不可用时禁止静默降级', () => {
  beforeEach(() => {
    vi.doUnmock(SQLITE_MODULE)
  })

  it('默认不允许 volatile → 抛错（不静默降级为内存）', async () => {
    // 模块导出为空对象：`const { SqliteSaver } = await import(...)` 得 undefined，
    // 触发 factory 的 SqliteSaver-not-found 分支进入 catch（与 import 抛错同一守卫）。
    vi.doMock(SQLITE_MODULE, () => ({}))
    const { build_checkpointer } = await freshFactory()
    const { getConfig } = await import('@/config/runtime-config.js')
    getConfig().set('memory.allow_volatile_checkpointer', false)

    await expect(build_checkpointer('sqlite')).rejects.toThrow(
      /volatile fallback is not allowed/,
    )
  })

  it('显式允许 volatile → 降级共享内存单例并标记 memory_fallback', async () => {
    vi.doMock(SQLITE_MODULE, () => ({}))
    const { build_checkpointer, getCheckpointerStatus, _getOrCreateSharedMemoryCheckpointer } =
      await freshFactory()
    const { getConfig } = await import('@/config/runtime-config.js')
    getConfig().set('memory.allow_volatile_checkpointer', true)

    const cp = await build_checkpointer('sqlite')
    expect(cp).toBeTruthy()
    expect(cp).toBe(await _getOrCreateSharedMemoryCheckpointer())
    expect(getCheckpointerStatus().mode).toBe('memory_fallback')
    expect(getCheckpointerStatus().sqliteAvailable).toBe(false)
    expect(getCheckpointerStatus().reason).toBeTruthy()
  })

  it('已确认不可用后再次请求仍遵守开关（不允许 volatile → 仍抛错）', async () => {
    vi.doMock(SQLITE_MODULE, () => ({}))
    const { build_checkpointer } = await freshFactory()
    const { getConfig } = await import('@/config/runtime-config.js')
    getConfig().set('memory.allow_volatile_checkpointer', false)

    // 第一次进 catch 抛错；模块态被标记为不可用，第二次走快速失败分支，同样抛错
    await expect(build_checkpointer('sqlite')).rejects.toThrow()
    await expect(build_checkpointer('sqlite')).rejects.toThrow(
      /SqliteSaver is unavailable/,
    )
  })
})
