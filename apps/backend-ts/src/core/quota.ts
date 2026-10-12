/**
 * Token 配额校验与用量记录（chat / agent 通道共用，T2.5 抽取）
 *
 * - checkQuota：入口校验总/日限额（resetAt 过期先重置），超限抛 429
 * - recordUsage：写入 token_usage 并扣减用户配额，缺失真实 usage 时按 length/4 估算
 */
import type { PrismaClient } from '@prisma/client'
import { TooManyRequestsError } from '../plugins/error-handler.js'

export interface TokenUsageData {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export async function checkQuota(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  const quota = await prisma.userQuota.findUnique({ where: { userId } })
  if (!quota) return // 无配额记录视为不限制（兼容旧数据）

  let effectiveDailyUsed = Number(quota.dailyUsed)
  if (quota.resetAt && quota.resetAt <= new Date()) {
    await prisma.userQuota
      .update({
        where: { userId },
        data: { dailyUsed: 0, resetAt: null },
      })
      .catch(() => {
        // 重置失败时按原值校验
      })
    effectiveDailyUsed = 0
  }

  const totalUsed = Number(quota.usedTokens)
  const totalLimit = Number(quota.totalTokens)
  const dailyLimit = Number(quota.dailyLimit)
  if (totalLimit > 0 && totalUsed >= totalLimit) {
    throw new TooManyRequestsError(`总 Token 配额已用尽（已用 ${totalUsed}/${totalLimit}）`)
  }
  if (dailyLimit > 0 && effectiveDailyUsed >= dailyLimit) {
    throw new TooManyRequestsError(`今日 Token 配额已用尽（已用 ${effectiveDailyUsed}/${dailyLimit}）`)
  }
}

export interface RecordUsageParams {
  userId: string
  sessionId: string
  messageId: string
  model: string
  usage?: TokenUsageData
  promptText: string
  completionText: string
}

export async function recordUsage(
  prisma: PrismaClient,
  p: RecordUsageParams,
): Promise<void> {
  const promptTokens = p.usage?.promptTokens ?? Math.floor(p.promptText.length / 4)
  const completionTokens =
    p.usage?.completionTokens ?? Math.floor(p.completionText.length / 4)
  const totalTokens =
    p.usage?.totalTokens ?? promptTokens + completionTokens

  await Promise.all([
    prisma.tokenUsage.create({
      data: {
        userId: p.userId,
        sessionId: p.sessionId,
        messageId: p.messageId,
        model: p.model,
        promptTokens,
        completionTokens,
        totalTokens,
      },
    }),
    // upsert：旧用户 / 注册回填缺失时没有 user_quotas 行，update 会抛
    // "Record to update not found"（prisma:error 噪声且计数丢失），
    // 这里按需建行并落地本次用量（默认额度沿用 schema 默认值）。
    prisma.userQuota
      .upsert({
        where: { userId: p.userId },
        create: {
          userId: p.userId,
          usedTokens: BigInt(totalTokens),
          dailyUsed: BigInt(totalTokens),
        },
        update: {
          usedTokens: { increment: BigInt(totalTokens) },
          dailyUsed: { increment: BigInt(totalTokens) },
        },
      })
      .catch(() => {
        // 并发建行冲突等：记账失败不阻断对话主流程
      }),
  ])
}
