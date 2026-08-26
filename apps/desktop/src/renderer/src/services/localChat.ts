// ============================================================
// Local Chat Service — 本地会话/消息持久化（云边双模阶段 2）
//
// 主进程经 better-sqlite3 落 userData/local-chat.db，渲染端经
// window.api.localChat 读写（preload localChatApi ↔ ipc-handlers
// LOCAL_CHAT_* 通道）。本 service 把 IPC 封装成与 chatService
// 同构的接口（getSessions/createSession/updateSession/...），
// 供 chatStore 按 session.runtime 分流调用，断网可用。
//
// 结果判别约定：主进程失败时返回 { ok:false, error }（LocalDaoResult），
// 成功返回业务对象；unwrap 统一转换成 异常/业务对象 两种形态。
// ============================================================

import type {
  ChatSession,
  ChatMessage,
  ContentBlock,
  Message,
  ToolCall
} from '@shared/types'
import type {
  LocalSessionListRequest,
  LocalSessionListResult,
  LocalCreateSessionRequest,
  LocalUpdateSessionRequest,
  LocalMessageListRequest,
  LocalMessageListResult,
  LocalAppendMessagesRequest,
  LocalDeleteMessagesRequest,
  LocalFeedbackRequest,
  LocalDaoResult
} from '@shared/ipc-channels'
import { getAgentTransportMode } from './transport'

/** preload localChat API 是否可用（纯浏览器 dev / 单测环境为 false） */
export function isLocalChatAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.api?.localChat
}

/** 本地运行时是否激活：IPC 模式 + 本地 DAO 可用（新建会话归属 local 的判据） */
export function isLocalRuntimeActive(): boolean {
  return getAgentTransportMode() === 'ipc' && isLocalChatAvailable()
}

/** 判别主进程返回的是错误结果还是业务对象 */
function isDaoError(r: unknown): r is LocalDaoResult {
  return (
    !!r &&
    typeof r === 'object' &&
    (r as LocalDaoResult).ok === false &&
    typeof (r as LocalDaoResult).error === 'string'
  )
}

function unwrap<T>(r: T | LocalDaoResult, action: string): T {
  if (isDaoError(r)) {
    throw new Error(`[localChat] ${action} 失败：${r.error}`)
  }
  return r as T
}

function unwrapVoid(r: LocalDaoResult, action: string): void {
  if (r && !r.ok) {
    throw new Error(`[localChat] ${action} 失败：${r.error}`)
  }
}

// ============================================================
// Message ↔ ChatMessage 持久化转换
// ============================================================

/** ToolCall.status → ContentBlock.status（对齐 mapContentBlocks 的正向映射） */
function toBlockStatus(s: ToolCall['status']): string {
  if (s === 'completed') return 'success'
  return s
}

/**
 * 把渲染端 Message 聚合态压回可持久化的 contentBlocks。
 * 逆向对齐 chatStore.mapContentBlocks：
 *   thinking → {type:'thinking'}（历史回读时还原 thinking.content）
 *   toolCalls → tool_call + tool_result 对（还原工具轨迹）
 *   正文存 ChatMessage.content 字段本身，不产 text_stream 块。
 */
export function buildPersistBlocks(msg: Message): ContentBlock[] | undefined {
  const blocks: ContentBlock[] = []
  if (msg.thinking?.content) {
    blocks.push({ type: 'thinking', summary: msg.thinking.content })
  }
  for (const tc of msg.toolCalls ?? []) {
    blocks.push({
      type: 'tool_call',
      toolName: tc.name,
      executionId: tc.id,
      status: toBlockStatus(tc.status)
    })
    if (tc.result !== undefined || tc.errorMessage !== undefined) {
      blocks.push({
        type: 'tool_result',
        executionId: tc.id,
        summary: tc.errorMessage ?? tc.result ?? '',
        status: toBlockStatus(tc.status)
      })
    }
  }
  return blocks.length > 0 ? blocks : undefined
}

/** 渲染端 Message → 本地库 ChatMessage（落 LOCAL_CHAT_APPEND_MESSAGES 的载荷） */
export function toPersistMessage(msg: Message): ChatMessage {
  return {
    id: msg.id,
    sessionId: msg.sessionId,
    role: msg.role,
    content: msg.content,
    parentMessageId: msg.parentMessageId,
    model: msg.model,
    tokenCount: msg.tokenCount,
    feedback: msg.feedback,
    createdAt: msg.createdAt,
    contentBlocks: buildPersistBlocks(msg)
  }
}

// ============================================================
// localChatService — 与 chatService 同构的本地实现
// ============================================================

export const localChatService = {
  /** 会话列表（最新在前，语义对齐 chatService.getSessions） */
  async getSessions(
    page = 1,
    pageSize = 20,
    archived = false
  ): Promise<LocalSessionListResult> {
    const req: LocalSessionListRequest = { page, pageSize, archived }
    return unwrap<LocalSessionListResult>(
      await window.api.localChat.listSessions(req),
      'listSessions'
    )
  },

  /** 创建本地会话（runtime 恒为 'local'） */
  async createSession(data?: LocalCreateSessionRequest): Promise<ChatSession> {
    return unwrap<ChatSession>(
      await window.api.localChat.createSession(data ?? {}),
      'createSession'
    )
  },

  /** 更新会话（标题 / modelConfig / 归档） */
  async updateSession(
    sessionId: string,
    patch: LocalUpdateSessionRequest
  ): Promise<ChatSession> {
    return unwrap<ChatSession>(
      await window.api.localChat.updateSession(sessionId, patch),
      'updateSession'
    )
  },

  /** 物理删除会话（级联删除消息） */
  async deleteSession(sessionId: string): Promise<void> {
    unwrapVoid(await window.api.localChat.deleteSession(sessionId), 'deleteSession')
  },

  /** 消息分页（游标语义对齐 chatService.getMessages） */
  async getMessages(
    sessionId: string,
    cursor?: string,
    limit = 50
  ): Promise<LocalMessageListResult> {
    const req: LocalMessageListRequest = { sessionId, cursor, limit }
    return unwrap<LocalMessageListResult>(
      await window.api.localChat.listMessages(req),
      'listMessages'
    )
  },

  /** 批量追加消息（INSERT OR IGNORE 幂等；用户消息即时落库、assistant 终态聚合后落库） */
  async appendMessages(sessionId: string, messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) return
    const req: LocalAppendMessagesRequest = { sessionId, messages }
    unwrapVoid(await window.api.localChat.appendMessages(req), 'appendMessages')
  },

  /** 按 id 删除消息（regenerate 截断等场景） */
  async deleteMessages(sessionId: string, messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return
    const req: LocalDeleteMessagesRequest = { sessionId, messageIds }
    unwrapVoid(await window.api.localChat.deleteMessages(req), 'deleteMessages')
  },

  /** 消息反馈 */
  async sendFeedback(
    messageId: string,
    feedback: 'like' | 'dislike' | 'none'
  ): Promise<void> {
    const req: LocalFeedbackRequest = { messageId, feedback }
    unwrapVoid(await window.api.localChat.updateFeedback(req), 'updateFeedback')
  },

  /**
   * 本地标题生成（降级启发式）：截取首条用户消息前 30 字并落库。
   * 云端 /generate-title 依赖 LLM 端点，本地模式不走网络。
   */
  async generateTitleFrom(sessionId: string, firstUserContent: string): Promise<string | null> {
    const trimmed = firstUserContent.trim()
    if (!trimmed) return null
    const title = trimmed.slice(0, 30) + (trimmed.length > 30 ? '...' : '')
    try {
      const updated = await this.updateSession(sessionId, { title })
      return updated.title || title
    } catch {
      return title
    }
  }
}
