// ============================================================
// Shared Types — Main ↔ Renderer 共享数据类型
// ============================================================

// ---- 用户 & 认证 ----
export interface UserProfile {
  id: string
  username: string
  email: string
  nickname?: string
  avatar?: string
  createdAt: string
}

export interface AuthTokens {
  token: string
  refreshToken: string
  user: UserProfile
}

export interface LoginRequest {
  username: string
  password: string
}

export interface RegisterRequest {
  username: string
  email: string
  password: string
}

// ---- 会话 ----
export interface ChatSession {
  id: string
  title: string
  model?: string
  modelConfig?: Record<string, unknown>
  isArchived: boolean
  createdAt: string
  updatedAt: string
  messageCount?: number
  /** 会话模式：普通对话为空，Agent 会话为 react_agent / rag_agent */
  agentMode?: string
}

export interface CreateSessionRequest {
  title?: string
  model?: string
  modelConfig?: Record<string, unknown>
}

export interface UpdateSessionRequest {
  title?: string
  model?: string
  modelConfig?: Record<string, unknown>
}

// ---- 消息 ----
export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  id: string
  sessionId: string
  role: MessageRole
  content: string
  parentMessageId?: string
  model?: string
  tokenCount?: number
  feedback?: 'like' | 'dislike' | 'none'
  createdAt: string
  /** 后端落库的 Agent 执行轨迹（thinking/tool_call/tool_result/text_stream） */
  contentBlocks?: ContentBlock[]
}

/**
 * 后端 Agent 消息执行轨迹块（对应 app/schemas/agent.AgentContentBlock）。
 * 历史消息回填时由 contentBlocks 转换为 Message.thinking / Message.toolCalls。
 */
export interface ContentBlock {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'text_stream'
  status?: string
  /** thinking / tool_call 摘要 */
  summary?: string
  /** tool_call 工具名 */
  toolName?: string
  /** 关联的工具执行明细 ID（与 ToolCall.id 对应） */
  executionId?: string
  /** text_stream 文本片段 */
  text?: string
}

export interface SendMessageRequest {
  sessionId?: string
  message: string
  model?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  parentMessageId?: string
  deepThink?: boolean
  netSearch?: boolean
  messageId?: string
}

// ---- SSE 流式响应 ----
export interface SSEChunk {
  type: 'content' | 'done' | 'error' | 'meta'
  content?: string
  messageId?: string
  sessionId?: string
  model?: string
  tokenCount?: number
  error?: string
}

// ---- Agent ----
export interface AgentSession {
  id: string
  title?: string
  agentMode?: string
  model?: string
  modelConfig?: Record<string, unknown>
  systemPrompt?: string
  messageCount?: number
  createdAt?: string
  updatedAt?: string
}

export interface CreateAgentSessionRequest {
  title?: string
  agentMode?: string
  model?: string
  systemPrompt?: string
  tools?: string[]
}

export interface AgentExecuteRequest {
  sessionId?: string
  instruction: string
  agentType?: string
  stream?: boolean
}

/** 后端工具执行明细（对应 app/schemas/agent.ToolExecutionDetail） */
export interface AgentToolExecution {
  id: string
  messageId?: string
  toolName: string
  toolCallId?: string
  inputParams?: Record<string, unknown>
  outputSummary?: string
  outputResult?: string
  status: string
  errorMessage?: string
  durationMs?: number
  startTime?: string
  endTime?: string
}

// ---- UI 扩展类型（Renderer 内部使用，但与 API 类型兼容）----
export interface ThinkingBlock {
  content: string
  duration?: number
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  result?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  /** 工具执行失败时的错误信息（对应后端 AgentToolExecution.errorMessage） */
  errorMessage?: string
  startTime?: number
  endTime?: number
}

export interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

export interface Message extends ChatMessage {
  thinking?: ThinkingBlock
  toolCalls?: ToolCall[]
  tokenUsage?: TokenUsage
  timestamp: number
  /** 用户消息附带图片（base64 dataUrl） */
  images?: AttachedImage[]
}

/** 用户消息的附件图片（与渲染端 ImageAttachment 结构兼容） */
export interface AttachedImage {
  id: string
  dataUrl: string
  mediaType: string
}

export interface AgentStep {
  id: string
  description: string
  toolName?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  result?: string
  startTime?: number
  endTime?: number
}

export interface AgentExecution {
  id: string
  instruction: string
  steps: AgentStep[]
  status: 'idle' | 'running' | 'completed' | 'error'
  error?: string
  createdAt: number
  updatedAt: number
}

export interface OpenFile {
  id: string
  name: string
  path: string
  language: string
  content?: string
  isDirty: boolean
}

// ---- 通用 API 响应 ----
export interface ApiResponse<T = unknown> {
  code: number
  data: T
  message: string
}

export interface PaginatedData<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// ---- 平台 ----
// 归一化平台标识，主进程 (process.platform) 与渲染端共用同一映射，
// 避免 macOS/Windows/Linux 判断在多处各写一份。
export type Platform = 'mac' | 'windows' | 'linux' | 'unknown'

export function normalizePlatform(p: string): Platform {
  if (p === 'darwin') return 'mac'
  if (p === 'win32') return 'windows'
  if (p === 'linux') return 'linux'
  return 'unknown'
}
