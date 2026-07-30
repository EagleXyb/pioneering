// P1-5 单元测试：工具能力矩阵 + 意图路由
// 对应文档 §5.2 P1-5 + 风险 R-09：两级管道 + intent 失败回退
import { describe, it, expect, beforeEach } from 'vitest'
import {
  TOOL_CAPABILITY_MATRIX,
  registerToolCapability,
  getToolCapability,
  filterToolsByTaskType,
  filterToolsByIntent,
  filterToolsByTaskTypeAndIntent,
  type ToolCapability,
} from '@/tools/tool-registry.js'

// 构造测试用工具实例（模拟 LangChain StructuredTool 的 name 字段）
function makeTool(name: string): any {
  return { name }
}

describe('P1-5 工具能力矩阵 + 意图路由', () => {
  // 保存原始矩阵，测试后恢复避免污染其他测试
  const originalMatrix = { ...TOOL_CAPABILITY_MATRIX }

  beforeEach(() => {
    // 恢复原始矩阵
    for (const key of Object.keys(TOOL_CAPABILITY_MATRIX)) {
      delete TOOL_CAPABILITY_MATRIX[key]
    }
    Object.assign(TOOL_CAPABILITY_MATRIX, originalMatrix)
  })

  // ============================================================
  // TOOL_CAPABILITY_MATRIX 注册表
  // ============================================================
  describe('TOOL_CAPABILITY_MATRIX 注册表', () => {
    it('预置内置工具能力描述', () => {
      expect(TOOL_CAPABILITY_MATRIX['search_engine']).toBeDefined()
      expect(TOOL_CAPABILITY_MATRIX['http_request']).toBeDefined()
      expect(TOOL_CAPABILITY_MATRIX['calculator']).toBeDefined()
      expect(TOOL_CAPABILITY_MATRIX['code_executor']).toBeDefined()
      expect(TOOL_CAPABILITY_MATRIX['sql_query']).toBeDefined()
      expect(TOOL_CAPABILITY_MATRIX['datetime']).toBeDefined()
      expect(TOOL_CAPABILITY_MATRIX['file_ops']).toBeDefined()
    })

    it('search_engine 属于 research 任务类型', () => {
      expect(TOOL_CAPABILITY_MATRIX['search_engine'].task_types).toContain('research')
    })

    it('sql_query 同时属于 research 和 coding', () => {
      expect(TOOL_CAPABILITY_MATRIX['sql_query'].task_types).toContain('research')
      expect(TOOL_CAPABILITY_MATRIX['sql_query'].task_types).toContain('coding')
    })

    it('http_request 标记 requires_confirmation=true', () => {
      expect(TOOL_CAPABILITY_MATRIX['http_request'].requires_confirmation).toBe(true)
    })

    it('search_engine 有 fallback_chain', () => {
      expect(TOOL_CAPABILITY_MATRIX['search_engine'].fallback_chain).toContain('http_request')
    })
  })

  // ============================================================
  // getToolCapability / registerToolCapability
  // ============================================================
  describe('getToolCapability / registerToolCapability', () => {
    it('未注册的工具返回 null', () => {
      expect(getToolCapability('non_existent')).toBeNull()
    })

    it('registerToolCapability 注册后可查询', () => {
      const cap: ToolCapability = {
        name: 'custom_tool',
        task_types: ['research'],
      }
      registerToolCapability(cap)
      expect(getToolCapability('custom_tool')).toEqual(cap)
    })

    it('registerToolCapability 空 name 抛异常', () => {
      expect(() => registerToolCapability({ name: '', task_types: [] })).toThrow('non-empty')
    })

    it('重复注册覆盖旧条目', () => {
      registerToolCapability({ name: 'custom', task_types: ['research'] })
      registerToolCapability({ name: 'custom', task_types: ['coding'] })
      expect(getToolCapability('custom')?.task_types).toEqual(['coding'])
    })
  })

  // ============================================================
  // 第一级管道：filterToolsByTaskType
  // ============================================================
  describe('filterToolsByTaskType（task_type 粗筛）', () => {
    const allTools = [
      makeTool('search_engine'),
      makeTool('http_request'),
      makeTool('calculator'),
      makeTool('code_executor'),
      makeTool('sql_query'),
      makeTool('datetime'),
      makeTool('file_ops'),
    ]

    it('research 返回 search_engine/http_request/sql_query/datetime', () => {
      const r = filterToolsByTaskType(allTools, 'research')
      const names = r.map((t) => t.name)
      expect(names).toContain('search_engine')
      expect(names).toContain('http_request')
      expect(names).toContain('sql_query')
      expect(names).toContain('datetime')
      expect(names).not.toContain('calculator')
      expect(names).not.toContain('code_executor')
      expect(names).not.toContain('file_ops')
    })

    it('coding 返回 calculator/code_executor/sql_query', () => {
      const r = filterToolsByTaskType(allTools, 'coding')
      const names = r.map((t) => t.name)
      expect(names).toContain('calculator')
      expect(names).toContain('code_executor')
      expect(names).toContain('sql_query')
      expect(names).not.toContain('search_engine')
    })

    it('review 返回空数组（纯 LLM 评审）', () => {
      expect(filterToolsByTaskType(allTools, 'review')).toEqual([])
    })

    it('未知 task_type 保守返回全部工具', () => {
      const r = filterToolsByTaskType(allTools, 'unknown_type')
      expect(r.length).toBe(allTools.length)
    })

    it('default 保守返回全部工具', () => {
      const r = filterToolsByTaskType(allTools, 'default')
      expect(r.length).toBe(allTools.length)
    })
  })

  // ============================================================
  // 第二级管道：filterToolsByIntent
  // ============================================================
  describe('filterToolsByIntent（intent 细筛）', () => {
    const researchTools = [
      makeTool('search_engine'),
      makeTool('http_request'),
      makeTool('datetime'),
    ]

    it('intent="外部信息检索" 返回 search_engine（首选）', () => {
      const r = filterToolsByIntent(researchTools, '外部信息检索')
      expect(r).not.toBeNull()
      expect(r!.map((t) => t.name)).toContain('search_engine')
    })

    it('intent="日期" 返回 datetime', () => {
      const r = filterToolsByIntent(researchTools, '日期')
      expect(r).not.toBeNull()
      expect(r!.map((t) => t.name)).toContain('datetime')
    })

    it('intent 为空返回 null（触发回退）', () => {
      expect(filterToolsByIntent(researchTools, '')).toBeNull()
    })

    it('intent 无匹配返回 null（触发回退）', () => {
      expect(filterToolsByIntent(researchTools, '完全不匹配的意图')).toBeNull()
    })

    it('工具不在矩阵中时跳过（不报错）', () => {
      const toolsWithUnknown = [makeTool('unknown_tool'), makeTool('search_engine')]
      const r = filterToolsByIntent(toolsWithUnknown, '外部信息检索')
      expect(r).not.toBeNull()
      expect(r!.map((t) => t.name)).toContain('search_engine')
      expect(r!.map((t) => t.name)).not.toContain('unknown_tool')
    })
  })

  // ============================================================
  // 两级管道：filterToolsByTaskTypeAndIntent
  // ============================================================
  describe('filterToolsByTaskTypeAndIntent（两级管道 + 回退）', () => {
    const allTools = [
      makeTool('search_engine'),
      makeTool('http_request'),
      makeTool('calculator'),
      makeTool('code_executor'),
      makeTool('sql_query'),
      makeTool('datetime'),
      makeTool('file_ops'),
    ]

    it('task_type=research + intent="外部信息检索"：返回 search_engine', () => {
      const r = filterToolsByTaskTypeAndIntent(allTools, 'research', '外部信息检索')
      const names = r.map((t) => t.name)
      expect(names).toContain('search_engine')
      expect(names).not.toContain('calculator')
    })

    it('task_type=research + intent="日期"：返回 datetime', () => {
      const r = filterToolsByTaskTypeAndIntent(allTools, 'research', '日期')
      expect(r.map((t) => t.name)).toContain('datetime')
    })

    it('intent 无匹配时回退到 task_type 粗筛结果（R-09 策略①）', () => {
      const r = filterToolsByTaskTypeAndIntent(allTools, 'research', '完全不匹配的意图')
      // 应该回退到 research 粗筛结果
      const names = r.map((t) => t.name)
      expect(names).toContain('search_engine')
      expect(names).toContain('http_request')
      expect(names).toContain('datetime')
    })

    it('intent 为空时仅做 task_type 粗筛', () => {
      const r = filterToolsByTaskTypeAndIntent(allTools, 'coding', null)
      const names = r.map((t) => t.name)
      expect(names).toContain('calculator')
      expect(names).toContain('code_executor')
    })

    it('task_type=review 返回空（无论 intent）', () => {
      const r = filterToolsByTaskTypeAndIntent(allTools, 'review', '外部信息检索')
      expect(r).toEqual([])
    })

    it('task_type 未知时返回全部工具（intent 被忽略）', () => {
      const r = filterToolsByTaskTypeAndIntent(allTools, 'unknown_type', '外部信息检索')
      // 未知 task_type 保守返回全部，intent 细筛在全部工具中找
      // search_engine 在矩阵中且匹配 intent，应被选中
      expect(r.map((t) => t.name)).toContain('search_engine')
    })

    it('intent 匹配但工具不在 task_type 粗筛结果中时不会被选中', () => {
      // coding 粗筛不含 search_engine，即使 intent="外部信息检索" 匹配 search_engine
      const r = filterToolsByTaskTypeAndIntent(allTools, 'coding', '外部信息检索')
      // intent 细筛在 coding 子集中无匹配 → 回退到 coding 粗筛结果
      const names = r.map((t) => t.name)
      expect(names).not.toContain('search_engine')
      expect(names).toContain('calculator')
    })
  })

  // ============================================================
  // 向后兼容
  // ============================================================
  describe('向后兼容', () => {
    it('矩阵预置条目覆盖原 _TOOL_TASK_TYPE_MAP 的所有映射', () => {
      // 原 research: ['search_engine', 'http_request']
      const researchTools = filterToolsByTaskType(
        [makeTool('search_engine'), makeTool('http_request'), makeTool('calculator')],
        'research',
      )
      expect(researchTools.map((t) => t.name).sort()).toEqual(['http_request', 'search_engine'])

      // 原 coding: ['calculator', 'code_executor']
      const codingTools = filterToolsByTaskType(
        [makeTool('calculator'), makeTool('code_executor'), makeTool('search_engine')],
        'coding',
      )
      expect(codingTools.map((t) => t.name).sort()).toEqual(['calculator', 'code_executor'])
    })
  })
})
