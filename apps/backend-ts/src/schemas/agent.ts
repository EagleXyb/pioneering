// Agent schemas —— 对应 Python app/schemas/agent.py
import { z } from 'zod'

// 对应 Python: CreateAgentSessionRequest
export const CreateAgentSessionRequestSchema = z.object({
  // P4: 新增 plan_execute 模式，与前端任务模式对齐
  agentMode: z.enum(['react_agent', 'rag_agent', 'plan_execute']).default('react_agent'),
  title: z.string().nullable().optional(),
  // P1-12 修复：不设默认值，让 agent.ts 中 `dto.model || env.LLM_DEFAULT_MODEL` 生效
  model: z.string().nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  tools: z.array(z.string()).nullable().optional(),
})
export type CreateAgentSessionRequest = z.infer<typeof CreateAgentSessionRequestSchema>

// 对应 Python: AgentSessionResponse（from_attributes=True）
export const AgentSessionResponseSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  agentMode: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  modelConfig: z.record(z.unknown()).nullable().optional(),
  systemPrompt: z.string().nullable().optional(),
  messageCount: z.number().default(0),
  createdAt: z.date().nullable().optional(),
  updatedAt: z.date().nullable().optional(),
})

// 对应 Python: AgentChatRequest
export const AgentChatRequestSchema = z.object({
  sessionId: z.string().nullable().optional(),
  message: z.string(),
  stream: z.boolean().default(true),
  // P4: 支持 per-request 指定 Agent 模式，前端任务模式传 'plan_execute' 启用 Plan-Execute 图
  agentMode: z.enum(['react_agent', 'plan_execute']).default('react_agent'),
})
export type AgentChatRequest = z.infer<typeof AgentChatRequestSchema>

// 对应 Python: AgentFeedbackRequest
export const AgentFeedbackRequestSchema = z.object({
  messageId: z.string().nullable().optional(),
  rating: z.number().int().min(1).max(5),
  feedbackText: z.string().nullable().optional(),
})
export type AgentFeedbackRequest = z.infer<typeof AgentFeedbackRequestSchema>

// 对应 Python: AgentMessageResponse（from_attributes=True）
export const AgentMessageResponseSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.string(),
  content: z.string(),
  contentBlocks: z.array(z.any()).nullable().optional(),
  promptTokens: z.number().nullable().optional(),
  completionTokens: z.number().nullable().optional(),
  latencyMs: z.number().nullable().optional(),
  userRating: z.number().nullable().optional(),
  userFeedback: z.string().nullable().optional(),
  createdAt: z.date().nullable().optional(),
})

// 对应 Python: ToolExecutionDetail（from_attributes=True）
export const ToolExecutionDetailSchema = z.object({
  id: z.string(),
  messageId: z.string().nullable().optional(),
  toolName: z.string(),
  toolCallId: z.string().nullable().optional(),
  inputParams: z.record(z.unknown()).nullable().optional(),
  outputSummary: z.string().nullable().optional(),
  outputResult: z.string().nullable().optional(),
  status: z.string().default('pending'),
  errorMessage: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  startTime: z.date().nullable().optional(),
  endTime: z.date().nullable().optional(),
})

// 对应 Python: ExecutionListResponse
export const ExecutionListResponseSchema = z.object({
  executions: z.array(ToolExecutionDetailSchema),
})

// 对应 Python: ExecutionResultResponse
export const ExecutionResultResponseSchema = z.object({
  executionId: z.string(),
  outputResult: z.string().nullable().optional(),
})
