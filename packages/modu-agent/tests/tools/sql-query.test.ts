import { describe, it, expect } from 'vitest'
import { SqlQueryTool } from '@/tools/sql-query.js'

/**
 * SqlQueryTool 表名提取增强测试（对应文档 §2.5 建议4）。
 *
 * 由于 better-sqlite3 未安装，仅验证 _validateQuery 逻辑：
 *   - 校验失败 → SQL_001（不触达数据库）
 *   - 校验通过 → SQL_003（better-sqlite3 not available）
 */
describe('SqlQueryTool table name extraction', () => {
  // 辅助：白名单只含 'users' 与 'orders'
  const tool = new SqlQueryTool(null, 1000, ['users', 'orders'])

  it('returns its name and requires approval', () => {
    expect(tool.name()).toBe('sql_query')
    expect(tool.requiresApproval()).toBe(true)
  })

  it('allows simple table name in whitelist', async () => {
    const r = await tool.invoke({ query: 'SELECT * FROM users' }, {})
    // 校验通过 → 触发 better-sqlite3 缺失错误 SQL_003
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_003')
  })

  it('rejects simple table name not in whitelist', async () => {
    const r = await tool.invoke({ query: 'SELECT * FROM secrets' }, {})
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_001')
    expect(r.data.message).toContain("Table 'secrets'")
  })

  it('extracts table name from schema-qualified reference (fix)', async () => {
    // public.users → 规范化为 users（在白名单中）→ 校验通过
    const r = await tool.invoke({ query: 'SELECT * FROM public.users' }, {})
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_003') // better-sqlite3 缺失，说明校验通过
  })

  it('rejects schema-qualified table not in whitelist (fix)', async () => {
    // public.secrets → 规范化为 secrets（不在白名单）→ 拒绝
    const r = await tool.invoke({ query: 'SELECT * FROM public.secrets' }, {})
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_001')
    expect(r.data.message).toContain("Table 'secrets'")
  })

  it('extracts table name from double-quoted identifier (fix)', async () => {
    // "users" → 去引号后为 users（在白名单中）→ 校验通过
    const r = await tool.invoke({ query: 'SELECT * FROM "users"' }, {})
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_003')
  })

  it('extracts table name with spaces from quoted identifier (fix)', async () => {
    // 白名单含 "my table"
    const t = new SqlQueryTool(null, 1000, ['my table'])
    const r = await t.invoke({ query: 'SELECT * FROM "my table"' }, {})
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_003')
  })

  it('rejects quoted identifier not in whitelist (fix)', async () => {
    const r = await tool.invoke({ query: 'SELECT * FROM "secrets"' }, {})
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_001')
    expect(r.data.message).toContain("Table 'secrets'")
  })

  it('extracts tables from JOIN clause', async () => {
    // users JOIN orders → 都在白名单 → 校验通过
    const r = await tool.invoke(
      { query: 'SELECT * FROM users u JOIN orders o ON u.id = o.user_id' },
      {},
    )
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_003')
  })

  it('rejects JOIN with table not in whitelist', async () => {
    const r = await tool.invoke(
      { query: 'SELECT * FROM users u JOIN secrets s ON u.id = s.user_id' },
      {},
    )
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_001')
    expect(r.data.message).toContain("Table 'secrets'")
  })

  it('extracts tables from subquery (already worked, verify no regression)', async () => {
    // 子查询中的 FROM secrets 会被全局正则匹配到
    const r = await tool.invoke(
      { query: 'SELECT * FROM (SELECT * FROM secrets) AS t' },
      {},
    )
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_001')
    expect(r.data.message).toContain("Table 'secrets'")
  })

  it('allows subquery with whitelisted table', async () => {
    const r = await tool.invoke(
      { query: 'SELECT * FROM (SELECT * FROM users) AS t' },
      {},
    )
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_003')
  })

  it('skips table check when whitelist is null (backward compat)', async () => {
    const t = new SqlQueryTool(null, 1000, null)
    const r = await t.invoke({ query: 'SELECT * FROM any_table' }, {})
    // 无白名单 → 不做表名校验 → 直接到 better-sqlite3 导入
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_003')
  })

  it('still rejects forbidden SQL keywords', async () => {
    const r = await tool.invoke(
      { query: 'SELECT * FROM users; DROP TABLE users' },
      {},
    )
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_001')
  })

  it('still rejects non-SELECT statements', async () => {
    const r = await tool.invoke({ query: 'DROP TABLE users' }, {})
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_001')
  })

  it('still rejects SQL comments', async () => {
    const r = await tool.invoke({ query: 'SELECT * FROM users -- comment' }, {})
    expect(r.status).toBe('error')
    expect(r.error_code).toBe('SQL_001')
  })
})
