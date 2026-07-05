// ============================================================
// Chat Service — 聊天/会话相关 API
// ============================================================

import apiClient from './client'
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
   * 适配后端 AG-UI 协议事件格式
   *
   * 后端事件流：
   *   RUN_STARTED → [THINKING_START → THINKING_TEXT_MESSAGE_CONTENT* → THINKING_END*] →
   *   TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT* → TEXT_MESSAGE_END →
   *   RUN_FINISHED
   *
   * 异常时：
    *   RUN_ERROR
   */
  sendMessageStream(
    request: SendMessageRequest,
    onChunk: (content: string) => void,
    onDone: (meta: {
      messageId: string
      sessionId: string
      model?: string
      tokenCount?: number
    }) => void,
    onError: (error: string) => void
  ): AbortController {
    const controller = new AbortController()

    const url = `${apiClient.getBaseURL()}/chat/completions`
    const payload = { ...request, stream: true }

    // 跟踪 AG-UI 事件状态
    let capturedMessageId = ''
    let capturedSessionId = ''

    // 使用 fetch 实现 SSE（axios 对流式支持不佳）
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiClient.getAccessToken()
          ? { Authorization: `Bearer ${apiClient.getAccessToken()}` }
          : {})
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          const errData = await response.json().catch(() => ({}))
          onError(errData.message || `HTTP ${response.status}`)
          return
        }

        const reader = response.body?.getReader()
        if (!reader) {
          onError('Response body is not readable')
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || !trimmed.startsWith('data:')) continue

            const jsonStr = trimmed.slice(5).trim()
            if (jsonStr === '[DONE]') continue

            try {
              const event = JSON.parse(jsonStr)

              switch (event.type) {
                // 流开始：记录 sessionId
                case 'RUN_STARTED':
                  capturedSessionId = event.threadId || ''
                  break

                // 文本消息开始：记录 messageId
                case 'TEXT_MESSAGE_START':
                  capturedMessageId = event.messageId || ''
                  break

                // 文本内容块：delta 是增量内容
                case 'TEXT_MESSAGE_CONTENT':
                  if (event.delta) {
                    onChunk(event.delta)
                  }
                  break

                // 流结束
                case 'RUN_FINISHED':
                  onDone({
                    messageId: capturedMessageId,
                    sessionId: capturedSessionId || (request.sessionId ?? ''),
                    model: event.model,
                    tokenCount: event.tokenCount
                  })
                  break

                // 错误
                case 'RUN_ERROR':
                  onError(event.message || 'Unknown error')
                  break

                // 深度思考/工具调用等事件——当前 UI 直接忽略
                case 'THINKING_START':
                case 'THINKING_TEXT_MESSAGE_START':
                case 'THINKING_TEXT_MESSAGE_CONTENT':
                case 'THINKING_TEXT_MESSAGE_END':
                case 'THINKING_END':
                case 'TEXT_MESSAGE_END':
                  break
              }
            } catch {
              // 非 JSON 行，跳过
            }
          }
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          onError(err.message || 'Network error')
        }
      })

    return controller
  }
}
