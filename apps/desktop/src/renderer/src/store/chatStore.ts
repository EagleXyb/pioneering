// ============================================================
// Chat Store — 聊天会话状态管理 (Zustand)
// ============================================================

import { create } from 'zustand'
import type { ChatSession, ChatMessage } from '@shared/types'
import { chatService } from '../services/api/chat'

interface ChatState {
  // 会话列表
  sessions: ChatSession[]
  sessionsLoading: boolean
  currentSessionId: string | null

  // 消息
  messages: Record<string, ChatMessage[]> // sessionId → messages
  messagesLoading: boolean

  // 流式输出状态
  streamingContent: string
  streamingMessageId: string | null
  isStreaming: boolean
  abortController: AbortController | null

  // 错误
  error: string | null

  // 操作
  loadSessions: () => Promise<void>
  createSession: (title?: string) => Promise<ChatSession>
  selectSession: (sessionId: string) => void
  loadMessages: (sessionId: string) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  stopStreaming: () => void
  deleteSession: (sessionId: string) => Promise<void>
  clearError: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  sessionsLoading: false,
  currentSessionId: null,
  messages: {},
  messagesLoading: false,
  streamingContent: '',
  streamingMessageId: null,
  isStreaming: false,
  abortController: null,
  error: null,

  loadSessions: async () => {
    set({ sessionsLoading: true, error: null })
    try {
      const data = await chatService.getSessions()
      set({ sessions: data.sessions, sessionsLoading: false })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load sessions',
        sessionsLoading: false
      })
    }
  },

  createSession: async (title) => {
    set({ error: null })
    try {
      const session = await chatService.createSession({
        title: title ?? 'New Chat'
      })
      set((state) => ({
        sessions: [session, ...state.sessions],
        currentSessionId: session.id
      }))
      return session
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to create session'
      })
      throw err
    }
  },

  selectSession: (sessionId) => {
    set({ currentSessionId: sessionId })
    // 如果消息未加载，自动加载
    const state = get()
    if (!state.messages[sessionId]) {
      state.loadMessages(sessionId)
    }
  },

  loadMessages: async (sessionId) => {
    set({ messagesLoading: true, error: null })
    try {
      const data = await chatService.getMessages(sessionId)
      set((state) => ({
        messages: { ...state.messages, [sessionId]: data.messages },
        messagesLoading: false
      }))
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : 'Failed to load messages',
        messagesLoading: false
      })
    }
  },

  sendMessage: async (content) => {
    const { currentSessionId, abortController } = get()

    // 如果正在流式输出，先停止
    if (abortController) {
      abortController.abort()
    }

    let sessionId = currentSessionId

    // 没有当前会话则自动创建
    if (!sessionId) {
      try {
        const session = await get().createSession(
          content.slice(0, 30) + (content.length > 30 ? '...' : '')
        )
        sessionId = session.id
      } catch {
        return
      }
    }

    // 添加用户消息到本地
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      sessionId: sessionId!,
      role: 'user',
      content,
      createdAt: new Date().toISOString()
    }

    // 准备占位 assistant 消息
    const assistantMsgId = `assistant-${Date.now()}`
    const assistantPlaceholder: ChatMessage = {
      id: assistantMsgId,
      sessionId: sessionId!,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString()
    }

    set((state) => ({
      messages: {
        ...state.messages,
        [sessionId!]: [
          ...(state.messages[sessionId!] || []),
          userMessage,
          assistantPlaceholder
        ]
      },
      streamingContent: '',
      streamingMessageId: assistantMsgId,
      isStreaming: true,
      error: null
    }))

    // 发送流式请求
    const controller = chatService.sendMessageStream(
      {
        sessionId: sessionId!,
        message: content,
        stream: true
      },
      // onChunk
      (chunk) => {
        set((state) => ({
          streamingContent: state.streamingContent + chunk
        }))
      },
      // onDone
      (meta) => {
        set((state) => {
          const msgs = state.messages[sessionId!] || []
          const idx = msgs.findIndex((m) => m.id === assistantMsgId)
          if (idx !== -1) {
            const updated = [...msgs]
            updated[idx] = {
              ...updated[idx],
              id: meta.messageId || assistantMsgId,
              content: state.streamingContent,
              model: meta.model,
              tokenCount: meta.tokenCount
            }
            return {
              messages: { ...state.messages, [sessionId!]: updated },
              isStreaming: false,
              streamingContent: '',
              streamingMessageId: null,
              abortController: null
            }
          }
          return {
            isStreaming: false,
            streamingContent: '',
            streamingMessageId: null,
            abortController: null
          }
        })
      },
      // onError
      (error) => {
        set((state) => {
          const msgs = state.messages[sessionId!] || []
          const idx = msgs.findIndex((m) => m.id === assistantMsgId)
          if (idx !== -1) {
            const updated = [...msgs]
            updated[idx] = {
              ...updated[idx],
              content: `[Error] ${error}`
            }
            return {
              messages: { ...state.messages, [sessionId!]: updated },
              isStreaming: false,
              streamingContent: '',
              streamingMessageId: null,
              abortController: null,
              error
            }
          }
          return {
            isStreaming: false,
            streamingContent: '',
            streamingMessageId: null,
            abortController: null,
            error
          }
        })
      }
    )

    set({ abortController: controller })
  },

  stopStreaming: () => {
    const { abortController } = get()
    if (abortController) {
      abortController.abort()
      set({
        isStreaming: false,
        streamingContent: '',
        streamingMessageId: null,
        abortController: null
      })
    }
  },

  deleteSession: async (sessionId) => {
    set({ error: null })
    try {
      await chatService.deleteSession(sessionId, true)
      set((state) => {
        const { [sessionId]: _, ...restMessages } = state.messages
        return {
          sessions: state.sessions.filter((s) => s.id !== sessionId),
          messages: restMessages,
          currentSessionId:
            state.currentSessionId === sessionId
              ? null
              : state.currentSessionId
        }
      })
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : 'Failed to delete session'
      })
    }
  },

  clearError: () => set({ error: null })
}))
