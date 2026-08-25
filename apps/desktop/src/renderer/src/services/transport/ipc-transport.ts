// ============================================================
// IPC Transport — AgentTransport 的本地实现（云边双模阶段 1）
//
// 经 preload 暴露的 window.api.agent 调用主进程内嵌的
// modu-agent 运行时（agent-runtime.ts）：
//
//   sendMessage  ←→  AGENT_SEND   ←→  POST /agent/completions
//   resume       ←→  AGENT_RESUME ←→  POST /agent/resume
//   abort        ←→  AGENT_ABORT  ←→  POST /agent/abort
//   getState     ←→  AGENT_STATE  ←→  GET  /agent/state/:threadId
//   stop         ←→  AGENT_STOP   ←→  POST /agent/completions/stop
//
// 流式事件不走 invoke 返回值：主进程经 AGENT_EVENT 通道推送
// AgentEventEnvelope { runId, seq, event }，本实现按 runId 过滤
// 后交给 createAguiEventDispatcher 分发——与 HttpTransport 的
// SSE 解析共用同一份「事件对象 → AguiStreamCallbacks」映射，
// 保证云边事件语义完全同源。
//
// abort 语义对齐 HTTP 模式：AbortController.abort() 静默退订，
// 不触发 onDone/onError（真正的停止由 stop(sessionId) 通知主进程）。
// ============================================================

import type {
  SendMessageRequest,
  ResumeRequest,
  AbortRequest,
  HitlStateResponse
} from '@shared/types'
import type { AgentEventEnvelope } from '@shared/ipc-channels'
import { createAguiEventDispatcher } from '../api/agui'
import type { AguiStreamCallbacks } from '../api/agui'
import type { AgentTransport } from './types'

/** 进行中的 run（runId → 订阅与分发器），终态/abort 后自动清理 */
interface ActiveRun {
  runId: string
  controller: AbortController
  dispatch: (event: Record<string, unknown>) => boolean
  unsubscribe: () => void
  /** 已收敛（终态事件到达或本地 abort）：后续事件一律忽略 */
  finished: boolean
}

const activeRuns = new Map<string, ActiveRun>()

/** 惰性获取 preload 暴露的 agent API（node 测试环境/纯浏览器下为 undefined） */
function getAgentApi() {
  if (typeof window === 'undefined') return undefined
  return window.api?.agent
}

function finishRun(run: ActiveRun): void {
  if (run.finished) return
  run.finished = true
  if (activeRuns.get(run.runId) === run) activeRuns.delete(run.runId)
  try {
    run.unsubscribe()
  } catch {
    // 忽略退订异常（如 preload 已销毁）
  }
}

function generateRunId(method: 'send' | 'resume'): string {
  const uuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${method}-${uuid}`
}

/**
 * 启动一次 IPC run（send / resume 共用）：
 * 先订阅 AGENT_EVENT 再 invoke，保证主进程推送的首个事件不丢；
 * invoke 立即返回（{ok} 只表示「已受理」），流式事件异步到达。
 */
function startRun(
  method: 'send' | 'resume',
  request: SendMessageRequest | ResumeRequest,
  cb: AguiStreamCallbacks
): AbortController {
  const controller = new AbortController()
  const agentApi = getAgentApi()
  if (!agentApi) {
    cb.onError('本地 Agent 运行时不可用（window.api.agent 缺失）')
    return controller
  }

  const runId = generateRunId(method)
  const { dispatch } = createAguiEventDispatcher(cb)
  const run: ActiveRun = {
    runId,
    controller,
    dispatch,
    unsubscribe: () => {},
    finished: false
  }

  run.unsubscribe = agentApi.onEvent((envelope: AgentEventEnvelope) => {
    if (run.finished || envelope.runId !== runId) return
    // 终态事件（RUN_FINISHED/RUN_ERROR/RUN_PAUSED/HITL_ABORTED）：分发后退订
    if (run.dispatch(envelope.event)) finishRun(run)
  })
  activeRuns.set(runId, run)

  // 对齐 HTTP 模式 abort 语义：静默退订，不触发 onDone/onError
  controller.signal.addEventListener('abort', () => finishRun(run))

  agentApi[method](runId, request as SendMessageRequest & ResumeRequest)
    .then((res) => {
      if (run.finished) return
      if (!res || !res.ok) {
        finishRun(run)
        cb.onError(res?.error || `agent.${method} 调用失败`)
      }
    })
    .catch((err: unknown) => {
      if (run.finished) return
      finishRun(run)
      cb.onError(String(err))
    })

  return controller
}

export const ipcTransport: AgentTransport = {
  kind: 'ipc',

  sendMessage(request: SendMessageRequest, cb: AguiStreamCallbacks): AbortController {
    return startRun('send', request, cb)
  },

  resume(request: ResumeRequest, cb: AguiStreamCallbacks): AbortController {
    return startRun('resume', request, cb)
  },

  async abort(
    threadId: string,
    reason: AbortRequest['reason'] = 'user_cancel'
  ): Promise<{ message: string; aborted: boolean }> {
    const agentApi = getAgentApi()
    if (!agentApi) throw new Error('本地 Agent 运行时不可用')
    const res = await agentApi.abort(threadId, reason)
    // error 语义对齐 HttpTransport：失败以异常形式抛出（调用方 catch 收尾）
    if (res && res.error) throw new Error(res.error)
    return { message: res?.message ?? '', aborted: res?.aborted ?? false }
  },

  async getState(threadId: string): Promise<HitlStateResponse> {
    const agentApi = getAgentApi()
    if (!agentApi) throw new Error('本地 Agent 运行时不可用')
    return agentApi.state(threadId)
  },

  async stop(sessionId: string): Promise<{ message: string; aborted: boolean }> {
    const agentApi = getAgentApi()
    if (!agentApi) return { message: '本地 Agent 运行时不可用', aborted: false }
    return agentApi.stop(sessionId)
  }
}
