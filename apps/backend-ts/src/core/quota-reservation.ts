// 配额预扣与结算（P2）
//
// 目标：把"先调用、后记账"改成"先预扣、后结算"，避免并发请求同时通过校验
// 导致配额超卖（TC-15）。
//
// 实现要点：
//   - 预扣：按估算 token 原子递增 used_tokens / daily_used，再放行模型调用；
//   - 结算：recordUsage 按 (实际 - 预扣) 调整差额，只记一条 token_usage；
//   - 释放：调用失败 / 无产出时回滚预扣；
//   - 兜底：预扣带 TTL 自动释放，避免进程异常导致额度永久占用。
//
// 单实例约束：并发控制是进程内串行锁；多实例需要数据库行锁或 Redis 锁（终态再收敛）。
import type { PrismaClient } from '@prisma/client'
import { TooManyRequestsError } from '../plugins/error-handler.js'

export interface QuotaReservation {
  userId: string
  /** 预扣的 token 数（未命中配额记录时为 0） */
  reserved: number
  /** 是否真的写入了预扣（无 user_quotas 行时为 false） */
  applied: boolean
  settled: boolean
  timer: ReturnType<typeof setTimeout> | null
}

export interface ReserveOptions {
  /** 预扣自动释放时间（毫秒），默认 5 分钟 */
  ttlMs?: number
}

/** 按用户串行化"读-判-写"，避免同进程内并发超卖。 */
const _chains = new Map<string, Promise<unknown>>()

function withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const prev = _chains.get(userId) ?? Promise.resolve()
  const run = prev.catch(() => undefined).then(fn)
  // 链路只保留最新 Promise，避免 Map 无限增长
  _chains.set(
    userId,
    run.catch(() => undefined),
  )
  return run
}

async function adjustQuota(
  prisma: PrismaClient,
  userId: string,
  delta: number,
): Promise<void> {
  if (delta === 0) return
  const data =
    delta > 0
      ? {
          usedTokens: { increment: BigInt(delta) },
          dailyUsed: { increment: BigInt(delta) },
        }
      : {
          usedTokens: { decrement: BigInt(-delta) },
          dailyUsed: { decrement: BigInt(-delta) },
        }
  await prisma.userQuota.update({ where: { userId }, data }).catch(() => {
    // 记账失败不阻断主流程
  })
}

/**
 * 预扣配额。
 *
 * @param estimate 预估本次消耗（prompt + max_tokens 的上限估计）
 * @throws TooManyRequestsError 超出总量或日限额
 */
export async function reserveQuota(
  prisma: PrismaClient,
  userId: string,
  estimate: number,
  opts: ReserveOptions = {},
): Promise<QuotaReservation> {
  const reserved = Math.max(0, Math.ceil(estimate))
  const empty: QuotaReservation = {
    userId,
    reserved: 0,
    applied: false,
    settled: false,
    timer: null,
  }
  if (reserved === 0) return empty

  return withUserLock(userId, async () => {
    const quota = await prisma.userQuota.findUnique({ where: { userId } })
    // 无配额记录视为不限制（与 checkQuota 一致）
    if (!quota) return empty

    let dailyUsed = Number(quota.dailyUsed)
    if (quota.resetAt && quota.resetAt <= new Date()) {
      await prisma.userQuota
        .update({ where: { userId }, data: { dailyUsed: 0, resetAt: null } })
        .catch(() => undefined)
      dailyUsed = 0
    }

    const totalUsed = Number(quota.usedTokens)
    const totalLimit = Number(quota.totalTokens)
    const dailyLimit = Number(quota.dailyLimit)

    if (totalLimit > 0 && totalUsed + reserved > totalLimit) {
      throw new TooManyRequestsError(
        `总 Token 配额不足（剩余 ${Math.max(0, totalLimit - totalUsed)}，本次预计 ${reserved}）`,
      )
    }
    if (dailyLimit > 0 && dailyUsed + reserved > dailyLimit) {
      throw new TooManyRequestsError(
        `今日 Token 配额不足（剩余 ${Math.max(0, dailyLimit - dailyUsed)}，本次预计 ${reserved}）`,
      )
    }

    await prisma.userQuota.update({
      where: { userId },
      data: {
        usedTokens: { increment: BigInt(reserved) },
        dailyUsed: { increment: BigInt(reserved) },
      },
    })

    const reservation: QuotaReservation = {
      userId,
      reserved,
      applied: true,
      settled: false,
      timer: null,
    }

    // 兜底自动释放：进程崩溃 / 路由异常退出时不至于永久占用额度
    const ttlMs = Math.max(10_000, opts.ttlMs ?? 5 * 60_000)
    reservation.timer = setTimeout(() => {
      void releaseQuota(prisma, reservation)
    }, ttlMs)
    ;(reservation.timer as unknown as { unref?: () => void }).unref?.()

    return reservation
  })
}

/** 回滚预扣（调用失败 / 无产出）。 */
export async function releaseQuota(
  prisma: PrismaClient,
  reservation: QuotaReservation | null | undefined,
): Promise<void> {
  if (!reservation || !reservation.applied || reservation.settled) return
  reservation.settled = true
  if (reservation.timer) {
    clearTimeout(reservation.timer)
    reservation.timer = null
  }
  await adjustQuota(prisma, reservation.userId, -reservation.reserved)
}

/**
 * 标记已结算（实际差额由 recordUsage 的 reservedTokens 参数完成）。
 *
 * 仅清理定时器，不再写库，避免与 recordUsage 重复调整。
 */
export function markQuotaSettled(reservation: QuotaReservation | null | undefined): void {
  if (!reservation || reservation.settled) return
  reservation.settled = true
  if (reservation.timer) {
    clearTimeout(reservation.timer)
    reservation.timer = null
  }
}

/** 估算本次请求的预扣额度（prompt 粗估 + 输出上限）。 */
export function estimateReservation(promptText: string, maxTokens?: number | null): number {
  const promptTokens = Math.max(1, Math.ceil(promptText.length / 4))
  const outputTokens = Math.max(1, maxTokens ?? 1024)
  return promptTokens + outputTokens
}
