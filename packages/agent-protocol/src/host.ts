/**
 * HitlHost —— HITL 状态机的宿主契约（依赖注入）
 *
 * 背景：desktop 版 hitlStore 直接 import desktop 的 chatStore / transport /
 * clarify-metrics。本包作为共享协议层不能反向依赖宿主私有模块，因此将这些
 * 调用点收敛为 Host 接口：由各宿主（web / desktop）在启动时 bindHitlHost
 * 注入自己的实现。状态机本身的行为与 desktop 版完全一致。
 */
import type {
  HitlAbortReason,
  HitlItem,
  HitlKind,
  HitlResolveInput,
  HitlStateResponse,
} from './types.js'

/** resumeHitl 返回：ok=false 时 reason 为可展示原因（store 回滚 paused 并显示） */
export interface ResumeHitlResult {
  ok: boolean
  reason?: string
}

/** 恢复时重建暂停容器的入参（camelCase） */
export interface RestoreHitlPauseInput {
  sessionId: string
  kind: HitlKind
  message?: string
  question?: string
  toolCalls?: NonNullable<HitlItem['toolCalls']>
}

export interface HitlHost {
  /** 当前激活会话 id */
  getCurrentSessionId(): string | null | undefined
  /** 切换当前会话（暂停项归属其他会话时调用） */
  selectSession?(sessionId: string): void
  /** 宿主侧记录的暂停会话 id（recover 时判定本地是否处于暂停态） */
  getPausedSessionId(): string | null | undefined
  /** 会话 runtime（云端 web 恒为 cloud；不区分时可返回 undefined） */
  getSessionRuntime?(sessionId: string): 'local' | 'cloud' | undefined
  /** 查询后端 HITL 状态 */
  getState(
    threadId: string,
    runtime?: 'local' | 'cloud',
  ): Promise<HitlStateResponse | null | undefined>
  /** 发起 resume 续写同一条 assistant 消息 */
  resumeHitl(sessionId: string, input: HitlResolveInput): Promise<ResumeHitlResult>
  /** 通知后端中止待答复项（best-effort） */
  abortHitl(sessionId: string, reason: HitlAbortReason): Promise<unknown> | unknown
  /** 刷新恢复：重建可续写的暂停容器 */
  restoreHitlPause(input: RestoreHitlPauseInput): void
  /** 失效收尾：追加说明文案、解除暂停标记 */
  finalizeHitlStale(sessionId: string, reason: string): void
  /** 写入全局错误提示（无卡片可承载时） */
  setGlobalError?(message: string): void
  // —— 澄清灰度观测（可选；口径对齐 desktop clarify-metrics）——
  trackAnswered?(sessionId: string, kind: HitlKind): void
  trackSkipped?(sessionId: string, kind: HitlKind): void
  trackExpired?(sessionId: string): void
}

let boundHost: HitlHost | null = null

/** 宿主启动时注入实现（唯一接线点） */
export function bindHitlHost(host: HitlHost): void {
  boundHost = host
}

/** 获取已接线的宿主（动作回调中使用；未接线时抛错暴露初始化问题） */
export function getHitlHost(): HitlHost {
  if (!boundHost) {
    throw new Error('[agent-protocol] HitlHost 尚未接线（bindHitlHost 未被调用）')
  }
  return boundHost
}
