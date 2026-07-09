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
import { buildSendText } from '../lib/input/select-file-editor'

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
    extra?: { images?: ImageAttachment[]; selectedFiles?: string[]; skill?: string | null; model?: string }
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

// M1: 单调递增的流序号。每次 sendMessage 自增；旧流的回调里若发现自己
// 的序号已不是“当前最新序号”则立即丢弃，避免快速连发时旧流闭包
// （pendingContent / liveToolCalls）与新流交错写入，造成工具调用列表
// 错乱或误伤新消息。
let streamSeq = 0

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
    const model = extra?.model?.trim()

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

    // M1: 本次发送的单调递增序号，用于在回调中识别“是否仍是最新流”。
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

    // M1: 将序号并入 id，避免同一毫秒内两次 sendMessage 生成相同的
    // `assistant-${now}` 导致 findIndex 命中错乱（旧/新消息互相覆盖）。
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
        // 将 @{path} 文件引用转为后台约定的 <select-file> 标准线格式；
        // 用户气泡仍保留原始 @{} 文本，仅请求体做转换。
        message: buildSendText(content),
        stream: true,
        model: model && model !== '自定义' ? model : undefined
      },
      {
        // M1: 旧流回调守卫 —— 若已有更新的 sendMessage 自增 streamSeq，
        // 本次（旧流）回调立即放弃，避免 pendingContent/liveToolCalls 被旧流继续累加。
        onChunk: (delta) => {
          if (mySeq !== streamSeq) return
          pendingContent += delta
          scheduleUpdate()
        },
        onThinking: (delta) => {
          if (mySeq !== streamSeq) return
          pendingThinking += delta
          scheduleUpdate()
        },
        onToolCallStart: ({ id, name }) => {
          if (mySeq !== streamSeq) return
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
          if (mySeq !== streamSeq) return
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
        // M1: 旧流（已被新的发送覆盖，或已 stopStreaming 退出）的 onDone 不应落库，
        // 防止误改新消息或残留的占位消息。
        onDone: (meta) => {
          if (mySeq !== streamSeq) return
          if (get().streamingMessageId !== assistantMsgId) return

          if (rafId !== null) {
            cancelAnimationFrame(rafId)
            rafId = null
          }
          // M2: 先 cancel rAF，再立即把尚未 flush 的 pendingContent/pendingThinking
          // 合并进最终值。注意 streamingContent/streamingThinking 是“上一次 rAF flush
          // 时的累计值”，pending 是 flush 之后的新增增量，二者拼接为完整正文/思考，
          // 不能只取一个（否则丢尾帧或丢已 flush 的内容）。
          const finalMsgId = meta.messageId || assistantMsgId
          const finalContent = get().streamingContent + pendingContent || ''
          const finalThinking = get().streamingThinking + pendingThinking || undefined
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
        // M1: 同 onDone，旧流 onError 不落库。
        onError: (error) => {
          if (mySeq !== streamSeq) return
          if (get().streamingMessageId !== assistantMsgId) return

          if (rafId !== null) {
            cancelAnimationFrame(rafId)
            rafId = null
          }
          // M2: 同样先合并 pending 再清空，避免丢失尾部增量。
          const finalContent = get().streamingContent + pendingContent || ''
          const finalThinking = get().streamingThinking + pendingThinking || undefined
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
    const {
      abortController,
      streamingMessageId,
      streamingContent,
      streamingThinking,
      streamingToolCalls,
      currentSessionId
    } = get()
    if (abortController) abortController.abort()

    const sid = currentSessionId
    const id = streamingMessageId

    // 合并已生成的增量，避免停止后留下空气泡 / 丢失已流式输出的内容。
    set((state) => {
      if (sid && id) {
        const list = state.messages[sid] || []
        const idx = list.findIndex((m) => m.id === id)
        if (idx !== -1) {
          const prev = list[idx]!
          const merged = [...list]
          merged[idx] = {
            ...prev,
            content: streamingContent || prev.content,
            thinking: streamingThinking ? { content: streamingThinking } : prev.thinking,
            toolCalls: streamingToolCalls.length ? streamingToolCalls : prev.toolCalls
          }
          return {
            messages: { ...state.messages, [sid]: merged },
            isStreaming: false,
            streamingContent: '',
            streamingThinking: '',
            streamingToolCalls: [],
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
        streamingMessageId: null,
        abortController: null
      }
    })
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
