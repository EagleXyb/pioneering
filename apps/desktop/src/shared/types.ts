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
  archived: boolean
  createdAt: string
  updatedAt: string
  messageCount?: number
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
  title: string
  agentType?: string
  status: 'idle' | 'running' | 'completed' | 'error'
  createdAt: string
  updatedAt: string
}

export interface AgentExecuteRequest {
  sessionId?: string
  instruction: string
  agentType?: string
  stream?: boolean
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
