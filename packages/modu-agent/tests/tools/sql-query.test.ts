import { describe, it, expect } from 'vitest'
import { SqlQueryTool } from '@/tools/sql-query.js'

/**
 * SqlQueryTool 表名提取增强测试（对应文档 §2.5 建议4）。
 *
 * 本组用例的**意图**是验证 `_validateQuery` 的表名提取/白名单逻辑，而非数据库执行：
 *   - 校验失败 → SQL_001（不触达数据库）
 *   - 校验通过 → 触达数据库层，错误码取决于 better-sqlite3 是否安装
 *
 * T2-3 修复：原用例硬编码断言 `SQL_003`，而源码已把「依赖缺失」拆为独立错误码
 * `SQL_005`（见 tools/sql-query.ts 依赖导入处注释），导致 better-sqlite3 未安装时
 * 7 个用例集体漂移变红。此处改为断言**语义**（校验通过）+ 按环境精确校验错误码，
 * 使两种依赖状态下均正确。
 */

/**
 * 断言"表名校验通过"（请求已触达数据库层），并按 better-sqlite3 可用性精确校验错误码。
 *
 *   - 依赖缺失 → SQL_005（依赖缺失，源码已独立）
 *   - 依赖可用 → SQL_003（执行错误，如库文件不存在）
 */
function expectValidationPassed(r: any): void {
  expect(r.status).toBe('error')
  // 校验层必须放行：白名单/关键词/参数类拒绝都不该发生
  expect(r.error_code).not.toBe('SQL_001')
  expect(r.error_code).not.toBe('SQL_002')
  const depMissing = String(r.data?.message ?? '').includes('better-sqlite3 not available')
  expect(r.error_code).toBe(depMissing ? 'SQL_005' : 'SQL_003')
}

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
    expectValidationPassed(r)
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
    expectValidationPassed(r) // 校验通过说明 better-sqlite3 缺失码属预期
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
    expectValidationPassed(r)
  })

  it('extracts table name with spaces from quoted identifier (fix)', async () => {
    // 白名单含 "my table"
    const t = new SqlQueryTool(null, 1000, ['my table'])
    const r = await t.invoke({ query: 'SELECT * FROM "my table"' }, {})
    expect(r.status).toBe('error')
    expectValidationPassed(r)
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
    expectValidationPassed(r)
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
    expectValidationPassed(r)
  })

  it('skips table check when whitelist is null (backward compat)', async () => {
    const t = new SqlQueryTool(null, 1000, null)
    const r = await t.invoke({ query: 'SELECT * FROM any_table' }, {})
    // 无白名单 → 不做表名校验 → 直接到 better-sqlite3 导入
    expect(r.status).toBe('error')
    expectValidationPassed(r)
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
