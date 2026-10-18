/**
 * P2 回归：配额预扣与结算
 *
 * 覆盖：预扣写入、超限拒绝、释放回滚、结算差额、并发不超卖。
 * 使用内存版 prisma 替身，避免依赖真实数据库。
 */
import { describe, it, expect } from 'vitest'
import {
  estimateReservation,
  markQuotaSettled,
  releaseQuota,
  reserveQuota,
} from '../src/core/quota-reservation.ts'
import { recordUsage } from '../src/core/quota.ts'

interface QuotaState {
  totalTokens: number
  usedTokens: number
  dailyLimit: number
  dailyUsed: number
  resetAt: Date | null
}

function makePrisma(seed: QuotaState, opts: { withQuota?: boolean } = {}) {
  const state: QuotaState = { ...seed }
  const usageRows: Array<Record<string, unknown>> = []
  const hasQuota = opts.withQuota !== false

  const applyOps = (data: Record<string, any>) => {
    const apply = (field: 'usedTokens' | 'dailyUsed', op: Record<string, bigint>) => {
      if (op.increment !== undefined) state[field] += Number(op.increment)
      if (op.decrement !== undefined) state[field] -= Number(op.decrement)
    }
    for (const field of ['usedTokens', 'dailyUsed'] as const) {
      if (data[field]) apply(field, data[field])
    }
    if (data.resetAt === null) state.resetAt = null
  }

  const prisma = {
    userQuota: {
      findUnique: async () => (hasQuota ? { userId: 'u1', ...state } : null),
      update: async ({ data }: { data: Record<string, any> }) => {
        applyOps(data)
        return { userId: 'u1', ...state }
      },
      upsert: async ({ update }: { update: Record<string, any> }) => {
        applyOps(update)
        return { userId: 'u1', ...state }
      },
    },
    tokenUsage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        usageRows.push(data)
        return data
      },
    },
  }

  return { prisma: prisma as any, state, usageRows }
}

const SEED: QuotaState = {
  totalTokens: 1_000,
  usedTokens: 0,
  dailyLimit: 1_000,
  dailyUsed: 0,
  resetAt: null,
}

describe('reserveQuota / releaseQuota', () => {
  it('预扣写库，释放后归还', async () => {
    const { prisma, state } = makePrisma(SEED)
    const r = await reserveQuota(prisma, 'u1', 100)
    expect(r.applied).toBe(true)
    expect(r.reserved).toBe(100)
    expect(state.usedTokens).toBe(100)
    expect(state.dailyUsed).toBe(100)

    await releaseQuota(prisma, r)
    expect(state.usedTokens).toBe(0)
    expect(state.dailyUsed).toBe(0)
  })

  it('余额不足直接拒绝，且不写入', async () => {
    const { prisma, state } = makePrisma({ ...SEED, usedTokens: 950 })
    await expect(reserveQuota(prisma, 'u1', 100)).rejects.toMatchObject({ statusCode: 429 })
    expect(state.usedTokens).toBe(950)
  })

  it('无配额记录时视为不限制（不预扣）', async () => {
    const { prisma } = makePrisma(SEED, { withQuota: false })
    const r = await reserveQuota(prisma, 'u1', 100)
    expect(r.applied).toBe(false)
    expect(r.reserved).toBe(0)
  })

  it('并发预扣不超卖', async () => {
    const { prisma, state } = makePrisma({ ...SEED, totalTokens: 500, dailyLimit: 500 })
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserveQuota(prisma, 'u1', 100)),
    )
    const ok = results.filter((r) => r.status === 'fulfilled') as Array<PromiseFulfilledResult<any>>
    expect(ok).toHaveLength(5)
    expect(state.usedTokens).toBe(500)

    await Promise.all(ok.map((r) => releaseQuota(prisma, r.value)))
    expect(state.usedTokens).toBe(0)
  })
})

describe('recordUsage 预扣结算', () => {
  it('按 (实际 - 预扣) 调整配额，只写一条用量', async () => {
    const { prisma, state, usageRows } = makePrisma(SEED)
    const r = await reserveQuota(prisma, 'u1', 100)
    expect(state.usedTokens).toBe(100)

    await recordUsage(prisma, {
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm1',
      model: 'deepseek-v4-flash',
      usage: { promptTokens: 40, completionTokens: 20, totalTokens: 60 },
      promptText: '',
      completionText: '',
      reservedTokens: r.reserved,
    })
    markQuotaSettled(r)

    expect(state.usedTokens).toBe(60)
    expect(state.dailyUsed).toBe(60)
    expect(usageRows).toHaveLength(1)
  })

  it('实际高于预扣时补扣差额', async () => {
    const { prisma, state } = makePrisma(SEED)
    const r = await reserveQuota(prisma, 'u1', 50)

    await recordUsage(prisma, {
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm1',
      model: 'deepseek-v4-flash',
      usage: { promptTokens: 80, completionTokens: 40, totalTokens: 120 },
      promptText: '',
      completionText: '',
      reservedTokens: r.reserved,
    })
    markQuotaSettled(r)

    expect(state.usedTokens).toBe(120)
  })

  it('未传 reservedTokens 时保持旧行为（直接累加）', async () => {
    const { prisma, state } = makePrisma(SEED)
    await recordUsage(prisma, {
      userId: 'u1',
      sessionId: 's1',
      messageId: 'm1',
      model: 'deepseek-v4-flash',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      promptText: '',
      completionText: '',
    })
    expect(state.usedTokens).toBe(15)
  })
})

describe('estimateReservation', () => {
  it('按 prompt 与输出上限估算', () => {
    expect(estimateReservation('abcd', 100)).toBe(101)
    expect(estimateReservation('abcd', null)).toBe(1 + 1024)
    expect(estimateReservation('', 0)).toBe(1 + 1)
  })
})
