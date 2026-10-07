/**
 * 配额校验 / 用量记录单元测试（T2.5）
 */
import { describe, it, expect, vi } from 'vitest'

import { checkQuota, recordUsage } from '../src/core/quota.js'

type Overrides = {
  quota?: Record<string, unknown> | null
}

function mockPrisma(o: Overrides = {}) {
  const quotaUpdate = vi.fn(async () => ({}))
  const tokenCreate = vi.fn(async (_arg: unknown) => ({}))
  const quotaRecordUpdate = vi.fn(async () => ({}))

  const prisma = {
    userQuota: {
      findUnique: vi.fn(async () =>
        o.quota === undefined ? null : o.quota,
      ),
      update: quotaUpdate,
    },
    tokenUsage: { create: tokenCreate },
  }

  return { prisma, quotaUpdate, tokenCreate, quotaRecordUpdate }
}

describe('checkQuota', () => {
  it('无配额记录视为不限制', async () => {
    const { prisma } = mockPrisma()
    await expect(checkQuota(prisma as never, 'u1')).resolves.toBeUndefined()
  })

  it('总配额用尽抛 429', async () => {
    const { prisma } = mockPrisma({
      quota: {
        usedTokens: 1000,
        totalTokens: 1000,
        dailyLimit: 5000,
        dailyUsed: 0,
        resetAt: null,
      },
    })
    await expect(checkQuota(prisma as never, 'u1')).rejects.toThrow(/总 Token 配额已用尽/)
  })

  it('日配额用尽抛 429', async () => {
    const { prisma } = mockPrisma({
      quota: {
        usedTokens: 0,
        totalTokens: 0,
        dailyLimit: 100,
        dailyUsed: 100,
        resetAt: null,
      },
    })
    await expect(checkQuota(prisma as never, 'u1')).rejects.toThrow(/今日 Token 配额已用尽/)
  })

  it('resetAt 过期先重置 dailyUsed 再校验', async () => {
    const { prisma, quotaUpdate } = mockPrisma({
      quota: {
        usedTokens: 0,
        totalTokens: 0,
        dailyLimit: 100,
        dailyUsed: 100,
        resetAt: new Date(Date.now() - 1000),
      },
    })
    await checkQuota(prisma as never, 'u1')
    expect(quotaUpdate).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      data: { dailyUsed: 0, resetAt: null },
    })
  })

  it('未超限正常通过', async () => {
    const { prisma } = mockPrisma({
      quota: {
        usedTokens: 10,
        totalTokens: 1000,
        dailyLimit: 1000,
        dailyUsed: 10,
        resetAt: null,
      },
    })
    await expect(checkQuota(prisma as never, 'u1')).resolves.toBeUndefined()
  })
})

describe('recordUsage', () => {
  it('写入 token_usage（用真实 usage）', async () => {
    const { prisma, tokenCreate } = mockPrisma()
    prisma.userQuota.update = vi.fn(async () => ({}))

    await recordUsage(prisma as never, {
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm1',
      model: 'deepseek',
      usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
      promptText: 'x'.repeat(40),
      completionText: 'y'.repeat(80),
    })

    expect(tokenCreate).toHaveBeenCalledWith({
      data: {
        userId: 'u1',
        sessionId: 's1',
        messageId: 'm1',
        model: 'deepseek',
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
      },
    })
  })

  it('无 usage 时按 length/4 估算', async () => {
    const { prisma, tokenCreate } = mockPrisma()
    prisma.userQuota.update = vi.fn(async () => ({}))

    await recordUsage(prisma as never, {
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm1',
      model: 'm',
      promptText: 'a'.repeat(40), // 10
      completionText: 'b'.repeat(80), // 20
    })

    const arg = tokenCreate.mock.calls[0]![0] as {
      data: { promptTokens: number; completionTokens: number; totalTokens: number }
    }
    expect(arg.data.promptTokens).toBe(10)
    expect(arg.data.completionTokens).toBe(20)
    expect(arg.data.totalTokens).toBe(30)
  })

  it('配额记录更新失败（无记录）不阻断', async () => {
    const { prisma, tokenCreate } = mockPrisma()
    prisma.userQuota.update = vi.fn(async () => {
      throw new Error('no quota row')
    })

    await expect(
      recordUsage(prisma as never, {
        userId: 'u1',
        sessionId: 's1',
        messageId: 'm1',
        model: 'm',
        promptText: 'hi',
        completionText: 'yo',
      }),
    ).resolves.toBeUndefined()
    expect(tokenCreate).toHaveBeenCalled()
  })
})
