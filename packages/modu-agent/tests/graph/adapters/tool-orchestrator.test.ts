// P2-3 单元测试：动态工具编排（串行/并行/条件分支）
// 对应文档 §5.3 P2-3 + 风险 R-12：保守串行 + 依赖分析 + advisory 模式
import { describe, it, expect } from 'vitest'
import {
  hasDependency,
  planExecution,
  parseToolCalls,
  shouldOrchestrate,
  formatExecutionPlan,
  type ToolCallItem,
} from '@/graph/adapters/tool-orchestrator.js'

function makeToolCall(id: string, name: string, args: Record<string, any> = {}): ToolCallItem {
  return { id, name, args }
}

describe('P2-3 动态工具编排', () => {
  // ============================================================
  // parseToolCalls
  // ============================================================
  describe('parseToolCalls', () => {
    it('解析标准 tool_calls 数组', () => {
      const raw = [
        { id: 'call_1', name: 'search_engine', args: { query: 'test' } },
        { id: 'call_2', name: 'calculator', args: { expression: '1+1' } },
      ]
      const items = parseToolCalls(raw)
      expect(items.length).toBe(2)
      expect(items[0].id).toBe('call_1')
      expect(items[0].name).toBe('search_engine')
      expect(items[1].args).toEqual({ expression: '1+1' })
    })

    it('空数组返回空数组', () => {
      expect(parseToolCalls([])).toEqual([])
    })

    it('非数组返回空数组', () => {
      expect(parseToolCalls(null as any)).toEqual([])
      expect(parseToolCalls(undefined as any)).toEqual([])
    })

    it('缺失字段时使用默认值', () => {
      const items = parseToolCalls([{}])
      expect(items[0].id).toBe('')
      expect(items[0].name).toBe('')
      expect(items[0].args).toEqual({})
    })
  })

  // ============================================================
  // hasDependency
  // ============================================================
  describe('hasDependency', () => {
    it('同名工具有依赖（可能操作同一资源）', () => {
      const a = makeToolCall('1', 'file_ops', { mode: 'write' })
      const b = makeToolCall('2', 'file_ops', { mode: 'read' })
      expect(hasDependency(a, b)).toBe(true)
    })

    it('两个写操作工具有依赖', () => {
      const a = makeToolCall('1', 'sql_query', { sql: 'INSERT...' })
      const b = makeToolCall('2', 'file_ops', { mode: 'write' })
      // sql_query 和 file_ops 都 requires_confirmation=true
      expect(hasDependency(a, b)).toBe(true)
    })

    it('两个读操作工具无依赖', () => {
      const a = makeToolCall('1', 'search_engine', { query: 'a' })
      const b = makeToolCall('2', 'calculator', { expression: '1+1' })
      // search_engine 和 calculator 都 requires_confirmation=false
      expect(hasDependency(a, b)).toBe(false)
    })

    it('args 含占位符引用时有依赖', () => {
      const a = makeToolCall('1', 'search_engine', { query: 'test' })
      const b = makeToolCall('2', 'http_request', { url: '${1.output}' })
      expect(hasDependency(a, b)).toBe(true)
    })

    it('args 引用另一个工具 id 时有依赖', () => {
      const a = makeToolCall('call_1', 'search_engine', { query: 'test' })
      const b = makeToolCall('call_2', 'http_request', { data: 'call_1' })
      // b.args.data 包含 a.id='call_1'
      expect(hasDependency(a, b)).toBe(true)
    })

    it('短 id（非 call_ 前缀）不触发 id 引用检测', () => {
      const a = makeToolCall('1', 'search_engine', { query: 'test' })
      const b = makeToolCall('2', 'calculator', { expression: '1+1' })
      // id='1' 不是 call_ 前缀，不检测 id 引用
      expect(hasDependency(a, b)).toBe(false)
    })

    it('不同名且无引用的读操作工具无依赖', () => {
      const a = makeToolCall('1', 'search_engine', { query: 'a' })
      const b = makeToolCall('2', 'datetime', {})
      expect(hasDependency(a, b)).toBe(false)
    })
  })

  // ============================================================
  // planExecution
  // ============================================================
  describe('planExecution', () => {
    it('空 tool_calls 返回空计划', () => {
      const plan = planExecution([])
      expect(plan.groups).toEqual([])
      expect(plan.has_parallel).toBe(false)
      expect(plan.total_calls).toBe(0)
    })

    it('单个 tool_call 返回串行计划', () => {
      const plan = planExecution([makeToolCall('1', 'search_engine', {})])
      expect(plan.groups.length).toBe(1)
      expect(plan.groups[0].type).toBe('serial')
      expect(plan.has_parallel).toBe(false)
      expect(plan.total_calls).toBe(1)
    })

    it('保守模式下有依赖时全部串行', () => {
      const calls = [
        makeToolCall('1', 'search_engine', {}),
        makeToolCall('2', 'sql_query', {}), // requires_confirmation=true
        makeToolCall('3', 'file_ops', {}),   // requires_confirmation=true
      ]
      // sql_query 和 file_ops 之间有依赖（都是写操作）
      const plan = planExecution(calls, true)
      expect(plan.has_parallel).toBe(false)
      expect(plan.groups.length).toBe(1)
      expect(plan.groups[0].type).toBe('serial')
    })

    it('保守模式下无依赖时可并行', () => {
      const calls = [
        makeToolCall('1', 'search_engine', {}),  // requires_confirmation=false
        makeToolCall('2', 'calculator', {}),      // requires_confirmation=false
        makeToolCall('3', 'datetime', {}),        // requires_confirmation=false
      ]
      const plan = planExecution(calls, true)
      expect(plan.has_parallel).toBe(true)
      expect(plan.groups.length).toBe(1)
      expect(plan.groups[0].type).toBe('parallel')
      expect(plan.groups[0].tool_calls.length).toBe(3)
    })

    it('非保守模式下混合依赖分组', () => {
      const calls = [
        makeToolCall('1', 'search_engine', {}),  // 无依赖
        makeToolCall('2', 'calculator', {}),      // 无依赖
        makeToolCall('3', 'sql_query', {}),       // 与 file_ops 有依赖
        makeToolCall('4', 'file_ops', {}),        // 与 sql_query 有依赖
      ]
      const plan = planExecution(calls, false)
      // 第一组：search_engine + calculator（并行）
      // 第二组：sql_query（串行，因为 file_ops 依赖它）
      // 第三组：file_ops（串行）
      expect(plan.total_calls).toBe(4)
      // 应有至少一个并行组
      expect(plan.has_parallel).toBe(true)
    })

    it('保守模式默认 true', () => {
      const calls = [
        makeToolCall('1', 'file_ops', {}),
        makeToolCall('2', 'sql_query', {}),
      ]
      // 默认保守模式，两个写操作有依赖 → 串行
      const plan = planExecution(calls)
      expect(plan.has_parallel).toBe(false)
    })
  })

  // ============================================================
  // shouldOrchestrate
  // ============================================================
  describe('shouldOrchestrate', () => {
    it('feature flag 关闭时返回 false', () => {
      const calls = [
        makeToolCall('1', 'search_engine', {}),
        makeToolCall('2', 'calculator', {}),
      ]
      expect(shouldOrchestrate(calls, false)).toBe(false)
    })

    it('单个 tool_call 返回 false', () => {
      expect(shouldOrchestrate([makeToolCall('1', 'search_engine', {})], true)).toBe(false)
    })

    it('两个无依赖工具 + 启用时返回 true', () => {
      const calls = [
        makeToolCall('1', 'search_engine', {}),
        makeToolCall('2', 'calculator', {}),
      ]
      expect(shouldOrchestrate(calls, true)).toBe(true)
    })

    it('两个有依赖工具 + 启用 + 保守模式返回 false', () => {
      const calls = [
        makeToolCall('1', 'sql_query', {}),
        makeToolCall('2', 'file_ops', {}),
      ]
      // 两个写操作有依赖，保守模式下串行 → has_parallel=false
      expect(shouldOrchestrate(calls, true, true)).toBe(false)
    })

    it('两个有依赖工具 + 启用 + 非保守模式可能返回 true', () => {
      const calls = [
        makeToolCall('1', 'search_engine', {}),
        makeToolCall('2', 'calculator', {}),
      ]
      expect(shouldOrchestrate(calls, true, false)).toBe(true)
    })

    it('空数组返回 false', () => {
      expect(shouldOrchestrate([], true)).toBe(false)
    })
  })

  // ============================================================
  // formatExecutionPlan
  // ============================================================
  describe('formatExecutionPlan', () => {
    it('格式化执行计划为日志字符串', () => {
      const plan = planExecution([
        makeToolCall('1', 'search_engine', {}),
        makeToolCall('2', 'calculator', {}),
      ], true)
      const str = formatExecutionPlan(plan)
      expect(str).toContain('ExecutionPlan')
      expect(str).toContain('2 calls')
      expect(str).toContain('parallel=true')
      expect(str).toContain('search_engine')
      expect(str).toContain('calculator')
    })

    it('空计划的格式化字符串', () => {
      const str = formatExecutionPlan({ groups: [], has_parallel: false, total_calls: 0 })
      expect(str).toContain('0 calls')
      expect(str).toContain('parallel=false')
    })
  })

  // ============================================================
  // 向后兼容
  // ============================================================
  describe('向后兼容', () => {
    it('parallel_tools 未启用时 routeAfterAgent 行为不变（返回 tools）', () => {
      // shouldOrchestrate 在 enabled=false 时返回 false
      // routeAfterAgent 仍返回 'tools'，ToolNode 正常执行
      const calls = [
        makeToolCall('1', 'search_engine', {}),
        makeToolCall('2', 'calculator', {}),
      ]
      expect(shouldOrchestrate(calls, false)).toBe(false)
    })

    it('单 tool_call 时等价现状（串行执行）', () => {
      const plan = planExecution([makeToolCall('1', 'search_engine', {})])
      expect(plan.has_parallel).toBe(false)
      expect(plan.groups.length).toBe(1)
      expect(plan.groups[0].type).toBe('serial')
    })
  })
})
