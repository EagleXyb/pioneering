// ============================================================
// Agent Transport — Agent 流式通道的传输层抽象（云边双模阶段 0）
//
// 目标：把「投递方式」从渲染端业务逻辑中剥离。
//   chatStore / hitlStore 只面向本接口编程，不感知事件
//   来自 HTTP/SSE（云端 backend-ts）还是 Electron IPC（本地主进程）。
//
// 接口语义与 backend-ts 的 REST 端点一一对应：
//   sendMessage  ←→  POST /agent/completions
//   resume       ←→  POST /agent/resume
//   abort        ←→  POST /agent/abort
//   getState     ←→  GET  /agent/state/:threadId
//
// 回调复用 AguiStreamCallbacks：AG-UI 事件是纯 JSON 数据对象，
// 与传输层解耦——两个实现（Http/Ipc）产出同一套回调，上层无感。
// ============================================================

import type {
  SendMessageRequest,
  ResumeRequest,
  AbortRequest,
  HitlStateResponse
} from '@shared/types'
import type { AguiStreamCallbacks } from '../api/agui'

/** 传输通道类型标识（日志与调试用） */
export type AgentTransportKind = 'http' | 'ipc'

export interface AgentTransport {
  /** 通道标识：'http' = 云端 SSE，'ipc' = 本地主进程 */
  readonly kind: AgentTransportKind

  /**
   * 发送 Agent 消息并流式接收（语义对齐 POST /agent/completions）。
   * 返回的 AbortController 由调用方持有，用于停止生成。
   */
  sendMessage(request: SendMessageRequest, cb: AguiStreamCallbacks): AbortController

  /**
   * 恢复被 interrupt 暂停的 Agent run（HITL，语义对齐 POST /agent/resume）。
   * 返回与 sendMessage 一致的 AG-UI 事件流，续写同一条 assistant 消息。
   */
  resume(request: ResumeRequest, cb: AguiStreamCallbacks): AbortController

  /**
   * 中止/拒绝 HITL 待答复项（语义对齐 POST /agent/abort）。
   * reason 缺省 'user_cancel'。
   */
  abort(
    threadId: string,
    reason?: AbortRequest['reason']
  ): Promise<{ message: string; aborted: boolean }>

  /**
   * 查询会话的待答复 HITL 状态（语义对齐 GET /agent/state/:threadId）。
   * 前端进页/重连恢复（hitlStore.recover）用。
   */
  getState(threadId: string): Promise<HitlStateResponse>

  /**
   * 停止该会话进行中的流（语义对齐 POST /agent/completions/stop）。
   * 云边双模阶段 1：chatStore.stopStreaming 据此按通道分流，
   * 本地模式下不再误打云端端点。
   */
  stop(sessionId: string): Promise<{ message: string; aborted: boolean }>
}
