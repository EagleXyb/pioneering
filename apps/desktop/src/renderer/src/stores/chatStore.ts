// ============================================================
// Chat Store — 聊天会话状态管理 (Zustand)
// ============================================================

import { create } from 'zustand'
import type { ChatSession, ChatMessage, Message } from '@shared/types'
import { chatService } from '../services/api/chat'

interface ChatState {
  sessions: ChatSession[]
  sessionsLoading: boolean
  currentSessionId: string | null

  messages: Record<string, Message[]>
  messagesLoading: boolean

  streamingContent: string
  streamingMessageId: string | null
  isStreaming: boolean
  abortController: AbortController | null

  error: string | null

  loadSessions: () => Promise<void>
  createSession: (title?: string) => Promise<ChatSession>
  selectSession: (sessionId: string) => void
  loadMessages: (sessionId: string) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  stopStreaming: () => void
  deleteSession: (sessionId: string) => Promise<void>
  clearError: () => void
}

function chatMessageToMessage(msg: ChatMessage): Message {
  return {
    ...msg,
    timestamp: new Date(msg.createdAt).getTime(),
    thinking: undefined,
    toolCalls: undefined,
    tokenUsage: msg.tokenCount ? { prompt: 0, completion: msg.tokenCount, total: msg.tokenCount } : undefined
  }
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
    const state = get()
    if (!state.messages[sessionId]) {
      state.loadMessages(sessionId)
    }
  },

  loadMessages: async (sessionId) => {
    set({ messagesLoading: true, error: null })
    try {
      const data = await chatService.getMessages(sessionId)
      const messages = data.messages.map(chatMessageToMessage)
      set((state) => ({
        messages: { ...state.messages, [sessionId]: messages },
        messagesLoading: false
      }))
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load messages',
        messagesLoading: false
      })
    }
  },

  sendMessage: async (content) => {
    const { currentSessionId, abortController } = get()

    if (abortController) {
      abortController.abort()
    }

    let sessionId = currentSessionId

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

    const _sessionId = sessionId
    const now = Date.now()

    const userMessage: Message = {
      id: `user-${now}`,
      sessionId: _sessionId,
      role: 'user',
      content,
      createdAt: new Date(now).toISOString(),
      timestamp: now
    }

    const assistantMsgId = `assistant-${now}`
    const assistantPlaceholder: Message = {
      id: assistantMsgId,
      sessionId: _sessionId,
      role: 'assistant',
      content: '',
      createdAt: new Date(now).toISOString(),
      timestamp: now
    }

    set((state) => ({
      messages: {
        ...state.messages,
        [_sessionId]: [
          ...(state.messages[_sessionId] || []),
          userMessage,
          assistantPlaceholder
        ]
      },
      streamingContent: '',
      streamingMessageId: assistantMsgId,
      isStreaming: true,
      error: null
    }))

    let pendingContent = ''
    let rafId: number | null = null

    const scheduleUpdate = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        const content = pendingContent
        pendingContent = ''
        rafId = null
        set({ streamingContent: content })
      })
    }

    const controller = chatService.sendMessageStream(
      {
        sessionId: _sessionId,
        message: content,
        stream: true
      },
      (chunk) => {
        pendingContent += chunk
        scheduleUpdate()
      },
      (meta) => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }
        const finalMsgId = meta.messageId || assistantMsgId
        const finalSid = meta.sessionId || _sessionId
        set((state) => {
          const finalContent = pendingContent || state.streamingContent
          pendingContent = ''
          const msgs = state.messages[_sessionId] || []
          const idx = msgs.findIndex((m) => m.id === assistantMsgId)
          if (idx !== -1) {
            const prevMsg = msgs[idx]!
            const updated = [...msgs]
            updated[idx] = {
              ...prevMsg,
              id: finalMsgId,
              sessionId: finalSid,
              content: finalContent,
              model: meta.model,
              tokenCount: meta.tokenCount,
              tokenUsage: meta.tokenCount
                ? { prompt: 0, completion: meta.tokenCount, total: meta.tokenCount }
                : undefined,
              timestamp: Date.now()
            }
            return {
              messages: { ...state.messages, [_sessionId]: updated },
              isStreaming: false,
              streamingContent: '',
              streamingMessageId: null,
              abortController: null,
              currentSessionId: finalSid
            }
          }
          return {
            isStreaming: false,
            streamingContent: '',
            streamingMessageId: null,
            abortController: null,
            currentSessionId: finalSid
          }
        })
      },
      (error) => {
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }
        pendingContent = ''
        set((state) => {
          const msgs = state.messages[_sessionId] || []
          const idx = msgs.findIndex((m) => m.id === assistantMsgId)
          if (idx !== -1) {
            const prevMsg = msgs[idx]!
            const updated = [...msgs]
            updated[idx] = {
              ...prevMsg,
              content: `[Error] ${error}`,
              timestamp: Date.now()
            }
            return {
              messages: { ...state.messages, [_sessionId]: updated },
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
        error: err instanceof Error ? err.message : 'Failed to delete session'
      })
    }
  },

  clearError: () => set({ error: null })
}))
