/**
 * loadSessionHistoryByBudget 单元测试（T3.7）
 */
import { describe, it, expect } from 'vitest'
import { loadSessionHistoryByBudget } from '../src/core/context-budget.js'

type Row = { role: string; content: string | null; createdAt: number }

function mockPrisma(rows: Row[]) {
  return {
    chatMessage: {
      // 返回按 createdAt desc 的副本（模拟 DB 排序）
      findMany: async () =>
        [...rows].sort((a, b) => b.createdAt - a.createdAt),
    },
  }
}

/** 生成 n 条消息，m0 最旧、m(n-1) 最新 */
function makeRows(n: number, content = 'x'.repeat(40)): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `${content}-${i}`,
    createdAt: i,
  }))
}

describe('loadSessionHistoryByBudget（T3.7）', () => {
  it('短会话：全部保留（不截断）', async () => {
    const prisma = mockPrisma(makeRows(4))
    const result = await loadSessionHistoryByBudget(prisma as never, 's1')
    expect(result).toHaveLength(4)
    // 顺序旧→新
    expect(result[0]!.content).toContain('-0')
    expect(result[3]!.content).toContain('-3')
  })

  it('始终保留最近 keepLastN 条，即使超出 token 预算', async () => {
    const prisma = mockPrisma(makeRows(20))
    const result = await loadSessionHistoryByBudget(prisma as never, 's1', {
      maxTokens: 1, // 极紧预算
      keepLastN: 4,
    })
    // 只有最近 4 条
    expect(result).toHaveLength(4)
    expect(result.map((m) => m.content)).toEqual([
      expect.stringContaining('-16'),
      expect.stringContaining('-17'),
      expect.stringContaining('-18'),
      expect.stringContaining('-19'),
    ])
  })

  it('预算内尽量保留更早的消息', async () => {
    const prisma = mockPrisma(makeRows(20))
    // 每条约 11 tokens（44 chars/4 向上取整=11）
    const result = await loadSessionHistoryByBudget(prisma as never, 's1', {
      maxTokens: 100,
      keepLastN: 6,
    })
    // 6 保证 + 约 3 条更早（9*11=99 ≤100）
    expect(result.length).toBeGreaterThanOrEqual(9)
    // 最新消息一定在
    expect(result[result.length - 1]!.content).toContain('-19')
    // 顺序保持旧→新
    const indexes = result.map((m) => Number(m.content.split('-').pop()))
    const sorted = [...indexes].sort((a, b) => a - b)
    expect(indexes).toEqual(sorted)
  })

  it('maxTokens=0 表示不限制（候选窗口内全保留）', async () => {
    const prisma = mockPrisma(makeRows(10))
    const result = await loadSessionHistoryByBudget(prisma as never, 's1', {
      maxTokens: 0,
      keepLastN: 2,
      candidateLimit: 10,
    })
    expect(result).toHaveLength(10)
  })
})
