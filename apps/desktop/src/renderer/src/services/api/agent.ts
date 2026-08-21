// ============================================================
// Agent Service — 后端 ReAct Agent 相关 API
// 端点定义见 app/api/v1/agent.py
// ============================================================

import apiClient from './client'
import { streamAgui, type AguiStreamCallbacks } from './agui'
import type {
  AgentSession,
  ChatSession,
  CreateAgentSessionRequest,
  UpdateSessionRequest,
  AgentToolExecution,
  SendMessageRequest,
  ResumeRequest,
  AbortRequest,
  HitlStateResponse
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

  /**
   * 更新 Agent 会话（标题等）。Agent 会话与聊天会话共用同一张
   * chat_sessions 表，复用 /chat/sessions/:id 端点。
   */
  async updateSession(
    sessionId: string,
    data: UpdateSessionRequest
  ): Promise<ChatSession> {
    const res = await apiClient.put<ChatSession>(
      `/chat/sessions/${sessionId}`,
      data
    )
    return res.data
  },

  /** 发送消息并获取 Agent 流式响应（AG-UI 协议，含工具调用） */
  sendMessageStream(
    request: SendMessageRequest,
    cb: AguiStreamCallbacks
  ): AbortController {
    return streamAgui('/agent/completions', request, cb)
  },

  /**
   * AI 生成 Agent 会话标题。
   * Agent 会话与聊天会话共用 chat_sessions 表与 /chat/sessions/:id 端点，
   * 故复用 chat 的 generate-title 接口；后端生成后自行持久化，前端仅同步本地。
   */
  async generateTitle(sessionId: string): Promise<string | null> {
    try {
      const res = await apiClient.post<{ title: string }>(
        `/chat/sessions/${sessionId}/generate-title`
      )
      return res.data?.title || null
    } catch {
      return null
    }
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
  },

  // ========== HITL（Human-in-the-Loop）=====
  // 阶段二 2.2：resume / abort / state 三个服务方法，与 chat.ts 的
  // sendMessageStream / stopGeneration 同款写法。

  /**
   * 恢复被 interrupt 暂停的 Agent run（HITL）。
   * 复用 streamAgui 指向 /agent/resume，返回与初次生成一致的 AG-UI SSE 流。
   */
  resumeStream(request: ResumeRequest, cb: AguiStreamCallbacks): AbortController {
    return streamAgui('/agent/resume', request, cb)
  },

  /** 中止/拒绝 HITL 待答复项（超时/用户取消后收尾） */
  async abortHitl(threadId: string, reason: AbortRequest['reason'] = 'user_cancel'): Promise<{ message: string; aborted: boolean }> {
    const res = await apiClient.post<{ message: string; aborted: boolean }>('/agent/abort', {
      sessionId: threadId,
      reason
    })
    return res.data
  },

  /** 查询会话的待答复 HITL 状态（前端进页/重连恢复用） */
  async getHitlState(threadId: string): Promise<HitlStateResponse> {
    const res = await apiClient.get<HitlStateResponse>(`/agent/state/${encodeURIComponent(threadId)}`)
    return res.data
  }
}
