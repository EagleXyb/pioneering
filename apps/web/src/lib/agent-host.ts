/**
 * Web HitlHost 接线（T1.3）
 *
 * HITL 状态机（@pioneering/agent-protocol 的 useHitlStore）所需的宿主动作，
 * 统一在此绑定；与具体模式相关的动作（resume / restore / finalize）由当前
 * 激活模式的 Hook 在挂载时通过 bindAgentModeRuntime 注册。
 *
 * 本模块为副作用模块，在 main.tsx 中 import 一次。
 */
import {
  bindHitlHost,
  type HitlHost,
} from '@pioneering/agent-protocol'
import { fetchHitlState, abortAgentHitl } from '../api/agent'
import { useConversationStore } from '../store/conversationStore'

/** 当前激活模式（pro / task）注册的运行时动作 */
export interface AgentModeRuntime {
  /** 本地暂停会话 id（recover 判定本地是否处于暂停态） */
  getPausedSessionId: () => string | null
  resumeHitl: HitlHost['resumeHitl']
  restoreHitlPause: HitlHost['restoreHitlPause']
  finalizeHitlStale: HitlHost['finalizeHitlStale']
}

let activeRuntime: AgentModeRuntime | null = null

/** 模式 Hook 挂载/卸载时注册（null=注销） */
export function bindAgentModeRuntime(runtime: AgentModeRuntime | null): void {
  activeRuntime = runtime
}

bindHitlHost({
  getCurrentSessionId: () => useConversationStore.getState().activeId ?? null,
  selectSession: (id) => useConversationStore.getState().activate(id),
  getPausedSessionId: () => activeRuntime?.getPausedSessionId() ?? null,
  getState: (threadId) => fetchHitlState(threadId),
  resumeHitl: (sessionId, input) =>
    activeRuntime?.resumeHitl(sessionId, input) ??
    Promise.resolve({ ok: false as const, reason: 'Agent 运行时未就绪，请重试。' }),
  abortHitl: (sessionId, reason) => abortAgentHitl(sessionId, reason),
  restoreHitlPause: (input) => activeRuntime?.restoreHitlPause(input),
  finalizeHitlStale: (sessionId, reason) =>
    activeRuntime?.finalizeHitlStale(sessionId, reason),
})
