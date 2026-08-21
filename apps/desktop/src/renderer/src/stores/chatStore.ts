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
  Attachment,
  TraceNode,
  UserQuestionRequestPayload
} from '@shared/types'
import { chatService } from '../services/api/chat'
import { agentService } from '../services/api/agent'
import type { ImageAttachment } from '../lib/input/image-attachments'
import { buildSendText } from '../lib/input/select-file-editor'
import {
  createStreamHandler,
  makeThinkingNodeId,
  makeTextNodeId,
  type StreamHandlerOptions
} from '../services/stream-handler'
import { buildTraceFromContentBlocks } from '../services/trace-builder'
import { useHitlStore, type HitlItem } from './hitlStore'

const DEFAULT_IDLE_TIMEOUT_MS = 60000
const DEFAULT_AGENT_MODE_VALUE = 'react_agent'
export const DEFAULT_SESSION_TITLE = '新对话'

export interface ChatState {
  sessions: ChatSession[]
  sessionsLoading: boolean
  currentSessionId: string | null

  /**
   * 新建任务 draft 态标记（Lazy Create 延迟创建）：
   * 点击「新建任务」仅进入本地 draft（currentSessionId=null、不调后端、列表无新记录），
   * 首条消息发送时才真正创建会话。draft 态下高亮「新建任务」按钮。
   */
  isDraftNewSession: boolean

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
  streamingAttachments: Attachment[]
  streamingMessageId: string | null
  isStreaming: boolean
  abortController: AbortController | null

  // ===== HITL（阶段二 2.4）=====
  /** 当前待答复的暂停项（interrupt 暂停时由 USER_QUESTION_REQUEST 事件填充） */
  hitlPending: UserQuestionRequestPayload | null
  /** 是否处于暂停待答复态（消息生命周期 streaming→paused→resuming→done） */
  isHitlPaused: boolean

  /** UI 层 Agent 模式开关（true = 走 Agent 端点）；实际发送时以当前会话的 agentMode 为准 */
  agentMode: boolean
  error: string | null

  loadSessions: () => Promise<void>
  /** 清空所有会话与消息数据（登出/切换账号时调用，不触碰流式状态与业务 action） */
  resetSessions: () => void
  /** 进入「新建任务」draft 态：不创建后端会话、不在列表落库，等待首条消息发送时才真正创建 */
  startNewTask: () => void
  createSession: (title?: string) => Promise<ChatSession>
  setSessionTitle: (sessionId: string, title: string) => void
  renameSession: (sessionId: string, title: string) => Promise<void>
  selectSession: (sessionId: string) => void
  loadMessages: (sessionId: string, append?: boolean) => Promise<void>
  loadMoreMessages: () => Promise<void>
  sendMessage: (
    content: string,
    extra?: { images?: ImageAttachment[]; selectedFiles?: string[]; skill?: string | null; model?: string }
  ) => Promise<void>
  stopStreaming: () => void
  setAgentMode: (mode: boolean) => void
  // ===== HITL（阶段二 2.4）=====
  /** 答复暂停项：resume 续写同一条 assistant 消息（approved/feedback/modified_args） */
  resumeHitl: (
    approved: boolean,
    feedback?: string | null,
    modifiedArgs?: Record<string, Record<string, unknown>> | null
  ) => Promise<void>
  /** 中止/拒绝暂停项（用户取消后收尾） */
  abortHitl: () => Promise<void>
  toggleMessageFeedback: (messageId: string, feedback: 'like' | 'dislike' | 'none') => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  /** 分享会话；后端未就绪时返回 null，由 UI 降级 */
  shareSession: (sessionId: string) => Promise<string | null>
  /** 保存会话到指定工作空间；后端未就绪时静默失败 */
  moveSessionToWorkspace: (sessionId: string, workspaceId: string) => Promise<void>
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

/**
 * 收尾时统一清空流式快照。
 * sendMessage 的 onFlush/onDone/onError 与 stopStreaming 四处共用，
 * 替代原先散落的重复字段重置样板。导出以便单测复用。
 */
export function emptyStreaming(): Partial<ChatState> {
  return {
    streamingContent: '',
    streamingThinking: '',
    streamingToolCalls: [],
    streamingTraceNodes: {},
    streamingTraceRootOrder: [],
    streamingAttachments: [],
    streamingMessageId: null,
    isStreaming: false,
    abortController: null
  }
}

/**
 * 把流式快照落盘到 messages[sid][idx] 并清空流式状态。
 * 供 onDone / onError / stopStreaming 复用：定位目标消息、浅合并 patch、清空快照。
 * 若目标消息不在列表中（如已被删除），仅清空快照，不写消息。
 * 导出以便单测复用。
 */
export function finalizeStreamingMessage(
  state: ChatState,
  sid: string,
  msgId: string,
  patch: Partial<Message>
): Partial<ChatState> {
  const msgs = state.messages[sid] ?? []
  const idx = msgs.findIndex((m) => m.id === msgId)
  if (idx === -1) return emptyStreaming()
  const updated = [...msgs]
  updated[idx] = { ...updated[idx]!, ...patch }
  return {
    messages: { ...state.messages, [sid]: updated },
    ...emptyStreaming()
  }
}

/**
 * HITL 暂停收尾（阶段二 2.4）：
 * 把暂停的半截 assistant 消息写入消息列表并标记 paused=true，进入"暂停待答复"态。
 * 与 finalizeStreamingMessage 不同：**保留 streamingMessageId**（= msgId），
 * 供 resume 续写时定位同一条 assistant 消息；也不清空 isHitlPaused。
 */
export function pauseStreamingMessage(
  state: ChatState,
  sid: string,
  msgId: string,
  patch: Partial<Message>
): Partial<ChatState> {
  const msgs = state.messages[sid] ?? []
  const idx = msgs.findIndex((m) => m.id === msgId)
  const base: Partial<ChatState> = {
    streamingMessageId: msgId,
    isHitlPaused: true,
    isStreaming: false,
    abortController: null
  }
  if (idx === -1) return base
  const updated = [...msgs]
  updated[idx] = { ...updated[idx]!, ...patch }
  return {
    messages: { ...state.messages, [sid]: updated },
    ...base
  }
}

// ---- HITL 共享回调（阶段二 2.4）：sendMessage 与 resumeHitl 复用 ----

/** 暂停时的消息 patch：保留半截内容/轨迹，标记 paused=true，供 resume 续写同一条消息 */
function buildRunPausedPatch(st: ChatState, sid: string, msgId: string): Partial<Message> {
  return {
    id: msgId,
    sessionId: sid,
    content: st.streamingContent,
    thinking: st.streamingThinking ? { content: st.streamingThinking } : undefined,
    toolCalls: st.streamingToolCalls.length ? st.streamingToolCalls : undefined,
    traceNodes: st.streamingTraceNodes,
    traceRootOrder: st.streamingTraceRootOrder,
    attachments: st.streamingAttachments.length ? st.streamingAttachments : undefined,
    paused: true,
    timestamp: Date.now()
  }
}

/** 中止/超时收尾的消息 patch：追加「已中止」说明、解除 paused */
function buildHitlAbortedPatch(st: ChatState, sid: string, msgId: string): Partial<Message> {
  const base = st.streamingContent
  return {
    id: msgId,
    sessionId: sid,
    content: base ? `${base}\n\n[已中止] 该操作未执行。` : '[已中止] 该操作未执行。',
    thinking: st.streamingThinking ? { content: st.streamingThinking } : undefined,
    toolCalls: st.streamingToolCalls.length ? st.streamingToolCalls : undefined,
    traceNodes: st.streamingTraceNodes,
    traceRootOrder: st.streamingTraceRootOrder,
    attachments: st.streamingAttachments.length ? st.streamingAttachments : undefined,
    paused: false,
    timestamp: Date.now()
  }
}

/** 把 AG-UI 暂停项（UserQuestionRequestPayload）转成 hitlStore 的 HitlItem */
function toHitlItem(p: UserQuestionRequestPayload): HitlItem {
  return {
    sessionId: p.session_id,
    runId: p.run_id,
    kind: p.kind,
    message: p.message,
    toolCalls: p.tool_calls,
    question: p.question,
    options: p.options
  }
}

function chatMessageToMessage(msg: ChatMessage): Message {
  const { thinking, toolCalls } = mapContentBlocks(msg.contentBlocks)
  const trace = buildTraceFromContentBlocks(msg.contentBlocks, msg.id, msg.content)
  return {
    ...msg,
    timestamp: new Date(msg.createdAt).getTime(),
    thinking,
    toolCalls,
    // 方案A：从 contentBlocks 重建 Trace 树，使历史加载与初次生成的 AgentTimeline 渲染一致
    traceNodes: trace?.nodes,
    traceRootOrder: trace?.roots,
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
  isDraftNewSession: false,
  messages: {},
  messagesLoading: false,
  messagesNextCursor: {},
  messagesHasMore: {},
  streamingContent: '',
  streamingThinking: '',
  streamingToolCalls: [],
  streamingTraceNodes: {},
  streamingTraceRootOrder: [],
  streamingAttachments: [],
  streamingMessageId: null,
  isStreaming: false,
  abortController: null,
  hitlPending: null,
  isHitlPaused: false,
  agentMode: false,
  error: null,

  loadSessions: async () => {
    set({ sessionsLoading: true, error: null })
    try {
      const data = await chatService.getSessions(1, 50)
      // 刷新兜底选中：
      //   - 若 currentSessionId 为空，或选中的 id 不在新列表中（可能被其他端删除），
      //     则自动选中列表第一个会话（后端按 createdAt DESC = 最新会话），
      //   - 确保刷新后不会出现「导航高亮助理 + 会话列表无选中行」的错位。
      //   参考经验 416906：selected 初始化缺失是刷新选中错位的常见根因。
      const list = data.sessions
      const prevId = get().currentSessionId
      const stillValid = prevId && list.some((s) => s.id === prevId)
      const nextCurrent = stillValid ? prevId : list[0]?.id ?? null
      set({ sessions: list, sessionsLoading: false, currentSessionId: nextCurrent, isDraftNewSession: false })
      // 兜底选中后拉取该会话消息，确保中栏内容与选中一致
      if (nextCurrent && nextCurrent !== prevId) {
        await get().loadMessages(nextCurrent)
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load sessions',
        sessionsLoading: false
      })
    }
  },

  // Lazy Create：进入「新建任务」draft 态。
  // 仅清理本地选中与流式残留，不创建后端会话、不在列表落库；
  // 用户首条消息发送时 sendMessage 的「无 sessionId 兜底」才真正调用 createSession。
  startNewTask: () => {
    if (get().isStreaming) get().stopStreaming()
    set({
      currentSessionId: null,
      isDraftNewSession: true,
      ...emptyStreaming()
    })
  },

  createSession: async (title) => {
    set({ error: null })
    // 守卫：当前会话若是未命名的空白会话（标题仍为默认「新对话」），直接复用，
    // 避免反复点击「新建任务」/快捷键在列表堆积大量空会话。
    // 判据用标题而非 messageCount：发消息后阶段一/二会立即改写标题，
    // 标题仍是默认值即代表该会话从未产生过内容。
    const currentId = get().currentSessionId
    if (currentId) {
      const current = get().sessions.find((s) => s.id === currentId)
      if (current && current.title === DEFAULT_SESSION_TITLE) {
        // 复用空白会话时同样退出 draft 态，保证高亮收敛到会话行
        set({ isDraftNewSession: false })
        return current
      }
    }
    try {
      const isAgent = get().agentMode
      const session = isAgent
        ? await agentService.createSession({
            title: title ?? DEFAULT_SESSION_TITLE,
            agentMode: DEFAULT_AGENT_MODE_VALUE
          })
        : await chatService.createSession({
            title: title ?? DEFAULT_SESSION_TITLE
          })
      const chatSession: ChatSession = {
        id: session.id,
        title: session.title || title || DEFAULT_SESSION_TITLE,
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
        currentSessionId: chatSession.id,
        // 真正创建成功，退出 draft 态（高亮从「新建任务」转移到会话行）
        isDraftNewSession: false
      }))
      return chatSession
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to create session'
      })
      throw err
    }
  },

  setSessionTitle: (sessionId, title) => {
    const trimmed = title.trim()
    if (!trimmed) return
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, title: trimmed } : s
      )
    }))
  },

  renameSession: async (sessionId, title) => {
    const trimmed = title.trim()
    if (!trimmed) return
    const prev = get().sessions.find((s) => s.id === sessionId)
    if (!prev) return
    // 乐观更新：先改本地，失败回滚
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, title: trimmed } : s
      )
    }))
    try {
      const service = isAgentSession(prev) ? agentService : chatService
      const updated = await service.updateSession(sessionId, { title: trimmed })
      if (updated?.title) {
        get().setSessionTitle(sessionId, updated.title)
      }
    } catch (err) {
      // 回滚到原标题
      get().setSessionTitle(sessionId, prev.title)
      set({ error: err instanceof Error ? err.message : 'Failed to rename session' })
    }
  },

  selectSession: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId)
    set({
      currentSessionId: sessionId,
      isDraftNewSession: false,
      agentMode: isAgentSession(session)
    })
    const state = get()
    if (!state.messages[sessionId]) {
      state.loadMessages(sessionId)
    }
    // 阶段四边界：关窗/刷新后重连，恢复该会话未答复的 HITL 暂停项
    void useHitlStore.getState().recover(sessionId)
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
    const { currentSessionId, abortController, agentMode: globalAgentMode } = get()
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
        const session = await get().createSession()
        sessionId = session.id
      } catch {
        return
      }
    }

    const _sessionId = sessionId
    // 必须从最新状态取 targetSession：无 sessionId 时上方 createSession 已异步 set 新会话，
    // 闭包里的旧 sessions 引用找不到它，会导致阶段一乐观标题失效、agentMode 误判
    const targetSession = get().sessions.find((s) => s.id === _sessionId)
    // 阶段一（乐观命名）：首条消息且标题仍是默认值时，立即截取前 30 字给用户瞬时反馈。
    // 仅更新本地并记录 optimisticTitle，供阶段二（AI 命名）判断是否仍待生成。
    let optimisticTitle: string | null = null
    if (
      targetSession &&
      targetSession.title === DEFAULT_SESSION_TITLE &&
      (targetSession.messageCount ?? 0) === 0
    ) {
      optimisticTitle = content.slice(0, 30) + (content.length > 30 ? '...' : '')
      get().setSessionTitle(_sessionId, optimisticTitle)
    }
    const useAgent = isAgentSession(targetSession) || globalAgentMode
    const service = useAgent ? agentService : chatService
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
      streamingAttachments: [],
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
      onFlush: ({ contentDelta, thinkingDelta, toolCalls, traceNodes, traceRootOrder, attachments }) => {
        set((state) => ({
          streamingContent: state.streamingContent + contentDelta,
          streamingThinking: state.streamingThinking + thinkingDelta,
          streamingToolCalls: toolCalls,
          streamingTraceNodes: traceNodes,
          streamingTraceRootOrder: traceRootOrder,
          streamingAttachments: attachments
        }))
      },
      onDone: ({ msgId, content, thinking, toolCalls, traceNodes, traceRootOrder, attachments, meta }) => {
        set((state) => {
          // 从 trace 树推导最终的 text 正文（避免依赖外部 content 闭包）
          const textNode = traceNodes[makeTextNodeId(assistantMsgId)]
          const finalContent = textNode?.content ?? content
          return finalizeStreamingMessage(state, _sessionId, assistantMsgId, {
            id: msgId,
            sessionId: _sessionId,
            content: finalContent,
            thinking: thinking ? { content: thinking } : undefined,
            toolCalls: toolCalls.length ? toolCalls : undefined,
            traceNodes,
            traceRootOrder,
            attachments: attachments.length ? attachments : undefined,
            model: meta.model,
            tokenCount: meta.tokenCount,
            tokenUsage: meta.tokenCount
              ? { prompt: 0, completion: meta.tokenCount, total: meta.tokenCount }
              : undefined,
            timestamp: Date.now()
          })
        })
        // 阶段二（AI 命名）：助手实际回复了内容，且标题仍是默认值或阶段一的临时截断值时，
        // 调用后端生成 AI 摘要标题覆盖；失败则保留阶段一结果（后续消息可重试）。
        // 触发判据用「标题值」而非时间标志：AI 标题生成后标题不再是默认/临时值，
        // 刷新后从后端读回已持久化的固定标题，不会重复生成导致标题反复变化。
        const doneTextNode = traceNodes[makeTextNodeId(assistantMsgId)]
        const doneContent = doneTextNode?.content ?? content
        if (doneContent) {
          const current = get().sessions.find((s) => s.id === _sessionId)
          const stillNeedsTitle =
            current &&
            (current.title === DEFAULT_SESSION_TITLE ||
              (optimisticTitle !== null && current.title === optimisticTitle))
          if (stillNeedsTitle) {
            service
              .generateTitle(_sessionId)
              .then((title) => {
                if (title) get().setSessionTitle(_sessionId, title)
              })
              .catch(() => {})
          }
        }
      },
      onError: (error, { content, thinking, toolCalls, traceNodes, traceRootOrder, attachments }) => {
        set((state) => {
          const textNode = traceNodes[makeTextNodeId(assistantMsgId)]
          const baseContent = textNode?.content ?? content
          return {
            ...finalizeStreamingMessage(state, _sessionId, assistantMsgId, {
              id: assistantMsgId,
              sessionId: _sessionId,
              content: baseContent ? `${baseContent}\n\n[Error] ${error}` : `[Error] ${error}`,
              thinking: thinking ? { content: thinking } : undefined,
              toolCalls: toolCalls.length ? toolCalls : undefined,
              traceNodes,
              traceRootOrder,
              attachments: attachments.length ? attachments : undefined,
              timestamp: Date.now()
            }),
            error
          }
        })
      },
      // ===== HITL（阶段二 2.4）=====
      // 消息生命周期由 streaming→done/error 扩展为 streaming→paused→resuming→done：
      //   - onHumanInputRequest：暂存暂停项（由 HitlHost 同步到 hitlStore 弹 UI）
      //   - onRunPaused：paused 不 finalize；标记消息 paused、进入暂停待答复态，
      //     保留 streamingMessageId=assistantMsgId 供 resume 续写同一条消息
      //   - onHitlAborted：超时/用户取消后收尾
      onHumanInputRequest: (p) => {
        set({ hitlPending: p })
        useHitlStore.getState().enqueue(toHitlItem(p))
      },
      onRunPaused: () => {
        const st = get()
        set((s) => pauseStreamingMessage(
          s,
          _sessionId,
          assistantMsgId,
          buildRunPausedPatch(st, _sessionId, assistantMsgId)
        ))
      },
      onHitlAborted: () => {
        const st = get()
        set((s) => finalizeStreamingMessage(
          s,
          _sessionId,
          assistantMsgId,
          buildHitlAbortedPatch(st, _sessionId, assistantMsgId)
        ))
        set({ isHitlPaused: false, hitlPending: null })
        // 当前弹窗对应的暂停项已收敛，出队展示队列下一项（若有）
        useHitlStore.getState().dequeue()
      }
    })

    const controller = service.sendMessageStream(
      {
        sessionId: _sessionId,
        message: buildSendText(content),
        stream: true,
        model: model && model !== '配置模型' ? model : undefined
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
      streamingAttachments,
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
            traceRootOrder: streamingTraceRootOrder.length ? streamingTraceRootOrder : prev.traceRootOrder,
            attachments: streamingAttachments.length ? streamingAttachments : prev.attachments
          }
          return {
            ...finalizeStreamingMessage(state, sid, id, merged[idx]!)
          }
        }
      }
      return emptyStreaming()
    })
  },

  setAgentMode: (mode) => set({ agentMode: mode }),

  // ===== HITL（阶段二 2.4/2.5）：resume / abort =====
  // 与 sendMessage 同构：复用 createStreamHandler 续写同一条 assistant 消息。
  // 消息生命周期 streaming→paused→resuming→done：
  //   - paused 消息保留 streamingMessageId（=assistantMsgId），本方法据此定位续写容器；
  //   - initialState 用暂停消息的 trace 树/工具调用/附件做种子，resume 续写而非重开节点；
  //   - 流结束（onDone/onError/onHitlAborted）由 hitlStore.dequeue() 出队下一个暂停项。
  resumeHitl: async (approved, feedback = null, modifiedArgs = null) => {
    const { currentSessionId, streamingMessageId, isHitlPaused } = get()
    if (!isHitlPaused || !currentSessionId || !streamingMessageId) return
    const _sessionId = currentSessionId
    const assistantMsgId = streamingMessageId

    // 从暂停消息（paused=true）提取 trace 树/工具调用/附件，作为 resume 续写容器的种子
    const pausedMsg = get().messages[_sessionId]?.find((m) => m.id === assistantMsgId)
    const seed: StreamHandlerOptions['initialState'] = {
      traceNodes: pausedMsg?.traceNodes ?? get().streamingTraceNodes,
      traceRootOrder: pausedMsg?.traceRootOrder ?? get().streamingTraceRootOrder,
      toolCalls: pausedMsg?.toolCalls ?? get().streamingToolCalls,
      attachments: pausedMsg?.attachments ?? get().streamingAttachments
    }

    const mySeq = ++streamSeq
    set({
      isHitlPaused: false,
      isStreaming: true,
      hitlPending: null,
      abortController: null,
      streamingMessageId: assistantMsgId
    })

    const streamHandler = createStreamHandler({
      mySeq,
      getCurrentSeq: () => streamSeq,
      getCurrentStreamingId: () => get().streamingMessageId,
      assistantMsgId,
      idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
      // resume 续写容器：streamingContent 保留暂停前内容，初始种子保证 trace 树不重开节点
      initialState: seed,
      onFlush: ({ contentDelta, thinkingDelta, toolCalls, traceNodes, traceRootOrder, attachments }) => {
        set((state) => ({
          streamingContent: state.streamingContent + contentDelta,
          streamingThinking: state.streamingThinking + thinkingDelta,
          streamingToolCalls: toolCalls,
          streamingTraceNodes: traceNodes,
          streamingTraceRootOrder: traceRootOrder,
          streamingAttachments: attachments
        }))
      },
      onDone: ({ msgId, content, thinking, toolCalls, traceNodes, traceRootOrder, attachments, meta }) => {
        set((state) => {
          const textNode = traceNodes[makeTextNodeId(assistantMsgId)]
          const finalContent = textNode?.content ?? content
          return finalizeStreamingMessage(state, _sessionId, assistantMsgId, {
            id: msgId,
            sessionId: _sessionId,
            content: finalContent,
            thinking: thinking ? { content: thinking } : undefined,
            toolCalls: toolCalls.length ? toolCalls : undefined,
            traceNodes,
            traceRootOrder,
            attachments: attachments.length ? attachments : undefined,
            paused: false,
            model: meta.model,
            tokenCount: meta.tokenCount,
            tokenUsage: meta.tokenCount
              ? { prompt: 0, completion: meta.tokenCount, total: meta.tokenCount }
              : undefined,
            timestamp: Date.now()
          })
        })
        useHitlStore.getState().dequeue()
      },
      onError: (error, { content, thinking, toolCalls, traceNodes, traceRootOrder, attachments }) => {
        set((state) => {
          const textNode = traceNodes[makeTextNodeId(assistantMsgId)]
          const baseContent = textNode?.content ?? content
          return {
            ...finalizeStreamingMessage(state, _sessionId, assistantMsgId, {
              id: assistantMsgId,
              sessionId: _sessionId,
              content: baseContent ? `${baseContent}\n\n[Error] ${error}` : `[Error] ${error}`,
              thinking: thinking ? { content: thinking } : undefined,
              toolCalls: toolCalls.length ? toolCalls : undefined,
              traceNodes,
              traceRootOrder,
              attachments: attachments.length ? attachments : undefined,
              paused: false,
              timestamp: Date.now()
            }),
            error
          }
        })
        useHitlStore.getState().dequeue()
      },
      // ===== HITL：resume 流上的暂停/中止处理（多次 interrupt 串行）=====
      onHumanInputRequest: (p) => {
        set({ hitlPending: p })
        useHitlStore.getState().enqueue(toHitlItem(p))
      },
      onRunPaused: () => {
        const st = get()
        set((s) => pauseStreamingMessage(
          s,
          _sessionId,
          assistantMsgId,
          buildRunPausedPatch(st, _sessionId, assistantMsgId)
        ))
      },
      onHitlAborted: () => {
        const st = get()
        set((s) => finalizeStreamingMessage(
          s,
          _sessionId,
          assistantMsgId,
          buildHitlAbortedPatch(st, _sessionId, assistantMsgId)
        ))
        set({ isHitlPaused: false, hitlPending: null })
        useHitlStore.getState().dequeue()
      }
    })

    const controller = agentService.resumeStream(
      { sessionId: _sessionId, approved, feedback, modifiedArgs },
      streamHandler
    )
    set({ abortController: controller })
  },

  /** 中止/拒绝 HITL 待答复项（用户取消/关闭弹窗后收尾） */
  abortHitl: async () => {
    const { currentSessionId, streamingMessageId } = get()
    if (!currentSessionId) return
    get().abortController?.abort()
    // 通知后端中止（best-effort；后端未就绪由 catch 忽略）
    try {
      await agentService.abortHitl(currentSessionId, 'user_cancel')
    } catch {
      // 忽略：本地收尾即可
    }
    const sid = currentSessionId
    const msgId = streamingMessageId
    if (msgId) {
      const st = get()
      set((s) => finalizeStreamingMessage(s, sid, msgId, buildHitlAbortedPatch(st, sid, msgId)))
    }
    set({ isHitlPaused: false, hitlPending: null })
    useHitlStore.getState().dequeue()
  },

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
          isDraftNewSession: false,
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

  shareSession: async (sessionId) => {
    try {
      return await chatService.shareSession(sessionId)
    } catch {
      return null
    }
  },

  moveSessionToWorkspace: async (sessionId, workspaceId) => {
    try {
      const updated = await chatService.updateSessionWorkspace(sessionId, workspaceId)
      // 乐观写入本地 workspaceId；后端回包缺失时用入参兜底
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId
            ? { ...s, workspaceId: updated.workspaceId ?? workspaceId }
            : s
        )
      }))
    } catch {
      // 后端能力未就绪：静默保持现状，不阻断用户其他操作
    }
  },

  // 登出 / 切换账号时清空会话与消息数据。
  // 仅重置数据字段，刻意不触碰 isStreaming / abortController / streaming* 等流式状态，
  // 也不动任何业务 action 函数，避免打断进行中的对话或引入状态不一致。
  resetSessions: () =>
    set({
      sessions: [],
      sessionsLoading: false,
      currentSessionId: null,
      isDraftNewSession: false,
      messages: {},
      messagesLoading: false,
      messagesNextCursor: {},
      messagesHasMore: {}
    }),

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
