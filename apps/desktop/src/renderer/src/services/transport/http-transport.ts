// ============================================================
// HTTP Transport — AgentTransport 的云端实现（云边双模阶段 0）
//
// 薄封装现有 agentService 的流式与 HITL 四方法，行为与改造前
// 完全一致（同一函数、同一参数、同一返回值），仅改变调用入口：
// chatStore 不再直接 import agentService 的流式方法，而是经
// TransportProvider 获取本实现。
//
// 阶段 1 将新增 IpcTransport（Electron 主进程内嵌 modu-agent），
// 与本实现并存，由 TRANSPORT_MODE 特性开关选择。
// ============================================================

import type {
  SendMessageRequest,
  ResumeRequest,
  AbortRequest,
  HitlStateResponse
} from '@shared/types'
import { agentService } from '../api/agent'
import type { AguiStreamCallbacks } from '../api/agui'
import type { AgentTransport } from './types'

export const httpTransport: AgentTransport = {
  kind: 'http',

  sendMessage(request: SendMessageRequest, cb: AguiStreamCallbacks): AbortController {
    return agentService.sendMessageStream(request, cb)
  },

  resume(request: ResumeRequest, cb: AguiStreamCallbacks): AbortController {
    return agentService.resumeStream(request, cb)
  },

  async abort(
    threadId: string,
    reason: AbortRequest['reason'] = 'user_cancel'
  ): Promise<{ message: string; aborted: boolean }> {
    return agentService.abortHitl(threadId, reason)
  },

  async getState(threadId: string): Promise<HitlStateResponse> {
    return agentService.getHitlState(threadId)
  },

  async stop(sessionId: string): Promise<{ message: string; aborted: boolean }> {
    // agentService.stopGeneration 失败由调用方 catch 忽略（best-effort，与改造前一致）
    await agentService.stopGeneration(sessionId)
    return { message: 'stopped', aborted: true }
  }
}
