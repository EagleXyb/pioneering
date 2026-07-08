// ============================================================
// Chat Store — 聊天会话状态管理 (Zustand)
// 同时支撑普通对话与后端 Agent 流式：累积思考过程(thenking)
// 与工具调用轨迹(toolCalls)，并在历史消息中回填 contentBlocks。
// ============================================================

import { create } from 'zustand'
import type {
  ChatSession,
  ChatMessage,
  Message,
  ThinkingBlock,
  ToolCall,
  ContentBlock,
  AttachedImage
} from '@shared/types'
import { chatService } from '../services/api/chat'
import { agentService } from '../services/api/agent'
import type { ImageAttachment } from '../lib/input/image-attachments'

interface ChatState {
  sessions: ChatSession[]
  sessionsLoading: boolean
  currentSessionId: string | null

  messages: Record<string, Message[]>
  messagesLoading: boolean

  streamingContent: string
  streamingThinking: string
  streamingToolCalls: ToolCall[]
  streamingMessageId: string | null
  isStreaming: boolean
  abortController: AbortController | null

  /** 当前发送是否走 Agent 端点（/agent/completions） */
  agentMode: boolean
  error: string | null

  loadSessions: () => Promise<void>
  createSession: (title?: string) => Promise<ChatSession>
  selectSession: (sessionId: string) => void
  loadMessages: (sessionId: string) => Promise<void>
  sendMessage: (
    content: string,
    extra?: { images?: ImageAttachment[]; selectedFiles?: string[]; skill?: string | null }
  ) => Promise<void>
  stopStreaming: () => void
  setAgentMode: (mode: boolean) => void
  deleteSession: (sessionId: string) => Promise<void>
  clearError: () => void
}

/** 将后端 contentBlocks 转换为前端 thinking + toolCalls */
function mapContentBlocks(
  blocks?: ContentBlock[]
): { thinking?: ThinkingBlock; toolCalls?: ToolCall[] } {
  if (!blocks || blocks.length === 0) return {}
  let thinkingContent = ''
  const toolCalls: ToolCall[] = []
  const toolIndexById = new Map<string, number>()

  const mapStatus = (s?: string): ToolCall['status'] =>
    s === 'success' ? 'completed' : ((s as ToolCall['status']) ?? 'pending')

  for (const b of blocks) {
    if (b.type === 'thinking') {
      thinkingContent += b.summary ?? ''
    } else if ((b as { reasoningContent?: string }).reasoningContent) {
      // 普通对话历史落库格式：content_blocks = [{ reasoningContent: "..." }]（无 type 字段）
      thinkingContent += (b as { reasoningContent?: string }).reasoningContent ?? ''
    } else if (b.type === 'tool_call') {
      const id = b.executionId || `tool_${toolCalls.length}`
      toolIndexById.set(id, toolCalls.length)
      toolCalls.push({
        id,
        name: b.toolName || 'tool',
        status: mapStatus(b.status),
        arguments: {}
      })
    } else if (b.type === 'tool_result') {
      const idx = b.executionId ? toolIndexById.get(b.executionId) : undefined
      if (idx !== undefined && toolCalls[idx]) {
        toolCalls[idx] = { ...toolCalls[idx]!, status: 'completed', result: b.summary }
      }
    }
  }

  return {
    thinking: thinkingContent ? { content: thinkingContent } : undefined,
    toolCalls: toolCalls.length ? toolCalls : undefined
  }
}

function chatMessageToMessage(msg: ChatMessage): Message {
  const { thinking, toolCalls } = mapContentBlocks(msg.contentBlocks)
  return {
    ...msg,
    timestamp: new Date(msg.createdAt).getTime(),
    thinking,
    toolCalls,
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
  streamingThinking: '',
  streamingToolCalls: [],
  streamingMessageId: null,
  isStreaming: false,
  abortController: null,
  agentMode: false,
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

  sendMessage: async (content, extra) => {
    const { currentSessionId, abortController, agentMode } = get()
    const images = (extra?.images ?? []) as AttachedImage[]

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
      timestamp: now,
      images: images.length ? images : undefined
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
      streamingThinking: '',
      streamingToolCalls: [],
      streamingMessageId: assistantMsgId,
      isStreaming: true,
      error: null
    }))

    let pendingContent = ''
    let pendingThinking = ''
    const liveToolCalls: ToolCall[] = []
    const toolIndexById = new Map<string, number>()
    let rafId: number | null = null

    const scheduleUpdate = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        const content = pendingContent
        const thinking = pendingThinking
        pendingContent = ''
        pendingThinking = ''
        rafId = null
        set({
          streamingContent: content,
          streamingThinking: thinking,
          streamingToolCalls: liveToolCalls.slice()
        })
      })
    }

    const controller = (agentMode ? agentService : chatService).sendMessageStream(
      {
        sessionId: _sessionId,
        message: content,
        stream: true
      },
      {
        onChunk: (delta) => {
          pendingContent += delta
          scheduleUpdate()
        },
        onThinking: (delta) => {
          pendingThinking += delta
          scheduleUpdate()
        },
        onToolCallStart: ({ id, name }) => {
          const idx = liveToolCalls.length
          toolIndexById.set(id, idx)
          liveToolCalls.push({
            id,
            name,
            status: 'running',
            arguments: {},
            startTime: Date.now()
          })
          scheduleUpdate()
        },
        onToolCallResult: ({ id, name, result }) => {
          const idx = toolIndexById.get(id)
          if (idx !== undefined && liveToolCalls[idx]) {
            liveToolCalls[idx] = {
              ...liveToolCalls[idx]!,
              name: liveToolCalls[idx]!.name || name,
              status: 'completed',
              result,
              endTime: Date.now()
            }
          } else {
            liveToolCalls.push({ id, name, status: 'completed', arguments: {}, result, endTime: Date.now() })
          }
          scheduleUpdate()
        },
        onDone: (meta) => {
          if (rafId !== null) {
            cancelAnimationFrame(rafId)
            rafId = null
          }
          const finalMsgId = meta.messageId || assistantMsgId
          const finalThinking = pendingThinking || get().streamingThinking
          const finalToolCalls = liveToolCalls.slice()
          pendingThinking = ''
          pendingContent = ''
          set((state) => {
            const finalContent = pendingContent || state.streamingContent
            const msgs = state.messages[_sessionId] || []
            const idx = msgs.findIndex((m) => m.id === assistantMsgId)
            if (idx !== -1) {
              const prevMsg = msgs[idx]!
              const updated = [...msgs]
              updated[idx] = {
                ...prevMsg,
                id: finalMsgId,
                sessionId: _sessionId,
                content: finalContent,
                thinking: finalThinking ? { content: finalThinking } : undefined,
                toolCalls: finalToolCalls.length ? finalToolCalls : undefined,
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
                streamingThinking: '',
                streamingToolCalls: [],
                streamingMessageId: null,
                abortController: null
              }
            }
            return {
              isStreaming: false,
              streamingContent: '',
              streamingThinking: '',
              streamingToolCalls: [],
              streamingMessageId: null,
              abortController: null
            }
          })
        },
        onError: (error) => {
          if (rafId !== null) {
            cancelAnimationFrame(rafId)
            rafId = null
          }
          const finalContent = pendingContent || get().streamingContent
          const finalThinking = pendingThinking || get().streamingThinking
          const finalToolCalls = liveToolCalls.slice()
          pendingContent = ''
          pendingThinking = ''
          set((state) => {
            const msgs = state.messages[_sessionId] || []
            const idx = msgs.findIndex((m) => m.id === assistantMsgId)
            if (idx !== -1) {
              const prevMsg = msgs[idx]!
              const updated = [...msgs]
              updated[idx] = {
                ...prevMsg,
                id: assistantMsgId,
                sessionId: _sessionId,
                content: finalContent ? `${finalContent}\n\n[Error] ${error}` : `[Error] ${error}`,
                thinking: finalThinking ? { content: finalThinking } : prevMsg.thinking,
                toolCalls: finalToolCalls.length ? finalToolCalls : prevMsg.toolCalls,
                timestamp: Date.now()
              }
              return {
                messages: { ...state.messages, [_sessionId]: updated },
                isStreaming: false,
                streamingContent: '',
                streamingThinking: '',
                streamingToolCalls: [],
                streamingMessageId: null,
                abortController: null,
                error
              }
            }
            return {
              isStreaming: false,
              streamingContent: '',
              streamingThinking: '',
              streamingToolCalls: [],
              streamingMessageId: null,
              abortController: null,
              error
            }
          })
        }
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
        streamingThinking: '',
        streamingToolCalls: [],
        streamingMessageId: null,
        abortController: null
      })
    }
  },

  setAgentMode: (mode) => set({ agentMode: mode }),

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
            state.currentSessionId === sessionId ? null : state.currentSessionId
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
