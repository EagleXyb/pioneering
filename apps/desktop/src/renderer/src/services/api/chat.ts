// ============================================================
// Chat Service — 聊天/会话相关 API
// ============================================================

import apiClient from './client'
import { streamAgui, type AguiStreamCallbacks } from './agui'
import type {
  ChatSession,
  ChatMessage,
  CreateSessionRequest,
  UpdateSessionRequest,
  SendMessageRequest
} from '@shared/types'

// 后端会话列表响应格式（字段名与后端对齐）
interface SessionListData {
  sessions: ChatSession[]
  total: number
  page: number
  pageSize: number
}

export const chatService = {
  /** 获取会话列表 */
  async getSessions(
    page = 1,
    pageSize = 20,
    archived = false
  ): Promise<SessionListData> {
    const res = await apiClient.get<SessionListData>(
      '/chat/sessions',
      { params: { page, pageSize, archived } }
    )
    return res.data
  },

  /** 创建新会话 */
  async createSession(data?: CreateSessionRequest): Promise<ChatSession> {
    const res = await apiClient.post<ChatSession>('/chat/sessions', data ?? {})
    return res.data
  },

  /** 获取单个会话 */
  async getSession(sessionId: string): Promise<ChatSession> {
    const res = await apiClient.get<ChatSession>(
      `/chat/sessions/${sessionId}`
    )
    return res.data
  },

  /** 更新会话 */
  async updateSession(
    sessionId: string,
    data: UpdateSessionRequest
  ): Promise<ChatSession> {
    const res = await apiClient.put<ChatSession>(
      `/chat/sessions/${sessionId}`,
      data
    )
    return res.data
  },

  /** 删除/归档会话 */
  async deleteSession(
    sessionId: string,
    archive = false
  ): Promise<void> {
    await apiClient.delete(`/chat/sessions/${sessionId}`, {
      params: { archive }
    })
  },

  /** AI 生成会话标题（取最近消息摘要，三级回退由后端处理） */
  async generateTitle(sessionId: string): Promise<string | null> {
    try {
      const res = await apiClient.post<{ title: string }>(
        `/chat/sessions/${sessionId}/generate-title`
      )
      return res.data?.title || null
    } catch {
      return null
    }
  },

  /**
   * 分享会话，返回分享链接。
   * 后端分享接口尚未就绪时返回 null，由 UI 层降级（复制会话信息到剪贴板）。
   */
  async shareSession(sessionId: string): Promise<string | null> {
    try {
      const res = await apiClient.post<{ shareUrl?: string; url?: string }>(
        `/chat/sessions/${sessionId}/share`
      )
      return res.data?.shareUrl ?? res.data?.url ?? null
    } catch {
      return null
    }
  },

  /**
   * 将会话保存/移动到指定工作空间。
   * 后端能力未就绪时静默失败，由 UI 层保持现状（不阻断其他操作）。
   */
  async updateSessionWorkspace(
    sessionId: string,
    workspaceId: string
  ): Promise<ChatSession> {
    const res = await apiClient.put<ChatSession>(
      `/chat/sessions/${sessionId}`,
      { workspaceId }
    )
    return res.data
  },

  /** 获取消息列表 */
  async getMessages(
    sessionId: string,
    cursor?: string,
    limit = 50,
    direction: 'before' | 'after' = 'before'
  ): Promise<{ messages: ChatMessage[]; nextCursor?: string }> {
    const res = await apiClient.get<{
      messages: ChatMessage[]
      nextCursor?: string
    }>(`/chat/sessions/${sessionId}/messages`, {
      params: { cursor, limit, direction }
    })
    return res.data
  },

  /** 编辑消息 */
  async editMessage(
    sessionId: string,
    messageId: string,
    content: string
  ): Promise<ChatMessage> {
    const res = await apiClient.put<ChatMessage>(
      `/chat/sessions/${sessionId}/messages/${messageId}`,
      { content }
    )
    return res.data
  },

  /** 发送消息反馈 */
  async sendFeedback(
    messageId: string,
    feedback: 'like' | 'dislike' | 'none'
  ): Promise<void> {
    await apiClient.post(`/chat/messages/${messageId}/feedback`, { feedback })
  },

  /** 重新生成回复 */
  async regenerate(
    messageId: string,
    model?: string
  ): Promise<void> {
    await apiClient.post(`/chat/messages/${messageId}/regenerate`, { model })
  },

  /** 停止生成 */
  async stopGeneration(sessionId: string): Promise<void> {
    await apiClient.post('/chat/completions/stop', { sessionId })
  },

  /**
   * 发送消息并获取流式响应（SSE）
   * 适配后端 AG-UI 协议事件格式（复用共享解析器 agui.ts，
   * 兼容普通 LLM 流式与 Agent 流式，支持思考过程与工具调用透传）。
   */
  sendMessageStream(
    request: SendMessageRequest,
    cb: AguiStreamCallbacks
  ): AbortController {
    return streamAgui('/chat/completions', request, cb)
  }
}
