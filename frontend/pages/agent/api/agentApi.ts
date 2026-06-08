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

export { authHeaders, API_BASE_URL }
