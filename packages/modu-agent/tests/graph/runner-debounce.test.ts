import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  reset_runner_cache,
  _flushDebouncedResetForTest,
  _resetDebounceStateForTest,
  _triggerConfigChangeForTest,
} from '@/graph/runner.js'

/**
 * P9.5.1: 图重建去抖 + LLM 参数软失效测试。
 *
 * 通过 `_triggerConfigChangeForTest` 直接调用配置变更回调，绕过 RuntimeConfig
 * 回调注册机制（避免与全局 `_configCallbackRegistered` 标志相互干扰）。
 *
 * 注：logger 使用 `console.info(formatStr, ...args)` 形式调用，format string 中的
 * `%d` / `%s` 占位符由 Node.js util.format 在内部替换，spy 捕获的是原始未格式化的
 * args。因此测试匹配 format string 而非替换后的字符串，并单独检查 args 数组。
 */

/** 在 spy.mock.calls 中查找首个 format string 匹配的 call。 */
function findLogCall(
  calls: any[][],
  formatSubstr: string,
): { formatStr: string; args: any[] } | undefined {
  for (const call of calls) {
    if (typeof call[0] === 'string' && call[0].includes(formatSubstr)) {
      return { formatStr: call[0], args: call.slice(1) }
    }
  }
  return undefined
}

/** 统计匹配 format string 的 call 数量。 */
function countLogCalls(calls: any[][], formatSubstr: string): number {
  return calls.filter(
    (call) => typeof call[0] === 'string' && call[0].includes(formatSubstr),
  ).length
}

describe('P9.5.1 图重建去抖', () => {
  beforeEach(() => {
    _resetDebounceStateForTest()
    reset_runner_cache()
  })

  it('单次非 LLM 配置变更触发缓存重置', () => {
    const setSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    _triggerConfigChangeForTest('tools.calculator.enabled', false, true)
    _flushDebouncedResetForTest()

    // 验证：日志含 "Debounced cache reset triggered by"，args[0]=1（变更数）
    const resetLog = findLogCall(setSpy.mock.calls, 'Debounced cache reset triggered by')
    expect(resetLog).toBeDefined()
    expect(resetLog!.args[0]).toBe(1)
    setSpy.mockRestore()
  })

  it('连续多次非 LLM 配置变更合并为一次重置', () => {
    const setSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    _triggerConfigChangeForTest('tools.calculator.enabled', false, true)
    _triggerConfigChangeForTest('tools.search.enabled', false, true)
    _triggerConfigChangeForTest('memory.short_term.max_messages', 10, 20)
    _triggerConfigChangeForTest('orchestration.multi_agent.enabled', true, false)
    _triggerConfigChangeForTest('plan_execute.enabled', true, false)

    _flushDebouncedResetForTest()
    _flushDebouncedResetForTest()  // 二次 flush 应无副作用

    // 验证 "Debounced cache reset triggered by" 仅出现一次，args[0]=5
    const resetCount = countLogCalls(setSpy.mock.calls, 'Debounced cache reset triggered by')
    expect(resetCount).toBe(1)
    const resetLog = findLogCall(setSpy.mock.calls, 'Debounced cache reset triggered by')
    expect(resetLog!.args[0]).toBe(5)
    setSpy.mockRestore()
  })

  it('LLM 参数软失效不触发缓存重置', () => {
    const setSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    _triggerConfigChangeForTest('llm.temperature', 0.7, 0.5)
    _triggerConfigChangeForTest('llm.max_tokens', 4096, 8192)
    _triggerConfigChangeForTest('llm.max_reasoning_iterations', 3, 5)

    _flushDebouncedResetForTest()

    // 验证 "Skipping runner cache reset" 出现
    const skipLog = findLogCall(setSpy.mock.calls, 'Skipping runner cache reset')
    expect(skipLog).toBeDefined()
    expect(skipLog!.args[0]).toBe(3)  // 3 个变更
    // 验证未触发 "Debounced cache reset triggered by"
    const resetCount = countLogCalls(setSpy.mock.calls, 'Debounced cache reset triggered by')
    expect(resetCount).toBe(0)
    setSpy.mockRestore()
  })

  it('混合场景：LLM 参数 + 非 LLM 参数仍触发重置', () => {
    const setSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    _triggerConfigChangeForTest('llm.temperature', 0.7, 0.5)
    _triggerConfigChangeForTest('tools.calculator.enabled', true, false)

    _flushDebouncedResetForTest()

    // 验证触发重置，args[0]=2（变更数）
    const resetLog = findLogCall(setSpy.mock.calls, 'Debounced cache reset triggered by')
    expect(resetLog).toBeDefined()
    expect(resetLog!.args[0]).toBe(2)
    setSpy.mockRestore()
  })

  it('未匹配 _GRAPH_REBUILD_PREFIXES 的 key 不进入 debounce 队列', () => {
    const setSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    // observability.* 不在 _GRAPH_REBUILD_PREFIXES 中
    _triggerConfigChangeForTest('observability.tracing.enabled', false, true)

    _flushDebouncedResetForTest()

    // 验证未触发任何 cache reset 日志
    const resetCount = countLogCalls(setSpy.mock.calls, 'Debounced cache reset triggered')
    expect(resetCount).toBe(0)
    // 也未触发 "queued for debounced"（因为未匹配前缀）
    const queueCount = countLogCalls(setSpy.mock.calls, 'queued for debounced')
    expect(queueCount).toBe(0)
    setSpy.mockRestore()
  })

  it('debounce 定时器在首次变更时创建，后续变更复用', () => {
    const setSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    // 首次变更：format string + keyPath + pending_count(=1)
    _triggerConfigChangeForTest('tools.calculator.enabled', false, true)
    const firstPending = findLogCall(setSpy.mock.calls, 'queued for debounced')
    expect(firstPending).toBeDefined()
    expect(firstPending!.args[1]).toBe(1)  // args=[keyPath, pending_count]，pending=1

    // 第二次变更（应复用 timer，pending=2）
    _triggerConfigChangeForTest('tools.search.enabled', false, true)
    const secondPending = setSpy.mock.calls.find(
      (call) => typeof call[0] === 'string' &&
        call[0].includes('queued for debounced') &&
        call[2] === 2,  // args=[keyPath, pending_count]，pending=2
    )
    expect(secondPending).toBeDefined()

    _flushDebouncedResetForTest()
    setSpy.mockRestore()
  })

  it('多次独立 debounce 窗口各自独立', () => {
    const setSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    // 第一轮
    _triggerConfigChangeForTest('tools.calculator.enabled', false, true)
    _flushDebouncedResetForTest()
    const firstCount = countLogCalls(setSpy.mock.calls, 'Debounced cache reset triggered by')
    expect(firstCount).toBe(1)

    // 第二轮（应再次触发）
    _triggerConfigChangeForTest('tools.search.enabled', false, true)
    _flushDebouncedResetForTest()
    const secondCount = countLogCalls(setSpy.mock.calls, 'Debounced cache reset triggered by')
    expect(secondCount).toBe(2)  // 累计两次独立重置

    setSpy.mockRestore()
  })
})
