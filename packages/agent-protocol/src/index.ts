/**
 * @pioneering/agent-protocol — L2 Agent 协议层
 *
 * 三模式中仅 pro / task 消费（chat 栈不引任何 @pioneering/* 依赖）。
 */
export type {
  HitlKind,
  HitlArtifact,
  UserQuestionRequestPayload,
  ResumeRequest,
  AbortRequest,
  HitlStateResponse,
  HitlStatus,
  HitlAbortReason,
  HitlItem,
  HitlItemInput,
  HitlResolveInput,
} from './types.js'

export { useHitlStore } from './hitlStore.js'
export type { HitlState } from './hitlStore.js'
export { bindHitlStore, getHitlStore } from './hitl-bridge.js'
export type { HitlStoreApi } from './hitl-bridge.js'
export { bindHitlHost, getHitlHost } from './host.js'
export type { HitlHost, ResumeHitlResult, RestoreHitlPauseInput } from './host.js'

export { HitlInlineCard } from './components/HitlInlineCard.js'
export type { HitlInlineCardProps, HitlCardOption } from './components/HitlInlineCard.js'
export { HitlToolConfirmBody } from './components/HitlToolConfirmBody.js'
export type {
  HitlToolConfirmBodyProps,
  HitlToolCall,
} from './components/HitlToolConfirmBody.js'
