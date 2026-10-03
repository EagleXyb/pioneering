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
  SendMessageRequest,
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
import { getAgentTransport, getTransportForRuntime } from '../services/transport'
import { trackClarifyTriggered } from '../services/clarify-metrics'
import {
  localChatService,
  isLocalChatAvailable,
  isLocalRuntimeActive,
  toPersistMessage
} from '../services/localChat'
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

// ============================================================
// HITL 类型（阶段三收敛）
// ============================================================

/** HITL 答复入参（与 hitlStore.HitlResolveInput 结构对齐） */
export interface HitlResumeInput {
  approved: boolean
  feedback?: string | null
  modifiedArgs?: Record<string, Record<string, unknown>> | null
  /** 澄清回答自由文本（kind='clarifying'） */
  answer?: string | null
  /** 多选回答的选项 id（kind='choice'） */
  answerId?: string | null
}

/** resume 启动结果：ok=false 时 reason 可直接展示给用户 */
export type HitlResumeResult = { ok: true } | { ok: false; reason: string }

/** 重建暂停容器入参（进页/重连恢复） */
export interface RestoreHitlPauseInput {
  sessionId: string
  kind: UserQuestionRequestPayload['kind']
  message?: string
  question?: string
  toolCalls?: UserQuestionRequestPayload['tool_calls']
}

/**
 * 当前会话是否处于 HITL 暂停待答复态（选择器）。
 * 用法：`useChatStore(selectIsHitlPaused)`
 */
export const selectIsHitlPaused = (s: {
  hitlPausedSessionId: string | null
  currentSessionId: string | null
}): boolean => !!s.hitlPausedSessionId && s.hitlPausedSessionId === s.currentSessionId

/** 本地模式（IPC）携带的最大历史轮数（角色对，user+assistant 混计） */
const IPC_HISTORY_MAX_MESSAGES = 20

/**
 * 云边双模阶段 1：本地模式多轮上下文。
 * 主进程内嵌 modu-agent 无 Prisma 会话状态，把当前会话已有消息
 * 压缩为 role/content 对随请求携带；云端端点忽略该字段。
 */
function buildIpcHistory(messages: Message[] | undefined): Array<{ role: string; content: string }> | undefined {
  if (!messages || messages.length === 0) return undefined
  const history = messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && !!m.content?.trim())
    .slice(-IPC_HISTORY_MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content }))
  return history.length > 0 ? history : undefined
}

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
  /**
   * 处于"暂停待答复"态的会话 id（null = 无暂停）。
   * 阶段三收敛：由布尔量改为会话标识，避免跨会话串线
   * （在 B 会话回答 A 会话的暂停项）。
   */
  hitlPausedSessionId: string | null
  /** 暂停的半截 assistant 消息 id（resume 续写定位 + 重连恢复重建用） */
  hitlPausedMessageId: string | null

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
  /**
   * 答复暂停项：resume 续写同一条 assistant 消息。
   * 返回结果供调用方感知"未真正启动"（不再静默早退导致 UI 卡死）。
   */
  resumeHitl: (sessionId: string, input: HitlResumeInput) => Promise<HitlResumeResult>
  /** 中止/拒绝暂停项（用户取消后收尾）；sessionId 缺省取当前会话 */
  abortHitl: (
    sessionId?: string,
    reason?: 'user_cancel' | 'timeout' | 'reject'
  ) => Promise<void>
  /**
   * 重建暂停容器（进页/重连恢复）：把后端仍在等待答复的项落成一条
   * paused=true 的 assistant 消息，并写入暂停标记，使答复链路可用。
   */
  restoreHitlPause: (input: RestoreHitlPauseInput) => void
  /**
   * 暂停项已失效（后端超时自动拒绝 / checkpointer 丢失）时收尾：
   * 追加说明文案、解除 paused 标记，并清空暂停状态。
   */
  finalizeHitlStale: (sessionId: string, reason: string) => void
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
 * HITL 暂停收尾（阶段二 2.4 / 阶段三收敛）：
 * 把暂停的半截 assistant 消息写入消息列表并标记 paused=true，进入"暂停待答复"态。
 * 与 finalizeStreamingMessage 不同：**保留 streamingMessageId**（= msgId），
 * 供 resume 续写时定位同一条 assistant 消息；同时记录会话级暂停标记
 * （hitlPausedSessionId / hitlPausedMessageId），供答复与恢复链路校验归属。
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
    hitlPausedSessionId: sid,
    hitlPausedMessageId: msgId,
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
    pausedKind: st.hitlPending?.kind,
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
    pausedKind: undefined,
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
    options: p.options,
    artifacts: p.artifacts,
    origin: 'live',
    createdAt: Date.now()
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

/** 云边双模阶段 2：会话是否归属本地运行时（SQLite DAO + IPC Transport） */
function isLocalSession(session: ChatSession | undefined): boolean {
  return session?.runtime === 'local'
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
  hitlPausedSessionId: null,
  hitlPausedMessageId: null,
  agentMode: false,
  error: null,

  loadSessions: async () => {
    set({ sessionsLoading: true, error: null })
    // 云边双模阶段 2：云端列表 + 本地 SQLite 列表合并展示。
    // 云端失败（断网/未登录）不再直接置错——本地会话可用即为可用产品；
    // 仅当两侧都拿不到数据时才报错。
    let cloudSessions: ChatSession[] = []
    let cloudError: unknown = null
    try {
      const data = await chatService.getSessions(1, 50)
      cloudSessions = data.sessions
    } catch (err) {
      cloudError = err
    }
    let localSessions: ChatSession[] = []
    let localError: unknown = null
    // 本地会话只要 DAO 可达就展示（与全局传输模式无关——
    // local 会话的发送/恢复按 session.runtime 恒走 IPC）
    if (isLocalChatAvailable()) {
      try {
        localSessions = (await localChatService.getSessions(1, 50)).sessions
      } catch (err) {
        localError = err
      }
    }
    if (cloudError && localSessions.length === 0) {
      set({
        error:
          cloudError instanceof Error ? cloudError.message : 'Failed to load sessions',
        sessionsLoading: false
      })
      return
    }
    if (localError) {
      // 本地库读失败：不阻断云端列表，但提示用户本地持久化异常
      console.warn('[chatStore] local sessions load failed:', localError)
    }
    const list = [...localSessions, ...cloudSessions].sort((a, b) =>
      (b.updatedAt || '').localeCompare(a.updatedAt || '')
    )
    // 刷新兜底选中：
    //   - 若 currentSessionId 为空，或选中的 id 不在新列表中（可能被其他端删除），
    //     则自动选中列表第一个会话（最新会话），
    //   - 确保刷新后不会出现「导航高亮助理 + 会话列表无选中行」的错位。
    //   参考经验 416906：selected 初始化缺失是刷新选中错位的常见根因。
    const prevId = get().currentSessionId
    const stillValid = prevId && list.some((s) => s.id === prevId)
    const nextCurrent = stillValid ? prevId : list[0]?.id ?? null
    set({ sessions: list, sessionsLoading: false, currentSessionId: nextCurrent, isDraftNewSession: false })
    // 兜底选中后拉取该会话消息，确保中栏内容与选中一致
    if (nextCurrent && nextCurrent !== prevId) {
      await get().loadMessages(nextCurrent)
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
      // 云边双模阶段 2：本地运行时激活（IPC 模式 + 本地 DAO 可达）时，
      // 新会话归属 local——落本地 SQLite，后续发送/恢复恒走 IPC Transport。
      if (isLocalRuntimeActive()) {
        const session = await localChatService.createSession({
          title: title ?? DEFAULT_SESSION_TITLE,
          // 本地模式所有会话均由主进程内嵌 agent 承载（无独立纯聊天通道）；
          // agentMode 仅作 UI 展示标记，保留用户的模式开关选择
          agentMode: isAgent ? DEFAULT_AGENT_MODE_VALUE : undefined
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
          agentMode: session.agentMode,
          runtime: 'local'
        }
        set((state) => ({
          sessions: [chatSession, ...state.sessions],
          currentSessionId: chatSession.id,
          isDraftNewSession: false
        }))
        return chatSession
      }
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
      // 云边双模阶段 2：local 会话改本地 SQLite，cloud 会话按原有 agent/chat 分流
      const updated = isLocalSession(prev)
        ? await localChatService.updateSession(sessionId, { title: trimmed })
        : await (
            isAgentSession(prev) ? agentService : chatService
          ).updateSession(sessionId, { title: trimmed })
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
    const needLoad = !state.messages[sessionId]
    // 阶段四边界：关窗/刷新后重连，恢复该会话未答复的 HITL 暂停项
    // 云边双模：按会话 runtime 路由到对应 Transport（local→IPC / cloud→全局模式）
    // 阶段三修正：必须等消息加载完成后再恢复——loadMessages 会整体替换
    // messages[sid]，若先重建暂停容器会被随后的加载结果覆盖。
    void (async () => {
      if (needLoad) {
        await get().loadMessages(sessionId)
      }
      await useHitlStore.getState().recover(sessionId, session?.runtime)
    })()
  },

  loadMessages: async (sessionId, append = false) => {
    set({ messagesLoading: true, error: null })
    try {
      const cursor = append ? get().messagesNextCursor[sessionId] : undefined
      // 云边双模阶段 2：local 会话读本地 SQLite，cloud 会话读云端
      const session = get().sessions.find((s) => s.id === sessionId)
      const data = isLocalSession(session)
        ? await localChatService.getMessages(sessionId, cursor)
        : await chatService.getMessages(sessionId, cursor)
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

    // 阶段三守卫（P0）：会话处于 HITL 暂停待答复态时禁止发起新 run。
    // 否则会覆盖 streamingMessageId、与后端未收敛的 interrupt 并存，
    // 导致 pause/resume 状态机彻底错位（输入框是这个场景的主要触发入口）。
    const pausedSessionId = get().hitlPausedSessionId
    if (pausedSessionId && pausedSessionId === currentSessionId) {
      set({
        error: '当前会话正在等待你的答复，请先处理待确认项（或取消该操作）后再发送新消息。'
      })
      return
    }

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
    // 云边双模阶段 2：local 会话恒走 IPC Transport（主进程内嵌 agent），
    // 并把用户消息/assistant 终态落本地 SQLite（HITL 暂停半截消息不落库）
    const isLocal = isLocalSession(targetSession)
    const useAgent = isLocal || isAgentSession(targetSession) || globalAgentMode
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

    // 本地持久化（仅 local 会话）：
    //   - 用户消息：发送即落库
    //   - assistant：仅在终态（done/error/aborted/stop）落库一次；
    //     DAO 端 INSERT OR IGNORE 幂等兜底，重复调用无害
    let assistantPersisted = false
    const persistAssistant = (patch: Partial<Message>): void => {
      if (!isLocal || assistantPersisted) return
      assistantPersisted = true
      const finalMsg: Message = {
        ...assistantPlaceholder,
        ...patch,
        id: assistantMsgId,
        sessionId: _sessionId
      }
      void localChatService
        .appendMessages(_sessionId, [toPersistMessage(finalMsg)])
        .catch((e) => console.warn('[chatStore] local persist assistant failed:', e))
    }
    if (isLocal) {
      void localChatService
        .appendMessages(_sessionId, [toPersistMessage(userMessage)])
        .catch((e) => console.warn('[chatStore] local persist user message failed:', e))
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
        // 从 trace 树推导最终的 text 正文（避免依赖外部 content 闭包）
        const textNode = traceNodes[makeTextNodeId(assistantMsgId)]
        const finalContent = textNode?.content ?? content
        const donePatch: Partial<Message> = {
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
        }
        set((state) => finalizeStreamingMessage(state, _sessionId, assistantMsgId, donePatch))
        // 云边双模阶段 2：local 会话 assistant 终态落本地库
        persistAssistant(donePatch)
        // 阶段二（AI 命名）：助手实际回复了内容，且标题仍是默认值或阶段一的临时截断值时，
        // 调用后端生成 AI 摘要标题覆盖；失败则保留阶段一结果（后续消息可重试）。
        // 触发判据用「标题值」而非时间标志：AI 标题生成后标题不再是默认/临时值，
        // 刷新后从后端读回已持久化的固定标题，不会重复生成导致标题反复变化。
        const doneContent = finalContent
        if (doneContent) {
          const current = get().sessions.find((s) => s.id === _sessionId)
          const stillNeedsTitle =
            current &&
            (current.title === DEFAULT_SESSION_TITLE ||
              (optimisticTitle !== null && current.title === optimisticTitle))
          if (stillNeedsTitle) {
            if (isLocal) {
              // 本地模式：不走云端 LLM 命名，降级为截取首条用户消息并落本地库
              void localChatService
                .generateTitleFrom(_sessionId, content)
                .then((title) => {
                  if (title) get().setSessionTitle(_sessionId, title)
                })
                .catch(() => {})
            } else {
              service
                .generateTitle(_sessionId)
                .then((title) => {
                  if (title) get().setSessionTitle(_sessionId, title)
                })
                .catch(() => {})
            }
          }
        }
      },
      onError: (error, { content, thinking, toolCalls, traceNodes, traceRootOrder, attachments }) => {
        const textNode = traceNodes[makeTextNodeId(assistantMsgId)]
        const baseContent = textNode?.content ?? content
        const errorPatch: Partial<Message> = {
          id: assistantMsgId,
          sessionId: _sessionId,
          content: baseContent ? `${baseContent}\n\n[Error] ${error}` : `[Error] ${error}`,
          thinking: thinking ? { content: thinking } : undefined,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          traceNodes,
          traceRootOrder,
          attachments: attachments.length ? attachments : undefined,
          timestamp: Date.now()
        }
        set((state) => ({
          ...finalizeStreamingMessage(state, _sessionId, assistantMsgId, errorPatch),
          error
        }))
        // 云边双模阶段 2：error 也是终态，local 会话落库
        persistAssistant(errorPatch)
      },
      // ===== HITL（阶段二 2.4）=====
      // 消息生命周期由 streaming→done/error 扩展为 streaming→paused→resuming→done：
      //   - onHumanInputRequest：暂存暂停项（由 HitlHost 同步到 hitlStore 弹 UI）
      //   - onRunPaused：paused 不 finalize；标记消息 paused、进入暂停待答复态，
      //     保留 streamingMessageId=assistantMsgId 供 resume 续写同一条消息
      //   - onHitlAborted：超时/用户取消后收尾
      onHumanInputRequest: (p) => {
        set({ hitlPending: p })
        // 阶段2 观测：澄清类暂停项入队（clarifying/choice）；重复计数由指标层按会话+类型去重
        trackClarifyTriggered(p.session_id, p.kind)
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
        const abortedPatch = buildHitlAbortedPatch(st, _sessionId, assistantMsgId)
        set((s) => finalizeStreamingMessage(s, _sessionId, assistantMsgId, abortedPatch))
        // 云边双模阶段 2：中止是终态，local 会话落库
        persistAssistant(abortedPatch)
        set({ hitlPausedSessionId: null, hitlPausedMessageId: null, hitlPending: null })
        // 当前弹窗对应的暂停项已收敛，出队展示队列下一项（若有）
        useHitlStore.getState().dequeue()
      }
    })

    // 云边双模阶段 0/1：Agent 流式走 Transport 抽象（http=云端 SSE / ipc=主进程推送）；
    // 普通聊天仍走 chatService——本地模式只覆盖 Agent 通道。
    const streamRequest: SendMessageRequest = {
      sessionId: _sessionId,
      message: buildSendText(content),
      stream: true,
      model: model && model !== '配置模型' ? model : undefined,
      // 云边对齐（P1）：外层图模式透传（plan_execute → Plan-Execute 图）。
      // 云端由 AgentChatRequestSchema 校验；本地由 agent-runtime 白名单归一化。
      agentMode: targetSession?.agentMode === 'plan_execute' ? 'plan_execute' : undefined
    }
    let controller: AbortController
    if (useAgent) {
      // 云边双模阶段 2：local 会话恒走 IPC（与全局模式无关）
      const transport = isLocal
        ? getTransportForRuntime('local')
        : getAgentTransport()
      if (transport.kind === 'ipc') {
        // 本地模式：主进程无会话状态，携带多轮上下文
        streamRequest.history = buildIpcHistory(get().messages[_sessionId])
      }
      controller = transport.sendMessage(streamRequest, streamHandler)
    } else {
      controller = chatService.sendMessageStream(streamRequest, streamHandler)
    }

    set({ abortController: controller })
  },

  stopStreaming: () => {
    // 阶段三守卫（P0）：暂停态下"停止"应等价于"取消该待确认操作"。
    // 统一走 hitlStore.dismiss()——它负责关窗、通知后端中止并出队下一项，
    // 若只调 abortHitl 会留下悬空弹窗（后续批准必定失败）。
    const { currentSessionId: _currentSessionId, hitlPausedSessionId } = get()
    if (hitlPausedSessionId && hitlPausedSessionId === _currentSessionId) {
      const hitl = useHitlStore.getState()
      // 有展示项 → dismiss（关窗 + 中止 + 出队）；无展示项（恢复失败等）→ 直接中止收尾
      if (hitl.currentItem) hitl.dismiss()
      else void get().abortHitl(_currentSessionId)
      return
    }

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
    // 云边双模阶段 2：local 会话恒走 IPC stop（主进程 stopRun）
    const isLocal = isLocalSession(targetSession)
    const useAgent = isLocal || isAgentSession(targetSession) || globalAgentMode
    if (currentSessionId) {
      if (useAgent) {
        // 云边双模阶段 1：Agent 停止生成经 Transport 分流（http=云端端点 / ipc=主进程 stopRun）
        void getTransportForRuntime(targetSession?.runtime)
          .stop(currentSessionId)
          .catch(() => {})
      } else {
        void chatService.stopGeneration?.(currentSessionId).catch(() => {})
      }
    }

    const sid = currentSessionId
    const id = streamingMessageId

    // 停止也是终态：local 会话把聚合后的 assistant 消息落本地库
    const persistLocalStop = (msg: Message): void => {
      if (!isLocal || !sid) return
      void localChatService
        .appendMessages(sid, [toPersistMessage(msg)])
        .catch((e) => console.warn('[chatStore] local persist (stop) failed:', e))
    }

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
          persistLocalStop(merged[idx]!)
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
  resumeHitl: async (sessionId, input) => {
    const { approved, feedback = null, modifiedArgs = null, answer = null, answerId = null } = input
    const { hitlPausedSessionId, hitlPausedMessageId } = get()

    // 前置校验：必须存在"该会话"的暂停容器。不满足时返回可展示原因，
    // 由 hitlStore 回滚到 paused 并提示，而不是静默早退导致 UI 卡死。
    if (!hitlPausedSessionId || hitlPausedSessionId !== sessionId) {
      return { ok: false as const, reason: '该会话当前没有等待答复的操作，请刷新会话状态后重试。' }
    }
    if (!hitlPausedMessageId) {
      return { ok: false as const, reason: '暂停消息已丢失（可能已重载会话），请重新发起请求。' }
    }
    const _sessionId = sessionId
    const assistantMsgId = hitlPausedMessageId

    // 云边双模阶段 2：local 会话 resume 后的终态落本地库
    // （暂停半截消息按 HITL 约定不落库，resume 续写完成才聚合落库）
    const session = get().sessions.find((s) => s.id === _sessionId)
    const isLocal = isLocalSession(session)
    let resumePersisted = false
    const persistResumeTerminal = (patch: Partial<Message>): void => {
      if (!isLocal || resumePersisted) return
      resumePersisted = true
      const base = get().messages[_sessionId]?.find((m) => m.id === assistantMsgId)
      if (!base) return
      const finalMsg: Message = { ...base, ...patch, id: assistantMsgId, sessionId: _sessionId }
      void localChatService
        .appendMessages(_sessionId, [toPersistMessage(finalMsg)])
        .catch((e) => console.warn('[chatStore] local persist (resume terminal) failed:', e))
    }

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
      // 清理暂停标记：resume 流重新进入 streaming 生命周期，
      // 若再次被 interrupt 会由 onRunPaused 重新写入
      hitlPausedSessionId: null,
      hitlPausedMessageId: null,
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
        const resumeDonePatch: Partial<Message> = {
          id: msgId,
          sessionId: _sessionId,
          content: (traceNodes[makeTextNodeId(assistantMsgId)]?.content ?? content),
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
        }
        set((state) => finalizeStreamingMessage(state, _sessionId, assistantMsgId, resumeDonePatch))
        persistResumeTerminal(resumeDonePatch)
        useHitlStore.getState().dequeue()
      },
      onError: (error, { content, thinking, toolCalls, traceNodes, traceRootOrder, attachments }) => {
        const resumeErrorPatch: Partial<Message> = {
          id: assistantMsgId,
          sessionId: _sessionId,
          content: (traceNodes[makeTextNodeId(assistantMsgId)]?.content ?? content)
            ? `${traceNodes[makeTextNodeId(assistantMsgId)]?.content ?? content}\n\n[Error] ${error}`
            : `[Error] ${error}`,
          thinking: thinking ? { content: thinking } : undefined,
          toolCalls: toolCalls.length ? toolCalls : undefined,
          traceNodes,
          traceRootOrder,
          attachments: attachments.length ? attachments : undefined,
          paused: false,
          timestamp: Date.now()
        }
        set((state) => ({
          ...finalizeStreamingMessage(state, _sessionId, assistantMsgId, resumeErrorPatch),
          error
        }))
        persistResumeTerminal(resumeErrorPatch)
        useHitlStore.getState().dequeue()
      },
      // ===== HITL：resume 流上的暂停/中止处理（多次 interrupt 串行）=====
      onHumanInputRequest: (p) => {
        set({ hitlPending: p })
        // 阶段2 观测：澄清类暂停项入队（clarifying/choice）；重复计数由指标层按会话+类型去重
        trackClarifyTriggered(p.session_id, p.kind)
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
        const abortedPatch = buildHitlAbortedPatch(st, _sessionId, assistantMsgId)
        set((s) => finalizeStreamingMessage(s, _sessionId, assistantMsgId, abortedPatch))
        persistResumeTerminal(abortedPatch)
        set({ hitlPausedSessionId: null, hitlPausedMessageId: null, hitlPending: null })
        useHitlStore.getState().dequeue()
      }
    })

    // 云边双模阶段 2：HITL resume 按会话 runtime 路由（local→IPC / cloud→全局模式）
    const controller = getTransportForRuntime(session?.runtime).resume(
      { sessionId: _sessionId, approved, feedback, modifiedArgs, answer, answerId },
      streamHandler
    )
    set({ abortController: controller })
    return { ok: true as const }
  },

  /** 中止/拒绝 HITL 待答复项（用户取消/关闭弹窗后收尾） */
  abortHitl: async (sessionId, reason = 'user_cancel') => {
    const { currentSessionId, hitlPausedSessionId, hitlPausedMessageId, streamingMessageId } = get()
    const sid = sessionId ?? hitlPausedSessionId ?? currentSessionId
    if (!sid) return

    // 中止进行中的 resume 流（若有）
    get().abortController?.abort()

    // 通知后端中止（best-effort；后端未就绪由 catch 忽略）
    // 云边双模阶段 2：HITL abort 按会话 runtime 路由（local→IPC / cloud→全局模式）
    const session = get().sessions.find((s) => s.id === sid)
    try {
      await getTransportForRuntime(session?.runtime).abort(sid, reason)
    } catch {
      // 忽略：本地收尾即可
    }

    // 暂停消息 id：优先使用会话级暂停标记（支持在非当前会话上中止）
    const msgId = hitlPausedSessionId === sid ? hitlPausedMessageId : streamingMessageId
    if (msgId) {
      const st = get()
      const abortedPatch = buildHitlAbortedPatch(st, sid, msgId)
      set((s) => finalizeStreamingMessage(s, sid, msgId, abortedPatch))
      // 云边双模阶段 2：中止是终态，local 会话聚合落库
      if (isLocalSession(session)) {
        const base = get().messages[sid]?.find((m) => m.id === msgId)
        if (base) {
          const finalMsg: Message = { ...base, ...abortedPatch, id: msgId, sessionId: sid }
          void localChatService
            .appendMessages(sid, [toPersistMessage(finalMsg)])
            .catch((e) => console.warn('[chatStore] local persist (abort) failed:', e))
        }
      }
    }
    set({ hitlPausedSessionId: null, hitlPausedMessageId: null, hitlPending: null })
  },

  /**
   * 重建暂停容器（进页/重连恢复）。
   *
   * 为什么需要：暂停的半截 assistant 消息按约定不落库，重进会话后消息列表里
   * 没有对应容器，"续写同一条消息"与答复校验都会失败。此处按后端仍在等待的
   * 暂停项补一条 paused 占位消息，使答复链路立即可用。
   */
  restoreHitlPause: (input) => {
    const sid = input.sessionId
    const msgs = get().messages[sid] ?? []
    // 已有同会话的播放占位则不重复创建
    const existingIdx = msgs.findIndex((m) => m.paused)
    const msgId = existingIdx >= 0 ? msgs[existingIdx]!.id : `assistant-hitl-${sid}-${Date.now()}`
    const placeholder: Message = {
      id: msgId,
      sessionId: sid,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      timestamp: Date.now(),
      paused: true,
      pausedKind: input.kind
    }
    const next = existingIdx >= 0
      ? msgs.map((m, i) => (i === existingIdx ? { ...m, ...placeholder, content: m.content } : m))
      : [...msgs, placeholder]

    set({
      messages: { ...get().messages, [sid]: next },
      // 保留原消息 id 供 resume 定位；不改变当前会话（由调用方决定是否切换）
      hitlPausedSessionId: sid,
      hitlPausedMessageId: msgId,
      streamingMessageId: msgId,
      isStreaming: false,
      abortController: null
    })
    // 同步种子内容，保证 resume 时 trace/content 有兜底来源
    set((s) => ({
      streamingContent: s.streamingContent || msgs.find((m) => m.id === msgId)?.content || '',
      streamingTraceNodes: s.streamingTraceNodes,
      streamingTraceRootOrder: s.streamingTraceRootOrder
    }))
  },

  /**
   * 暂停项失效收尾（后端超时自动拒绝 / checkpointer 丢失）：
   * 追加说明文案、解除 paused 标记并清空暂停状态，避免 UI 永远停在"等待答复"。
   */
  finalizeHitlStale: (sessionId, reason) => {
    const st = get()
    const msgId = st.hitlPausedSessionId === sessionId ? st.hitlPausedMessageId : null
    if (msgId) {
      const list = st.messages[sessionId] ?? []
      const idx = list.findIndex((m) => m.id === msgId)
      if (idx !== -1) {
        const prev = list[idx]!
        const note = `[已失效] ${reason}`
        const updated = [...list]
        updated[idx] = {
          ...prev,
          content: prev.content ? `${prev.content}\n\n${note}` : note,
          paused: false,
          pausedKind: undefined
        }
        set({ messages: { ...st.messages, [sessionId]: updated } })
      }
    }
    set({ hitlPausedSessionId: null, hitlPausedMessageId: null, hitlPending: null })
  },

  toggleMessageFeedback: async (messageId, feedback) => {
    const { currentSessionId, messages, sessions } = get()
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
      // 云边双模阶段 2：local 会话反馈写本地 SQLite
      const target = sessions.find((s) => s.id === currentSessionId)
      if (isLocalSession(target)) {
        await localChatService.sendFeedback(messageId, next)
      } else {
        await chatService.sendFeedback(messageId, next)
      }
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
      // 云边双模阶段 2：local 会话删本地库（物理级联），cloud 会话走归档删除
      const target = state.sessions.find((s) => s.id === sessionId)
      if (isLocalSession(target)) {
        await localChatService.deleteSession(sessionId)
      } else {
        await chatService.deleteSession(sessionId, true)
      }
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
    // 云边双模阶段 2：本地会话不支持云端分享（阶段 4 单向同步后再评估）
    const target = get().sessions.find((s) => s.id === sessionId)
    if (isLocalSession(target)) return null
    try {
      return await chatService.shareSession(sessionId)
    } catch {
      return null
    }
  },

  moveSessionToWorkspace: async (sessionId, workspaceId) => {
    // 云边双模阶段 2：本地会话不支持云端工作空间
    const target = get().sessions.find((s) => s.id === sessionId)
    if (isLocalSession(target)) return
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

  // 登出 / 切换账号时清空云端会话与消息数据。
  // 云边双模阶段 2：本地会话（runtime='local'）归属设备而非账号，
  // 登出/切号时保留本地会话及其消息，避免误删设备上的数据。
  // 仅重置数据字段，刻意不触碰 isStreaming / abortController / streaming* 等流式状态，
  // 也不动任何业务 action 函数，避免打断进行中的对话或引入状态不一致。
  resetSessions: () =>
    set((state) => {
      const localIds = new Set(
        state.sessions.filter((s) => s.runtime === 'local').map((s) => s.id)
      )
      const messages: typeof state.messages = {}
      const cursors: typeof state.messagesNextCursor = {}
      const hasMore: typeof state.messagesHasMore = {}
      for (const id of localIds) {
        messages[id] = state.messages[id] ?? []
        cursors[id] = state.messagesNextCursor[id]
        hasMore[id] = state.messagesHasMore[id] ?? false
      }
      // 阶段三：登出/切换账号时同步清空 HITL 暂停态，
      // 避免上一个账号残留的待答复弹窗被新用户看到/误答
      const clearHitl = {
        hitlPending: null as UserQuestionRequestPayload | null,
        hitlPausedSessionId: null as string | null,
        hitlPausedMessageId: null as string | null
      }
      useHitlStore.getState().reset()
      return {
        sessions: state.sessions.filter((s) => s.runtime === 'local'),
        sessionsLoading: false,
        // 选中会话被清掉时回退到第一个本地会话（若有）
        currentSessionId:
          state.currentSessionId && localIds.has(state.currentSessionId)
            ? state.currentSessionId
            : null,
        isDraftNewSession: false,
        messages,
        messagesLoading: false,
        ...clearHitl,
        messagesNextCursor: cursors,
        messagesHasMore: hasMore
      }
    }),

  clearError: () => set({ error: null }),

  regenerateMessage: async (messageId) => {
    const { currentSessionId, messages, sessions, isStreaming } = get()
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

    // 云边双模阶段 2：local 会话同步截断本地库（被移除的旧消息从 SQLite 删除），
    // 防止刷新后旧 assistant 消息与重新生成的回复同时出现
    const target = sessions.find((s) => s.id === currentSessionId)
    if (isLocalSession(target)) {
      const removedIds = list.slice(userIdx).map((m) => m.id)
      void localChatService
        .deleteMessages(currentSessionId, removedIds)
        .catch((e) => console.warn('[chatStore] local truncate (regenerate) failed:', e))
    }

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
