import { API_ENDPOINTS } from '@shared/api/endpoints'
import type { ChatSession, ChatMessage, AgentStep } from '../types'
import { StepType } from '../types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token') || ''
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' }
}

/** 获取会话列表 */
export async function fetchSessions(): Promise<ChatSession[]> {
  const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.SESSIONS}`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error('获取会话列表失败')
  const data = await res.json()
  const raw = Array.isArray(data) ? data : (data.sessions || [])
  return raw.map((s: Record<string, unknown>) => ({
    id: s.id as string,
    title: s.title as string,
    model: s.model as string,
    messageCount: (s.message_count ?? s.messageCount ?? 0) as number,
    createdAt: (s.created_at ?? s.createdAt ?? '') as string,
    updatedAt: (s.updated_at ?? s.updatedAt ?? '') as string,
  }))
}

/** 创建新会话 */
export async function createSession(title: string, model: string): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.SESSIONS}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title, model }),
  })
  if (!res.ok) throw new Error('创建会话失败')
  return res.json()
}

/** 加载会话消息 */
export async function fetchSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await fetch(
    `${API_BASE_URL}${API_ENDPOINTS.CHAT.MESSAGES(sessionId)}`,
    { headers: authHeaders() },
  )
  if (!res.ok) throw new Error('加载会话消息失败')

  const rawData: Array<Record<string, unknown>> = await res.json()

  return rawData.map((m: Record<string, unknown>) => {
    const thinkingContent = (m.thinking_content ?? m.thinkingContent ?? '') as string
    const answerContent = (m.answer_content ?? m.answerContent ?? '') as string
    const toolCalls = (m.tool_calls ?? m.toolCalls ?? []) as Array<{
      id: string
      name: string
      arguments: string
      result?: string
      status: 'pending' | 'running' | 'success' | 'error'
    }>
    const createdAt = (m.created_at ?? m.createdAt ?? '') as string

    const steps: AgentStep[] = []

    if (thinkingContent) {
      steps.push({
        id: `thinking_${m.id}`,
        type: StepType.THINKING,
        content: thinkingContent,
        status: 'success',
        startTime: new Date(createdAt).getTime(),
        endTime: new Date(createdAt).getTime(),
      } as import('../types').ThinkingStep)
    }

    if (toolCalls && toolCalls.length > 0) {
      for (const tc of toolCalls) {
        steps.push({
          id: tc.id,
          type: StepType.TOOL_CALL,
          toolName: tc.name,
          arguments: tc.arguments,
          status: tc.status === 'pending' || tc.status === 'running' ? 'streaming' : tc.status === 'error' ? 'error' : 'success',
          startTime: new Date(createdAt).getTime(),
          endTime: tc.result ? new Date(createdAt).getTime() : undefined,
        } as import('../types').ToolCallStep)

        if (tc.result) {
          steps.push({
            id: `${tc.id}_result`,
            type: StepType.TOOL_RESULT,
            toolCallId: tc.id,
            toolName: tc.name,
            result: tc.result,
            status: 'success',
            startTime: new Date(createdAt).getTime(),
            endTime: new Date(createdAt).getTime(),
          } as import('../types').ToolResultStep)
        }
      }
    }

    if (answerContent) {
      steps.push({
        id: `text_${m.id}`,
        type: StepType.TEXT_STREAM,
        content: answerContent,
        status: 'success',
        startTime: new Date(createdAt).getTime(),
        endTime: new Date(createdAt).getTime(),
      } as import('../types').TextStreamStep)
    }

    return {
      id: `db_${m.id}`,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content as string,
      steps,
      status: 'success' as const,
      timestamp: new Date(createdAt).getTime(),
      thinkingContent,
      answerContent,
      toolCalls,
    }
  })
}

/** 发送聊天请求 (SSE 流) */
export function createChatRequest(body: {
  sessionId: string | null
  message: string
  model: string
  stream: boolean
  deepThinking: boolean
  webSearch: boolean
  signal?: AbortSignal
}): Promise<Response> {
  return fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.COMPLETIONS}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body),
    signal: body.signal,
  })
}

/** 删除会话 */
export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.CHAT.SESSION_BY_ID(sessionId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error('删除会话失败')
}

/** 创建 Agent 会话 (POST /agent/sessions) */
export async function createAgentSession(title: string, model: string): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AGENT.SESSIONS}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ title, model, agentMode: 'react_agent' }),
  })
  if (!res.ok) throw new Error('创建Agent会话失败')
  return res.json()
}

/** 加载 Agent 会话消息 (GET /agent/sessions/{sessionId}/messages) */
export async function fetchAgentSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await fetch(
    `${API_BASE_URL}${API_ENDPOINTS.AGENT.MESSAGES(sessionId)}`,
    { headers: authHeaders() },
  )
  if (!res.ok) throw new Error('加载Agent会话消息失败')

  const rawData: Array<Record<string, unknown>> = await res.json()

  return rawData.map((m: Record<string, unknown>) => {
    const content = (m.content ?? '') as string
    const contentBlocks = (m.contentBlocks ?? []) as Array<{
      type: string
      status: string
      text?: string
      toolName?: string
      executionId?: string
      summary?: string
    }>
    const createdAt = (m.createdAt ?? '') as string
    const role = (m.role ?? 'assistant') as string

    const steps: AgentStep[] = []

    if (contentBlocks && contentBlocks.length > 0) {
      for (const block of contentBlocks) {
        const blockStatus: 'pending' | 'streaming' | 'success' | 'error' =
          block.status === 'error' ? 'error' : block.status === 'running' ? 'streaming' : 'success'

        if (block.type === 'thinking') {
          steps.push({
            id: `thinking_${m.id}_${steps.length}`,
            type: StepType.THINKING,
            content: block.summary || '',
            status: blockStatus,
            startTime: new Date(createdAt).getTime(),
            endTime: new Date(createdAt).getTime(),
          } as import('../types').ThinkingStep)
        } else if (block.type === 'tool_call') {
          steps.push({
            id: block.executionId || `tool_${m.id}_${steps.length}`,
            type: StepType.TOOL_CALL,
            toolName: block.toolName || 'unknown',
            arguments: block.summary || '',
            status: blockStatus,
            startTime: new Date(createdAt).getTime(),
            endTime: blockStatus !== 'streaming' ? new Date(createdAt).getTime() : undefined,
          } as import('../types').ToolCallStep)
        } else if (block.type === 'tool_result') {
          steps.push({
            id: `${block.executionId || 'result'}_${steps.length}`,
            type: StepType.TOOL_RESULT,
            toolCallId: block.executionId || '',
            toolName: block.toolName || 'unknown',
            result: block.summary || '',
            status: blockStatus,
            startTime: new Date(createdAt).getTime(),
            endTime: new Date(createdAt).getTime(),
          } as import('../types').ToolResultStep)
        } else if (block.type === 'text_stream') {
          steps.push({
            id: `text_${m.id}_${steps.length}`,
            type: StepType.TEXT_STREAM,
            content: block.text || '',
            status: blockStatus,
            startTime: new Date(createdAt).getTime(),
            endTime: blockStatus !== 'streaming' ? new Date(createdAt).getTime() : undefined,
          } as import('../types').TextStreamStep)
        }
      }
    } else if (content) {
      // 兼容仅有 content 的消息
      steps.push({
        id: `text_${m.id}`,
        type: StepType.TEXT_STREAM,
        content,
        status: 'success',
        startTime: new Date(createdAt).getTime(),
        endTime: new Date(createdAt).getTime(),
      } as import('../types').TextStreamStep)
    }

    return {
      id: `agent_${m.id}`,
      role: role as 'user' | 'assistant' | 'system',
      content,
      steps,
      status: 'success' as const,
      timestamp: new Date(createdAt).getTime(),
    }
  })
}

/** 发送 Agent 请求 (SSE 流) POST /agent/completions */
export function createAgentRequest(body: {
  sessionId: string | null
  message: string
  stream: boolean
  signal?: AbortSignal
}): Promise<Response> {
  return fetch(`${API_BASE_URL}${API_ENDPOINTS.AGENT.COMPLETIONS}`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ sessionId: body.sessionId, message: body.message, stream: body.stream }),
    signal: body.signal,
  })
}

export { authHeaders, API_BASE_URL }
