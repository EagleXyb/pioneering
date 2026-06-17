/**
 * 后端 API 类型定义
 * 对应 docs/接口/AI 对话系统 API.yaml 中的 schemas
 */

// ========== 通用 ==========

export interface ErrorResponse {
  code: number;
  message: string;
  details?: string;
  requestId?: string;
}

// ========== 用户相关 ==========

export interface User {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  email?: string;
  phone?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuotaInfo {
  totalTokens: number;
  usedTokens: number;
  remainingTokens: number;
  dailyLimit: number;
  dailyUsed: number;
}

// ========== 会话相关 ==========

export interface ModelConfig {
  temperature?: number;
  maxTokens?: number;
}

export interface MessagePreview {
  content: string;
  role: 'user' | 'assistant';
  createdAt: string;
}

export interface Session {
  id: string;
  title: string;
  model: string;
  modelConfig?: ModelConfig;
  messageCount: number;
  lastMessage?: MessagePreview;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
}

export interface CreateSessionRequest {
  title?: string;
  model?: string;
  systemPrompt?: string;
  initialMessage?: string;
}

export interface UpdateSessionRequest {
  title?: string;
  model?: string;
  modelConfig?: ModelConfig;
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
  page: number;
  pageSize: number;
}

// ========== 消息相关 ==========

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type FeedbackType = 'none' | 'like' | 'dislike';

export interface ContentBlock {
  type: 'text' | 'code' | 'image' | 'file';
  text?: string;
  code?: string;
  language?: string;
  imageUrl?: string;
  fileId?: string;
}

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  contentBlocks?: ContentBlock[];
  parentMessageId?: string;
  childrenMessageIds?: string[];
  tokenCount?: number;
  feedback?: FeedbackType;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface MessageListResponse {
  messages: Message[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ========== 对话补全 ==========

export interface ChatCompletionRequest {
  sessionId?: string;
  message: string;
  model?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  parentMessageId?: string;
}

export interface ChatCompletionChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
  };
  finishReason?: 'stop' | 'length' | 'content_filter' | null;
}

export interface ChatCompletionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  sessionId: string;
  choices: ChatCompletionChoice[];
  usage?: ChatCompletionUsage;
  createdAt: string;
}

// ========== 停止生成 ==========

export interface StopGenerationRequest {
  sessionId: string;
  messageId: string;
}

// ========== 消息编辑与重新生成 ==========

export interface EditMessageRequest {
  content: string;
  regenerate?: boolean;
}

export interface RegenerateRequest {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

// ========== 消息反馈 ==========

export interface FeedbackRequest {
  messageId: string;
  feedback: FeedbackType;
}
