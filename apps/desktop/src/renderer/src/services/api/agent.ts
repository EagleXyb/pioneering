// ============================================================
// Agent Service — 后端 ReAct Agent 相关 API
// 端点定义见 app/api/v1/agent.py
// ============================================================

import apiClient from './client'
import { streamAgui, type AguiStreamCallbacks } from './agui'
import type {
  AgentSession,
  CreateAgentSessionRequest,
  AgentToolExecution,
  SendMessageRequest
} from '@shared/types'

export const agentService = {
  /** 创建 Agent 会话 */
  async createSession(data?: CreateAgentSessionRequest): Promise<AgentSession> {
    const res = await apiClient.post<AgentSession>('/agent/sessions', data ?? {})
    return res.data
  },

  /** 获取单个 Agent 会话 */
  async getSession(sessionId: string): Promise<AgentSession> {
    const res = await apiClient.get<AgentSession>(`/agent/sessions/${sessionId}`)
    return res.data
  },

  /** 发送消息并获取 Agent 流式响应（AG-UI 协议，含工具调用） */
  sendMessageStream(
    request: SendMessageRequest,
    cb: AguiStreamCallbacks
  ): AbortController {
    return streamAgui('/agent/completions', request, cb)
  },

  /** 查询某条消息的工具执行轨迹 */
  async getExecutions(messageId: string): Promise<AgentToolExecution[]> {
    const res = await apiClient.get<{ executions: AgentToolExecution[] }>(
      `/agent/messages/${messageId}/executions`
    )
    return res.data.executions
  },

  /** 获取单次工具执行的完整原始结果 */
  async getExecutionResult(executionId: string): Promise<string | null> {
    const res = await apiClient.get<{ executionId: string; outputResult: string | null }>(
      `/agent/executions/${executionId}/result`
    )
    return res.data.outputResult
  },

  /** 停止 Agent 流式生成（best-effort；后端若未实现该端点由调用方 catch 忽略） */
  // B11 修复：原用 { session_id }（snake_case）与 chat.ts 的 { sessionId }（camelCase）不一致，
  // 统一为 camelCase，与项目整体约定及 chat 服务保持一致。
  async stopGeneration(sessionId: string): Promise<void> {
    await apiClient.post('/agent/completions/stop', { sessionId })
  }
}
