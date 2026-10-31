/**
 * Desktop HitlHost 接线
 *
 * HITL 状态机统一使用 @pioneering/agent-protocol 的实现；本模块把 desktop
 * 私有的 chatStore / transport / 澄清观测注入进协议层的 Host 契约。
 *
 * 副作用模块：在 main.tsx 中 import 一次。
 */
import { bindHitlHost } from '@pioneering/agent-protocol'
import { getTransportForRuntime } from '../services/transport'
import {
  trackClarifyAnswered,
  trackClarifyExpired,
  trackClarifySkipped,
} from '../services/clarify-metrics'
import { useChatStore } from '../stores/chatStore'

bindHitlHost({
  getCurrentSessionId: () => useChatStore.getState().currentSessionId,
  selectSession: (sessionId) => useChatStore.getState().selectSession(sessionId),
  getPausedSessionId: () => useChatStore.getState().hitlPausedSessionId,
  getSessionRuntime: (sessionId) =>
    useChatStore.getState().sessions.find((s) => s.id === sessionId)?.runtime,
  getState: (threadId, runtime) => getTransportForRuntime(runtime).getState(threadId),
  resumeHitl: (sessionId, input) => useChatStore.getState().resumeHitl(sessionId, input),
  abortHitl: (sessionId, reason) => useChatStore.getState().abortHitl(sessionId, reason),
  restoreHitlPause: (input) => useChatStore.getState().restoreHitlPause(input),
  finalizeHitlStale: (sessionId, reason) =>
    useChatStore.getState().finalizeHitlStale(sessionId, reason),
  setGlobalError: (message) => useChatStore.setState({ error: message }),
  trackAnswered: (sessionId, kind) => trackClarifyAnswered(sessionId, kind),
  trackSkipped: (sessionId, kind) => trackClarifySkipped(sessionId, kind),
  trackExpired: (sessionId) => trackClarifyExpired(sessionId),
})
