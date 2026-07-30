// P2-1 单元测试：写操作 + 敏感数据安全防护
// 对应文档 §5.3 P2-1 + 风险 R-10：guardrail 合并判定 + dry_run + 配置化注册表
import { describe, it, expect, beforeEach } from 'vitest'
import {
  ACTION_GUARDRAILS,
  registerGuardrailRule,
  checkGuardrail,
  checkGuardrailsForToolCalls,
  type GuardrailRule,
} from '@/tools/tool-guardrails.js'
import { TOOL_CAPABILITY_MATRIX } from '@/tools/tool-registry.js'

describe('P2-1 写操作 + 敏感数据安全防护', () => {
  // 保存原始 guardrails，测试后恢复
  const originalGuardrails = [...ACTION_GUARDRAILS]

  beforeEach(() => {
    // 恢复原始 guardrails
    ACTION_GUARDRAILS.length = 0
    ACTION_GUARDRAILS.push(...originalGuardrails)
  })

  // ============================================================
  // ACTION_GUARDRAILS 注册表
  // ============================================================
  describe('ACTION_GUARDRAILS 注册表', () => {
    it('预置常见写操作 guardrail 规则', () => {
      const ruleIds = ACTION_GUARDRAILS.map((r) => r.rule_id)
      expect(ruleIds).toContain('guard_file_ops_write')
      expect(ruleIds).toContain('guard_file_ops_delete')
      expect(ruleIds).toContain('guard_sql_query_write')
      expect(ruleIds).toContain('guard_http_request_sensitive')
      expect(ruleIds).toContain('guard_code_executor_network')
    })
  })

  // ============================================================
  // registerGuardrailRule
  // ============================================================
  describe('registerGuardrailRule', () => {
    it('追加新规则到注册表', () => {
      const beforeLen = ACTION_GUARDRAILS.length
      registerGuardrailRule({
        rule_id: 'custom_test_rule',
        tool_name: 'custom_tool',
        description: 'Test rule',
      })
      expect(ACTION_GUARDRAILS.length).toBe(beforeLen + 1)
      const found = ACTION_GUARDRAILS.find((r) => r.rule_id === 'custom_test_rule')
      expect(found).toBeDefined()
    })

    it('同 rule_id 覆盖旧规则', () => {
      registerGuardrailRule({
        rule_id: 'guard_file_ops_write',
        tool_name: 'file_ops',
        description: 'Overridden description',
      })
      const found = ACTION_GUARDRAILS.find((r) => r.rule_id === 'guard_file_ops_write')
      expect(found?.description).toBe('Overridden description')
    })

    it('空 rule_id 抛异常', () => {
      expect(() =>
        registerGuardrailRule({ rule_id: '', description: 'x' }),
      ).toThrow('non-empty')
    })
  })

  // ============================================================
  // checkGuardrail
  // ============================================================
  describe('checkGuardrail', () => {
    it('file_ops write 操作命中 guardrail', () => {
      const r = checkGuardrail('file_ops', { mode: 'write', path: '/tmp/test' })
      expect(r.hit).toBe(true)
      expect(r.rule?.rule_id).toBe('guard_file_ops_write')
    })

    it('file_ops append 操作命中 guardrail', () => {
      const r = checkGuardrail('file_ops', { mode: 'append', path: '/tmp/test' })
      expect(r.hit).toBe(true)
    })

    it('file_ops delete 操作命中 guardrail', () => {
      const r = checkGuardrail('file_ops', { mode: 'delete', path: '/tmp/test' })
      expect(r.hit).toBe(true)
      expect(r.rule?.rule_id).toBe('guard_file_ops_delete')
    })

    it('file_ops read 操作不命中 guardrail', () => {
      const r = checkGuardrail('file_ops', { mode: 'read', path: '/tmp/test' })
      // read 不匹配 write|append|overwrite 或 delete|remove
      // 但 file_ops 在矩阵中 requires_confirmation=true，所以仍命中第二层
      expect(r.hit).toBe(true)
      expect(r.rule?.rule_id).toBe('matrix_file_ops')
    })

    it('sql_query INSERT 命中 guardrail', () => {
      const r = checkGuardrail('sql_query', {
        sql: 'INSERT INTO users VALUES (1, "test")',
      })
      expect(r.hit).toBe(true)
      expect(r.rule?.rule_id).toBe('guard_sql_query_write')
    })

    it('sql_query UPDATE 命中 guardrail', () => {
      const r = checkGuardrail('sql_query', {
        sql: 'UPDATE users SET name = "test"',
      })
      expect(r.hit).toBe(true)
    })

    it('sql_query DROP 命中 guardrail', () => {
      const r = checkGuardrail('sql_query', {
        sql: 'DROP TABLE users',
      })
      expect(r.hit).toBe(true)
    })

    it('sql_query SELECT 不命中写操作 guardrail（但矩阵标注 requires_confirmation）', () => {
      const r = checkGuardrail('sql_query', {
        sql: 'SELECT * FROM users',
      })
      // SELECT 不匹配 INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE
      // 但 sql_query 在矩阵中 requires_confirmation=true，所以命中第二层
      expect(r.hit).toBe(true)
      expect(r.rule?.rule_id).toBe('matrix_sql_query')
    })

    it('http_request POST 命中 guardrail', () => {
      const r = checkGuardrail('http_request', {
        url: 'https://api.example.com',
        method: 'POST',
      })
      expect(r.hit).toBe(true)
      expect(r.rule?.rule_id).toBe('guard_http_request_sensitive')
    })

    it('http_request GET 不命中写操作 guardrail（但矩阵标注 requires_confirmation）', () => {
      const r = checkGuardrail('http_request', {
        url: 'https://api.example.com',
        method: 'GET',
      })
      // GET 不匹配 POST|PUT|PATCH|DELETE，但矩阵 requires_confirmation=true
      expect(r.hit).toBe(true)
      expect(r.rule?.rule_id).toBe('matrix_http_request')
    })

    it('code_executor 含 fetch 命中 guardrail', () => {
      const r = checkGuardrail('code_executor', {
        code: 'const data = await fetch("/api/data")',
      })
      expect(r.hit).toBe(true)
      expect(r.rule?.rule_id).toBe('guard_code_executor_network')
    })

    it('code_executor 无网络操作命中（但矩阵标注 requires_confirmation）', () => {
      const r = checkGuardrail('code_executor', {
        code: 'const x = 1 + 2',
      })
      expect(r.hit).toBe(true)
      expect(r.rule?.rule_id).toBe('matrix_code_executor')
    })

    it('search_engine 不命中任何 guardrail', () => {
      const r = checkGuardrail('search_engine', { query: 'test' })
      expect(r.hit).toBe(false)
    })

    it('calculator 不命中任何 guardrail', () => {
      const r = checkGuardrail('calculator', { expression: '1+1' })
      expect(r.hit).toBe(false)
    })

    it('datetime 不命中任何 guardrail', () => {
      const r = checkGuardrail('datetime', {})
      expect(r.hit).toBe(false)
    })

    it('未知工具不命中任何 guardrail', () => {
      const r = checkGuardrail('unknown_tool', {})
      expect(r.hit).toBe(false)
    })
  })

  // ============================================================
  // dry_run 模式
  // ============================================================
  describe('dry_run 模式', () => {
    it('dryRun=true 时返回 dry_run_result', () => {
      const r = checkGuardrail('file_ops', { mode: 'write' }, true)
      expect(r.hit).toBe(true)
      expect(r.dry_run_result).toBeDefined()
      expect(r.dry_run_result?.would_execute).toBe(false)
      expect(r.dry_run_result?.blocked_reason).toContain('guard_file_ops_write')
    })

    it('dryRun=false 时不返回 dry_run_result', () => {
      const r = checkGuardrail('file_ops', { mode: 'write' }, false)
      expect(r.hit).toBe(true)
      expect(r.dry_run_result).toBeUndefined()
    })

    it('dry_run_supported=false 的规则不返回 dry_run_result', () => {
      // code_executor 的 network 规则 dry_run_supported=false
      const r = checkGuardrail(
        'code_executor',
        { code: 'fetch("/api")' },
        true,
      )
      expect(r.hit).toBe(true)
      expect(r.rule?.dry_run_supported).toBe(false)
      // dry_run_supported=false 时不填充 dry_run_result
      expect(r.dry_run_result).toBeUndefined()
    })
  })

  // ============================================================
  // checkGuardrailsForToolCalls
  // ============================================================
  describe('checkGuardrailsForToolCalls', () => {
    it('批量检查返回命中的 tool_calls', () => {
      const toolCalls = [
        { id: 'call_1', name: 'search_engine', args: { query: 'test' } },
        { id: 'call_2', name: 'file_ops', args: { mode: 'write' } },
        { id: 'call_3', name: 'calculator', args: { expression: '1+1' } },
        { id: 'call_4', name: 'sql_query', args: { sql: 'DELETE FROM users' } },
      ]
      const hits = checkGuardrailsForToolCalls(toolCalls)
      expect(hits.length).toBe(2)
      const hitIds = hits.map((h) => h.toolCall.id)
      expect(hitIds).toContain('call_2')
      expect(hitIds).toContain('call_4')
    })

    it('全部不命中时返回空数组', () => {
      const toolCalls = [
        { id: 'call_1', name: 'search_engine', args: { query: 'test' } },
        { id: 'call_2', name: 'calculator', args: { expression: '1+1' } },
      ]
      const hits = checkGuardrailsForToolCalls(toolCalls)
      expect(hits).toEqual([])
    })

    it('空 tool_calls 返回空数组', () => {
      expect(checkGuardrailsForToolCalls([])).toEqual([])
    })
  })

  // ============================================================
  // 参数条件匹配
  // ============================================================
  describe('参数条件匹配', () => {
    it('多选模式 | 匹配任一关键词', () => {
      // sql 规则: INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE
      expect(checkGuardrail('sql_query', { sql: 'ALTER TABLE users' }).hit).toBe(true)
      expect(checkGuardrail('sql_query', { sql: 'TRUNCATE TABLE users' }).hit).toBe(true)
      expect(checkGuardrail('sql_query', { sql: 'CREATE TABLE users' }).hit).toBe(true)
    })

    it('大小写不敏感匹配', () => {
      expect(checkGuardrail('sql_query', { sql: 'insert into users' }).hit).toBe(true)
      expect(checkGuardrail('sql_query', { sql: 'drop table users' }).hit).toBe(true)
    })

    it('参数缺失时不匹配该规则', () => {
      // 缺少 mode 参数，file_ops write 规则不命中
      // 但 file_ops 矩阵 requires_confirmation=true，命中第二层
      const r = checkGuardrail('file_ops', {})
      expect(r.hit).toBe(true)
      expect(r.rule?.rule_id).toBe('matrix_file_ops')
    })
  })

  // ============================================================
  // 向后兼容
  // ============================================================
  describe('向后兼容', () => {
    it('guardrail 关闭时（无命中）行为等价现状', () => {
      // search_engine / calculator / datetime 无 guardrail 命中
      // 也不在 requires_confirmation=true 矩阵中
      expect(checkGuardrail('search_engine', {}).hit).toBe(false)
      expect(checkGuardrail('calculator', {}).hit).toBe(false)
      expect(checkGuardrail('datetime', {}).hit).toBe(false)
    })

    it('TOOL_CAPABILITY_MATRIX.requires_confirmation 作为兜底', () => {
      // 所有 requires_confirmation=true 的工具都应命中（即使无规则匹配）
      const confirmedTools = Object.values(TOOL_CAPABILITY_MATRIX)
        .filter((c) => c.requires_confirmation === true)
        .map((c) => c.name)
      expect(confirmedTools).toContain('http_request')
      expect(confirmedTools).toContain('code_executor')
      expect(confirmedTools).toContain('sql_query')
      expect(confirmedTools).toContain('file_ops')

      for (const name of confirmedTools) {
        expect(checkGuardrail(name, {}).hit).toBe(true)
      }
    })
  })
})
