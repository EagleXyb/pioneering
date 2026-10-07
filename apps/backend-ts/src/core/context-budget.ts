/**
 * 会话历史的 token 预算选择（T3.7）
 *
 * 替代固定「最近 20 条」：始终保留最近 keepLastN 条，其余消息从旧到新
 * 在 token 预算（chars/4 近似）内尽量多带，输出保持旧→新顺序。
 */
import type { PrismaClient } from '@prisma/client'

export interface HistoryBudget {
  /** token 上限（0=不限制） */
  maxTokens?: number
  /** 始终保留的最近消息数 */
  keepLastN?: number
  /** DB 候选窗口条数 */
  candidateLimit?: number
}

export interface HistoryMessage {
  role: string
  content: string
}

export async function loadSessionHistoryByBudget(
  prisma: PrismaClient,
  sessionId: string,
  budget: HistoryBudget = {},
): Promise<HistoryMessage[]> {
  const maxTokens = budget.maxTokens ?? 8000
  const keepLastN = Math.max(0, budget.keepLastN ?? 6)
  const candidateLimit = Math.max(keepLastN, budget.candidateLimit ?? 100)

  // newest → oldest
  const rows = (await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: candidateLimit,
    select: { role: true, content: true },
  })) as Array<{ role: string; content: string | null }>

  const cost = (content: string | null): number =>
    Math.max(1, Math.ceil((content ?? '').length / 4))

  // 1) 最近 N 条无条件保留（unshift 维持旧→新）
  const kept: HistoryMessage[] = []
  let usedTokens = 0
  const guaranteed = rows.slice(0, keepLastN)
  // guaranteed 为「新→旧」：顺序 unshift 得到旧→新
  for (let i = 0; i < guaranteed.length; i++) {
    const row = guaranteed[i]!
    kept.unshift({ role: row.role, content: row.content ?? '' })
    usedTokens += cost(row.content)
  }

  // 2) 更早的消息：从紧邻保留段的位置向旧方向添加，直到预算用尽
  const older = rows.slice(keepLastN)
  const accepted: Array<{ role: string; content: string | null }> = []
  for (const row of older) {
    const c = cost(row.content)
    if (maxTokens > 0 && usedTokens + c > maxTokens) break
    accepted.push(row)
    usedTokens += c
  }
  // accepted 为「较新→较旧」，顺序 unshift 得到旧→新
  for (let i = 0; i < accepted.length; i++) {
    const row = accepted[i]!
    kept.unshift({ role: row.role, content: row.content ?? '' })
  }

  return kept
}
