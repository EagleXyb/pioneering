import { API_ENDPOINTS } from '@shared/api/endpoints'
import type { AgentMessage, AgentStep } from '../types'
import { StepType } from '../types'
import type { ChatSession } from '../../workspace/shared/types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000'

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token') || ''
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' }
}

/** 获取 Agent 会话列表 */
export async function fetchAgentSessions(): Promise<ChatSession[]> {
  const res = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AGENT.SESSIONS}`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error('获取Agent会话列表失败')
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

/** 删除 Agent 会话 */
export async function deleteAgentSession(sessionId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE_URL}${API_ENDPOINTS.AGENT.SESSION_BY_ID?.(sessionId) || `/agent/sessions/${sessionId}`}`,
    { method: 'DELETE', headers: authHeaders() },
  )
  if (!res.ok) throw new Error('删除Agent会话失败')
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
export async function fetchAgentSessionMessages(sessionId: string): Promise<AgentMessage[]> {
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
