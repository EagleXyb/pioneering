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

export interface QuotaInfo {
  totalTokens: number;
  usedTokens: number;
  dailyLimit: number;
  dailyUsed: number;
  resetAt?: string | null;
}
// 剩余 Token 由前端派生：totalTokens - usedTokens

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
  /** Agent 模式标记（T3.5）：后端权威字段，前端据此推导 pro/task */
  agentMode?: 'react_agent' | 'plan_execute' | null;
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
  /** 归档状态：true 归档，false 恢复，undefined 不变 */
  isArchived?: boolean;
}

export interface SessionListResponse {
  sessions: Session[];
  total: number;
  /** 游标分页：下一页游标（null 表示无更多数据） */
  nextCursor: string | null;
  hasMore: boolean;
  /** 本页返回的条数上限（兼容旧字段） */
  limit: number;
}

// ========== 消息相关 ==========

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';
export type FeedbackType = 'none' | 'like' | 'dislike';

/**
 * 持久化 contentBlocks 的块类型（两条写入通道口径不同）：
 * - agent 通道（pro/task，backend-ts agent-bridge.collectMetadataFromEvent）：
 *   thinking / tool_call / tool_result / text_stream，按事件顺序 push，可还原 TAO 闭环
 * - chat 通道（backend-ts routes/chat）：无 type，仅 reasoningContent / sources 字段
 */
export type ContentBlockType =
  | 'text'
  | 'code'
  | 'image'
  | 'file'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'text_stream';

export interface ContentBlock {
  /** 块类型（agent 通道写入；chat 通道的来源块无此字段） */
  type?: ContentBlockType;
  /** 块处理状态（agent 通道：running / success / error） */
  status?: string;
  /** thinking 段文本（agent 通道）/ tool_result 观测摘要 */
  summary?: string;
  /** 思考段轮次（多轮 ReAct 的顺序锚点，C 档后端写入） */
  round?: number;
  /** tool_call / tool_result 的工具名 */
  toolName?: string;
  /** tool_call / tool_result 的关联执行 id */
  executionId?: string;
  /** 工具调用参数 JSON（截断后持久化，供历史动作行摘要） */
  args?: string;
  /** text_stream 的正文分片 */
  text?: string;
  code?: string;
  language?: string;
  imageUrl?: string;
  fileId?: string;
  /** 后端存储的思考内容（非标准 ContentBlock 字段） */
  reasoningContent?: string;
  content?: string;
  id?: string;
  role?: string;
  /** 联网搜索结构化来源（chat 通道） */
  sources?: Array<Record<string, unknown>>;
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
  deepThink?: boolean;
  netSearch?: boolean;
  messageId?: string;
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
  feedback: FeedbackType;
}
