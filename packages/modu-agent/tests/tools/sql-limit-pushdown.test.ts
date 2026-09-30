// P1-12：SQL 限量下推纯函数回归（不依赖 better-sqlite3 原生模块）。
import { describe, it, expect } from 'vitest'
import { applySelectLimitPushdown } from '@/tools/sql-query.js'

describe('P1-12 · applySelectLimitPushdown 限量下推', () => {
  it('普通 SELECT 被包装为 LIMIT maxRows+1 子查询', () => {
    expect(applySelectLimitPushdown('SELECT * FROM users', 100))
      .toBe('SELECT * FROM (SELECT * FROM users) LIMIT 101')
  })

  it('剥离尾部一个或多个分号与空白（子查询内尾分号非法）', () => {
    expect(applySelectLimitPushdown('  select * from t ;  ', 10))
      .toBe('SELECT * FROM (select * from t) LIMIT 11')
    expect(applySelectLimitPushdown('select * from t;;', 10))
      .toBe('SELECT * FROM (select * from t) LIMIT 11')
  })

  it('maxRows=1 时下推 LIMIT 2（用于区分"1 行未截断"与"还有更多"）', () => {
    expect(applySelectLimitPushdown('SELECT id FROM t', 1))
      .toBe('SELECT * FROM (SELECT id FROM t) LIMIT 2')
  })

  it('原 SQL 自带 LIMIT 时仍统一外包（由外层限量保证不超 maxRows+1）', () => {
    expect(applySelectLimitPushdown('SELECT * FROM t LIMIT 50', 100))
      .toBe('SELECT * FROM (SELECT * FROM t LIMIT 50) LIMIT 101')
  })

  it('JOIN / WHERE / ORDER BY / 参数占位符等结构原样保留在子查询内', () => {
    const sql = 'SELECT a.id, b.name FROM a JOIN b ON a.id=b.aid WHERE a.x=? ORDER BY a.id DESC'
    expect(applySelectLimitPushdown(sql, 500))
      .toBe(`SELECT * FROM (${sql}) LIMIT 501`)
  })
})
