// Chat schemas —— 对应 Python app/schemas/chat.py
import { z } from 'zod'

// 对应 Python: CreateSessionRequest（populate_by_name=True, alias 映射）
export const CreateSessionRequestSchema = z.object({
  title: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  // 对应 Python: Field(None, alias="system_prompt")
  systemPrompt: z.string().nullable().optional(),
  initialMessage: z.string().nullable().optional(),
})
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>

// 对应 Python: UpdateSessionRequest（populate_by_name=True）
export const UpdateSessionRequestSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, { message: '标题不能为空' })
    .max(200, { message: '标题长度不能超过 200' })
    .nullable()
    .optional(),
  model: z.string().nullable().optional(),
  modelConfig: z.record(z.unknown()).nullable().optional(),
  /** 归档状态：true 归档，false 恢复，undefined 不变 */
  isArchived: z.boolean().optional(),
})
export type UpdateSessionRequest = z.infer<typeof UpdateSessionRequestSchema>

// 对应 Python: SessionResponse（from_attributes=True）
export const SessionResponseSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  modelConfig: z.record(z.unknown()).nullable().optional(),
  messageCount: z.number().default(0),
  lastMessage: z.any().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
  isArchived: z.boolean().default(false),
})

// 对应 Python: SessionListResponse
export const SessionListResponseSchema = z.object({
  sessions: z.array(SessionResponseSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})

// 对应 Python: MessageResponse（from_attributes=True）
export const MessageResponseSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.string(),
  content: z.string(),
  contentBlocks: z.array(z.any()).nullable().optional(),
  tokenCount: z.number().nullable().optional(),
  feedback: z.string().default('none'),
  metadata: z.record(z.unknown()).nullable().optional(),
  parentMessageId: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
})

// 对应 Python: MessageListResponse
export const MessageListResponseSchema = z.object({
  messages: z.array(MessageResponseSchema),
  nextCursor: z.string().nullable().optional(),
  hasMore: z.boolean().default(false),
})

// 对应 Python: ChatCompletionRequest（populate_by_name=True）
export const ChatCompletionRequestSchema = z.object({
  sessionId: z.string().nullable().optional(),
  message: z.string(),
  model: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  temperature: z.number().nullable().optional(),
  maxTokens: z.number().nullable().optional(),
  stream: z.boolean().default(true),
  parentMessageId: z.string().nullable().optional(),
  deepThink: z.boolean().default(false),
  netSearch: z.boolean().default(false),
  messageId: z.string().nullable().optional(),
})
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>

// 对应 Python: ChatCompletionResponse
export const ChatCompletionResponseSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  model: z.string(),
  choices: z.array(z.record(z.unknown())),
  usage: z.record(z.unknown()).nullable().optional(),
  createdAt: z.string(),
})

// 对应 Python: StopGenerationRequest
export const StopGenerationRequestSchema = z.object({
  sessionId: z.string(),
  messageId: z.string().nullable().optional(),
})

// 对应 Python: FeedbackRequest（pattern="^(none|like|dislike)$"）
export const FeedbackRequestSchema = z.object({
  feedback: z.enum(['none', 'like', 'dislike']),
})

// 对应 Python: EditMessageRequest
export const EditMessageRequestSchema = z.object({
  content: z.string(),
  regenerate: z.boolean().default(false),
})
export type EditMessageRequest = z.infer<typeof EditMessageRequestSchema>

// 对应 Python: RegenerateRequest（populate_by_name=True）
export const RegenerateRequestSchema = z.object({
  model: z.string().nullable().optional(),
  temperature: z.number().nullable().optional(),
  maxTokens: z.number().nullable().optional(),
})
export type RegenerateRequest = z.infer<typeof RegenerateRequestSchema>
