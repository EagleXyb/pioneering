// ============================================================
// Chat Service — 聊天/会话相关 API
// ============================================================

import apiClient from './client'
import type {
  ChatSession,
  ChatMessage,
  CreateSessionRequest,
  UpdateSessionRequest,
  SendMessageRequest,
  PaginatedData
} from '@shared/types'

export const chatService = {
  /** 获取会话列表 */
  async getSessions(
    page = 1,
    pageSize = 20,
    archived = false
  ): Promise<PaginatedData<ChatSession>> {
    const res = await apiClient.get<PaginatedData<ChatSession>>(
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
   * 返回 AbortController 用于取消请求
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
    const axiosInstance = apiClient.getAxiosInstance()

    const url = `${apiClient.getBaseURL()}/chat/completions`
    const payload = { ...request, stream: true }

    // 使用 fetch 实现 SSE（axios 对流式支持不佳）
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiClient.getAccessToken()
          ? `Bearer ${apiClient.getAccessToken()}`
          : ''
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
              const parsed = JSON.parse(jsonStr)
              if (parsed.type === 'content' && parsed.content) {
                onChunk(parsed.content)
              } else if (parsed.type === 'done') {
                onDone({
                  messageId: parsed.messageId,
                  sessionId: parsed.sessionId,
                  model: parsed.model,
                  tokenCount: parsed.tokenCount
                })
              } else if (parsed.type === 'error') {
                onError(parsed.error || 'Unknown error')
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
