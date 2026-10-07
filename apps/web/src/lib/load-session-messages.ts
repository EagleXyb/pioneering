/**
 * 拉取会话历史并转换为 ChatMessagesData（pro / task 共用，T3.2 抽取）
 * 同时返回原始消息（含 contentBlocks），供模式恢复面板步骤（T3.3）。
 * 各模式自己的引用重置/状态装配仍留在 Hook 内。
 */
import { getMessages } from '../api/message'
import { convertMessages, type ChatMessageData } from '../api/converter'
import type { Message } from '../api/types'

export interface SessionMessages {
  messages: ChatMessageData[]
  rawMessages: Message[]
}

export async function fetchSessionMessages(
  sessionId: string,
): Promise<SessionMessages> {
  const resp = await getMessages(sessionId)
  return { messages: convertMessages(resp.messages), rawMessages: resp.messages }
}
