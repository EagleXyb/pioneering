/**
 * 用户消息「编辑重发」后端支撑（chat / agent 两个通道共用）
 *
 * 背景：产品要求"编辑后将从此处重新开始对话，已有产物不会被删除"。
 * 原实现（POST /chat/messages/:id/regenerate 与 PUT 编辑接口）仅把
 * "喂给 LLM 的上下文数组"截断，数据库里被编辑点之后的旧消息仍然存在，
 * 刷新历史时旧回复会与新回复同时出现在时间轴（语义不符）。
 *
 * 本模块把"更新正文 + 截断其后消息 + 重算会话计数"收敛为一个可复用步骤，
 * 由 /chat/completions 与 /agent/completions 在检测到 messageId 时调用。
 *
 * 口径说明：
 *   - 消息时序统一以 (createdAt, id) 复合键为准，与消息分页接口
 *     GET /chat/sessions/:id/messages 的排序口径完全一致，
 *     避免同毫秒写入的多条消息被漏删或错删。
 *   - 截断使用 deleteMany（硬删）；产物（artifact / plan_steps / run 记录）
 *     与消息分离存储，天然不受影响。
 */
import type { PrismaClient } from '@prisma/client'
import { NotFoundError, ForbiddenError } from '../plugins/error-handler.js'

/** 会话内消息时序锚点 */
export interface MessageAnchor {
  createdAt: Date
  id: string
}

/** (createdAt, id) 复合序中「晚于 anchor」的过滤条件（与分页排序同口径） */
export function messagesAfterWhere(sessionId: string, anchor: MessageAnchor) {
  return {
    sessionId,
    OR: [
      { createdAt: { gt: anchor.createdAt } },
      { createdAt: anchor.createdAt, id: { gt: anchor.id } },
    ],
  }
}

export interface ApplyMessageEditOptions {
  sessionId: string
  userId: string
  messageId: string
  content: string
  /** 是否截断该消息之后的所有消息（编辑重发语义默认开启） */
  truncateAfter: boolean
}

export interface ApplyMessageEditResult {
  id: string
  content: string
  createdAt: Date
  /** 被截断的消息条数（0 表示该消息本就是最后一条） */
  truncatedCount: number
}

/**
 * 应用一次「编辑用户消息」：
 *   1. 校验消息存在（否则 404）且属于当前用户/会话
 *   2. 校验 role === 'user'（否则 403，对齐 Python 与既有 PUT 接口）
 *   3. 更新正文
 *   4. truncateAfter 时删除其后所有消息，并把 messageCount / lastMessageId
 *      重算为截断后的真实值（原实现只做自增，截断后会与库内数据背离）
 */
export async function applyUserMessageEdit(
  prisma: PrismaClient,
  opts: ApplyMessageEditOptions,
): Promise<ApplyMessageEditResult> {
  const { sessionId, userId, messageId, content, truncateAfter } = opts

  const target = await prisma.chatMessage.findFirst({
    where: { id: messageId, sessionId, userId },
  })
  if (!target) {
    throw new NotFoundError('消息不存在')
  }
  if (target.role !== 'user') {
    throw new ForbiddenError('仅允许编辑用户消息')
  }

  const updated = await prisma.chatMessage.update({
    where: { id: messageId },
    data: { content },
  })

  let truncatedCount = 0
  if (truncateAfter) {
    const deleted = await prisma.chatMessage.deleteMany({
      where: messagesAfterWhere(sessionId, { createdAt: target.createdAt, id: target.id }),
    })
    truncatedCount = Number(deleted?.count ?? 0)

    if (truncatedCount > 0) {
      // 重算计数与最后一条消息指针（对齐 /agent 与 /chat 收尾逻辑使用的字段语义）
      const remaining = await prisma.chatMessage.count({ where: { sessionId } })
      const latest = await prisma.chatMessage.findFirst({
        where: { sessionId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      })
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          messageCount: remaining,
          lastMessageId: latest?.id ?? target.id,
        },
      })
    }
  }

  return {
    id: updated.id,
    content: typeof updated.content === 'string' ? updated.content : content,
    createdAt: target.createdAt,
    truncatedCount,
  }
}
