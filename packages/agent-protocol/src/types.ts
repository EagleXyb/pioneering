/**
 * HITL（Human-in-the-Loop）协议类型
 *
 * 从 apps/desktop/src/shared/types.ts 摘取（仅 HITL 相关，不整文件搬迁）。
 * 命名约定（硬约束）：
 *   - AG-UI 事件载荷为 snake_case（session_id / tool_calls / pending_tool_calls）
 *   - REST 请求体为 camelCase（sessionId / modifiedArgs）
 */

/** HITL 中断类型：
 * tool_confirm=工具执行审批；clarifying=自由文本澄清；choice=选项式澄清；
 * plan_confirm=方案/文档生成后的"是否基于产物继续执行"确认门（协议预留，
 * 后端图节点暂未发射该事件，本期无 UI）。
 */
export type HitlKind = 'tool_confirm' | 'clarifying' | 'choice' | 'plan_confirm'

/** 方案确认门的产物文件描述（path 可选：未提供时仅展示文件名，不支持点击打开） */
export interface HitlArtifact {
  name: string
  path?: string
}

/** AG-UI USER_QUESTION_REQUEST 事件载荷（snake_case） */
export interface UserQuestionRequestPayload {
  kind: HitlKind
  session_id: string
  run_id?: string
  message?: string
  /** kind='tool_confirm' 时携带待审批的工具调用列表 */
  tool_calls?: Array<{
    id: string
    name: string
    args: Record<string, unknown>
  }>
  /** kind='clarifying' 时携带澄清问题文本 */
  question?: string
  /** kind='choice' 时携带多选选项（description 为选项补充说明，可选） */
  options?: Array<{ id: string; label: string; description?: string }>
  /** kind='plan_confirm' 时携带待确认的产物文件列表（协议预留） */
  artifacts?: HitlArtifact[]
}

/** POST /agent/resume 请求体（对应 Command(resume) 载荷，camelCase） */
export interface ResumeRequest {
  sessionId: string
  approved: boolean
  feedback?: string | null
  /** 改参批准：按 tool_call_id 覆盖原参数 */
  modifiedArgs?: Record<string, Record<string, unknown>> | null
  /** 澄清回答自由文本（kind='clarifying'） */
  answer?: string | null
  /** 多选回答的选项 id（kind='choice'） */
  answerId?: string | null
}

/** POST /agent/abort 请求体（camelCase） */
export interface AbortRequest {
  sessionId: string
  reason?: HitlAbortReason
}

/** GET /agent/state/:threadId 响应（前端进页/重连恢复待答复项；snake_case） */
export interface HitlStateResponse {
  session_id: string
  pending: boolean
  /** 超时自动拒绝后为 true，前端据此收尾 */
  expired?: boolean
  /** 暂停项类型：前端据此选择卡片（不再靠 tool_requires_approval 猜测） */
  kind?: HitlKind
  /** 提示文案（interrupt 载荷透传） */
  message?: string
  /** kind='clarifying' 时的澄清问题 */
  question?: string
  /** kind='choice' 时的选项（description 为选项补充说明，可选） */
  options?: Array<{ id: string; label: string; description?: string }>
  /** kind='plan_confirm' 时的产物文件列表（协议预留） */
  artifacts?: HitlArtifact[]
  next_nodes?: string[]
  pending_tool_calls?: Array<Record<string, unknown>>
  tool_requires_approval?: boolean
  trace_id?: string
  user_id?: string
  created_at?: string | number | null
}

/**
 * 状态机：idle=无待答复项；paused=暂停项等待答复；
 * awaiting=澄清/多选输入中（保留语义，当前与 paused 等价）；
 * resolving=resume 请求进行中（卡片已关，流续写同消息）。
 */
export type HitlStatus = 'idle' | 'paused' | 'awaiting' | 'resolving'

/** 中止原因（对齐 AgentAbortRequestSchema） */
export type HitlAbortReason = 'user_cancel' | 'timeout' | 'reject'

/** 暂停项（与 UserQuestionRequestPayload 对齐，供三类卡片渲染；camelCase） */
export interface HitlItem {
  sessionId: string
  runId?: string
  kind: HitlKind
  message?: string
  /** kind='tool_confirm' 时携带待审批的工具调用列表 */
  toolCalls?: UserQuestionRequestPayload['tool_calls']
  /** kind='clarifying' 时携带澄清问题文本 */
  question?: string
  /** kind='choice' 时携带多选选项 */
  options?: UserQuestionRequestPayload['options']
  /** kind='plan_confirm' 时携带待确认的产物文件列表 */
  artifacts?: UserQuestionRequestPayload['artifacts']
  /** 来源：live=实时事件；recover=进页/重连恢复 */
  origin: 'live' | 'recover'
  /** 入队时间（epoch ms，供 UI 展示序号/耗时） */
  createdAt: number
}

/** 入队入参（去重键与时间戳由 store 生成） */
export type HitlItemInput = Omit<HitlItem, 'createdAt'> & { createdAt?: number }

/** 答复入参（对象式，避免 5 个位置参数导致调用点错位；camelCase） */
export interface HitlResolveInput {
  approved: boolean
  feedback?: string | null
  modifiedArgs?: Record<string, Record<string, unknown>> | null
  /** 澄清回答自由文本（kind='clarifying'） */
  answer?: string | null
  /** 多选回答的选项 id（kind='choice'） */
  answerId?: string | null
}
