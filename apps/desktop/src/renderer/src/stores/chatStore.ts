// ============================================================
// Chat Store — 聊天会话状态管理 (Zustand)
// 同时支撑普通对话与后端 Agent 流式：累积思考过程(thinking)
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
  AttachedImage,
  TraceNode
} from '@shared/types'
import { chatService } from '../services/api/chat'
import { agentService } from '../services/api/agent'
import type { ImageAttachment } from '../lib/input/image-attachments'
import { buildSendText } from '../lib/input/select-file-editor'
import {
  createStreamHandler,
  makeThinkingNodeId,
  makeTextNodeId,
  makeObservationNodeId
} from '../services/stream-handler'

const DEFAULT_IDLE_TIMEOUT_MS = 60000
const DEFAULT_AGENT_MODE_VALUE = 'react_agent'

interface ChatState {
  sessions: ChatSession[]
  sessionsLoading: boolean
  currentSessionId: string | null

  messages: Record<string, Message[]>
  messagesLoading: boolean
  messagesNextCursor: Record<string, string | undefined>
  messagesHasMore: Record<string, boolean>

  streamingContent: string
  streamingThinking: string
  streamingToolCalls: ToolCall[]
  // M1: 流式 trace 树快照（每帧 rAF 更新）
  streamingTraceNodes: Record<string, TraceNode>
  streamingTraceRootOrder: string[]
  streamingMessageId: string | null
  isStreaming: boolean
  abortController: AbortController | null

  /** UI 层 Agent 模式开关（true = 走 Agent 端点）；实际发送时以当前会话的 agentMode 为准 */
  agentMode: boolean
  error: string | null

  loadSessions: () => Promise<void>
  createSession: (title?: string) => Promise<ChatSession>
  selectSession: (sessionId: string) => void
  loadMessages: (sessionId: string, append?: boolean) => Promise<void>
  loadMoreMessages: () => Promise<void>
  sendMessage: (
    content: string,
    extra?: { images?: ImageAttachment[]; selectedFiles?: string[]; skill?: string | null; model?: string }
  ) => Promise<void>
  stopStreaming: () => void
  setAgentMode: (mode: boolean) => void
  toggleMessageFeedback: (messageId: string, feedback: 'like' | 'dislike' | 'none') => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  regenerateMessage: (messageId: string) => Promise<void>
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
      thinkingContent += (b as { reasoningContent?: string }).reasoningContent ?? ''
    } else if (b.type === 'text_stream') {
      thinkingContent += b.text ?? ''
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
        const st = b.status
        const mapped: ToolCall['status'] =
          st === 'error' || st === 'failed'
            ? 'error'
            : st === 'pending'
              ? 'pending'
              : 'completed'
        toolCalls[idx] = { ...toolCalls[idx]!, status: mapped, result: b.summary }
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
    feedback: msg.feedback,
    tokenUsage: msg.tokenCount ? { prompt: 0, completion: msg.tokenCount, total: msg.tokenCount } : undefined
  }
}

function isAgentSession(session: ChatSession | undefined): boolean {
  return !!(session && session.agentMode)
}

let streamSeq = 0

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  sessionsLoading: false,
  currentSessionId: null,
  messages: {},
  messagesLoading: false,
  messagesNextCursor: {},
  messagesHasMore: {},
  streamingContent: '',
  streamingThinking: '',
  streamingToolCalls: [],
  streamingTraceNodes: {},
  streamingTraceRootOrder: [],
  streamingMessageId: null,
  isStreaming: false,
  abortController: null,
  agentMode: false,
  error: null,

  loadSessions: async () => {
    set({ sessionsLoading: true, error: null })
    try {
      const data = await chatService.getSessions(1, 50)
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
      const isAgent = get().agentMode
      const session = isAgent
        ? await agentService.createSession({
            title: title ?? 'New Agent Chat',
            agentMode: DEFAULT_AGENT_MODE_VALUE
          })
        : await chatService.createSession({
            title: title ?? 'New Chat'
          })
      const chatSession: ChatSession = {
        id: session.id,
        title: session.title || title || 'New Chat',
        model: session.model,
        modelConfig: session.modelConfig,
        isArchived: false,
        createdAt: session.createdAt || new Date().toISOString(),
        updatedAt: session.updatedAt || new Date().toISOString(),
        messageCount: session.messageCount,
        agentMode: isAgent ? DEFAULT_AGENT_MODE_VALUE : undefined
      }
      set((state) => ({
        sessions: [chatSession, ...state.sessions],
        currentSessionId: chatSession.id
      }))
      return chatSession
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to create session'
      })
      throw err
    }
  },

  selectSession: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    set({
      currentSessionId: sessionId,
      agentMode: isAgentSession(session)
    })
    const state = get()
    if (!state.messages[sessionId]) {
      state.loadMessages(sessionId)
    }
  },

  loadMessages: async (sessionId, append = false) => {
    set({ messagesLoading: true, error: null })
    try {
      const cursor = append ? get().messagesNextCursor[sessionId] : undefined
      const data = await chatService.getMessages(sessionId, cursor)
      const newMessages = data.messages.map(chatMessageToMessage)
      set((state) => {
        const existing = append ? state.messages[sessionId] || [] : []
        const merged = [...newMessages, ...existing]
        return {
          messages: { ...state.messages, [sessionId]: merged },
          messagesLoading: false,
          messagesNextCursor: {
            ...state.messagesNextCursor,
            [sessionId]: data.nextCursor
          },
          messagesHasMore: {
            ...state.messagesHasMore,
            [sessionId]: !!data.nextCursor
          }
        }
      })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load messages',
        messagesLoading: false
      })
    }
  },

  loadMoreMessages: async () => {
    const { currentSessionId, messagesLoading, messagesHasMore } = get()
    if (!currentSessionId || messagesLoading || !messagesHasMore[currentSessionId]) return
    await get().loadMessages(currentSessionId, true)
  },

  sendMessage: async (content, extra) => {
    const { currentSessionId, abortController, sessions, agentMode: globalAgentMode } = get()
    const images = (extra?.images ?? []) as AttachedImage[]
    const model = extra?.model?.trim()

    if (abortController) {
      abortController.abort()
      const sid = currentSessionId
      if (sid) {
        set((state) => {
          const list = state.messages[sid]
          if (!list || list.length === 0) return state
          const last = list[list.length - 1]
          if (
            last &&
            last.role === 'assistant' &&
            !last.content &&
            !last.thinking &&
            (!last.toolCalls || last.toolCalls.length === 0)
          ) {
            return {
              messages: { ...state.messages, [sid]: list.slice(0, -1) }
            }
          }
          return state
        })
      }
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
    const targetSession = sessions.find((s) => s.id === _sessionId)
    const useAgent = isAgentSession(targetSession) || globalAgentMode
    const now = Date.now()
    const mySeq = ++streamSeq

    const userMessage: Message = {
      id: `user-${now}`,
      sessionId: _sessionId,
      role: 'user',
      content,
      createdAt: new Date(now).toISOString(),
      timestamp: now,
      images: images.length ? images : undefined
    }

    const assistantMsgId = `assistant-${now}-${mySeq}`
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
      streamingTraceNodes: {},
      streamingTraceRootOrder: [],
      streamingMessageId: assistantMsgId,
      isStreaming: true,
      error: null
    }))

    const streamHandler = createStreamHandler({
      mySeq,
      getCurrentSeq: () => streamSeq,
      getCurrentStreamingId: () => get().streamingMessageId,
      assistantMsgId,
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
      onFlush: ({ contentDelta, thinkingDelta, toolCalls, traceNodes, traceRootOrder }) => {
        set((state) => ({
          streamingContent: state.streamingContent + contentDelta,
          streamingThinking: state.streamingThinking + thinkingDelta,
          streamingToolCalls: toolCalls,
          streamingTraceNodes: traceNodes,
          streamingTraceRootOrder: traceRootOrder
        }))
      },
      onDone: ({ msgId, content, thinking, toolCalls, traceNodes, traceRootOrder, meta }) => {
        set((state) => {
          const msgs = state.messages[_sessionId] || []
          const idx = msgs.findIndex((m) => m.id === assistantMsgId)
          // 从 trace 树推导最终的 text 正文（避免依赖外部 content 闭包）
          const textNode = traceNodes[makeTextNodeId(assistantMsgId)]
          const finalContent = textNode?.content ?? content
          if (idx !== -1) {
            const prevMsg = msgs[idx]!
            const updated = [...msgs]
            updated[idx] = {
              ...prevMsg,
              id: msgId,
              sessionId: _sessionId,
              content: finalContent,
              thinking: thinking ? { content: thinking } : undefined,
              toolCalls: toolCalls.length ? toolCalls : undefined,
              traceNodes,
              traceRootOrder,
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
              streamingTraceNodes: {},
              streamingTraceRootOrder: [],
              streamingMessageId: null,
              abortController: null
            }
          }
          return {
            isStreaming: false,
            streamingContent: '',
            streamingThinking: '',
            streamingToolCalls: [],
            streamingTraceNodes: {},
            streamingTraceRootOrder: [],
            streamingMessageId: null,
            abortController: null
          }
        })
      },
      onError: (error, { content, thinking, toolCalls, traceNodes, traceRootOrder }) => {
        set((state) => {
          const msgs = state.messages[_sessionId] || []
          const idx = msgs.findIndex((m) => m.id === assistantMsgId)
          const textNode = traceNodes[makeTextNodeId(assistantMsgId)]
          const baseContent = textNode?.content ?? content
          if (idx !== -1) {
            const prevMsg = msgs[idx]!
            const updated = [...msgs]
            updated[idx] = {
              ...prevMsg,
              id: assistantMsgId,
              sessionId: _sessionId,
              content: baseContent ? `${baseContent}\n\n[Error] ${error}` : `[Error] ${error}`,
              thinking: thinking ? { content: thinking } : prevMsg.thinking,
              toolCalls: toolCalls.length ? toolCalls : prevMsg.toolCalls,
              traceNodes,
              traceRootOrder,
              timestamp: Date.now()
            }
            return {
              messages: { ...state.messages, [_sessionId]: updated },
              isStreaming: false,
              streamingContent: '',
              streamingThinking: '',
              streamingToolCalls: [],
              streamingTraceNodes: {},
              streamingTraceRootOrder: [],
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
            streamingTraceNodes: {},
            streamingTraceRootOrder: [],
            streamingMessageId: null,
            abortController: null,
            error
          }
        })
      }
    })

    const service = useAgent ? agentService : chatService
    const controller = service.sendMessageStream(
      {
        sessionId: _sessionId,
        message: buildSendText(content),
        stream: true,
        model: model && model !== '自定义' ? model : undefined
      },
      streamHandler
    )

    set({ abortController: controller })
  },

  stopStreaming: () => {
    const {
      abortController,
      streamingMessageId,
      streamingContent,
      streamingThinking,
      streamingToolCalls,
      streamingTraceNodes,
      streamingTraceRootOrder,
      currentSessionId,
      sessions,
      agentMode: globalAgentMode
    } = get()
    if (abortController) abortController.abort()

    const targetSession = currentSessionId ? sessions.find((s) => s.id === currentSessionId) : undefined
    const useAgent = isAgentSession(targetSession) || globalAgentMode
    if (currentSessionId) {
      const stopper = useAgent ? agentService : chatService
      void stopper.stopGeneration?.(currentSessionId).catch(() => {})
    }

    const sid = currentSessionId
    const id = streamingMessageId

    set((state) => {
      if (sid && id) {
        const list = state.messages[sid] || []
        const idx = list.findIndex((m) => m.id === id)
        if (idx !== -1) {
          const prev = list[idx]!
          // 停止时把所有在途 trace 节点标记为 completed（用户主动停止不算错误）
          const finalTraceNodes: Record<string, TraceNode> = { ...streamingTraceNodes }
          const now = Date.now()
          for (const n of Object.values(finalTraceNodes)) {
            if (n.status === 'running' || n.status === 'pending') {
              n.status = 'completed'
              n.endTime = now
              if (n.startTime) n.durationMs = now - n.startTime
            }
          }
          const textNode = finalTraceNodes[makeTextNodeId(id)]
          const finalContent = (textNode?.content ?? streamingContent) || prev.content
          const thinkingNode = finalTraceNodes[makeThinkingNodeId(id)]
          const finalThinking = thinkingNode?.content ?? streamingThinking
          const merged = [...list]
          merged[idx] = {
            ...prev,
            content: finalContent,
            thinking: finalThinking ? { content: finalThinking } : prev.thinking,
            toolCalls: streamingToolCalls.length ? streamingToolCalls : prev.toolCalls,
            traceNodes: Object.keys(finalTraceNodes).length ? finalTraceNodes : prev.traceNodes,
            traceRootOrder: streamingTraceRootOrder.length ? streamingTraceRootOrder : prev.traceRootOrder
          }
          return {
            messages: { ...state.messages, [sid]: merged },
            isStreaming: false,
            streamingContent: '',
            streamingThinking: '',
            streamingToolCalls: [],
            streamingTraceNodes: {},
            streamingTraceRootOrder: [],
            streamingMessageId: null,
            abortController: null
          }
        }
      }
      return {
        isStreaming: false,
        streamingContent: '',
        streamingThinking: '',
        streamingToolCalls: [],
        streamingTraceNodes: {},
        streamingTraceRootOrder: [],
        streamingMessageId: null,
        abortController: null
      }
    })
  },

  setAgentMode: (mode) => set({ agentMode: mode }),

  toggleMessageFeedback: async (messageId, feedback) => {
    const { currentSessionId, messages } = get()
    if (!currentSessionId) return
    const list = messages[currentSessionId]
    if (!list) return
    const idx = list.findIndex((m) => m.id === messageId)
    if (idx === -1) return

    const prev = list[idx]!
    const next: 'like' | 'dislike' | 'none' = prev.feedback === feedback ? 'none' : feedback
    set((state) => {
      const msgs = state.messages[currentSessionId] || []
      const updated = [...msgs]
      updated[idx] = { ...updated[idx]!, feedback: next }
      return { messages: { ...state.messages, [currentSessionId]: updated } }
    })

    try {
      await chatService.sendFeedback(messageId, next)
    } catch {
      set((state) => {
        const msgs = state.messages[currentSessionId] || []
        const updated = [...msgs]
        updated[idx] = { ...updated[idx]!, feedback: prev.feedback }
        return { messages: { ...state.messages, [currentSessionId]: updated } }
      })
    }
  },

  deleteSession: async (sessionId) => {
    set({ error: null })
    const state = get()
    if (state.isStreaming && state.currentSessionId === sessionId) {
      get().stopStreaming()
    }
    try {
      await chatService.deleteSession(sessionId, true)
      set((state) => {
        const { [sessionId]: _, ...restMessages } = state.messages
        const { [sessionId]: __, ...restCursors } = state.messagesNextCursor
        const { [sessionId]: ___, ...restHasMore } = state.messagesHasMore
        const remaining = state.sessions.filter((s) => s.id !== sessionId)
        return {
          sessions: remaining,
          messages: restMessages,
          messagesNextCursor: restCursors,
          messagesHasMore: restHasMore,
          currentSessionId:
            state.currentSessionId === sessionId
              ? remaining[0]?.id ?? null
              : state.currentSessionId,
          agentMode:
            state.currentSessionId === sessionId
              ? isAgentSession(remaining[0])
              : state.agentMode
        }
      })
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to delete session'
      })
    }
  },

  clearError: () => set({ error: null }),

  regenerateMessage: async (messageId) => {
    const { currentSessionId, messages, isStreaming } = get()
    if (!currentSessionId || isStreaming) return
    const list = messages[currentSessionId]
    if (!list || list.length === 0) return

    const assistantIdx = list.findIndex((m) => m.id === messageId)
    if (assistantIdx === -1) return
    const assistantMsg = list[assistantIdx]
    if (!assistantMsg || assistantMsg.role !== 'assistant') return

    let userIdx = assistantIdx - 1
    while (userIdx >= 0 && list[userIdx]!.role !== 'user') {
      userIdx--
    }
    if (userIdx === -1) return
    const userMsg = list[userIdx]!

    set((state) => {
      const msgs = state.messages[currentSessionId] || []
      const trimmed = msgs.slice(0, userIdx)
      return {
        messages: { ...state.messages, [currentSessionId]: trimmed }
      }
    })

    await get().sendMessage(userMsg.content, {
      images: userMsg.images ? (userMsg.images as ImageAttachment[]) : undefined
    })
  }
}))
